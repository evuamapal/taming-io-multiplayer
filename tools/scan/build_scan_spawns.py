#!/usr/bin/env python3
# Wild creature spawn stats from the capture-mode scans, per biome phase (server biome message, atl4 type 32 field b):
# templates [species, type, stage, unique creature ids] sorted by count desc, per_scan = unique wild creatures per scan.
# Wild = atl4 type 79 create with field 2 == 0 and no owner (field 13 absent); species 21, type 22, stage 23,
# each creature counted once per scan with its last sighting. per_scan (density) only from scans of MIN_VIEW_S or longer:
# the Oct 17 tracker scans last ~27 s and see a fraction of what a 4-min walk sees; their creatures still feed the mix.
# Usage: build_scan_spawns.py SCANS_DEC_DIR TYPEMAP_DIR [TAG_LIST] -> mimic/data/scan_spawns.json
import json, glob, os, sys, collections
PKG = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOTE = ("wild creature templates [species, type, stage, count] and unique creatures per scan view, per biome phase, "
        "from the 2026-10-18 capture-mode scans (per-server tables from the client shuffle)")

COMPACT = {"0", "1", "3", "4", "5", "_type"}
def compact(x):
    # compact move records: decode.py now stamps them with the server's own move id and "_c0"; files decoded before that
    # carry the atl4 id 84, which a typemap would misread (fake creates), so both are dropped before any typemap lookup
    return bool(x.get("_c0")) or (x.get("1") == 84 and set(x) <= COMPACT)

MIN_VIEW_S = 120

def build(files, tmd):
    tpl = collections.defaultdict(collections.Counter); per = collections.defaultdict(list)
    for f in files:
        key = open(f.replace(".v2.jsonl", ".key")).read().strip(); tm = json.load(open(os.path.join(tmd, "typemap_%s.json" % key)))
        ph = None; seen = collections.defaultdict(dict); t0 = t1 = None
        for l in open(f):
            r = json.loads(l); ts = r.get("ts")
            if isinstance(ts, (int, float)): t0 = ts if t0 is None else min(t0, ts); t1 = ts if t1 is None else max(t1, ts)
            for x in r.get("msgs", []) or []:
                if not isinstance(x, dict) or compact(x): continue
                t = tm.get(str(x.get("1")))
                if t == 32 and isinstance(x.get("b"), int) and 0 <= x["b"] <= 5: ph = x["b"]
                if t != 79 or x.get("2") != 0 or ph is None or "13" in x or "0" not in x: continue
                if not all(isinstance(x.get(k), int) for k in ("21", "22", "23")): continue
                seen[ph][x["0"]] = (x["21"], x["22"], x["23"])   # last sighting wins (creatures grow a stage)
        for ph in sorted(seen):
            if t0 is not None and t1 - t0 >= MIN_VIEW_S: per[ph].append(len(seen[ph]))
            for v in seen[ph].values(): tpl[ph][v] += 1
    out = {}
    for ph in sorted(tpl):
        out[str(ph)] = {"per_scan": per[ph], "templates": [list(k) + [n] for k, n in tpl[ph].most_common()]}
    out["note"] = NOTE
    return out

if __name__ == "__main__":
    dec, tmd = sys.argv[1], sys.argv[2]
    files = sorted(glob.glob(os.path.join(dec, "*.v2.jsonl")))
    if len(sys.argv) > 3:
        want = {l.split("\t")[0].replace(".jsonl.gz", "").strip() for l in open(sys.argv[3]) if l.strip()}
        files = [f for f in files if os.path.basename(f).replace(".v2.jsonl", "") in want]
    out = build(files, tmd)
    json.dump(out, open(os.path.join(PKG, "mimic", "data", "scan_spawns.json"), "w"))
    for ph in sorted(k for k in out if k != "note"):
        print("phase", ph, "scans", len(out[ph]["per_scan"]), "creatures", sum(out[ph]["per_scan"]), "templates", len(out[ph]["templates"]))
