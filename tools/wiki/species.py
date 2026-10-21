#!/usr/bin/env python3
# Groups capture creatures by (field 22 type, field 21 species, field 23 stage, pet) with hp estimates
# (damage field 10 vs hp bar 9 drop). Writes work/wiki_species_rec.json and work/wiki_species_stage.json.
import collections, json, os, statistics

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEC = os.path.join(REPO, "work", "sp3_decoded.jsonl")
PH = {0: "forest", 1: "snow", 2: "dark", 3: "desert", 4: "sea", 5: "volcanic"}
ents, phase, t0 = {}, None, None
G = collections.defaultdict(lambda: {"ids": set(), "phases": collections.Counter(), "pets": set(), "f23": collections.Counter(), "first": None})
H = collections.defaultdict(list)
for l in open(DEC):
    r = json.loads(l)
    if r["k"] == "ws_open": t0 = r["w"]
    if r["k"] != "rx": continue
    for m in r["m"]:
        a = m.get("_a")
        if a == 32 and "b" in m: phase = m["b"]
        if a == 79 and m.get("2") == 0:
            k = (m.get("22"), m.get("21")); pet = m.get("13") is not None
            ents[m["0"]] = {"k": k, "s": m.get("23"), "pet": pet, "bar": m.get("9", 255)}
            g = G[k]; g["ids"].add(m["0"]); g["phases"][PH.get(phase, phase)] += 1; g["f23"][m.get("23")] += 1
            if g["first"] is None: g["first"] = [r["i"], round(r["w"] - t0, 1)]
            if pet: g["pets"].add(m["0"])
        elif a == 84 and m.get("0") in ents:
            e = ents[m["0"]]
            if "9" in m:
                if m.get("10", 0) > 0 and e["bar"] > m["9"]:
                    H[e["k"] + (e["s"], e["pet"])].append(m["10"] * 255.0 / (e["bar"] - m["9"]))
                e["bar"] = m["9"]
        elif a == 87:
            ents.pop(m.get("0"), None)
rec = [{"kind22": k[0], "f21": k[1], "ids": len(g["ids"]), "pets": len(g["pets"]), "phases": dict(g["phases"]),
        "f23": {str(a): b for a, b in g["f23"].items()}, "first": g["first"]} for k, g in sorted(G.items(), key=lambda t: (t[0][0] or 0, t[0][1] or 0))]
stage = [{"k22": k[0], "f21": k[1], "f23": k[2], "pet": k[3], "n": len(v), "hp": round(statistics.median(v))}
         for k, v in sorted(H.items(), key=lambda t: tuple(-1 if x is None else x for x in t[0])) if len(v) >= 2]
json.dump(rec, open(os.path.join(REPO, "work", "wiki_species_rec.json"), "w"), indent=0)
json.dump(stage, open(os.path.join(REPO, "work", "wiki_species_stage.json"), "w"), indent=0)
print(len(rec), "species groups,", len(stage), "stage hp rows")
