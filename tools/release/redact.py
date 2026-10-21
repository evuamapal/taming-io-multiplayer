#!/usr/bin/env python3
# Release helper: redact this machine's home path and user name from every text file under the given
# dirs (--fix), or fail if either appears in the given dirs/zips (--check). Home -> "~", user -> "<user>".
import io, os, sys, zipfile

mode, paths = sys.argv[1], sys.argv[2:]
home = os.path.expanduser("~").encode()
user = os.path.basename(home)
needles = [home, user]


def text(b):
    return b"\0" not in b[:8192]


def fix(b):
    return b.replace(home, b"~").replace(user, b"<user>")


hits, changed, n = [], 0, 0
for p in paths:
    if mode == "--check" and p.endswith(".zip"):
        with zipfile.ZipFile(p) as z:
            for zi in z.infolist():
                n += 1
                b = z.read(zi)
                if any(x in b for x in needles): hits.append(p + "!" + zi.filename)
        continue
    for d, _, fs in os.walk(p):
        for f in fs:
            fp = os.path.join(d, f)
            if os.path.islink(fp): continue
            n += 1
            b = open(fp, "rb").read()
            if not any(x in b for x in needles): continue
            if mode == "--fix" and text(b):
                open(fp, "wb").write(fix(b)); changed += 1
            else:
                hits.append(fp)
print("%s: %d files, %d redacted, %d with user name or home path" % (mode, n, changed, len(hits)))
for h in hits[:20]: print("  HIT", h)
sys.exit(1 if hits else 0)
