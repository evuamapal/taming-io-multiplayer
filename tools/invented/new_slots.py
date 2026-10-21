#!/usr/bin/env python3
# Invented pets as their own species (client ids 155 Grove Colossus, 156 Stormhorn, 157 Cinder Prowler; see
# tools/invented/client_patch.js): the client asks for every registered image as img/h/<hash>.png, the hash being three
# FNV-1a passes over the image path. This moves the invented art in mimic/invented/override.json off the real species'
# sprite names (mammoth 41, reindeer 13, rat 39, which get their own art back) onto the new species' names:
#   img/creature/<baby-|boss-|><base>-<part>.png  ->  img/creature/<baby-|boss-|><key>-<part>.png
#   img/interface/card-<base><n>-<state>.png      ->  img/interface/card-<key><n>-<state>.png
# plus bmb-grove-{head,body,tail} (the giant stage) on the Grove Colossus boss art.
# Idempotent. Usage: new_slots.py [--table work/creature_images_pinned.json]
import argparse, json, os, re

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "mimic", "invented")
NEW = {"grove": 41, "stormhorn": 13, "cinder": 39}   # new species key -> base species (client table slot)


def fnv(s, h):
    for c in s.encode("utf8"):
        h = ((h ^ c) * 16777619) & 0xffffffff
    return h


def hashed(path):   # "img/creature/baby-wolf-head.png" -> "img/h/<24 hex>.png", as the client names it
    return "img/h/" + "".join("%08x" % fnv(path, sd) for sd in (2166136033, 2166136043, 2166136061)) + ".png"


def new_path(key, base_name, path):
    m = re.match(r"^img/creature/(baby-|boss-)?" + re.escape(base_name) + r"-([a-z-]+)\.png$", path)
    if m: return "img/creature/%s%s-%s.png" % (m.group(1) or "", key, m.group(2))
    m = re.match(r"^img/interface/card-" + re.escape(base_name) + r"(\d)-(in|out|click)\.png$", path)
    if m: return "img/interface/card-%s%s-%s.png" % (key, m.group(1), m.group(2))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", default=os.path.join(REPO, "work", "creature_images_pinned.json"))
    A = ap.parse_args()
    tab = json.load(open(A.table))
    ovr_path = os.path.join(OUT, "override.json")
    ovr = json.load(open(ovr_path))
    assert hashed("img/creature/baby-reindeer-head.png") == "img/h/ea0b993ab0eaddd04997702e.png"
    moved = 0
    for key, sp in NEW.items():
        v = tab[str(sp)]
        items = [(p[2], p[3]) for p in v["parts"]] + [("img/interface/%s.png" % c[0], c[1]) for c in v["cards"]]
        for path, url in items:
            k = "/" + url
            if k not in ovr: continue
            np = new_path(key, v["name"], path)
            assert np, path
            ovr["/" + hashed(np)] = ovr.pop(k)
            moved += 1
    # the giant stage (3) draws bmb-<key>-* sprites the pinned table does not list: the Grove Colossus wears its boss art
    for part in ("head", "body", "tail"):
        src = ovr.get("/" + hashed("img/creature/boss-grove-%s.png" % part))
        if src: ovr["/" + hashed("img/creature/bmb-grove-%s.png" % part)] = src
    json.dump(ovr, open(ovr_path, "w"), indent=1, sort_keys=True)
    print("moved", moved, "entries; override entries", len(ovr))


if __name__ == "__main__":
    main()
