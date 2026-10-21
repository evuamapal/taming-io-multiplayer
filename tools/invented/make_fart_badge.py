#!/usr/bin/env python3
# Fart badge art (owner: the top player badge at 100,000,000, after ancient, everyone's default; client side in
# tools/invented/client_patch.js). The badge, its preview tile and icons are drawn from the ancient badge's own art
# (dark backing kept, the ancient mask swapped for a green fart cloud, the preview pattern tinted green).
# Adds them to mimic/invented/override.json (DOM paths and the canvas img/h/ name; rerun after make_art.py).
# Needs Pillow. Usage: make_fart_badge.py <badge-ancient.png> <preview-badge-ancient.png>   (mirror copies of the client's)
import colorsys, json, os, sys
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PNG = os.path.join(REPO, "mimic", "invented", "png")


def cloud(w, h):   # green cloud with a dark outline and two highlights, drawn 4x and scaled down
    S = 4; im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    puffs = [(0.34, 0.56, 0.22), (0.56, 0.44, 0.25), (0.72, 0.62, 0.19), (0.47, 0.69, 0.19), (0.22, 0.69, 0.14)]
    u = min(w, h) * S
    for col, grow in (((40, 52, 24, 255), 0.05), ((126, 190, 58, 255), 0.0)):
        for x, y, r in puffs:
            r = (r + grow) * u; cx, cy = x * w * S, y * h * S
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    for x, y, r in ((0.47, 0.40, 0.08), (0.69, 0.56, 0.06)):
        r *= u; cx, cy = x * w * S, y * h * S
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(196, 232, 128, 255))
    return im.resize((w, h), Image.LANCZOS)


def backing(src):   # the badge's dark backing only: every pixel of the ancient art becomes the backing colour
    a = src.getchannel("A")
    bg = Image.new("RGBA", src.size, (52, 44, 36, 255)); bg.putalpha(a)
    return bg


def tint(src, hue):   # keep lightness / saturation, move the hue (preview tile pattern)
    px = src.load(); out = src.copy(); po = out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            r2, g2, b2 = colorsys.hls_to_rgb(hue, l, min(1, s * 1.1))
            po[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    return out


def main():
    badge, preview = Image.open(sys.argv[1]).convert("RGBA"), Image.open(sys.argv[2]).convert("RGBA")
    b = backing(badge); c = cloud(int(badge.width * 0.78), int(badge.height * 0.78))
    b.alpha_composite(c, ((b.width - c.width) // 2, (b.height - c.height) // 2))
    b.save(os.path.join(PNG, "badge-fart.png"), optimize=True)
    tint(preview, 0.25).save(os.path.join(PNG, "preview-badge-fart.png"), optimize=True)
    for name, size in (("badge-preview-fart-icon.png", (64, 58)), ("leaderboard-badge-fart.png", (64, 58))):
        i = Image.new("RGBA", size, (0, 0, 0, 0)); c = cloud(size[0] - 4, size[1] - 4); i.alpha_composite(c, (2, 2))
        i.save(os.path.join(PNG, name), optimize=True)
    b.resize((106, 97), Image.LANCZOS).save(os.path.join(PNG, "badge-preview-fart-current.png"), optimize=True)   # the ladder emblem of the current badge
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import new_slots
    op = os.path.join(REPO, "mimic", "invented", "override.json"); ovr = json.load(open(op))
    for f in ("badge-fart.png", "preview-badge-fart.png", "badge-preview-fart-icon.png", "leaderboard-badge-fart.png", "badge-preview-fart-current.png"):
        ovr["/img/interface/" + f] = "invented/png/" + f
    ovr["/" + new_slots.hashed("img/interface/badge-fart.png")] = "invented/png/badge-fart.png"   # the in-world badge (canvas)
    json.dump(ovr, open(op, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
