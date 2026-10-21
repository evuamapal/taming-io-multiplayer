#!/usr/bin/env python3
# Stitches the capture-mode scans into the clone map: every static object the scans saw (servers share one map; field 13
# names agree with the base recording at all 405 matched spots), per biome phase from the server's own biome message,
# minus objects already in mimic/world_sp5.json (the base recording wins), plus the 600-unit cells the scans observed
# (synthetic fill there is replaced by what was really seen). Per-server tables: rnd_ws/decoder/typemap_<key>.json.
# Usage: build_world_scan.py SCANS_DEC_DIR TYPEMAP_DIR -> mimic/world_scan.json
import json, glob, os, sys, collections
PKG = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dec, tmd = sys.argv[1], sys.argv[2]
W = json.load(open(os.path.join(PKG, "mimic", "world_sp5.json")))
N = json.load(open(os.path.join(PKG, "decoder", "names.json")))
have = {int(b): {(o["3"], o["4"]) for o in v["objects"] if "3" in o and "4" in o} for b, v in W["phases"].items()}
# names allowed per phase: what the base map uses in that biome (real + synthetic); this drops objects that belong to
# the previous biome while a switch is in flight, and player buildings (wall, spike, door, ...) never appear there
allowed = {int(b): {o.get("name") for o in v["objects"] + v.get("synthetic", [])} for b, v in W["phases"].items()}
BUILD = ("wall", "spike", "door", "turret", "windmill", "pad", "tower", "trap", "chest", "bed", "table", "lamp", "gift")
objs = collections.defaultdict(dict); cells = collections.defaultdict(set); src = collections.defaultdict(collections.Counter)
for f in sorted(glob.glob(os.path.join(dec, "*.v2.jsonl"))):
    key = open(f.replace(".v2.jsonl", ".key")).read().strip(); tm = json.load(open(os.path.join(tmd, "typemap_%s.json" % key))); ph = None
    tag = os.path.basename(f).replace(".v2.jsonl", "")
    for l in open(f):
        r = json.loads(l)
        for x in r.get("msgs", []) or []:
            if not isinstance(x, dict): continue
            t = tm.get(str(x.get("1")))
            if t == 32 and isinstance(x.get("b"), int) and 0 <= x["b"] <= 5: ph = x["b"]
            if t != 79 or x.get("2") != 3 or ph is None or "3" not in x or not isinstance(x.get("13"), int) or x["13"] >= len(N): continue
            if x.get("15") is not None or x.get("16") is not None: continue   # player structures (team / placer), not world objects
            nm = N[x["13"]]
            if nm not in allowed.get(ph, set()) or any(b in nm for b in BUILD): continue
            cells[ph].add((x["3"] // 600, x["4"] // 600))
            p = (x["3"], x["4"])
            if p in have.get(ph, set()) or p in objs[ph]: continue
            rec = {k: v for k, v in x.items() if k.isdigit() and k not in ("0", "11")}
            rec["1"] = 79; rec["name"] = N[x["13"]]; rec["src"] = "scan " + tag
            objs[ph][p] = rec; src[ph][tag] += 1
out = {"note": "capture-mode scans 2026-10-18 stitched onto the base map (tools/scan/build_world_scan.py)", "phases": {}}
for ph in sorted(cells):
    out["phases"][str(ph)] = {"objects": list(objs[ph].values()), "covered_cells_600": sorted(list(c) for c in cells[ph])}
    print("phase", ph, "new objects", len(objs[ph]), "observed cells", len(cells[ph]), "names", collections.Counter(o["name"].rstrip("0123456789") for o in objs[ph].values()).most_common(6))
json.dump(out, open(os.path.join(PKG, "mimic", "world_scan.json"), "w"))
