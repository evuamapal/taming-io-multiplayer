#!/usr/bin/env python3
# Insect spawn mix per biome from the capture-mode scans: insects are wild creatures of species 57 at stage 3, the insect id
# in field 24 (client: species 57 stage 3 reads its insect from the skin field). Per biome: ids [[id, unique sightings]],
# per_scan = unique insects per scan of MIN_VIEW_S or longer (density, as build_scan_spawns.py).
# Usage: build_insects.py SCANS_DEC_DIR TYPEMAP_DIR OUT_JSON
import json, glob, os, sys, collections
MIN_VIEW_S = 120
SD, TMD, OUT = sys.argv[1:4]
ids = collections.defaultdict(collections.Counter); per = collections.defaultdict(list); nscan = collections.Counter()
for f in sorted(glob.glob(os.path.join(SD, "*.v2.jsonl"))):
    try: key = open(f.replace(".v2.jsonl", ".key")).read().strip(); tm = json.load(open(os.path.join(TMD, "typemap_%s.json" % key)))
    except Exception: continue
    ph = None; seen = collections.defaultdict(dict); t0 = t1 = None; phs = set()
    for l in open(f):
        r = json.loads(l); ts = r.get("ts")
        if isinstance(ts, (int, float)): t0 = ts if t0 is None else min(t0, ts); t1 = ts if t1 is None else max(t1, ts)
        for x in r.get("msgs", []) or []:
            if not isinstance(x, dict) or x.get("_c0"): continue
            t = tm.get(str(x.get("1")))
            if t == 32 and isinstance(x.get("b"), int) and 0 <= x["b"] <= 5: ph = x["b"]
            if ph is not None: phs.add(ph)
            if t == 79 and x.get("2") == 0 and x.get("21") == 57 and x.get("23") == 3 and "13" not in x and isinstance(x.get("24"), int):
                seen[ph][x["0"]] = x["24"]
    long = t0 is not None and t1 - t0 >= MIN_VIEW_S
    for p in phs:
        nscan[p] += 1
        if long: per[p].append(len(seen.get(p, {})))
    for p, d in seen.items():
        for v in d.values(): ids[p][v] += 1
out = {"note": "insects (species 57 stage 3, field 24 = insect id) per biome from the capture-mode scans: ids [[id, unique sightings]], per_scan = unique insects seen per scan view of 120 s or more", "phases": {}}
for p in sorted(ids):
    out["phases"][str(p)] = {"ids": sorted(([k, v] for k, v in ids[p].items() if 0 <= k < 64), key=lambda kv: -kv[1]), "per_scan": per[p], "scans": nscan[p]}
json.dump(out, open(OUT, "w"), indent=1)
for p, v in out["phases"].items():
    ps = sorted(v["per_scan"]); print(p, "scans", v["scans"], "median per scan", ps[len(ps) // 2] if ps else None, "ids", v["ids"][:14])
