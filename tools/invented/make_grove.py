#!/usr/bin/env python3
# Grove Colossus (invented forest world boss) art over the forest world boss sprites (dragon-egg0..7 of the client):
# bark colossus with a mossy body, glowing eyes, root arms and a branch crown; the big glow layers go transparent.
# Pure Python (make_art.py rasterizer). Writes mimic/invented/png/grove-egg*.png and adds them to override.json.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_art import render, write_png, hexc, Ellipse, Poly, Stroke, OUT
LINE = hexc("#22301a")
BARK, BARK2, MOSS, MOSS2, GLOW, LEAF = hexc("#7a5230"), hexc("#5a3a20"), hexc("#5f8f2f"), hexc("#86b84a"), hexc("#d8ff7a"), hexc("#4f8a2a")
def body():   # owner: everything in this one sprite, back to front: wide root arms and branch crown, then body, moss, face
    return [
        ([Stroke([(0.30, 0.50), (0.14, 0.58), (0.07, 0.76)], 0.075), Stroke([(0.70, 0.50), (0.86, 0.58), (0.93, 0.76)], 0.075)], BARK, True),
        ([Ellipse(0.075, 0.80, 0.07, 0.065), Ellipse(0.925, 0.80, 0.07, 0.065)], BARK2, True),
        ([Stroke([(0.24, 0.30), (0.20, 0.10), (0.34, 0.20), (0.42, 0.04), (0.50, 0.17), (0.58, 0.04), (0.66, 0.20), (0.80, 0.10), (0.76, 0.30)], 0.05)], BARK, True),
        ([Ellipse(0.20, 0.09, 0.06, 0.05), Ellipse(0.42, 0.04, 0.06, 0.045), Ellipse(0.58, 0.04, 0.06, 0.045), Ellipse(0.80, 0.09, 0.06, 0.05)], LEAF, True),
        ([Ellipse(0.5, 0.56, 0.31, 0.32)], BARK, True),
        ([Ellipse(0.5, 0.45, 0.25, 0.17)], MOSS, True),
        ([Ellipse(0.41, 0.40, 0.06, 0.04), Ellipse(0.59, 0.42, 0.07, 0.04)], MOSS2, False),
        ([Stroke([(0.36, 0.64), (0.40, 0.73), (0.38, 0.82)], 0.016), Stroke([(0.64, 0.63), (0.60, 0.73), (0.62, 0.81)], 0.016)], BARK2, False),
        ([Ellipse(0.41, 0.59, 0.055, 0.05), Ellipse(0.59, 0.59, 0.055, 0.05)], hexc("#1c240f"), False),
        ([Ellipse(0.41, 0.59, 0.035, 0.032), Ellipse(0.59, 0.59, 0.035, 0.032)], GLOW, False),
        ([Poly([(0.43, 0.71), (0.57, 0.71), (0.54, 0.76), (0.46, 0.76)])], hexc("#2a1a0e"), True)]
def head():
    return [([Poly([(0.15, 0.85), (0.25, 0.25), (0.40, 0.55), (0.50, 0.05), (0.60, 0.55), (0.75, 0.25), (0.85, 0.85)])], BARK, True),
            ([Ellipse(0.25, 0.25, 0.08, 0.06), Ellipse(0.5, 0.07, 0.09, 0.06), Ellipse(0.75, 0.25, 0.08, 0.06)], LEAF, True)]
def fist():
    return [([Ellipse(0.5, 0.5, 0.40, 0.38)], BARK, True), ([Stroke([(0.3, 0.45), (0.7, 0.45)], 0.03), Stroke([(0.32, 0.6), (0.68, 0.6)], 0.03)], BARK2, False),
            ([Ellipse(0.5, 0.28, 0.2, 0.08)], MOSS, False)]
def crown():
    return [([Stroke([(0.05, 0.8), (0.25, 0.3), (0.4, 0.6), (0.5, 0.1), (0.6, 0.6), (0.75, 0.3), (0.95, 0.8)], 0.07)], BARK, True),
            ([Ellipse(0.25, 0.3, 0.07, 0.15), Ellipse(0.5, 0.12, 0.07, 0.15), Ellipse(0.75, 0.3, 0.07, 0.15)], LEAF, True)]
def arm():
    return [([Stroke([(0.5, 0.05), (0.42, 0.35), (0.58, 0.6), (0.48, 0.95)], 0.30)], BARK, True), ([Stroke([(0.5, 0.15), (0.46, 0.5)], 0.08)], MOSS, False)]
DESIGN = {"dragon-egg2.png": body, "dragon-egg3.png": head, "dragon-egg4.png": fist, "dragon-egg6.png": crown, "dragon-egg7.png": arm}
CLEAR = {"dragon-egg0.png", "dragon-egg1.png", "dragon-egg5.png", "dragon-egg3.png", "dragon-egg4.png", "dragon-egg6.png", "dragon-egg7.png"}   # glow / shell layers: transparent
# owner: arm, fist, head and crown layers are drawn under the body; at 2.5x they stick out around it
GROW = {}
SIZE = {"dragon-egg0.png": (1514, 1563), "dragon-egg1.png": (1684, 1563), "dragon-egg2.png": (975, 966), "dragon-egg3.png": (445, 406),
        "dragon-egg4.png": (316, 305), "dragon-egg5.png": (952, 942), "dragon-egg6.png": (408, 156), "dragon-egg7.png": (109, 293)}
def main(table):
    ovr_path = os.path.join(OUT, "override.json"); ovr = json.load(open(ovr_path))
    for p, h in json.load(open(table)):
        f = p.split("/")[-1]
        if f not in SIZE: continue
        w, h2 = SIZE[f]; g = GROW.get(f, 1); w, h2 = round(w * g), round(h2 * g); png = "grove-" + f.replace("dragon-", "")
        if f in CLEAR: write_png(os.path.join(OUT, "png", png), 8, 8, bytes(8 * 8 * 4))
        else: write_png(os.path.join(OUT, "png", png), w, h2, render(w, h2, DESIGN[f](), max(6, round(min(w, h2) * 0.03)), LINE))
        ovr["/" + h] = "invented/png/" + png; ovr["/" + p] = "invented/png/" + png
        print("wrote", png, flush=True)
    json.dump(ovr, open(ovr_path, "w"), indent=1, sort_keys=True)
if __name__ == "__main__":
    main(sys.argv[1])
