#!/usr/bin/env python3
# Merge an extra mirror (e.g. images fetched later on a helper machine: rnd_ws/mirror) into a clone's mirror/.
# Rows are added only for URLs the clone does not have yet; real-host URLs are mapped to the local .invalid name,
# files are copied under their own name. index.jsonl is backed up first. Reads and writes local files only.
# Usage: merge_mirror.py <clone mirror dir> <extra mirror dir> [--dry]
import json, os, re, shutil, sys, time

dst, src = sys.argv[1], sys.argv[2]
dry = "--dry" in sys.argv
REAL = re.compile(r"^(https?://(?:[a-z0-9-]+\.)*)taming\.io(?=[/:?#]|$)", re.I)

have = set()
with open(os.path.join(dst, "index.jsonl"), encoding="utf8") as f:
    for ln in f:
        try: have.add(json.loads(ln)["url"])
        except Exception: pass

add = []
with open(os.path.join(src, "index.jsonl"), encoding="utf8") as f:
    for ln in f:
        try: r = json.loads(ln)
        except Exception: continue
        if not r.get("url") or not r.get("file") or r.get("status", 200) != 200: continue
        r["url"] = REAL.sub(r"\1taming.invalid", r["url"])
        if r["url"] in have or not os.path.exists(os.path.join(src, "files", r["file"])): continue
        have.add(r["url"]); add.append(r)

print("new urls: %d" % len(add))
if dry or not add: sys.exit(0)
idx = os.path.join(dst, "index.jsonl")
shutil.copy2(idx, idx + ".bak_" + time.strftime("%Y%m%d_%H%M%S"))
os.makedirs(os.path.join(dst, "files"), exist_ok=True)
with open(idx, "a", encoding="utf8") as out:
    for r in add:
        t = os.path.join(dst, "files", r["file"])
        if not os.path.exists(t): shutil.copy2(os.path.join(src, "files", r["file"]), t)
        out.write(json.dumps(r) + "\n")
print("merged %d into %s" % (len(add), dst))
