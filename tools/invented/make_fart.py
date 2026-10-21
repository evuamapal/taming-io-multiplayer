#!/usr/bin/env python3
# /fart cloud: original greenish-brown puff with bubbles, drawn over the rat skill frames (spell-mouse*, effect 61; the rat
# slot is Cinder Prowler, so nothing else uses them). Writes mimic/invented/png/fart-*.png and adds them to override.json.
# Hashed names come from the direct_scan vm harness (work/spell_hashes.txt: "img/creature/<name> img/h/<hash>.png").
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from make_art import write_png
REPO = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(REPO, "mimic", "invented")
FILL, SHADE, LINE, BUB = (140, 150, 70), (105, 110, 50), (60, 50, 30), (175, 185, 105)

def cloud(w, h, seed, fade):
    rnd = random.Random(seed)
    blobs = [(w * (0.5 + rnd.uniform(-0.18, 0.18)), h * (0.5 + rnd.uniform(-0.18, 0.18)), min(w, h) * rnd.uniform(0.16, 0.26)) for _ in range(6)]
    bubbles = [(w * rnd.uniform(0.15, 0.85), h * rnd.uniform(0.12, 0.88), min(w, h) * rnd.uniform(0.03, 0.06)) for _ in range(5)]
    px = bytearray(w * h * 4); a0 = int(230 * fade)
    for y in range(h):
        for x in range(w):
            d = min(math.hypot(x - bx, y - by) - r for bx, by, r in blobs)
            c = None
            if d < -3: c = FILL if (y - h * 0.42) < (x - w * 0.5) * 0.3 else SHADE
            elif d < 0: c = LINE
            for bx, by, r in bubbles:
                q = math.hypot(x - bx, y - by)
                if q < r - 1.5: c = BUB if q > r * 0.45 or (x < bx and y < by) else (235, 240, 200)
                elif q < r: c = LINE
            if c: i = (y * w + x) * 4; px[i:i + 4] = bytes((c[0], c[1], c[2], a0))
    return bytes(px)

def main():
    ovr_path = os.path.join(OUT, "override.json"); ovr = json.load(open(ovr_path))
    rows = [l.split() for l in open(os.path.join(REPO, "work", "spell_hashes.txt")) if "spell-mouse" in l]
    for k, (name, url) in enumerate(sorted(rows)):
        url = url.strip('"'); base = os.path.basename(name)[:-4]
        png = "fart-%s.png" % base.replace("spell-", "")
        write_png(os.path.join(OUT, "png", png), 200, 200, cloud(200, 200, k, 1.0 - 0.04 * (k % 8)))
        ovr["/" + url] = "invented/png/" + png
        print("wrote", png, "for", name)
    json.dump(ovr, open(ovr_path, "w"), indent=1, sort_keys=True)

if __name__ == "__main__":
    main()
