#!/usr/bin/env python3
# Parses mimic/data/wiki/raw/*.wiki (from crawl.py) into mimic/data/wiki/{animals,hats,items,structures,bosses,biomes,skills}.json.
# Every value is {"value", "source": "wiki", "page", "rev"}. No URLs or real-domain text in the output.
import codecs, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WIKI = os.path.join(REPO, "mimic", "data", "wiki")
RAW = os.path.join(WIKI, "raw")
REAL = codecs.decode("gnzvat.vb", "rot13")
STAGES = ("baby", "medium", "adult", "boss")
STRUCT_PAGES = {"Boost Pads", "Towers", "Turrets", "Walls", "Spikes", "Big Spikes", "Doors", "Windmills", "Heal Pads",
                "Bear Traps", "Grow pad", "Totem", "Crates", "Furniture", "Buildings", "Spike Shields"}
FIELD_RX = {"reload": "reload_s", "speed": "speed", "range": "range", "knockback": "knockback", "damage": "damage",
            "building_damage": "building_damage", "maximum": "maximum", "durability": "durability"}

IDX = json.load(open(os.path.join(RAW, "_index.json")))


def tag(v, page):
    return {"value": v, "source": "wiki", "page": page, "rev": IDX["pages"][page]["rev"]}


def scrub(s):
    s = re.sub(r"https?://\S+", "", s)
    return re.sub(re.escape(REAL), "the game", s, flags=re.I)


def clean(s):
    s = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", s)
    for _ in range(3):
        s = re.sub(r"\{\{Icon\|([^|}]+)\|([^|}]+)\}\}", r"\2 \1", s)
        s = re.sub(r"\{\{Icon\|([^|}]+)\}\}", r"\1", s)
        s = re.sub(r"\{\{(?:Box)[^{}]*\}\}", "", s)
        s = re.sub(r"\{\{Game\}\}", "the game", s)
        s = re.sub(r"\{\{([A-Za-z ]+)\}\}", r"\1", s)
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " / ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"'''?", "", s)
    return scrub(re.sub(r"\s+", " ", s)).strip()


def num(s):
    t = clean(s).replace(",", "")
    if re.fullmatch(r"-?\d+(\.\d+)?\s*%", t): t = t.rstrip("% ")
    if re.fullmatch(r"-?\d+", t): return int(t)
    if re.fullmatch(r"-?\d*\.\d+", t): return float(t)
    return t if t else None


def templates(text, names):
    """Top-level templates whose name is in names: yields (name, params, start)."""
    want = {n.lower().replace("_", " ") for n in names}
    i = 0
    while True:
        i = text.find("{{", i)
        if i < 0: return
        depth, j = 0, i
        while j < len(text):
            if text.startswith("{{", j): depth += 1; j += 2
            elif text.startswith("}}", j):
                depth -= 1; j += 2
                if depth == 0: break
            else: j += 1
        body = text[i + 2:j - 2]
        parts, d, cur, k = [], 0, "", 0
        while k < len(body):
            two = body[k:k + 2]
            if two in ("{{", "[["): d += 1; cur += two; k += 2; continue
            if two in ("}}", "]]"): d -= 1; cur += two; k += 2; continue
            if body[k] == "|" and d == 0: parts.append(cur); cur = ""; k += 1; continue
            cur += body[k]; k += 1
        parts.append(cur)
        name = parts[0].strip().lower().replace("_", " ")
        if name in want:
            params = {}
            for p in parts[1:]:
                if "=" in p:
                    a, b = p.split("=", 1); params[a.strip()] = b.strip()
            yield name, params, i
            i = j
        else:
            i += 2


def pages():
    for title, m in sorted(IDX["pages"].items()):
        if title.startswith("(FANON)") or "Sandbox" in title: continue
        yield title, open(os.path.join(RAW, m["file"])).read()


def animals_and_skills(out_a, out_s, out_b):
    for title, text in pages():
        for _, p, _ in templates(text, ["Animal Infobox"]):
            a = {"name": tag(title, title)}
            for k in ("type", "weight", "tool", "biome", "mount", "shieldable", "taming_chance", "skill_name", "skill_description"):
                if p.get(k): a[k] = tag(num(p[k]), title)
            if "biome" in a:
                a["biomes"] = tag([b.strip() for b in re.split(r",|/| and |<br\s*/?>", clean(p["biome"])) if b.strip()], title)
            st = {}
            for s in STAGES:
                row = {}
                for f in ("health", "dmg", "speed", "weight", "regen_points", "regen_speed"):
                    v = p.get(s + "_" + f)
                    if v not in (None, ""): row[f] = tag(num(v), title)
                if row: st[s] = row
            a["stages"] = st
            sk = {}
            for n in range(1, 20):
                lab = p.get("skill_%d_label" % n)
                if not lab: continue
                sk[clean(lab)] = {s: tag(num(p[s + "_skill_%d_data" % n]), title) for s in STAGES
                                  if p.get(s + "_skill_%d_data" % n) not in (None, "")}
            if sk: a["skill"] = sk
            m = re.search(r"(\d+)\s*XP", text)
            out_a[title] = a
            if p.get("skill_name"):
                out_s[clean(p["skill_name"])] = {"animal": tag(title, title), "description": a.get("skill_description"), "data": sk}
        for _, p, _ in templates(text, ["Boss Infobox"]):
            b = {"name": tag(title, title)}
            for k in ("health", "xp", "type", "biome", "animals"):
                if p.get(k): b[k] = tag(num(p[k]), title)
            moves = []
            for row in table_rows(text):
                if len(row) >= 3 and re.search(r"\d", row[-1]) and not row[0].lower().startswith("move"):
                    moves.append({"move": row[0], "damage": row[-1]})
            if moves: b["moves"] = tag(moves, title)
            out_b[title] = b


def table_rows(text):
    rows = []
    for tbl in re.findall(r"\{\|(.*?)\n\|\}", text, flags=re.S):
        for chunk in re.split(r"\n\|-[^\n]*", tbl)[1:]:
            chunk = re.sub(r"\{\{Box.*?\}\}", "", chunk, flags=re.S)
            cells = []
            for line in chunk.split("\n"):
                if line.startswith("!"): continue
                if line.startswith("|"):
                    for c in re.split(r"\|\|", line[1:]): cells.append(c)
                elif cells:
                    cells[-1] += "\n" + line
            cells = [clean(c) for c in cells]
            if any(cells): rows.append(cells)
    return rows


def items_tables(out_items, out_struct):
    for title, text in pages():
        heads = [(m.start(), clean(m.group(2))) for m in re.finditer(r"^(=+)\s*(.*?)\s*\1\s*$", text, flags=re.M)]
        for _, p, pos in templates(text, ["Items Table"]):
            sec = ""
            for hp, h in heads:
                if hp < pos: sec = h
            base = clean(p.get("name", "")) or (sec if sec not in ("Technical", "Variants", "") else title.rstrip("s"))
            for n in range(1, 12):
                nm = p.get("%d_name" % n)
                if nm is None: continue
                nm = clean(nm).split(" / ")[0].strip()
                full = nm if base.lower() in nm.lower() else (nm + " " + base).strip()
                row = {"name": tag(full, title), "tier": tag(nm, title)}
                if sec: row["section"] = tag(sec, title)
                recipe = {}
                for k, v in p.items():
                    m = re.fullmatch(r"%d_(.+)" % n, k)
                    if not m or m.group(1) == "name" or v == "": continue
                    f = m.group(1)
                    if f.endswith("_recipe"): recipe[f[:-7]] = num(v)
                    else: row[FIELD_RX.get(f, f)] = tag(num(v), title)
                if recipe: row["recipe"] = tag(recipe, title)
                if len(row) <= 3: continue
                (out_struct if title in STRUCT_PAGES else out_items)[full] = row


def infoboxes(out_items):
    for title, text in pages():
        for name, p, _ in templates(text, ["Items Infobox", "WeaponInfobox", "Resource Infobox"]):
            row = {"name": tag(title, title), "infobox": tag(name, title)}
            for k, v in p.items():
                if k in ("image", "caption") or v == "": continue
                row[k] = tag(num(v), title)
            if title not in out_items: out_items[title] = row


def hats(out):
    title = "In-game Shop"
    text = open(os.path.join(RAW, IDX["pages"][title]["file"])).read()
    for sec in re.split(r"^==\s*", text, flags=re.M)[1:]:
        sname = sec.split("==", 1)[0].strip()
        for row in table_rows(sec):
            row = [c for c in row if c != ""]
            if len(row) < 2: continue
            name = row[0]
            cost = None
            for c in row[1:]:
                m = re.fullmatch(r"([\d,]+) Gold", c)
                if m: cost = int(m.group(1).replace(",", ""))
            eff = [c for c in row[1:] if not re.fullmatch(r"[\d,]+ Gold", c)]
            h = {"name": tag(name, title), "kind": tag({"Hats": "hat", "Accessories": "accessory", "Temporary": "temporary"}.get(sname, sname), title),
                 "effect": tag(" | ".join(eff), title)}
            if cost is not None: h["gold"] = tag(cost, title)
            bm = re.search(r"works only in (?:the )?(Winter|Forest|Dark Forest|Desert|Ocean|Volcano)", " ".join(eff))
            if bm: h["biome_buff"] = tag({"biome": bm.group(1), "effect": "faster and protected"}, title)
            out[name] = h
    biomes_txt = open(os.path.join(RAW, IDX["pages"]["Biomes"]["file"])).read()
    m = re.search(r"Feather Tribe[^.]*gives the \[\[player\]\] a (\d+)% shield", biomes_txt)
    if m:
        for n in ("Feather Tribe", "Chapka", "Mushroom Hat", "Turban", "Diving Suit", "Heatmask Hat"):
            if n in out: out[n]["biome_shield_pct"] = tag(int(m.group(1)), "Biomes")


def biomes(animals, bosses):
    out = {}
    for src, key in ((animals, "animals"), (bosses, "bosses")):
        for name, a in src.items():
            bl = a.get("biomes", {}).get("value") if key == "animals" else [clean(str(a.get("biome", {}).get("value", "")))]
            for b in bl or []:
                b = re.sub(r"\s*Biome$", "", b).strip()
                if not b: continue
                o = out.setdefault(b, {"animals": [], "bosses": []})
                o[key].append(name)
    title = "Biomes"
    text = open(os.path.join(RAW, IDX["pages"][title]["file"])).read()
    for m in re.finditer(r"The '''([A-Za-z ]+)'''[^.]*?(?:biome)?[^.]*?last(?:s|ing)? (?:for )?(\d+) minutes", text):
        nm = m.group(1).strip()
        out.setdefault(nm, {"animals": [], "bosses": []})["minutes"] = tag(int(m.group(2)), title)
    for b in out.values():
        b["animals"].sort(); b["bosses"].sort()
    return out


def main():
    A, S, B, I, ST, H = {}, {}, {}, {}, {}, {}
    animals_and_skills(A, S, B)
    items_tables(I, ST)
    infoboxes(I)
    hats(H)
    BI = biomes(A, B)
    for name, obj in (("animals", A), ("skills", S), ("bosses", B), ("items", I), ("structures", ST), ("hats", H), ("biomes", BI)):
        s = json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False)
        assert REAL.lower() not in s.lower() and "http" not in s, name
        open(os.path.join(WIKI, name + ".json"), "w").write(s + "\n")
        print(name, len(obj))


if __name__ == "__main__":
    main()
