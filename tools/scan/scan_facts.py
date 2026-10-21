#!/usr/bin/env python3
# Game numbers observable in rx alone, over every decoded capture (scans_dec/*.v2.jsonl + human *_human.v2.jsonl), for
# the clone. Generalizes the single-capture tools/sp3 measurements to the whole corpus (each file decoded with its own
# server typemap). Sections:
#   tick: rx frame interval (median, p10, p90; frames batched under one timestamp skipped)
#   swing: per held item, gap between consecutive swings (field 15) of the same player holding it, gaps 0.2..3 s;
#          period = median (players hold the button; p10 also kept)
#   proj: per projectile kind (cat-2 field 7): speed per frame from consecutive positions, life create->remove,
#         range = p90 straight travel create -> last position; shot period = p10 gap between creates of the kind 40 or less apart
#   wild: per creature species (cat 0 without owner field 13): walk = median moving speed, chase = p90
# Per-file results cached in work/scan_facts/<tag>.json. Output: mimic/data/scan_facts.json, every value with n (samples)
# and files (how many captures it came from). Usage: scan_facts.py [--force]
import collections, glob, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import session_facts as S
OUTDIR = os.path.join(S.PKG, "work", "scan_facts")
OUT = os.path.join(S.PKG, "mimic", "data", "scan_facts.json")

def pct(xs, q):
    xs = sorted(xs); return None if not xs else xs[min(len(xs) - 1, int(q * len(xs)))]

class R(S.Replay):
    def __init__(s, *a):
        super().__init__(*a)
        s.ticks = []; s.lastt = None; s.sw = {}; s.swing = collections.defaultdict(list)
        s.pj = {}; s.proj = []; s.cr = {}; s.wild = collections.defaultdict(list); s.shots = collections.defaultdict(list)
    def frame(s, msgs):
        if s.lastt is not None: s.ticks.append(s.t - s.lastt)
        s.lastt = s.t; super().frame(msgs)
    def create(s, m, i):
        super().create(m, i)
        c = m.get("2")
        if c == 2 and isinstance(m.get("7"), int):
            s.pj[i] = {"k": m["7"], "t": s.t, "p": [(s.t, m.get("3"), m.get("4"))]}
            s.shots[m["7"]].append((s.t, m.get("3"), m.get("4")))
        elif c == 0 and m.get("13") is None and isinstance(m.get("21"), int):
            s.cr[i] = [m["21"], (s.t, m.get("3"), m.get("4"))]
    def update(s, m, i):
        h = super().update(m, i); e = s.E.get(i)
        if e is None: return h
        if "15" in m and e["cat"] == 1:
            it = e["f"].get("8"); last = s.sw.get(i)
            if last and last[1] == it and 0.2 <= s.t - last[0] <= 3: s.swing[it].append(round(s.t - last[0], 3))
            s.sw[i] = (s.t, it)
        if ("3" in m or "4" in m):
            if i in s.pj: s.pj[i]["p"].append((s.t, e["x"], e["y"]))
            elif i in s.cr:
                a = s.cr[i][1]; b = (s.t, e["x"], e["y"]); dt = b[0] - a[0]
                if a[1] is not None and 0.02 < dt <= 0.3:
                    v = math.hypot(b[1] - a[1], b[2] - a[2]) / dt
                    if v < 3000: s.wild[s.cr[i][0]].append(round(v, 1))
                s.cr[i][1] = b
        return h
    def remove(s, i):
        p = s.pj.pop(i, None)
        if p:
            v = []
            for a, b in zip(p["p"], p["p"][1:]):
                dt = b[0] - a[0]
                if a[1] is not None and b[1] is not None and 0.02 < dt <= 0.3: v.append(math.hypot(b[1] - a[1], b[2] - a[2]) / dt)
            q = [x for x in p["p"] if x[1] is not None]
            s.proj.append({"k": p["k"], "life": round(s.t - p["t"], 3), "v": [round(x) for x in v],
                           "travel": round(math.hypot(q[-1][1] - q[0][1], q[-1][2] - q[0][2])) if len(q) >= 2 else 0})
        s.cr.pop(i, None)
        super().remove(i)

def per_file(path, force):
    tag = os.path.basename(path).replace(".v2.jsonl", ""); cp = os.path.join(OUTDIR, tag + ".json")
    if not force and os.path.exists(cp) and os.path.getmtime(cp) >= max(os.path.getmtime(path), os.path.getmtime(__file__)):
        return json.load(open(cp))
    try:
        key = open(path.replace(".v2.jsonl", ".key")).read().strip()
        r = R(path, key, json.load(open(os.path.join(S.DECODER, "typemap_%s.json" % key))), None).run()
        gaps = collections.defaultdict(list)
        for k, sh in r.shots.items():
            for a, b in zip(sh, sh[1:]):
                if a[1] is not None and b[1] is not None and math.hypot(b[1] - a[1], b[2] - a[2]) <= 40 and b[0] - a[0] <= 5: gaps[k].append(round(b[0] - a[0], 3))
        d = {"tag": tag, "ticks": [round(x, 4) for x in r.ticks if 0.01 < x < 1], "swing": {str(k): v for k, v in r.swing.items()},
             "proj": r.proj, "shot_gaps": {str(k): v for k, v in gaps.items()}, "wild": {str(k): v for k, v in r.wild.items()}}
    except Exception as e:
        d = {"tag": tag, "error": str(e)[:200]}
    json.dump(d, open(cp, "w")); return d

def update(force=False):
    os.makedirs(OUTDIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(S.SCANS_DEC, "*.v2.jsonl")) + glob.glob(os.path.join(S.HUMAN, "*_human.v2.jsonl")))
    files = [f for f in files if os.path.exists(f.replace(".v2.jsonl", ".key"))]
    ticks = []; sw = collections.defaultdict(list); swf = collections.Counter(); pj = collections.defaultdict(list); pjf = collections.Counter()
    gaps = collections.defaultdict(list); wild = collections.defaultdict(list); wf = collections.Counter(); ok = 0
    for f in files:
        d = per_file(f, force)
        if "error" in d: continue
        ok += 1; ticks += d["ticks"]
        for k, v in d["swing"].items(): sw[k] += v; swf[k] += 1
        for p in d["proj"]: pj[str(p["k"])].append(p)
        for k in {str(p["k"]) for p in d["proj"]}: pjf[k] += 1
        for k, v in d["shot_gaps"].items(): gaps[k] += v
        for k, v in d["wild"].items(): wild[k] += v; wf[k] += 1
    r = lambda x: None if x is None else round(x, 3)
    out = {"note": "rx-only game numbers over %d decoded captures (tools/scan/scan_facts.py); n = samples, files = captures" % ok,
           "tick": {"median_s": r(pct(ticks, .5)), "p10_s": r(pct(ticks, .1)), "p90_s": r(pct(ticks, .9)), "n": len(ticks)}, "swing": {}, "proj": {}, "wild": {}}
    for k, v in sw.items():
        if len(v) >= 5: out["swing"][k] = {"name": S.item_name(int(k)) if k.lstrip("-").isdigit() else k, "period_s": r(pct(v, .1)), "median_s": r(pct(v, .5)), "n": len(v), "files": swf[k]}
    for k, ps in pj.items():
        vs = [x for p in ps for x in p["v"]]; lifes = [p["life"] for p in ps]
        sp = pct(vs, .5); lf = pct(lifes, .9); g = gaps.get(k, []); tr = pct([p.get("travel", 0) for p in ps], .9)
        out["proj"][k] = {"speed": None if sp is None else round(sp), "life_p90_s": r(lf), "range": tr or None,
                          "shot_period_s": r(pct(g, .1)) if len(g) >= 3 else None, "shot_n": len(g), "n": len(ps), "files": pjf[k]}
    for k, v in wild.items():
        mv = [x for x in v if x > 20]
        if len(mv) >= 20: out["wild"][k] = {"name": S.sp_name(int(k)), "walk": round(pct(mv, .5)), "chase": round(pct(mv, .9)), "n": len(mv), "files": wf[k]}
    json.dump(out, open(OUT, "w"), indent=1)
    return out

if __name__ == "__main__":
    o = update("--force" in sys.argv)
    print(o["note"]); print("tick", o["tick"])
    for k, v in sorted(o["proj"].items(), key=lambda a: int(a[0])): print("proj", k, v)
    for k, v in sorted(o["swing"].items(), key=lambda a: -a[1]["n"])[:40]: print("swing", k, v)
    print("wild species", len(o["wild"]))
