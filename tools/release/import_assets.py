#!/usr/bin/env python3
# Imports newly fetched first-party game files from the rnd_ws research mirror into this package's mirror:
# real game hosts rewritten to *.taming.invalid in the URL and in text bodies, third-party entries skipped,
# entries already present kept. SRC_DIR = a mirror dir (index.jsonl + files/) or a capture body dir (captures/*_files). Usage: import_assets.py SRC_DIR [--src-tag "missing-asset fetch"] [--dry]
import codecs, json, os, re, shutil, sys

PKG = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REAL = codecs.decode("gnzvat.vb", "rot13")
HOST_RE = re.compile(re.escape(REAL).encode() + rb"(?![A-Za-z0-9])", re.I)
TEXT = re.compile(r"^text/|javascript|json|xml|css|html")

src_dir, args = sys.argv[1], sys.argv[2:]
tag = args[args.index("--src-tag") + 1] if "--src-tag" in args else None
dry = "--dry" in args
dst_idx = os.path.join(PKG, "mirror", "index.jsonl")
have = set()
for line in open(dst_idx):
    try: have.add(json.loads(line)["url"])
    except Exception: pass

added = skipped_third = skipped_have = missing = rewritten = 0
out = []
for line in open(os.path.join(src_dir, "index.jsonl")):
    try: r = json.loads(line)
    except Exception: continue
    if tag and r.get("src") != tag: continue
    m = re.match(r"^(https?)://([^/]+)(.*)$", r.get("url", ""))
    if not m: continue
    host = m.group(2).lower()
    if not (host == REAL or host.endswith("." + REAL)):
        skipped_third += 1; continue
    url = m.group(1) + "://" + host[: -len(REAL)] + "taming.invalid" + m.group(3)
    if url in have:
        skipped_have += 1; continue
    sp = os.path.join(src_dir, "files", r["file"])
    if not os.path.exists(sp): sp = os.path.join(src_dir, r["file"])   # capture body dirs (captures/*_files) keep bodies next to index.jsonl
    if not os.path.exists(sp) or r.get("status", 200) != 200:
        missing += 1; continue
    data = open(sp, "rb").read()
    ct = r.get("mime") or ""
    for k, v in (r.get("headers") or {}).items():
        if k.lower() == "content-type": ct = v
    if TEXT.search(ct):
        nd = HOST_RE.sub(b"taming.invalid", data)
        if nd != data: rewritten += 1
        data = nd
    rec = {"url": url, "file": r["file"], "status": 200, "mime": r.get("mime") or ct}
    if ct: rec["headers"] = {"Content-Type": ct}
    out.append((rec, data)); have.add(url); added += 1

if not dry:
    with open(dst_idx, "a") as fo:
        for rec, data in out:
            open(os.path.join(PKG, "mirror", "files", rec["file"]), "wb").write(data)
            fo.write(json.dumps(rec, ensure_ascii=False) + "\n")
print("added %d, rewritten text %d, already present %d, third-party skipped %d, missing/bad %d%s"
      % (added, rewritten, skipped_have, skipped_third, missing, " (dry)" if dry else ""))
