#!/usr/bin/env python3
# Menu art for the invented pets (own species 155 Grove Colossus, 156 Stormhorn, 157 Cinder Prowler): the main menu
# picker and the pet slots load ./img/interface/<key>-{small-card,pet,head-card,body-card,tail-card}.png and
# ./img/creature/baby-<key>-head.png by the species key, which the in-game sprite override does not cover.
# Built from the invented sprites (make_art.py output), laid out like the client's own wolf card layers (287x365).
# Writes mimic/invented/png/menu-*.png and mimic/invented/menu.json, which hosted_server.js serves next to override.json.
# Needs Pillow. Usage: make_menu_art.py
import json, os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INV = os.path.join(REPO, "mimic", "invented")
PETS = {"stormhorn": "stormhorn", "cinder": "cinder", "grove": "grove"}   # client species key (own slots 156 / 157 / 155) -> art prefix


def src(name):
    im = Image.open(os.path.join(INV, "png", name + ".png")).convert("RGBA")
    return im.crop(im.getbbox())


def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def place(canvas, im, box):   # scaled into box (x0, y0, x1, y1), centered
    x0, y0, x1, y1 = box
    im = fit(im, x1 - x0, y1 - y0)
    canvas.alpha_composite(im, (x0 + (x1 - x0 - im.width) // 2, y0 + (y1 - y0 - im.height) // 2))


def fart_icon():   # a little green cloud with a dark outline (the client's type badges are 64x64)
    from PIL import ImageDraw
    S = 4; im = Image.new("RGBA", (64 * S, 64 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    puffs = [(22, 36, 14), (36, 28, 16), (46, 40, 12), (30, 44, 12), (14, 44, 9)]
    for col, grow in (((40, 52, 24, 255), 3), ((126, 190, 58, 255), 0)):
        for x, y, r in puffs:
            r += grow; d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=col)
    for x, y, r in ((30, 26, 5), (44, 36, 4)):
        d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=(196, 232, 128, 255))
    return im.resize((64, 64), Image.LANCZOS)


def main():
    out = {}
    for key, art in PETS.items():
        head, body, tail = src(art + "-st0-head"), src(art + "-st0-body"), src(art + "-st0-tail")
        layers = {}
        for part, im, box in (("tail", tail, (175, 130, 286, 300)), ("body", body, (55, 120, 245, 342)), ("head", head, (0, 62, 175, 226))):
            c = Image.new("RGBA", (287, 365), (0, 0, 0, 0))
            place(c, im, box)
            layers[part] = c
            f = "menu-%s-%s-card.png" % (art, part)
            c.save(os.path.join(INV, "png", f), optimize=True)
            out["/img/interface/%s-%s-card.png" % (key, part)] = "invented/png/" + f
        full = Image.new("RGBA", (287, 365), (0, 0, 0, 0))
        for part in ("tail", "body", "head"):
            full.alpha_composite(layers[part])
        full = full.crop(full.getbbox())
        c = Image.new("RGBA", (75, 95), (0, 0, 0, 0))
        place(c, full, (2, 4, 73, 93))
        f = "menu-%s-small-card.png" % art
        c.save(os.path.join(INV, "png", f), optimize=True)
        out["/img/interface/%s-small-card.png" % key] = "invented/png/" + f
        c = Image.new("RGBA", (184, 265), (0, 0, 0, 0))
        place(c, src(art + "-card0-in"), (0, 0, 184, 265))
        f = "menu-%s-pet.png" % art
        c.save(os.path.join(INV, "png", f), optimize=True)
        out["/img/interface/%s-pet.png" % key] = "invented/png/" + f
        out["/img/interface/%s-pet-card.png" % key] = "invented/png/" + f   # pet-chest card
        out["/img/creature/baby-%s-head.png" % key] = "invented/png/%s-st0-head.png" % art
    # the pet picker's "Fart" type: its badge and menu icon
    c = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    place(c, fart_icon(), (4, 4, 60, 60))
    c.save(os.path.join(INV, "png", "tooltip-element-fart.png"), optimize=True)
    out["/img/interface/tooltip-element-fart.png"] = "invented/png/tooltip-element-fart.png"
    with open(os.path.join(INV, "menu.json"), "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")


if __name__ == "__main__":
    main()
