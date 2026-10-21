#!/usr/bin/env python3
# Pet movement per species from every decoded capture (scans_dec/*.v2.jsonl and human *.v2.jsonl), for the clone.
# Pets = creatures (cat 0) whose create carries an owner id (field 13). Speed = hypot(dx, dy) / dt between consecutive
# position records of the same pet (~94 ms frames); gaps over 0.3 s and jumps over 3000 u/s (re-creates, teleports) skipped.
# Per species and stage: walk = median moving speed (> 20 u/s), run = p90 of all its moving samples pooled (wolf 268 vs
# the sp5 human-capture 270), dash = median peak of runs of 2+ frames above 1.8 x that run (null when none), dash_ms =
# median length of those runs (94 ms per frame).
# Per-file results are cached in work/pet_speed/<tag>.json (rebuilt when the v2 file or this script is newer).
# Output: mimic/data/pet_speed.json. Usage: pet_speed.py [--force]
import collections, glob, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import session_facts as S
PKG = S.PKG
OUTDIR = os.path.join(PKG, "work", "pet_speed")
OUT = os.path.join(PKG, "mimic", "data", "pet_speed.json")
MAX_DT, MAX_V, MOVING, DASH_K = 0.3, 3000.0, 20.0, 1.8

def pct(xs, q):
    xs = sorted(xs)
    return None if not xs else xs[min(len(xs) - 1, int(q * len(xs)))]

class R(S.Replay):
    def __init__(s, *a):
        super().__init__(*a); s.tr = {}    # pet id -> {sp, stage, pts: [(t, x, y)]}
    def create(s, m, i):
        super().create(m, i)
        if m.get("2") == 0 and isinstance(m.get("13"), int) and m["13"] > 0 and isinstance(m.get("21"), int):
            s.tr[i] = {"sp": m["21"], "stage": m.get("23"), "pts": [(s.t, m.get("3"), m.get("4"))]}
    def update(s, m, i):
        h = super().update(m, i)
        if i in s.tr and ("3" in m or "4" in m):
            e = s.E.get(i)
            if e and e["x"] is not None: s.tr[i]["pts"].append((s.t, e["x"], e["y"]))
            if e and isinstance(e["f"].get("23"), int): s.tr[i]["stage"] = e["f"]["23"]
        return h
    def remove(s, i):
        if i in s.tr: s.tr[i]["pts"].append(None)    # break the track
        super().remove(i)

def pet_tracks(path):
    key = open(path.replace(".v2.jsonl", ".key")).read().strip()
    tm = json.load(open(os.path.join(S.DECODER, "typemap_%s.json" % key)))
    r = R(path, key, tm, None).run()
    out = []
    for i, p in r.tr.items():
        v = []; seg = []
        for a, b in zip(p["pts"], p["pts"][1:]):
            if a is None or b is None or a[1] is None or b[1] is None: v.append(None); continue
            dt = b[0] - a[0]
            if dt <= 0.02 or dt > MAX_DT: v.append(None); continue
            sp = math.hypot(b[1] - a[1], b[2] - a[2]) / dt
            v.append(None if sp > MAX_V else round(sp, 1)); seg.append(dt)
        mv = [x for x in v if x is not None and x > MOVING]
        if len(mv) < 5: continue
        out.append({"id": i, "sp": p["sp"], "stage": p["stage"], "v": v})
    return out

def per_file(path, force):
    tag = os.path.basename(path).replace(".v2.jsonl", ""); cp = os.path.join(OUTDIR, tag + ".json")
    if not force and os.path.exists(cp) and os.path.getmtime(cp) >= max(os.path.getmtime(path), os.path.getmtime(__file__)):
        return json.load(open(cp))
    try: d = {"tag": tag, "pets": pet_tracks(path)}
    except Exception as e: d = {"tag": tag, "pets": [], "error": str(e)[:200]}
    json.dump(d, open(cp, "w")); return d

def dashes(v, run):
    out, cur = [], []
    for x in v + [None]:
        if x is not None and x > DASH_K * run: cur.append(x); continue
        if len(cur) >= 2: out.append({"peak": max(cur), "ms": round(len(cur) * 94)})
        cur = []
    return out

def summarize(pets):
    mv = [x for p in pets for x in p["v"] if x is not None and x > MOVING]
    run = pct(mv, 0.9); ds = [d for p in pets for d in dashes(p["v"], run)] if run else []
    med = lambda xs: None if not xs else round(pct(xs, 0.5))
    return {"walk": med(mv), "run": None if run is None else round(run), "dash": med([d["peak"] for d in ds]), "dash_ms": med([d["ms"] for d in ds]),
            "samples": len(mv), "pets": len(pets), "dash_samples": len(ds)}

def update(force=False):
    os.makedirs(OUTDIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(S.SCANS_DEC, "*.v2.jsonl")) + glob.glob(os.path.join(S.HUMAN, "*_human.v2.jsonl")))
    files = [f for f in files if os.path.exists(f.replace(".v2.jsonl", ".key"))]
    by = collections.defaultdict(list); src = collections.Counter()
    for f in files:
        d = per_file(f, force)
        for p in d["pets"]: by[p["sp"]].append(p); src[p["sp"]] += 1
    out = {"note": "pet movement per species from tools/scan/pet_speed.py over %d decoded captures; u/s" % len(files)}
    for sp in sorted(by):
        doc = summarize(by[sp]); doc["name"] = S.sp_name(sp); st = collections.defaultdict(list)
        for p in by[sp]: st[str(p["stage"])].append(p)
        doc["stages"] = {k: summarize(v) for k, v in sorted(st.items())}
        out[str(sp)] = doc
    out["all"] = summarize([p for v in by.values() for p in v]); out["all"]["name"] = "all species"
    json.dump(out, open(OUT, "w"), indent=1)
    return out

if __name__ == "__main__":
    o = update("--force" in sys.argv)
    for k, v in o.items():
        if k != "note": print(k, v["name"], {a: v[a] for a in ("walk", "run", "dash", "dash_ms", "pets", "dash_samples")})
