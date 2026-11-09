import sys, glob, wave
import numpy as np
sys.path.insert(0, "/app")
from speaker_verifier import speaker_verifier as sv

SR = 16000

def load(path):
    with wave.open(path, "rb") as w:
        raw = w.readframes(w.getnframes())
    x = np.frombuffer(raw, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768.0
    up = lambda s: np.interp(np.arange(0, len(s), 0.5), np.arange(len(s)), s).astype(np.float32)
    return up(x[:, 0]), up(x[:, 1])

def segments(x, thr, frame=320, gap_frames=10, min_s=1.2):
    n = len(x) // frame
    rms = np.sqrt((x[: n * frame].reshape(n, frame) ** 2).mean(axis=1))
    v = rms > thr
    segs, start, gap = [], None, 0
    for i, f in enumerate(v):
        if f:
            if start is None: start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap > gap_frames:
                end = i - gap + 1
                if (end - start) * frame / SR >= min_s: segs.append((start * frame, end * frame))
                start, gap = None, 0
    if start is not None and (n - start) * frame / SR >= min_s:
        segs.append((start * frame, n * frame))
    return segs, rms

for f in sorted(glob.glob("/tmp/recordings/*.wav")):
    c, a = load(f)
    n = len(c) // 320
    rms = np.sqrt((c[: n * 320].reshape(n, 320) ** 2).mean(axis=1))
    print("\n", f.split("/")[-1][:40], f"dur={len(c)/SR:.0f}s rms p50={np.percentile(rms,50):.4f} p90={np.percentile(rms,90):.4f} p99={np.percentile(rms,99):.4f}")
    thr = max(0.02, np.percentile(rms, 60))
    segs, _ = segments(c, thr)
    print(f"  thr={thr:.4f} segmentos contíguos >=1.2s: {len(segs)} ->", [round((e - s) / SR, 1) for s, e in segs][:12])
    embs = []
    for s, e in segs:
        for model in ("wespeaker",):
            embs.append(sv.extract_embedding(c[s:e][: int(2.0 * SR)], model))
    if len(embs) >= 2:
        sims = [sv.cosine_similarity(embs[i], embs[j]) for i in range(len(embs)) for j in range(i + 1, len(embs))]
        print(f"  intra-call (segmento a segmento, wespeaker): mediana={np.median(sims):.3f} min={min(sims):.3f} max={max(sims):.3f} n={len(sims)}")
    # agente vs cliente
    asegs, _ = segments(a, 0.02)
    if asegs and embs:
        ae = sv.extract_embedding(a[asegs[0][0]:asegs[0][1]][: int(2.0 * SR)], "wespeaker")
        print(f"  agente vs cliente: {np.median([sv.cosine_similarity(ae, e) for e in embs]):.3f}")
