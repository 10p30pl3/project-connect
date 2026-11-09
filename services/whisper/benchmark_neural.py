import os
import glob
import time
import wave
import json
import numpy as np
from speaker_verifier import SpeakerStream, SpeakerVerifierManager, DEFAULT_THRESHOLDS

REC_DIR = "/app/recordings"
wav_files = sorted(glob.glob(os.path.join(REC_DIR, "2026-11-02_*.wav")))
print(f"Starting Neural Benchmark (WeSpeaker & ECAPA) on {len(wav_files)} recordings...")

CARRIER_KEYWORDS = [
    "não existe", "desligado", "fora da área", "caixa postal", 
    "recado", "impossibilitado", "serviço móvel", "chamada encaminhada", 
    "ocupado", "temporariamente"
]

results = []
mgr = SpeakerVerifierManager()

for idx, wav_path in enumerate(wav_files):
    base_name = os.path.basename(wav_path)
    txt_path = wav_path.replace(".wav", ".txt")
    has_carrier = False
    carrier_text = ""
    if os.path.exists(txt_path):
        with open(txt_path, "r", encoding="utf-8") as fh:
            lines = [l.strip() for l in fh if l.strip()]
        client_lines = [l for l in lines if "Cliente:" in l]
        for l in client_lines:
            if any(kw in l.lower() for kw in CARRIER_KEYWORDS):
                has_carrier = True
                carrier_text = l
                break

    with wave.open(wav_path, "rb") as wf:
        nchannels = wf.getnchannels()
        framerate = wf.getframerate()
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)

    # Canal 0 (Cliente)
    audio_int16 = np.frombuffer(raw, dtype=np.int16)[0::nchannels]
    audio_f32 = audio_int16.astype(np.float32) / 32768.0
    duration_s = round(len(audio_f32) / 8000.0, 2)

    chunk_size = 160  # 20ms @ 8kHz
    total_chunks = len(audio_f32) // chunk_size

    rec_entry = {
        "file": base_name,
        "duration_s": duration_s,
        "has_carrier": has_carrier,
        "carrier_text": carrier_text,
        "models": {}
    }

    for model in ["wespeaker", "ecapa"]:
        threshold = DEFAULT_THRESHOLDS[model]
        call_id = f"{base_name}_{model}"
        mgr.clear_call(call_id)
        stream = SpeakerStream(call_id, model, threshold=threshold, sample_rate=8000, manager=mgr)

        noise_floor = 0.008
        BASE_VAD_THRESHOLD = 0.015
        
        events = []
        latencies_ms = []
        enroll_time_s = None
        verif_sims = []

        t_start = time.time()

        for c_idx in range(total_chunks):
            chunk = audio_f32[c_idx * chunk_size : (c_idx + 1) * chunk_size]
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            dyn_thresh = max(BASE_VAD_THRESHOLD, min(0.06, noise_floor * 2.2))
            is_speech = rms > dyn_thresh

            if not is_speech:
                noise_floor = 0.92 * noise_floor + 0.08 * rms

            work = stream.feed(chunk, is_speech)
            if work:
                t0 = time.time()
                evt = stream.run(work)
                dt_ms = (time.time() - t0) * 1000.0
                if evt:
                    evt_time = round((c_idx * chunk_size) / 8000.0, 2)
                    evt["time_s"] = evt_time

                    if work == "enroll":
                        enroll_time_s = evt_time
                        latencies_ms.append(dt_ms)
                    elif work == "verify":
                        latencies_ms.append(dt_ms)
                        verif_sims.append(evt.get("similarity", 0.0))
                    events.append(evt)

        total_proc_time = time.time() - t_start

        verifs = [e for e in events if e.get("type") == "speaker_verification"]
        matches = [e for e in verifs if e.get("is_match")]
        blocks = [e for e in verifs if not e.get("is_match")]
        
        sims_all = [v.get("similarity", 0.0) for v in verifs]
        mean_sim = round(float(np.mean(sims_all)), 4) if sims_all else None

        avg_lat = round(float(np.mean(latencies_ms)), 2) if latencies_ms else 0.0
        p95_lat = round(float(np.percentile(latencies_ms, 95)), 2) if latencies_ms else 0.0
        max_lat = round(float(np.max(latencies_ms)), 2) if latencies_ms else 0.0

        rec_entry["models"][model] = {
            "threshold": threshold,
            "enrolled": stream.enrolled,
            "enroll_time_s": enroll_time_s,
            "total_verifications": len(verifs),
            "matches": len(matches),
            "blocks": len(blocks),
            "pass_rate_pct": round((len(matches) / len(verifs)) * 100, 2) if verifs else (100.0 if stream.enrolled else 0.0),
            "mean_similarity": mean_sim,
            "min_similarity": round(float(np.min(sims_all)), 4) if sims_all else None,
            "max_similarity": round(float(np.max(sims_all)), 4) if sims_all else None,
            "avg_latency_ms": avg_lat,
            "p95_latency_ms": p95_lat,
            "max_latency_ms": max_lat,
            "total_time_s": round(total_proc_time, 2),
            "events_sample": events[:10]
        }

    results.append(rec_entry)
    m_ws = rec_entry["models"]["wespeaker"]["matches"]
    b_ws = rec_entry["models"]["wespeaker"]["blocks"]
    m_ec = rec_entry["models"]["ecapa"]["matches"]
    b_ec = rec_entry["models"]["ecapa"]["blocks"]
    print(f"[{idx+1:02d}/{len(wav_files)}] {base_name[:32]} | WeSpeaker: {m_ws:2d}M/{b_ws:2d}B | ECAPA: {m_ec:2d}M/{b_ec:2d}B")

with open("/app/recordings/benchmark_neural_results.json", "w", encoding="utf-8") as out_f:
    json.dump(results, out_f, indent=2)

print("✅ Neural Benchmark complete. Output written to /app/recordings/benchmark_neural_results.json")
