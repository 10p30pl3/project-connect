import os
import asyncio
import time
import json
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, UploadFile, File
from contextlib import asynccontextmanager

from priority_worker import PriorityInferenceWorker
from classifier import AMDClassifier
from pii_redactor import redact_pii
from speaker_verifier import speaker_verifier, SpeakerStream, DEFAULT_THRESHOLDS, model_key_of

worker = PriorityInferenceWorker()
classifier = AMDClassifier()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await worker.start()
    yield
    worker.stop()

app = FastAPI(title="Whisper Voice IA (AMD + STT + Biometrics Engine)", lifespan=lifespan)

stats = {
    "total_connections": 0,
    "active_connections": 0,
    "amd_decisions": 0,
    "stt_transcriptions": 0,
    "speaker_verifications": 0
}

@app.get("/healthz")
async def health_check():
    return {
        "status": "ok",
        "model": worker.model_size,
        "device": worker.device,
        "num_workers": worker.num_workers,
        "queue_size": len(worker.queue),
        "speaker_models": speaker_verifier.models_available(),
        "stats": stats
    }

@app.post("/v1/transcribe")
async def transcribe_file(file: UploadFile = File(...)):
    """Transcrição sob demanda de arquivo de áudio (Fila P2 - Baixa prioridade)"""
    content = await file.read()
    if len(content) > 44 and content[:4] == b"RIFF":
        content = content[44:]
    if len(content) % 2 != 0:
        content = content[:-1]
    if len(content) == 0:
        return {"text": ""}

    audio_int16 = np.frombuffer(content, dtype=np.int16)
    audio_float32 = audio_int16.astype(np.float32) / 32768.0

    raw_text = await worker.submit_task(audio_float32, priority=2)
    clean_text = redact_pii(raw_text)

    stats["stt_transcriptions"] += 1
    return {"text": clean_text}

@app.post("/v1/speaker/verify")
async def verify_speakers_api(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    model: str = Query("wespeaker"),
    threshold: float = Query(None)
):
    """
    Compara dois áudios usando WeSpeaker (CAM++) ou ECAPA-TDNN para verificar se pertencem ao mesmo locutor
    """
    c1 = await file1.read()
    c2 = await file2.read()
    if len(c1) > 44 and c1[:4] == b"RIFF": c1 = c1[44:]
    if len(c2) > 44 and c2[:4] == b"RIFF": c2 = c2[44:]
    if len(c1) % 2 != 0: c1 = c1[:-1]
    if len(c2) % 2 != 0: c2 = c2[:-1]

    a1 = np.frombuffer(c1, dtype=np.int16).astype(np.float32) / 32768.0
    a2 = np.frombuffer(c2, dtype=np.int16).astype(np.float32) / 32768.0

    if threshold is None:
        threshold = DEFAULT_THRESHOLDS[model_key_of(model)]

    emb1 = await asyncio.to_thread(speaker_verifier.extract_embedding, a1, model)
    emb2 = await asyncio.to_thread(speaker_verifier.extract_embedding, a2, model)
    sim = speaker_verifier.cosine_similarity(emb1, emb2)

    stats["speaker_verifications"] += 1
    return {
        "model": model,
        "similarity": round(sim, 4),
        "threshold": threshold,
        "is_match": bool(sim >= threshold)
    }

@app.websocket("/ws/audio")
async def audio_stream_endpoint(
    websocket: WebSocket,
    call_id: str = Query("unknown"),
    tenant_id: str = Query("default"),
    amd: bool = Query(True),
    stt: bool = Query(False),
    mode: str = Query("active"),
    spk_filter: str = Query("none"), # "none", "wespeaker", "ecapa"
    spk_threshold: float = Query(None)
):
    await websocket.accept()
    stats["total_connections"] += 1
    stats["active_connections"] += 1

    start_time = time.time()
    audio_buffer = []
    speech_samples = 0
    total_samples = 0
    silence_samples = 0
    # Se amd=False, amd_decided já inicia como True para liberar STT/Biometria imediatamente
    amd_decided = not amd
    speaker_enrolled = False
    is_spk_active = spk_filter.lower() in ["wespeaker", "ecapa"]
    if spk_threshold is None:
        spk_threshold = DEFAULT_THRESHOLDS[model_key_of(spk_filter)]

    # Verificação de locutor em janela deslizante (durante a fala a 8kHz da telefonia)
    spk_stream = SpeakerStream(call_id, spk_filter, spk_threshold, sample_rate=8000) if is_spk_active else None

    BASE_VAD_THRESHOLD = 0.015
    noise_floor = 0.008

    try:
        while True:
            data = await websocket.receive()
            if data.get("type") == "websocket.disconnect":
                break

            if "bytes" in data and data["bytes"]:
                chunk = data["bytes"]
                if len(chunk) % 2 != 0:
                    chunk = chunk[:-1]
                if len(chunk) == 0:
                    continue

                pcm16 = np.frombuffer(chunk, dtype=np.int16)
                f32 = pcm16.astype(np.float32) / 32768.0
                needs_buffer = stt or (amd and not amd_decided)
                if needs_buffer:
                    audio_buffer.append(f32)
                    total_samples += len(f32)

                rms = float(np.sqrt(np.mean(f32 ** 2)))
                dynamic_threshold = max(BASE_VAD_THRESHOLD, min(0.06, noise_floor * 2.2))

                if rms > dynamic_threshold:
                    speech_samples += len(f32)
                    silence_samples = 0
                else:
                    silence_samples += len(f32)
                    noise_floor = 0.92 * noise_floor + 0.08 * rms
                    if needs_buffer and speech_samples == 0 and len(audio_buffer) > 10:
                        dropped = audio_buffer.pop(0)
                        total_samples = max(0, total_samples - len(dropped))

                speech_ms = int((speech_samples / 16000.0) * 1000)
                silence_ms = int((silence_samples / 16000.0) * 1000)
                elapsed_ms = int((time.time() - start_time) * 1000)

                # --- 0. BIOMETRIA VOCAL EM JANELA DESLIZANTE (cadastro + verificação durante a fala) ---
                if spk_stream is not None:
                    work = spk_stream.feed(f32, rms > dynamic_threshold)
                    if work:
                        evt = await asyncio.to_thread(spk_stream.run, work) if work != "idle" else spk_stream.run(work)
                        if evt:
                            if evt["type"] == "speaker_verification":
                                stats["speaker_verifications"] += 1
                            try:
                                await websocket.send_text(json.dumps(evt))
                            except Exception:
                                break

                # --- 1. LÓGICA DE DECISÃO DO AMD (Fila P0) ---
                if amd and not amd_decided:
                    should_decide = False
                    is_silence_timeout = False

                    if elapsed_ms >= 2200 and speech_ms < 150:
                        should_decide = True
                        is_silence_timeout = True
                    elif speech_ms >= 300 and silence_ms >= 350:
                        should_decide = True
                    elif speech_ms >= 1800 or elapsed_ms >= 2400:
                        should_decide = True

                    if should_decide:
                        amd_decided = True
                        stats["amd_decisions"] += 1

                        if is_silence_timeout:
                            decision = {
                                "type": "decision",
                                "call_id": call_id,
                                "label": "silencio",
                                "confidence": 0.98,
                                "transcript": "",
                                "speech_ms": speech_ms,
                                "elapsed_ms": elapsed_ms,
                                "reason": "silence_timeout"
                            }
                        else:
                            full_audio = np.concatenate(audio_buffer) if audio_buffer else np.zeros(0, dtype=np.float32)
                            raw_transcript = await worker.submit_task(full_audio, priority=0)
                            transcript = redact_pii(raw_transcript)

                            clf_result = classifier.classify(
                                text=transcript,
                                speech_ms=speech_ms,
                                silence_ms=silence_ms,
                                is_early_media=False
                            )

                            decision = {
                                "type": "decision",
                                "call_id": call_id,
                                "label": clf_result["label"],
                                "confidence": clf_result["confidence"],
                                "transcript": transcript,
                                "speech_ms": speech_ms,
                                "elapsed_ms": elapsed_ms,
                                "reason": clf_result["reason"],
                                "probas": clf_result.get("probas", {})
                            }

                        audio_buffer = []
                        speech_samples = 0
                        silence_samples = 0
                        total_samples = 0

                        try:
                            await websocket.send_text(json.dumps(decision))
                        except Exception:
                            break

                        if not stt and not is_spk_active:
                            break

                # --- 2. LÓGICA DE TRANSCRIÇÃO CONTÍNUA (STT) (Fila P1) ---
                elif stt and amd_decided:
                    if (speech_ms >= 400 and silence_ms >= 400) or total_samples >= (16000 * 3):
                        if audio_buffer and speech_ms >= 200:
                            phrase_audio = np.concatenate(audio_buffer)
                            phrase_speech_ms = speech_ms
                            audio_buffer = []
                            speech_samples = 0
                            silence_samples = 0
                            total_samples = 0

                            # STT via Whisper
                            if stt:
                                raw_stt = await worker.submit_task(phrase_audio, priority=1)
                                clean_stt = redact_pii(raw_stt)

                                if clean_stt.strip():
                                    stats["stt_transcriptions"] += 1
                                    try:
                                        await websocket.send_text(json.dumps({
                                            "type": "transcript",
                                            "call_id": call_id,
                                            "text": clean_stt,
                                            "speech_ms": phrase_speech_ms,
                                            "is_final": True
                                        }))
                                    except Exception:
                                        break
                        elif total_samples >= (16000 * 3):
                            audio_buffer = []
                            speech_samples = 0
                            silence_samples = 0
                            total_samples = 0

            elif "text" in data and data["text"]:
                try:
                    payload = json.loads(data["text"])
                    cmd_type = payload.get("type")
                    if cmd_type == "stop":
                        break
                    elif cmd_type == "set_spk_filter":
                        new_filter = (payload.get("spk_filter") or "none").lower()
                        new_threshold = payload.get("spk_threshold")
                        if new_threshold is None and new_filter in ["wespeaker", "ecapa"]:
                            new_threshold = DEFAULT_THRESHOLDS[model_key_of(new_filter)]
                        
                        spk_filter = new_filter
                        is_spk_active = spk_filter in ["wespeaker", "ecapa"]
                        if is_spk_active:
                            spk_stream = SpeakerStream(call_id, spk_filter, new_threshold, sample_rate=8000)
                            print(f"[WS] [{call_id}] 🔀 Biometria vocal alterada dinamicamente para {spk_filter.upper()} (limiar={new_threshold})")
                            await websocket.send_text(json.dumps({
                                "type": "speaker_filter_updated",
                                "call_id": call_id,
                                "spk_filter": spk_filter,
                                "threshold": new_threshold
                            }))
                        else:
                            spk_stream = None
                            print(f"[WS] [{call_id}] 🔀 Biometria vocal desativada.")
                except Exception as e:
                    print(f"[WS] [{call_id}] Erro no processamento de comando texto: {e}")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Erro na sessão {call_id}: {e}")
    finally:
        speaker_verifier.clear_call(call_id)
        stats["active_connections"] = max(0, stats["active_connections"] - 1)
