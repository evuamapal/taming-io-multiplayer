#!/usr/bin/env python3
# Drops the real domain suffix from brand text (the name with its domain suffix -> "Taming") in mirror files and the patched
# bundle, so no packaged file carries the real host name in any form. Hosts were already *.invalid.
import codecs, json, os, re, sys

PKG = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUFFIX = codecs.decode("vb", "rot13")
def ch(c):   # one char, literal or \xHH / \uHHHH escaped, any case
    alts = [re.escape(x.encode()) for x in {c.lower(), c.upper()}]
    for x in {c.lower(), c.upper()}:
        alts += [rb"\\x" + ("%02x" % ord(x)).encode(), rb"\\u00" + ("%02x" % ord(x)).encode()]
    return rb"(?:" + rb"|".join(alts) + rb")"
WORD = "taming." + SUFFIX
RX = re.compile(rb"(" + b"".join(ch(c) for c in WORD[:6]) + rb")" + b"".join(ch(c) for c in WORD[6:]) + rb"(?![a-z0-9])", re.I)
dry = "--dry" in sys.argv

files = {os.path.join(PKG, "mimic", "game_mimic.js")}
for line in open(os.path.join(PKG, "mirror", "index.jsonl")):
    try: files.add(os.path.join(PKG, "mirror", "files", json.loads(line)["file"]))
    except Exception: pass
total = 0
for p in sorted(files):
    if not os.path.exists(p): continue
    b = open(p, "rb").read()
    nb, n = RX.subn(rb"\1", b)
    if n:
        total += n
        print("%4d %s" % (n, os.path.relpath(p, PKG)))
        if not dry: open(p, "wb").write(nb)
print("replaced", total, "(dry)" if dry else "")
