#!/usr/bin/env python3
# Per-server shuffle tables for the SP capture server, computed by the client's own code in the inert
# Node vm harness (direct_scan/node/tables.js, no network objects), cross-checked against the capture.
# Usage: learn_map.py [--key saopaulo5] -> mimic/data/sp3_fieldmap.json
import argparse, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
NODE = os.path.expanduser("~/node/bin/node")
TABLES = os.path.expanduser("~/tio/tio_dev/direct_scan/node/tables.js")
ap = argparse.ArgumentParser()
ap.add_argument("--key", default="saopaulo5")
ap.add_argument("--ref", default="atlanta4")
ap.add_argument("--out", default=os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json"))
A = ap.parse_args()

out = subprocess.run([NODE, TABLES, A.key, A.ref], capture_output=True, text=True, cwd=os.path.dirname(TABLES), timeout=120)
tab = json.loads(out.stdout.strip().splitlines()[-1])
sp, at = tab[A.key], tab[A.ref]

# Atlanta#4 type names used by the mimic and PROTOCOL.md
ATL_NAMES = {79: "create", 84: "move", 87: "remove", 53: "inventory", 27: "xp", 59: "own_info", 6: "death",
             64: "board", 19: "own_id", 32: "timer", 36: "item_count", 68: "clan_list", 58: "?58", 11: "?11",
             86: "?86", 31: "?31", 43: "?43"}
types = {}
for name, sid in sp["T"].items():
    aid = at["T"].get(name)
    types[str(sid)] = {"client": name, "atl4": aid, "atl4_name": ATL_NAMES.get(aid)}
ATL_OPS = {0: "aim", 4: "attack", 5: "key", 8: "heartbeat", 16: "rekey", 10: "select", 3: "join_a", 15: "join_b"}
ops = {}
for name, sid in sp["K"].items():
    aid = at["K"].get(name)
    ops[str(sid)] = {"client": name, "atl4": aid, "atl4_name": ATL_OPS.get(aid)}
doc = {
    "server_key": A.key, "ref_key": A.ref, "seeds": sp["seeds"],
    "note": "field_codes: wire code -> field key. Field keys are the same on every server (only wire codes, type ids and tx op ids are shuffled). types: sp3 type id -> client name + Atlanta#4 id. ops: sp3 tx base op -> Atlanta#4 base op.",
    "field_codes": {str(k): str(v) for k, v in sorted(sp["F"].items(), key=lambda kv: int(kv[0]))},
    "atl4_field_codes": {str(k): str(v) for k, v in sorted(at["F"].items(), key=lambda kv: int(kv[0]))},
    "types": dict(sorted(types.items(), key=lambda kv: int(kv[0]))),
    "ops": dict(sorted(ops.items(), key=lambda kv: int(kv[0]))),
}
json.dump(doc, open(A.out, "w"), indent=1)
print("wrote", A.out, len(types), "types", len(ops), "ops", len(doc["field_codes"]), "codes")
