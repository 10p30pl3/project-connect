"""
Avaliação de limiares de verificação de locutor (WeSpeaker CAM++ / ECAPA-TDNN) com gravações reais.

Cada gravação é um WAV estéreo 8kHz (L = Cliente, R = Atendente IA).
  - Enrollment: primeiros ENROLL_S segundos de fala do canal do cliente (como no pipeline real).
  - Genuínas:   janelas de fala (WINDOW_S) do mesmo cliente, depois do enrollment.
  - Impostoras A (sintéticas): janelas do canal do atendente (voz TTS) contra o enrollment.
  - Impostoras B (cross-call): janelas de OUTRAS chamadas (pode ser a mesma pessoa -> limite superior pessimista).

Uso (dentro do container):  python scripts/eval_speaker_thresholds.py /tmp/recordings
"""
import sys
import glob
import wave
import itertools
import numpy as np

sys.path.insert(0, ".")
import os
from speaker_verifier import speaker_verifier  # noqa: E402


ENROLL_S = 1.5
WINDOWS_S = [0.75, 1.0, 1.5]
STEP_S = 0.5
SR = 16000


def load_stereo_8k(path):
    with wave.open(path, "rb") as w:
        assert w.getnchannels() == 2 and w.getframerate() == 8000, f"formato inesperado: {path}"
        raw = w.readframes(w.getnframes())
    x = np.frombuffer(raw, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768.0
    return x[:, 0], x[:, 1]


def upsample_16k(x):
    n = len(x)
    return np.interp(np.arange(0, n, 0.5), np.arange(n), x).astype(np.float32)


def speech_only(x16, frame=320, floor=0.008):
    """Concatena apenas frames de fala (RMS acima de limiar adaptativo simples)."""
    n = len(x16) // frame
    frames = x16[: n * frame].reshape(n, frame)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    thr = max(0.012, np.percentile(rms, 30) * 2.5)
    keep = rms > thr
    return frames[keep].reshape(-1) if keep.any() else np.zeros(0, dtype=np.float32)


def windows(x, win_s):
    w = int(win_s * SR)
    step = int(STEP_S * SR)
    return [x[i:i + w] for i in range(0, len(x) - w + 1, step)]


def eer(gen, imp):
    ths = np.linspace(0, 1, 501)
    best = (1.0, 0.5)
    for t in ths:
        frr = float(np.mean(np.array(gen) < t)) if len(gen) else 0.0
        far = float(np.mean(np.array(imp) >= t)) if len(imp) else 0.0
        d = abs(frr - far)
        if d < best[0]:
            best = (d, t, frr, far)
    return best


def main(rec_dir):
    files = sorted(glob.glob(f"{rec_dir}/*.wav"))
    calls = []
    for f in files:
        try:
            cl, ag = load_stereo_8k(f)
        except Exception as e:
            print("skip", f, e)
            continue
        c = speech_only(upsample_16k(cl))
        a = speech_only(upsample_16k(ag))
        if len(c) >= int((ENROLL_S + 1.5) * SR):
            calls.append({"name": f.split("/")[-1][:30], "client": c, "agent": a})
    print(f"Chamadas utilizáveis (>= {ENROLL_S + 1.5:.1f}s de fala do cliente): {len(calls)}/{len(files)}")
    if not calls:
        return

    for model in ("wespeaker", "ecapa"):
        print("\n" + "=" * 78)
        print(f"MODELO: {model.upper()}")
        # embedding de enrollment por chamada
        for c in calls:
            c["enroll"] = speaker_verifier.extract_embedding(c["client"][: int(ENROLL_S * SR)], model)
        for win_s in WINDOWS_S:
            gen, imp_agent, imp_cross = [], [], []
            for i, c in enumerate(calls):
                rest = c["client"][int(ENROLL_S * SR):]
                for w in windows(rest, win_s):
                    e = speaker_verifier.extract_embedding(w, model)
                    gen.append(speaker_verifier.cosine_similarity(e, c["enroll"]))
                for w in windows(c["agent"], win_s)[:20]:
                    e = speaker_verifier.extract_embedding(w, model)
                    imp_agent.append(speaker_verifier.cosine_similarity(e, c["enroll"]))
                for j, o in enumerate(calls):
                    if j == i:
                        continue
                    for w in windows(o["client"][int(ENROLL_S * SR):], win_s)[:4]:
                        e = speaker_verifier.extract_embedding(w, model)
                        imp_cross.append(speaker_verifier.cosine_similarity(e, c["enroll"]))
            g = np.array(gen)
            print(f"\n-- Janela {win_s:.2f}s | genuínas n={len(g)} | impostoras(agente TTS) n={len(imp_agent)} | cross-call n={len(imp_cross)}")
            print(f"   genuínas  p5={np.percentile(g, 5):.3f} p25={np.percentile(g, 25):.3f} mediana={np.median(g):.3f} p95={np.percentile(g, 95):.3f}")
            if imp_agent:
                ia = np.array(imp_agent)
                print(f"   agente    mediana={np.median(ia):.3f} p95={np.percentile(ia, 95):.3f} max={ia.max():.3f}")
            if imp_cross:
                ic = np.array(imp_cross)
                print(f"   cross     mediana={np.median(ic):.3f} p95={np.percentile(ic, 95):.3f} max={ic.max():.3f}")
            print("   limiar |  FRR(titular bloqueado) | FAR agente | FAR cross")
            for t in (0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65):
                frr = float(np.mean(g < t))
                fa = float(np.mean(np.array(imp_agent) >= t)) if imp_agent else float("nan")
                fc = float(np.mean(np.array(imp_cross) >= t)) if imp_cross else float("nan")
                print(f"   {t:.2f}   |  {frr * 100:6.1f}%               | {fa * 100:6.1f}%    | {fc * 100:6.1f}%")
            if imp_agent:
                _, t, frr, far = eer(gen, imp_agent)
                print(f"   EER (genuínas vs agente) ~ {((frr + far) / 2) * 100:.1f}% @ limiar {t:.2f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/recordings")
