#!/usr/bin/env python3
# Two-way cross-check: capture-measured numbers vs the community wiki (mimic/data/wiki/*.json).
# Writes mimic/data/wiki_crosscheck.md + .json. Precedence: recording > wiki > guess.
import codecs, json, os, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(REPO, "mimic", "data")
W = {n: json.load(open(os.path.join(D, "wiki", n + ".json"))) for n in ("animals", "hats", "items", "structures", "bosses", "biomes")}
REAL = codecs.decode("gnzvat.vb", "rot13")
STAGE = {0: "baby", 1: "adult", 2: "boss", 3: "bmb"}
HELM = [(955.7, 1484.6), (1649.5, 2218.8)]   # Knight's Helmet worn: equip rows 17288 / 27588, deaths rows 25368 / 37396


def wv(kind, name, *path):
    o = W[kind].get(name)
    for p in path:
        if o is None: return None
        o = o.get(p)
    return o.get("value") if isinstance(o, dict) and "value" in o else o


def helmed(t):
    return any(a <= t <= b for a, b in HELM)


ROWS = []


def row(area, feature, rec, rec_src, wiki, wiki_page, verdict, decision):
    ROWS.append({"area": area, "feature": feature, "recording": rec, "recording_source": rec_src, "wiki": wiki,
                 "wiki_page": wiki_page, "verdict": verdict, "decision": decision})


def close(a, b, tol=0.15):
    return a is not None and b not in (None, 0) and abs(a - b) <= tol * abs(b)


# ------------------------------------------------------------ creature identity
row("creatures", "meaning of create field 22", "creature kind name (12 kinds, names from the client table key)",
    "sp3_facts.json facts.creatures.fields", "14 elemental types; animals of one type spawn in several biomes", "Types, Module:Animals/data",
    "mismatch", "field 22 = TYPE code, field 21 = SPECIES id (starters Wolf/Rabbit/Bear = 21 ids 0/1/2). Every per-kind number in creatures.js mixes species; key by (22, 21)")
row("creatures", "meaning of create field 23", "flag 0..3", "sp3_facts.json facts.creatures.fields",
    "stages baby / adult / boss, plus Big Mamma Boss", "Animals, Template:Animal Infobox",
    "match (new label)", "f23 = growth stage: 0 baby, 1 adult, 2 boss, 3 BMB (HP per stage below); never changes on a live entity in the capture")
TYPE = {20: "Fire", 21: "Water", 44: "Poison", 5: "Spectrum", 46: "Combat", 45: "Ice", 9: "Plant", 29: "Normal", 43: "Rock", 59: "Electric",
        11: "Insect (bugs)", 73: "unknown (single boss-state creature)"}
OLD = {44: "yellow-scorpion", 21: "ice-golem", 46: "dragon-fairy", 20: "dragon", 45: "rock-fairy", 5: "skunk", 11: "polar-bear", 9: "snow-wolf",
       29: "rabbid", 43: "armadillo", 59: "oryx", 73: "plant-mask"}
for k, t in sorted(TYPE.items()):
    row("creatures", "kind %d type" % k, "label '%s'" % OLD[k], "creatures.js KINDS", t, "Types + animal infobox type/biome",
        "mismatch" if OLD[k].split("-")[0].lower() not in t.lower() else "match", "type %s; species from field 21 (table below)" % t)
SPECIES = {(20, 0): ("Wolf", "own pet; Deflagration audio x13 from 70.9 s; pet hp 397"), (20, 8): ("Horse", "flame-dash audio 1941.6 s, pets first seen 1926.5 s"),
           (20, 75): ("Hedgehog", "Fire + Forest, hp 656"), (20, 112): ("Fire Wisp / Salamander / Lava Golem / Rabburn", "Fire + Volcano, no hp sample"),
           (21, 2): ("Bear", "the 'Water Bear' tame: pet create {21: 2, 22: 21} row 42292, ocean-wave audio 2536.2 s"),
           (21, 67): ("Toad", "viscous-tongue audio 782.6 s, Water + Dark Forest"), (21, 77): ("Rabbyss", "Water + Ocean, pet baby hp 319"),
           (21, 79): ("Seahorse", "Water + Ocean, adult 510 / boss 680"), (21, 47): ("Camel", "Water + Desert, f23 3 (BMB) hp ~2175"),
           (21, 83): ("Water + Ocean species (Sea Crab? time-stopping-bubble audio 1608.8 s)", "no hp sample"),
           (44, 31): ("Black Spider", "Poison + Dark Forest, adult hp 382, 15 dmg to the player"), (44, 44): ("Yellow Scorpion", "Poison + Desert"),
           (44, 78): ("Squid", "Poison + Ocean, viscous-ink-jet audio 1613.1 s"), (5, 49): ("Vulture", "Spectrum + Desert, boss hp 850"),
           (5, 48): ("Black Cat", "Spectrum + Dark, hp 350"), (5, 64): ("Raven or Unicorn", "Spectrum + Dark, boss hp ~935"),
           (5, 111): ("Dark Wisp (or Hellhound)", "Spectrum + Volcano, hp 510"), (46, 113): ("Lizardman", "Combat + Volcano, adult hp 382"),
           (46, 66): ("Kangaroo", "Combat + Desert, baby hp 170"), (45, 120): ("Seal", "Ice + Winter, adult hp 1020"),
           (9, 15): ("Deer", "vampiric-dash audio 39.1 s, Plant + Winter, baby hp 198"), (9, 1): ("Rabbit", "starter id 1, Plant + Forest"),
           (29, 59): ("Caracal", "Normal + Desert, baby hp 200"), (43, 53): ("Oryx", "Rock + Desert, baby hp 150"), (43, 3): ("Bull", "Rock + Forest"),
           (43, 82): ("Siren", "Rock/Water + Ocean"), (59, 7): ("Fox", "Electric + Forest"), (59, 91): ("Sheep", "Electric + Forest"),
           (11, 57): ("a bug (Insect)", "in all 6 phases, kill gave XP +75 = wiki insect catch/kill XP 75")}
REC = {}
p = os.path.join(REPO, "work", "wiki_species_stage.json")
if os.path.exists(p):
    for r in json.load(open(p)): REC[(r["k22"], r["f21"], r["f23"])] = r
for (k, f), (name, ev) in sorted(SPECIES.items()):
    hp_rows = [r for kk, r in REC.items() if kk[:2] == (k, f) and not r["pet"]] or [r for kk, r in REC.items() if kk[:2] == (k, f)]
    wname = name if name in W["animals"] else None
    for r in hp_rows:
        st = STAGE.get(r["f23"]); whp = wv("animals", wname, "stages", st, "health") if wname and st != "bmb" else None
        row("creatures", "%s (22=%d, 21=%d) %s hp" % (name, k, f, st), "%d (n %d%s)" % (r["hp"], r["n"], ", pets" if r["pet"] else ""),
            "work/sp3_decoded.jsonl damage field 10 vs hp bar 9 drop (work/wiki_species_stage.json)", whp, wname or "-",
            "match" if close(r["hp"], whp, 0.2) else ("n/a" if whp is None else "pet (level stats)" if r["pet"] else "weak sample (n %d)" % r["n"] if r["n"] < 5 else "mismatch"),
            "recording (pets carry level stats)" if r["pet"] else "recording; wiki fills the other stages")
    if not hp_rows:
        row("creatures", "%s (22=%d, 21=%d) identity" % (name, k, f), ev, "work/wiki_species_rec.json", name, wname or "-", "inferred", "wiki stats for this species")
row("creatures", "own pet species", "'Dragon' (inventory), C.pet_kind 20", "sp3_feature_inventory.md own pet", "Wolf (skill Deflagration)", "Wolf",
    "mismatch", "Wolf (Ion confirmed). Kind 20 = Fire type, species 21 = 0")
row("creatures", "own pet hp", 400, "creatures.js C.pet_hp (median 397, 83 hits)", wv("animals", "Wolf", "stages", "adult", "health"), "Wolf", "match", "recording")
row("creatures", "tamed creature", "ice-golem (inventory)", "sp3_feature_inventory.md taming", "Bear (Water, Forest, tame 66%)", "Bear",
    "mismatch", "Bear: field 21 = 2 and the Ocean Wave cast right after the tame; stage f23 0 = baby (wiki: only sleeping babies can be tamed)")
row("creatures", "Black Spider bite to player (no hat)", 15, "creatures.js SOURCES KINDS.*.dmg (44, row 11645, t 647.8 s, no helm)",
    wv("animals", "Black Spider", "stages", "adult", "dmg"), "Black Spider", "match", "recording")
row("creatures", "Seahorse/Water bite to player", "4 (12 of 15)", "creatures.js KINDS.*.dmg kind 21 (t 1706..1711 s, Knight's Helmet worn)",
    "Seahorse adult 7 x 0.6 (helm -40%) = 4.2", "Seahorse, In-game Shop", "match after helm", "base = wiki bite; the player takes 0.6x with Knight's Helmet")
row("creatures", "Lizardman bite to player", "6 (8 of 9)", "creatures.js KINDS.*.dmg kind 46 (t 2086..2109 s, helm worn)",
    "Lizardman adult 10 x 0.6 = 6", "Lizardman, In-game Shop", "match after helm", "base = wiki bite; helm 0.6x")
row("creatures", "skill cooldown", "10..15 s (guess)", "creatures.js KINDS.*.skill.every", "Reload 30 / 28 / 25 (baby / adult / boss), most animals", "animal infoboxes skill_1",
    "fill", "wiki (seconds), recording has no cadence")
row("creatures", "Wolf Deflagration duration", "skill projectile 108 x2 life 4.0 s (row 32588)", "creatures.js SOURCES KINDS.*.skill",
    "about 4 seconds, caster immobile", "Wolf", "match", "recording")
row("creatures", "Wolf Deflagration damage", "guess", "creatures.js skill dmg", "player 10/15/20 + DoT 1/1/2, animal 20/30/40 + DoT 2/3/4, building 5/10/15 + DoT 1/2/3",
    "Wolf", "fill", "wiki")
row("creatures", "kill XP", "+75 XP, +50 gold (kind 11 kill, row 27434)", "creatures.js KINDS.11.xp",
    "insect catch/kill 75 XP; animals baby 50, adult 100, boss 400, BMB 1200; tamed 1/10", "Pet Level System", "match (kind 11 = bug)",
    "recording for bugs; wiki per stage for the rest")
row("creatures", "speed units", "player walk 488 u/s; pet run 275 u/s; chases 265..390 u/s", "sp3_facts walk, creatures.js C.pet_run, KINDS.chase",
    "Tamer speed 350; Wolf 200/250/280; Black Spider 240/260/320", "Tamer, animal infoboxes", "scale",
    "wiki speed x 488/350 (1.39) approximates u/s for creatures (Black Spider adult 260 -> 363 vs chase 300..360); recording wins where measured")
row("creatures", "pets owned at once", "2 seen (own_info n 2), pet_max 3 guess", "creatures.js C.pet_max",
    "3 slot pets + 3 non-slot pets", "Taming", "match", "3")
row("creatures", "taming", "one sample: 4.7 s, success, no inventory paid", "creatures.js C.tame_ms",
    "only sleeping babies; base chance per species (Wolf/Bear/Rabbit 66%, most 6..18%); +1% per Slingshot/Appletor hit, 5% wake risk; Tamer's Cap x1.29; failure makes it attack; no cost",
    "Taming, animal infoboxes", "match", "recording timing; wiki chance and rules")

# ------------------------------------------------------------ player / items
row("player", "max hp", 100, "sp3_facts summary.max_hp", 100, "Tamer", "match", "recording")
row("player", "passive regen", "none (92 s at 88 HP)", "sp3_facts summary.passive_regen", "none unless Bandage / Angel Wings", "Tamer", "match", "recording")
row("player", "Knight's Helmet price", "10000 (gold 14055 -> 4055, row 17290)", "social.js SOURCES shop_buy_reply", wv("hats", "Knight's Helmet", "gold"), "In-game Shop", "match", "recording")
row("player", "Knight's Helmet effect", "walk factors x~0.6 and hits taken x0.6 while worn (955.7..1484.6 s, 1649.5..2218.8 s)",
    "sp3_facts walk.by_item evidence times + hp.damage_by_cause (this check)", wv("hats", "Knight's Helmet", "effect"), "In-game Shop",
    "match", "damage taken x0.6 (wiki 40%), walk x0.6 (measured; wiki gives no number)")
sp = json.load(open(os.path.join(D, "sp3_facts.json")))["facts"]["walk"]["value"]["by_item"]
fac = json.load(open(os.path.join(D, "sp3_facts.json")))["summary"]["walk_item_factor"][0]
for item, f in sorted(fac.items()):
    ts = [e["t"] for k, v in sp.items() if k.split("/")[0] == item for e in v.get("evidence", [])]
    hm = bool(ts) and all(helmed(t) for t in ts)
    ws = wv("items", item, "speed")
    if ws is None: continue
    exp = ws / 100.0 * (0.6 if hm else 1.0)
    row("player", "walk factor %s" % item, "%s%s" % (f, " (helm worn, t %s)" % ts[0] if hm else (" (t %s)" % ts[0] if ts else "")),
        "sp3_facts summary.walk_item_factor", "speed %s%s" % (ws, " x 0.6 = %.3f" % exp if hm else ""), items_page if (items_page := (W["items"][item]["name"]["page"])) else "",
        "match" if close(f, exp, 0.1) else "mismatch", "recording; for items not measured use wiki speed/100 (x0.6 with Knight's Helmet)")
DMG_C = {"Hand": 6, "Stone Axe": 42, "Golden Axe": 51, "Ruby Axe": 58, "Golden Pickaxe": 26, "Ruby Hammer": 18}
for item, v in DMG_C.items():
    w = wv("items", item, "animal_damage") or wv("items", item, "damage") or wv("items", item, "player_damage")
    row("weapons", "%s damage vs creatures" % item, v, "work/v03_reverify.json damage table (mode)", w, W["items"][item]["name"]["page"] if item in W["items"] else "-",
        "match" if close(v, w, 0.05) else "mismatch", "recording" + ("" if close(v, w, 0.05) else " (wiki %s)" % w))
for item, v, note in (("Hand", 4, "hits on the helmed own player, 6 x 0.6 = 3.6"), ("Golden Axe", 16, "victim gear unknown; 30 x 0.6 = 18"),
                      ("Amethyst Axe", "22 (x2), 33 (x1)", "37 x 0.6 = 22.2 (helm), 37 x 0.9 = 33.3 (biome hat)"), ("Ruby Pickaxe", 30, "target was a pet")):
    w = wv("items", item, "player_damage") or wv("items", item, "damage")
    row("weapons", "%s damage vs players" % item, v, "work/v03_reverify.json damage table", w, W["items"][item]["name"]["page"],
        "match after armour" if item != "Ruby Pickaxe" else "match", "base = wiki player_damage; apply victim hat reduction (%s)" % note)
STEP = {"Hand": 2, "Stone Axe": 10, "Golden Axe": 13, "Golden Pickaxe": 13, "Stone Hammer": 13, "Ruby Axe": 16, "Ruby Pickaxe": 16,
        "Amethyst Pickaxe": 19, "Ruby Hammer": 19, "Sapphire Pickaxe": 24}
for item, s in STEP.items():
    bd = wv("items", item, "building_damage")
    exp = bd * 255.0 / 400 if bd else None
    row("resources", "tree/stone hp byte step %s" % item, s, "game_config.js resource_step_by_tool (v03_audit)",
        "building_damage %s x 255 / 400 hp = %.1f" % (bd, exp) if exp else None, "Wood, Stone, " + (W["items"][item]["name"]["page"] if item in W["items"] else "Hand"),
        "match" if close(s, exp, 0.12) else "mismatch", "recording; unmeasured tools: building_damage x 255 / 400")
row("structures", "structure hp byte step per tool hit", "32 for axes and pickaxes, 24 Stone Hammer (spikes, walls, doors, turrets)",
    "game_config.js struct_step_tool / struct_step_by_tool", "Stone Axe building 15 on Stone Spike 225 hp = 17 bytes; Wooden Wall 400 hp", "Spikes, Walls, Axes",
    "mismatch", "recording (the server does not use building_damage / durability linearly for placed objects); keep 32 / 24")
row("structures", "spike contact damage", "3..5 (diamond 4..5 at 1478 s, amethyst 3..4 at 2214 s, helm worn)", "sp3_facts hp.damage_by_cause object:*-spike",
    "Amethyst Spike 6, Cosmetics (diamond) Spike 7; x 0.6 = 3.6 / 4.2", "Spikes", "match after helm", "base = wiki per tier, x0.6 with Knight's Helmet")
row("structures", "stone turret damage", 12, "creatures.js C.turret_dmg (rows 28541, 28657)", wv("structures", "Stone Turret", "damage"), "Turrets", "match", "recording")
row("structures", "turret damage other tiers", "wooden 10, golden 15, ruby 18, amethyst 21, diamond 24, sapphire 24 (guess)", "creatures.js C.turret_dmg",
    "Wooden 10, Golden 15, Ruby 18, Amethyst 21, Sapphire 25, Cosmetics 25", "Turrets", "mostly match", "wiki: sapphire and diamond (cosmetics) 25")
row("structures", "turret fire period", "0.9..1.5 s", "creatures.js C.turret_every", "reload 1 s wooden, 1.5 s others", "Turrets", "match", "recording 1000 ms; wiki 1500 for stone+ is also in range")
row("structures", "boost pad push", "one pet push: 96, 132, 123, 12 units per frame (~363 in 4 frames), direction = pad angle + 90 deg", "work/v03_reverify.json pads (row 14709)",
    "no push numbers; max 10 per player, durability 100 (Big 1000, Mega 100); Mega pushes harder; Short-Circuit Hat immune", "Boost Pads",
    "fill", "recording profile for the plain pad; wiki limits/durability/recipes; Mega multiplier stays a guess")
row("structures", "repair tower heal", "not measurable (4 heal projectiles, 3 repair sounds)", "v03_audit NOT-SPECIFIED",
    "reload 6 s (Stone/Ruby/Sapphire) / 8 s (Golden/Amethyst/Cosmetics), durability 510..900, pushes enemies; no heal amount", "Towers",
    "fill", "wiki reload + durability; heal amount: guess (Wrench repair 40/70/100/140/200 per hit is the nearest wiki number)")
row("structures", "heal pad", "not in capture", "-", "10 hp per 0.6 s (pets 20); Mega 15 (30); Big = larger radius; durability 500/1000/750", "Heal Pads", "fill", "wiki")
row("structures", "place distance", "62 (boost pad 100)", "v03_audit placing structures", "-", "-", "n/a", "recording")
row("structures", "limits per player", "-", "-", "walls 50, spikes 15, big spikes 12, doors 6, windmills 5, turrets 2, towers 1, boost pads 10, heal/grow pads 1, bear traps 4", "Walls, Spikes, ...", "fill", "wiki")

# ------------------------------------------------------------ food, biomes, hats
for item, (h, ot) in {"Cookie": (12, None), "Sandwich": (8, 4), "Salad": (10, 6), "Mushroom Soup": (12, 8)}.items():
    row("food", "%s heal" % item, "%d instant%s" % (h, ", %d per tick x6" % ot if ot else ""), "items.json heal + game_config heal_tick_by_item",
        "%d instant%s" % (h, ", heal O.T. %d x 6 ticks" % ot if ot else ""), "Food", "match", "recording")
row("biomes", "phase lengths and order", "480 s each, plain 960 s; snow, dark, desert, sea, volcanic, plain", "world_sp5.json / hosted_config game_sources biome",
    "Forest 16 min, others 8; Forest -> Winter -> Darkness -> Desert -> Ocean -> Volcano", "Biomes", "match", "recording")
row("hats", "hat price table", "client table _5268 (70 hats, 38 wings)", "social.js HAT_PRICE / WING_PRICE",
    "every priced wiki hat and accessory has an equal price in the client tables", "In-game Shop", "match (as a set)",
    "client table wins; names per id only verified for 25 = Knight's Helmet")
for n in ("Feather Tribe", "Chapka", "Mushroom Hat", "Turban", "Diving Suit", "Heatmask Hat"):
    row("hats", "%s buff" % n, "not in capture", "-", "%s gold, %s; 10%% shield + small speed boost" % (wv("hats", n, "gold"), wv("hats", n, "effect")),
        "In-game Shop, Biomes", "fill", "wiki (speed multiplier itself: guess)")

out_md = ["# Wiki cross-check (recording vs community wiki)", "",
          "Precedence: recording > wiki > guess. Recording = Saopaulo#5 human capture (sp3_facts.json, work/v03_audit.md, work/v03_reverify.json, creatures.js / social.js SOURCES, game_config.js, hosted_config.json game_sources).",
          "Wiki = mimic/data/wiki/*.json (crawled by tools/wiki/crawl.py, parsed by tools/wiki/parse.py). Generated by tools/wiki/crosscheck.py.", "",
          "Key findings: field 22 is the elemental TYPE and field 21 the SPECIES (our kind names were wrong); f23 is the growth stage; the human wore the Knight's Helmet from 955.7 to 1484.6 s and 1649.5 to 2218.8 s, which explains every 'low' damage and walk number in those windows (x0.6).", "",
          "| area | feature | recording | recording source | wiki | wiki page | verdict | decision |", "|---|---|---|---|---|---|---|---|"]
for r in ROWS:
    out_md.append("| " + " | ".join(str(r[k]).replace("|", "/") if r[k] is not None else "-" for k in
                                       ("area", "feature", "recording", "recording_source", "wiki", "wiki_page", "verdict", "decision")) + " |")
md = "\n".join(out_md) + "\n"
js = json.dumps({"precedence": "recording > wiki > guess", "helm_windows_s": HELM, "rows": ROWS}, indent=1, ensure_ascii=False)
for s in (md, js):
    assert REAL.lower() not in s.lower() and "—" not in s and "–" not in s
open(os.path.join(D, "wiki_crosscheck.md"), "w").write(md)
open(os.path.join(D, "wiki_crosscheck.json"), "w").write(js + "\n")
from collections import Counter
print(len(ROWS), Counter(r["verdict"] for r in ROWS))
