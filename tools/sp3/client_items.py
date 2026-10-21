#!/usr/bin/env python3
# Item tooltip stat tables from the client bundle: runs the client's own tooltip function (_5544 in study/game_r.js)
# for every item of the client item table _5465 inside the inert Node vm (no network objects) and records which
# tooltip icon (label) each number is drawn next to. Offline only.
# Usage: python3 tools/sp3/client_items.py -> mimic/data/client_items.json
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "mimic", "data", "client_items.json")
GAME = os.path.expanduser("~/tio/tio_dev/rnd_ws/study/game_r.js")
NODE = os.path.expanduser("~/node/bin/node")
HARN = os.path.expanduser("~/tio/tio_dev/direct_scan/node/harness.js")
ITEMS = json.load(open(os.path.join(REPO, "mimic", "data", "items.json")))

def func_src(src, name):
    i = src.index("function %s(){" % name)
    d = 0
    for k in range(src.index("{", i), len(src)):
        if src[k] == "{": d += 1
        elif src[k] == "}":
            d -= 1
            if d == 0: return src[i:k + 1]
    raise ValueError(name)

src = open(GAME, encoding="utf-8", errors="replace").read()
tip = func_src(src, "_5544")
head = "function _5544(){const _818=_3106._818;"
assert tip.startswith(head), tip[:80]
tip = "function _5544(_818){" + tip[len(head):]

# wrapper evaluated in the bundle scope: module locals of the item bar are re-created here
WRAP = r"""(function(){
var _5418=[_2493._5531,_2493._5532,_2493._5533,_2493._5534], _5413=[_2493._5527,_2493._5528,_2493._5529,_2493._5530];
var _5420=0; for (var k in _4215) _5420++; _5420--;
var _5415=1.5, _5432=0, _5417=1e9, _5535=0, _5434=[], _5411=0, _3106;
var CAP=[]; var _5453=function(id,v,c){CAP.push([id,v]);}; var _5457=function(){return 1;};
TIP
var lab={}; for (var k in _2493) lab[_2493[k]._219]=_2493[k]._400;
var out=[];
for (var i=0;i<_5465.length;i++){ var it=_5465[i]; if(!it) continue; CAP=[]; var err=null;
  try { _5544(it); } catch(e) { err=String(e&&e.message||e); }
  var raw={}; for (var q in it){ var v=it[q]; if(v===null||typeof v==="number"||typeof v==="string"||typeof v==="boolean"||(Array.isArray(v)&&v.every(function(x){return typeof x!=="object";}))) raw[q]=v; }
  out.push({i:i, id:it._5482, name:it._400, desc:it._3020, icon:it._3780, stats:CAP.map(function(c){return [lab[c[0]], c[1]];}), err:err, raw:raw,
    effect: it._4366 && it._4366._782 ? {chance: it._4366._5591, n: it._4366._395, v: it._4366._2159, ms: it._4366._1520} : null,
    recipe: it._3251 || null, harvest: it._5585 || null});
}
return out; })()""".replace("TIP", tip)

JS = r"""
const H = require(process.argv[1]); const env = H.load();
H.settle().then(() => {
  const fs = require("fs"); const expr = fs.readFileSync(0, "utf8");
  const res = env.G(expr);
  const R = (o) => { if (Array.isArray(o)) return o.map(R); if (o && typeof o === "object") { const r = {}; for (const k in o) r[H.RMAP[k] || k] = R(o[k]); return r; } return o; };
  fs.writeSync(1, JSON.stringify(R(res)) + "\n"); process.exit(0);
});
"""
p = subprocess.run([NODE, "-e", JS, HARN], input=WRAP, capture_output=True, text=True, cwd=os.path.dirname(HARN), timeout=300)
if p.returncode:
    print(p.stderr[-2000:]); sys.exit(1)
rows = json.loads(p.stdout.strip().splitlines()[-1])

KEEP = {"damage", "damage-tamer", "damage-animal", "damage-building", "damage-skill", "damage-fairy", "repair", "heal-tamer", "heal-animal",
        "heal", "heal-over-time", "heal-shield", "speed", "speed-bonus", "reload", "harvest-food", "harvest-wood", "harvest-stone", "harvest-gold",
        "recipe-food", "recipe-wood", "recipe-stone", "recipe-gold", "range", "knockback", "radius", "experience", "building-durability",
        "protection", "magic-protection", "tame-chance"}
out = {"source": "client tooltip function _5544 (study/game_r.js) run on every entry of the client item table _5465 in the inert vm; label = tooltip icon name (_2493 table)",
       "label_rules": {
           "damage-tamer / damage-animal / damage-building": "_4564 (or the skill/projectile _4799/_5560/_5562) -> tamer; animal = floor(_5563 * dmg); building = _5569 (shown when > 0, 'repair' when < 0)",
           "damage": "single damage value when _5563 == 1 and the item is not a structure-type (_5568 == 255)",
           "damage-fairy": "floor(1.5 * _5563 * dmg) for non-standard _5568",
           "heal / heal-tamer / heal-animal": "negative _4564 = heal; _4556 or _4812 = heal amount (food)",
           "heal-over-time": "_5575 or 10 * _5576", "speed": "floor(100 * _5581) = move speed percent while held",
           "reload": "(reload + _1520) ms if both, else reload / _1520 / _5582, shown in seconds",
           "harvest-*": "_5585[slot] when > 1 (food, wood, stone, gold)", "recipe-*": "_3251[slot] = cost",
           "knockout-chance / stun-chance": "floor(100 * _4366._5591) % (skill _5586._5587 knockout, _5589 stun)",
           "range": "_369 (only for _5568 == 255)", "knockback": "floor(_5593 / 10) when _5593 > 10", "radius": "_793 (when _5559 set)",
           "building-durability": "_5549[icon]._4556 for structures (_5547 == 65536)", "protection": "floor((1 - _4806 or _5552) * 100) %",
           "magic-protection": "floor((1 - _4808) * 100) %", "speed-bonus": "_5554 or (_4803 - 1) %", "damage-skill": "x _5557", "experience": "floor(100 * _3099) %",
           "tame-chance": "+1% when _5545 > 0"},
       "items": {}}
for r in rows:
    st = {}
    for lab, v in r["stats"]:
        if lab in st: lab = lab + "_2"
        st[lab] = v
    jid = str(r["id"])
    js = ITEMS.get(jid)
    out["items"][jid] = {"name": r["name"], "items_json_name": js["name"] if js else None, "desc": re.sub(r"<[^>]+>", " ", r["desc"] or "").strip(),
                         "icon": r["icon"], "tooltip": st, "effect": r["effect"], "recipe": r["recipe"], "harvest": r["harvest"], "err": r["err"],
                         "raw": {k: v for k, v in r["raw"].items() if k in ("level", "reload", "_5581", "_4564", "_5563", "_5569", "_369", "_5593", "_793", "_1520", "_5568", "_4556", "_5547", "_8438", "_10927", "_4566", "_4558")}}
json.dump(out, open(OUT, "w"), indent=1, ensure_ascii=True)
bad = [k for k, v in out["items"].items() if v["err"]]
mis = [k for k, v in out["items"].items() if v["items_json_name"] != v["name"]]
print("wrote", OUT, len(out["items"]), "items; tooltip errors", len(bad), bad[:5], "; name mismatches vs items.json", len(mis), mis[:5])
