"""
Avaliação rotulada de limiares com vozes sintéticas distintas passadas por um canal de telefonia simulado
(24kHz -> 8kHz -> G.711 u-law -> 8kHz -> 16kHz, igual ao caminho real do gateway).

  gen   : mesma voz, frases diferentes (janela vs. cadastro)
  imp   : vozes diferentes (janela vs. cadastro)
Uso: python scripts/eval_synthetic_telephony.py /tmp/spk_eval   (WAVs nomeados <voz>_<n>.wav, 24kHz mono)
"""
import os, sys, glob, wave, collections
import numpy as np
sys.path.insert(0, ".")
from speaker_verifier import speaker_verifier as sv

SR = 16000


def read_wav(p):
    with wave.open(p, "rb") as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return x, sr


def lin2mulaw2lin(x):
    mu = 255.0
    y = np.sign(x) * np.log1p(mu * np.abs(x)) / np.log1p(mu)
    q = np.round((y + 1) / 2 * 255) / 255 * 2 - 1
    return np.sign(q) * ((1 + mu) ** np.abs(q) - 1) / mu


def telephony(x, sr, noise_snr_db=None):
    # sr -> 8k (média simples por decimação com filtro boxcar) -> µ-law -> 16k (interp linear)
    ratio = sr // 8000
    x8 = x[: len(x) // ratio * ratio].reshape(-1, ratio).mean(axis=1)
    x8 = lin2mulaw2lin(np.clip(x8, -1, 1))
    if noise_snr_db is not None:
        p = np.mean(x8 ** 2) + 1e-9
        x8 = x8 + np.random.default_rng(1).standard_normal(len(x8)) * np.sqrt(p / 10 ** (noise_snr_db / 10))
    return np.interp(np.arange(0, len(x8), 0.5), np.arange(len(x8)), x8).astype(np.float32)


def trim_speech(x, frame=320):
    n = len(x) // frame
    fr = x[: n * frame].reshape(n, frame)
    rms = np.sqrt((fr ** 2).mean(axis=1))
    return fr[rms > max(0.01, rms.max() * 0.05)].reshape(-1)


def main(d):
    voices = collections.defaultdict(list)
    for p in sorted(glob.glob(f"{d}/*.wav")):
        voices[os.path.basename(p).split("_")[0]].append(p)
    for snr in (None, 20, 10):
        print("\n" + "#" * 78)
        print(f"Canal: G.711 simulado | ruído SNR = {snr} dB")
        data = {v: [trim_speech(telephony(*read_wav(p), snr)) for p in ps] for v, ps in voices.items()}
        for model in ("wespeaker", "ecapa"):
            for win_s in (1.0, 1.5):
                w = int(win_s * SR)
                gen, imp = [], []
                for v, clips in data.items():
                    enroll = sv.extract_embedding(clips[0][: int(1.5 * SR)], model)
                    for c in clips[1:]:
                        for i in range(0, len(c) - w + 1, SR // 2):
                            gen.append(sv.cosine_similarity(sv.extract_embedding(c[i:i + w], model), enroll))
                    for u, uclips in data.items():
                        if u == v:
                            continue
                        for c in uclips[1:2]:
                            for i in range(0, min(len(c) - w + 1, 2 * SR), SR // 2):
                                imp.append(sv.cosine_similarity(sv.extract_embedding(c[i:i + w], model), enroll))
                g, im = np.array(gen), np.array(imp)
                print(f"\n[{model} | janela {win_s}s] gen n={len(g)} p5={np.percentile(g,5):.2f} med={np.median(g):.2f} | imp n={len(im)} med={np.median(im):.2f} p95={np.percentile(im,95):.2f} max={im.max():.2f}")
                rows = []
                for t in np.arange(0.10, 0.80, 0.05):
                    rows.append(f"{t:.2f}: FRR {np.mean(g < t)*100:4.1f}% FAR {np.mean(im >= t)*100:4.1f}%")
                print("   " + " | ".join(rows[:7]))
                print("   " + " | ".join(rows[7:]))
                best = min(np.arange(0, 1, 0.01), key=lambda t: abs(np.mean(g < t) - np.mean(im >= t)))
                print(f"   EER ~ {(np.mean(g < best) + np.mean(im >= best)) / 2 * 100:.1f}% @ {best:.2f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/spk_eval")
