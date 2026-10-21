#!/usr/bin/env python3
# Placeholder art for world boss parts the mirror does not have yet (mushroom boss = Polecat stage 3, cactus boss = Deer
# stage 3): one generated shape per boss, served by hosted_server.js only while the real file is missing from the mirror.
# Hash lists: the image paths those boss renders requested that came back blank (world bosses on vs off, same spot).
# Usage: make_placeholders.py MUSH_HASHES CACT_HASHES   -> mimic/invented/placeholder.json + png/placeholder-*.png
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from make_art import write_png
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "mimic", "invented")
LINE = (50, 35, 40)

def shape(w, h, kind):
    px = bytearray(w * h * 4); cx, cy = w / 2, h / 2
    for y in range(h):
        for x in range(w):
            c = None
            if kind == "mushroom":
                cap = ((x - cx) / (w * 0.46)) ** 2 + ((y - cy * 0.85) / (h * 0.36)) ** 2
                stem = abs(x - cx) < w * 0.16 and cy * 0.9 < y < h * 0.92
                if cap <= 1:
                    c = LINE if cap > 0.86 else (150, 70, 170)
                    for sx, sy, r in ((0.35, 0.35, 0.08), (0.62, 0.3, 0.07), (0.5, 0.55, 0.06), (0.28, 0.6, 0.05), (0.72, 0.58, 0.05)):
                        if math.hypot(x - w * sx, y - h * sy) < w * r: c = (240, 230, 245)
                elif stem: c = (235, 220, 190)
            else:
                body = ((x - cx) / (w * 0.38)) ** 2 + ((y - cy) / (h * 0.44)) ** 2
                if body <= 1:
                    c = LINE if body > 0.85 else ((80, 160, 70) if int((x - cx) / (w * 0.12)) % 2 else (95, 180, 80))
                else:
                    a = math.atan2(y - cy, x - cx); r = math.hypot((x - cx) / (w * 0.38), (y - cy) / (h * 0.44))
                    if r < 1.18 and (a * 12 / math.pi) % 2 < 0.35: c = (230, 220, 150)
            if c: i = (y * w + x) * 4; px[i:i + 4] = bytes((*c, 255))
    return bytes(px)

def main():
    ph = {}
    for kind, f in (("mushroom", sys.argv[1]), ("cactus", sys.argv[2])):
        png = "placeholder-%s.png" % kind
        write_png(os.path.join(OUT, "png", png), 180, 180, shape(180, 180, kind))
        for h in open(f).read().split():
            ph["/img/h/%s.png" % h] = "invented/png/" + png
    json.dump({"note": "source=placeholder: served only while the mirror lacks the file (tools/invented/make_placeholders.py)", "map": ph},
              open(os.path.join(OUT, "placeholder.json"), "w"), indent=1, sort_keys=True)
    print(len(ph), "placeholder paths")

if __name__ == "__main__":
    main()
