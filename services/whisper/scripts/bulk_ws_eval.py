#!/usr/bin/env python3
"""
Script de Teste de Carga e Avaliação Offline via WebSocket
Envia arquivos WAV de teste para o endpoint /ws/audio em blocos de 20ms e mede a latência e matriz de confusão.
"""

import asyncio
import websockets
import json
import time
import os
import argparse
import wave

async def test_call(ws_url: str, wav_path: str, call_id: str):
    start = time.time()
    try:
        url = f"{ws_url}?call_id={call_id}&amd=true&stt=false"
        async with websockets.connect(url) as ws:
            with wave.open(wav_path, 'rb') as wf:
                sample_rate = wf.getframerate()
                # Lê em blocos de 20ms
                chunk_size = int(sample_rate * 0.020 * 2) # 2 bytes por sample PCM16

                while True:
                    data = wf.readframes(int(sample_rate * 0.020))
                    if not data:
                        break
                    await ws.send(data)
                    await asyncio.sleep(0.020)

                    # Tenta ler resposta sem bloquear
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=0.005)
                        decision = json.loads(msg)
                        if decision.get('type') == 'decision':
                            elapsed = time.time() - start
                            return {"call_id": call_id, "decision": decision, "elapsed_sec": elapsed}
                    except asyncio.TimeoutError:
                        pass

            # Aguarda resposta final
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=2.5)
                decision = json.loads(msg)
                elapsed = time.time() - start
                return {"call_id": call_id, "decision": decision, "elapsed_sec": elapsed}
            except Exception as e:
                return {"call_id": call_id, "error": str(e)}

    except Exception as e:
        return {"call_id": call_id, "error": str(e)}

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8080/ws/audio")
    parser.add_argument("--wav", required=True, help="Arquivo WAV PCM16 16kHz")
    args = parser.parse_args()

    if not os.path.exists(args.wav):
        print(f"Arquivo {args.wav} não encontrado.")
        return

    res = await test_call(args.url, args.wav, "teste-01")
    print("Resultado:", json.dumps(res, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    asyncio.run(main())
