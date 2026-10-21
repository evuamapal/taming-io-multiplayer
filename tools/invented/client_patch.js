// Invented pets: builds mimic/invented/client_patch.json, an in-memory patch for the pinned client bundle.
// The three invented pets are NEW species appended to the client species table (T), the real slots stay untouched:
//   155 Grove Colossus (built on the mammoth 41), 156 Stormhorn (reindeer 13), 157 Cinder Prowler (rat 39).
// Each new entry is a copy of its base species with its own key, name, kit and skill, and its own draw models: the base
// stage models (model table, sheet 3) are cloned with every image index that has invented art swapped for a newly
// registered image ("img/creature/<baby-|boss-|bmb-><key>-<part>.png", cards "img/interface/card-<key><stage>-<state>.png"). The
// client requests a registered image as img/h/<hash>.png (hash = 3 x FNV-1a of the path, see fnv() below); the server
// serves our art under those names (mimic/invented/override.json, tools/invented/make_art.py).
// The pet picker's type filter gets a "Fart" type (index 14 in the type name table) that lists exactly the three, and the
// badge table a Fart badge at 100M (the top badge, after ancient), the badge every player wears.
// The same code block turns item slot 17 into the invented Air Blast Gun (kept verbatim from the previous patch) and adds
// the goofy default cosmetics (skin 1093, accessory 626, walking particle 511, hat 70).
// Identifiers are resolved with the inert vm harness (read only reference).
// Usage: node tools/invented/client_patch.js   (hosted_server.js and offline_src/build.js apply it when TIO_BOSS_PETS !== "0")
"use strict";
const fs = require("fs"), path = require("path");
const H = require(process.env.HOME + "/tio/tio_dev/direct_scan/node/harness.js");
const REPO = path.join(__dirname, "..", "..");
const OUT = path.join(REPO, "mimic", "invented", "client_patch.json");
const OVR = JSON.parse(fs.readFileSync(path.join(REPO, "mimic", "invented", "override.json"), "utf8"));
const env = H.load(), G = env.G;
const inv = {}; for (const k in H.RMAP) inv[H.RMAP[k]] = k;
const L = (n) => { if (!inv[n]) throw new Error("no live name for " + n); return inv[n]; };
// the client image name hash: img/h/ + fnv1a(path, 2166136033) fnv1a(path, 2166136043) fnv1a(path, 2166136061) + .png
function fnv(s, h) { for (const c of Buffer.from(s, "utf8")) { h ^= c; h = Math.imul(h, 16777619) >>> 0; } return h; }
const hashed = (p) => "img/h/" + [2166136033, 2166136043, 2166136061].map((sd) => fnv(p, sd).toString(16).padStart(8, "0")).join("") + ".png";
const FART = 14;   // new type index in the type name table (the real ones are 0..13)
const NEW = [
  { id: 155, base: 41, key: "grove", name: "Grove Colossus" },
  { id: 156, base: 13, key: "stormhorn", name: "Stormhorn", skill: "Tempest Crown", sid: "tempest-crown", color: 3, fx: 45, reload: 20000, adm: [16, 16, 16, 16],
    desc: "Ultimate: a crown of lightning that zaps every enemy near Stormhorn for 4 s. Passive kit below.",
    kit: [["static-shell", "Static Shell", "-20% damage, shocks melee attackers for 10"], ["overcharge", "Overcharge", "2+ enemies near: zaps every 0.5 s for 4 s"],
      ["magnet-pull", "Magnet Pull", "every 8 s drags the farthest enemy in, 8 damage"], ["thunder-step", "Thunder Step", "blinks to you when you are hit, shocks 8 around"],
      ["chain-zap", "Chain Zap", "18 / 12 / 8 to 3 enemies every 1.2 s"]] },
  { id: 157, base: 39, key: "cinder", name: "Cinder Prowler", skill: "Ashen Snare", sid: "ashen-snare", color: 1, fx: 63, reload: 18000, adm: [6, 6, 6, 6],
    desc: "Ultimate: a smouldering field that slows enemies to 45% and burns them for 5 s (also cast at low health). Passive kit below.",
    kit: [["ember-trail", "Ember Trail", "dashes leave embers: 4 burn every 0.5 s"], ["molten-hide", "Molten Hide", "-30% damage, burns melee attackers for 6"],
      ["pounce-chain", "Pounce Chain", "a kill re-dashes at the next enemy, bite x1.5"], ["smoke-veil", "Smoke Veil", "at half health: unseen for 3 s (20 s reload)"],
      ["dash-bite", "Dash Bite", "dashes at 900 and bites for 30"]] },
];
H.settle().then(() => { try { main(); } catch (e) { console.error("FAILED", e && e.stack || e); process.exit(1); } });
function main() {
  const T = G("_3134"), IM = G("_3985"), P = G("_14503"), sheet = G("_1898"), PICK = G("_3170"), TY = G("_3687");
  const n = { T: L("_3134"), st: L("_782"), sk: L("_1058"), name: L("_300"), key: L("_400"), skins: L("_3267"), model: L("_4073"), skinimg: L("_4979"),
    sname: L("_400"), id: L("_4822"), color: L("_3688"), fx: L("_219"), pd: L("_4564"), dot: L("_4799"), bd: L("_4800"), bdot: L("_4801"), rep: L("_4797"),
    steal: L("_4798"), vamp: L("_4802"), spd: L("_4803"), reload: L("_4796"), table: L("_4792"), IM: L("_3985"), P: L("_14503"), M: L("_14539"),
    R: L("_3986"), reg: L("_3987"), idx: L("_14557"), pick: L("_3170"), types: L("_3687"), filt: L("_4859"), ftype: L("_4576"), bind: L("_4871") };
  if (T.length !== NEW[0].id || PICK.length !== T.length || TY.length !== FART) throw new Error("table sizes changed: T " + T.length + " pick " + PICK.length + " types " + TY.length);
  if (IM[2991].src !== hashed(P[IM[2991][n.idx]])) throw new Error("image hash scheme changed: " + IM[2991].src);
  const q = JSON.stringify;
  // per new species: [base image path, new image path] for every base sprite that has invented art (the draw models are
  // remapped from the one to the other), plus the images the client looks up by name (cards, the pet portrait)
  const plan = NEW.map((S) => {
    const b = T[S.base][n.key], swap = [], extra = [];
    const re = new RegExp("^img/creature/(baby-|boss-|bmb-)?" + b + "-([a-z-]+)\\.png$"), cre = new RegExp("^img/interface/card-" + b + "(\\d)-(in|out|click)\\.png$");
    for (const p of new Set(P)) {
      let m = re.exec(p), np = null;
      if (m && !/-skin\d/.test(p)) np = "img/creature/" + (m[1] || "") + S.key + "-" + m[2] + ".png";
      else if ((m = cre.exec(p))) np = "img/interface/card-" + S.key + m[1] + "-" + m[2] + ".png";
      if (np && OVR["/" + hashed(np)]) (/^img\/creature/.test(np) ? swap : extra).push([p, np]);
    }
    extra.push(["", "img/interface/" + S.key + "-pet.png"]);
    if (!swap.length) throw new Error("no invented art for " + S.key + " (run tools/invented/make_art.py)");
    return { S, swap, extra };
  });
  let code = ";(function(){try{var T=" + n.T + ",IM=" + n.IM + ",P=" + n.P + ",M=" + n.M + "[" + sheet + "],R=" + n.R + ";" +
    "function reg(p){IM.push(R[" + q(n.reg) + "](p));return IM.length-1;}" +
    "function find(p){for(var i=0;i<IM.length;i++)if(P[IM[i][" + q(n.idx) + "]]===p)return i;return -1;}" +
    "function cl(o){if(Array.isArray(o))return o.map(cl);if(o&&typeof o===\"object\"){var r={};for(var k in o)r[k]=cl(o[k]);return r;}return o;}" +
    "function rm(o,m){for(var k in o){var v=o[k];if(typeof v===\"number\"){if(m[v]!==undefined)o[k]=m[v];}else if(v&&typeof v===\"object\")rm(v,m);}}" +
    // one new species: copy of the base, own key / name / no skins, own models with the swapped images, listed in the picker
    "function add(id,base,key,name,swap,extra){if(T.length!==id||!T[base])return null;var m={};for(var i=0;i<swap.length;i++){var j=find(swap[i][0]);if(j>=0)m[j]=reg(swap[i][1]);}" +
    // the pet card frames are looked up by name (card-<key><stage>-in/out/click) in the image name table, which the bundle
    // fills (and turns into images) before this runs: name them here or the top-left card draws nothing
    "for(var i=0;i<extra.length;i++){var o=IM[reg(extra[i])],c=/^img\\/interface\\/(card-.+)\\.png$/.exec(extra[i]);if(c)" + L("_1434") + "[c[1]]=o;}var b=T[base],a=Object.assign({},b);a[" + q(n.key) + "]=key;a[" + q(n.name) + "]=name;a[" + q(n.skins) + "]=[];a.index=id;a.__fart=1;" +
    "a[" + q(n.st) + "]=b[" + q(n.st) + "].map(function(g){var s=Object.assign({},g);s[" + q(n.skinimg) + "]=[];var md=cl(M[g[" + q(n.model) + "]]);rm(md,m);M.push(md);s[" + q(n.model) + "]=M.length-1;" +
    "if(g[" + q(n.sk) + "])s[" + q(n.sk) + "]=Object.assign({},g[" + q(n.sk) + "]);return s;});T.push(a);" + n.pick + ".push(id);return a;}";
  for (const { S, swap, extra } of plan) {
    code += "(function(a){if(!a)return;";
    if (S.skill) code += "for(var i=0;i<a[" + q(n.st) + "].length;i++){var g=a[" + q(n.st) + "][i];if(!g||!g[" + q(n.sk) + "])continue;var s=g[" + q(n.sk) + "];" +
      "s[" + q(n.sname) + "]=" + q(S.skill) + ";s[" + q(n.id) + "]=" + q(S.sid) + ";s.description=" + q(S.desc) + ";s[" + q(n.color) + "]=" + S.color + ";s[" + q(n.fx) + "]=" + S.fx + ";" +
      // the panel shows animal damage = _4564, player damage = _4564 / divisor, damage over time = _4799 (players / 2)
      "s[" + q(n.pd) + "]=" + q(S.adm) + ";s[" + q(n.dot) + "]=" + q(S.adm) + ";s[" + q(n.bd) + "]=[0,0,0,0];s[" + q(n.bdot) + "]=[0,0,0,0];" +
      "s[" + q(n.rep) + "]=[0,0,0,0];s[" + q(n.steal) + "]=[0,0,0,0];s[" + q(n.vamp) + "]=[0,0,0,0];s[" + q(n.spd) + "]=[0,0,0,0];g[" + q(n.reload) + "]=" + S.reload + ";}";
    if (S.kit) code += "a.__kit=" + q(S.kit.map((k) => row(k[0], k[1], k[2])).join("")) + ";";
    code += "})(add(" + S.id + "," + S.base + "," + q(S.key) + "," + q(S.name) + "," + q(swap) + "," + q(extra.map((e) => e[1])) + "));";
  }
  code += n.types + "[" + FART + "]=\"fart\";";
  // Fart badge (owner): the top player badge at 100,000,000, after ancient (60M), with the ancient's perks; the
  // in-world badge image rank13 (game_config player_badge 14) becomes it; profile.js gives everyone that score
  const BD = G("_3244");
  if (BD.length !== 14 || BD[13][L("_400")] !== "ancient" || G("_1434").rank13 == null) throw new Error("badge table changed");
  code += "(function(B,I){var a=B[13];if(!a||a[" + q(L("_400")) + "]!==\"ancient\")return;var f=Object.assign(Object.create(Object.getPrototypeOf(a)),a);" +
    "f[" + q(L("_400")) + "]=\"fart\";f[" + q(L("_2151")) + "]=100000000;B.push(f);I.rank13=R[" + q(n.reg) + "](\"img/interface/badge-fart.png\");})(" + L("_3244") + "," + L("_1434") + ");";
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8")).patches[0].replace, gEnd = "})(" + L("_5465") + ");";
  const g0 = prev.indexOf("(function(I){var it=I&&I[17]"), g1 = prev.indexOf(gEnd, g0);
  if (g0 < 0 || g1 < 0) throw new Error("Air Blast Gun block not found in the previous patch");
  // owner: the Air Blast Gun is no longer a level-1 pick after the Hand but one last pick at age 28 (with the staffs) that
  // takes the primary weapon's bar slot (__swap, see the pick hook below): ages 1..27 pick exactly like the real game
  const P5519 = "it[" + q(L("_5519")) + "]=I[0];it[" + q(L("_5518")) + "]=I[0][" + q(L("_5518")) + "]||I[0];";
  code += prev.slice(g0, g1 + gEnd.length).replace(/it\.level=\[\d+\];(it\.__swap=1;)?/, "it.level=[28];it.__swap=1;")
    .replace(P5519, "delete it[" + q(L("_5519")) + "];it[" + q(L("_5518")) + "]=it;");
  // invented fairy staffs (game_config staffs, data/items.json, art tools/invented/make_staffs.py): new items appended to the
  // item table as copies of the Ruby Musket (ranged pose and hotbar class) with their own id, icon, name, text, pick level,
  // cost, reload (tooltip = reload + 100) and tooltip damage; no chain (_5519), the pick adds its own hotbar slot (_14012).
  // Staffs are age-28 picks (items.json level) that swap into the main weapon slot like the gun (__swap, __slot = the Hand class).
  // The cost keeps items.json order; its trailing null becomes undefined: the select check (_5323) reads slot 5 as a
  // required id and refused every staff from the bar (owner: unavailable sound; only a /give staff could be held)
  // The client loads img/item/<icon>.png and the inventory cards of every item in the table when it starts (_507)
  const STF = require(path.join(REPO, "mimic", "hosted", "game_config.js")).DEFAULTS.staffs, IJ = JSON.parse(fs.readFileSync(path.join(REPO, "mimic", "data", "items.json"), "utf8"));
  const SD = Object.entries(STF.items).map(([id, S]) => { const it = IJ[id], c = it.cost; return [+id, it.icon, S.name, "Invented. Casts the " + S.name.replace(" Staff", "") +
    " fairy's ultimate where you aim. " + c[2] + " stone and " + c[3] + " gold a cast.", it.level, S.ms - 350, c, S.hit]; });
  if (G("_5465").length !== SD[0][0] || !G("_5465")[126] || G("_5465")[126][L("_400")] !== "Ruby Musket") throw new Error("item table changed");
  code += "(function(I){var B=I&&I[126];if(!B||I.length!==" + SD[0][0] + ")return;var D=" + q(SD) + ";for(var i=0;i<D.length;i++){var d=D[i],a=Object.assign(Object.create(Object.getPrototypeOf(B)),B);" +
    "a[" + q(L("_5482")) + "]=d[0];a[" + q(L("_3780")) + "]=d[1];a[" + q(L("_400")) + "]=d[2];a[" + q(L("_3020")) + "]=d[3];a.level=d[4];a.__swap=1;a.__slot=I[0][" + q(L("_5485")) + "];delete a[" + q(L("_5519")) + "];a[" + q(L("_5518")) + "]=a;" +
    "a[" + q(L("_3405")) + "]=" + L("_14012") + "(d[0]);a.reload=d[5];a[" + q(L("_1520")) + "]=100;a[" + q(L("_3251")) + "]=d[6].map(function(v){return v===null?void 0:v;});a[" + q(L("_4564")) + "]=d[7];I.push(a);}})(" + L("_5465") + ");";
  // goofy default cosmetics (owner: every player wears them unless they pick others; art tools/invented/make_goofy.py):
  // skin 1093, accessory 626, walking particle 511 and hat 70 are appended to the cosmetic tables (menu skin / accessory /
  // particle lists, hat shop list) with their in-game images registered like the pets' (player<id>-head / arm-left /
  // arm-right, accessory<id>, hat<id>; the trail frames dust<id>-0..2 by name in the image name table).
  // The menu reads the saved pick from storage ("skin" / "accessory" / "particle"); with none saved it gets the goofy ones, so
  // the picker shows them selected and the join sends them (world.js uses them too when a join has no pick)
  const GO = { skin: 1093, acc: 626, hat: 70, dust: 511 };
  if (G("_3269").length !== GO.skin || G("_3314")[L("_3776")].length !== GO.skin || G("_3270").length !== GO.acc || G("_3314")[L("_3777")].length !== GO.acc ||
    G("_5265").length !== GO.hat || G("_5268")[L("_5110")].length !== GO.hat || typeof G("_314")[L("_397")] !== "function" ||
    G("_5050").length !== GO.dust || G("_3314")[L("_3778")].length !== GO.dust || G("_1434")["dust" + (GO.dust - 1) + "-0"] == null) throw new Error("cosmetic tables changed");
  code += "try{(function(C,SI,AI,HI,HS,U,DL,DI){" +
    "C[" + q(L("_3776")) + "].push([5,\"Mauve Derpington\"," + GO.skin + ",void 0,0,void 0]);SI.push([\"head\",\"arm-left\",\"arm-right\"].map(function(k){return reg(\"img/creature/player" + GO.skin + "-\"+k+\".png\");}));" +
    "C[" + q(L("_3777")) + "].push([5,\"Floaty McQuackface\"," + GO.acc + ",void 0,0,void 0]);AI.push(reg(\"img/item/accessory" + GO.acc + ".png\"));" +
    "HS[" + q(L("_5110")) + "].push([1,\"Brain Cooler 3000\"," + GO.hat + ",\"Spins when you think. You never think.\",1,{}]);HI.push(reg(\"img/item/hat" + GO.hat + ".png\"));" +
    "C[" + q(L("_3778")) + "].push([5,\"Squeaky Steps\"," + GO.dust + ",void 0,0,void 0]);DL.push(0);for(var j=0;j<3;j++)DI[\"dust" + GO.dust + "-\"+j]=IM[reg(\"img/particle/dust" + GO.dust + "-\"+j+\".png\")];" +
    "var g=U[" + q(L("_397")) + "];U[" + q(L("_397")) + "]=function(k){var v=g.apply(this,arguments);if(v==null||v===\"\"){if(k===\"skin\")return \"" + GO.skin + "\";if(k===\"particle\")return \"" + GO.dust + "\";}return v;};" +
    "})(" + L("_3314") + "," + L("_3269") + "," + L("_3270") + "," + L("_5265") + "," + L("_5268") + "," + L("_314") + "," + L("_5050") + "," + L("_1434") + ");}catch(e){}";
  code += "}catch(e){}})();";
  const anchor = "function " + L("_21054") + "(";
  // the pet panel's skill table builder lives in another scope: rename it in place and put a wrapper with its name first
  const tb = "function " + n.table + "(", orig = n.table + "ﾠkit0";
  // pet picker type filter (UI scope): type FART shows exactly the invented pets; the option is added to the type menu
  // when the client binds the menu options (its option list is live, so the new one gets the client's own handler)
  const fo = n.filt + "ﾠfart0", bo = n.bind + "ﾠfart0";
  const opt = "<img draggable=\"false\" src=\"./img/interface/tooltip-element-fart.png?5\" data-src=\"./img/interface/tooltip-element-fart.png?5\"></img>FART";
  const B0 = fs.readFileSync(path.join(REPO, "mimic", "game_mimic.js"), "utf8"), o0 = B0.indexOf("const " + L("_21035") + "=[");
  if (o0 < 0 || G("_21035").length !== 61) throw new Error("level badge offset table changed");
  const offs = B0.slice(o0, B0.indexOf("];", o0) + 2);
  const patches = [
    { find: anchor, replace: code + anchor },
    { find: tb, replace: "function " + n.table + "(a,b,c,d){var h=" + orig + "(a,b,c,d);return a&&a.__kit?h+a.__kit:h;}function " + orig + "(" },
    { find: "function " + n.filt + "(", replace: "function " + n.filt + "(a){if(" + n.ftype + "===" + FART + "){var t=" + n.T + "[a];return t&&t.__fart?1:0;}return " + fo + "(a);}function " + fo + "(" },
    { find: "function " + n.bind + "(", replace: "function " + n.bind + "(e){try{var p=e&&e.parentNode;if(p&&!p.querySelector(\"[data-element=\\\"fart\\\"]\")){var d=document.createElement(\"div\");" +
      "d.className=\"tamodex-select-option shadowed\";d.setAttribute(\"data-element\",\"fart\");d.innerHTML=" + q(opt) + ";p.appendChild(d);}}catch(x){}return " + bo + "(e);}function " + bo + "(" },
    // owner: invented pet level 67 is the new max (was 60). The client's max level constant drives the XP -> level cap, the
    // total XP of a maxed pet and the entity field 20 split (level + OB * (max + 1)); creatures.js encodes with the same max
    { find: "const " + L("_3104") + "=60;", replace: "const " + L("_3104") + "=67;" },
    // the level badge x offset table (one entry per level 0..60) gets 61..67 with the level 60 offset, else the badge
    // position is NaN and no level shows; the badge art is mimic/invented/png/hero-level61..67.png
    { find: offs, replace: offs.slice(0, -2) + "].concat([" + Array(7).fill(G("_21035")[60]).join(",") + "]);" },
    // owner: the invented age-28 weapons (__swap) take the bar slot of the item of the same bar class (the main weapon for
    // the gun and the staffs alike), so the bar keeps the real game's size: the pick commit (_5623) replaces the
    // bar entry of an item's parent (_5519), so the parent is set to that item right before it (social.js SWAP does the same)
    { find: "function " + L("_5623") + "(", replace: "function " + L("_5623") + "(a){if(a&&a.__swap){var B=" + L("_5428") + "." + L("_1431") +
      ";for(var i=0;i<B.length;i++){var o=B[i]&&B[i]." + L("_818") + ";if(o&&o!==a&&o." + L("_5485") + "===(a.__slot!=null?a.__slot:a." + L("_5485") + ")){a[" + q(L("_5519")) + "]=o;break;}}}" +
      "return " + L("_5623") + "ﾠswap0(a);}function " + L("_5623") + "ﾠswap0(" },
  ];
  // cosmetics window (owner: paging 12 at a time through the many cosmetics is annoying): a slider under the grid and mouse
  // wheel scrolling over every item of the tab; the arrows keep working. The list is a row of 3-item columns (W px wide)
  // scrolled by scrollLeft with the page index kept in sync, and the columns load lazily: our scrolling loads them all
  const cs = { list: L("_3316"), page: L("_2898"), cols: L("_5034"), loaded: L("_5035"), load: L("_5059"), W: L("_2419") };
  patches.push({ find: "function " + L("_5080") + "(", replace: ";(function(){try{var LI=" + cs.list + ";if(!LI||!LI.parentNode)return;var s=document.createElement(\"input\");s.type=\"range\";s.id=\"cosmetics-slider\";s.min=0;s.step=1;s.value=0;" +
    "var st=document.createElement(\"style\");st.textContent=\"#cosmetics-slider{position:absolute;z-index:2;height:16px;margin:0;padding:0;-webkit-appearance:none;appearance:none;background:#5b3a20;border-radius:8px;outline:none;cursor:pointer}" +
    "#cosmetics-slider::-webkit-slider-thumb{-webkit-appearance:none;width:56px;height:22px;border-radius:11px;background:#f2c14e;border:3px solid #3a2312}#cosmetics-slider::-moz-range-thumb{width:56px;height:22px;border-radius:11px;background:#f2c14e;border:3px solid #3a2312}\";document.head.appendChild(st);LI.parentNode.appendChild(s);" +
    "var W=" + cs.W + ",acc=0,tgt=-1;function all(){if(" + cs.loaded + "<" + cs.cols + "){var t=" + cs.page + ";" + cs.page + "=" + cs.loaded + ";" + cs.load + "(" + cs.cols + ");" + cs.page + "=t;}}" +
    "function mx(){return Math.max(0," + cs.cols + "-4);}function sync(){var m=mx();s.max=m;s.style.display=m>0?\"\":\"none\";s.style.left=LI.offsetLeft+\"px\";s.style.top=(LI.offsetTop+LI.offsetHeight+8)+\"px\";s.style.width=LI.offsetWidth+\"px\";if(document.activeElement!==s)s.value=" + cs.page + ";}" +
    "function go(p,smooth){all();p=Math.max(0,Math.min(mx(),p));" + cs.page + "=p;tgt=p;LI.style.scrollBehavior=smooth?\"\":\"auto\";LI.scrollLeft=p*W;s.value=p;}" +
    "s.addEventListener(\"input\",function(){go(Number(s.value),0);});s.addEventListener(\"change\",function(){LI.style.scrollBehavior=\"\";s.blur();});" +
    "LI.addEventListener(\"wheel\",function(e){e.preventDefault();acc+=Math.abs(e.deltaY)>Math.abs(e.deltaX)?e.deltaY:e.deltaX;if(Math.abs(acc)<40)return;var n=acc>0?1:-1;acc=0;go((tgt>=0?tgt:" + cs.page + ")+n,1);},{passive:false});" +
    "LI.addEventListener(\"scroll\",function(){" + cs.page + "=Math.round(LI.scrollLeft/W);if(Math.abs(LI.scrollLeft-tgt*W)<2)tgt=-1;sync();});" +
    "new MutationObserver(function(){if(!LI.scrollLeft)tgt=-1;sync();}).observe(LI,{childList:true});setInterval(function(){if(LI.offsetWidth)sync();},500);}catch(e){}})();function " + L("_5080") + "(" });
  const B = fs.readFileSync(path.join(REPO, "mimic", "game_mimic.js"), "utf8");
  for (const p of patches) if (B.split(p.find).length !== 2) throw new Error("find not exactly once in mimic/game_mimic.js: " + p.find);
  fs.writeFileSync(OUT, JSON.stringify({ note: "each find must occur exactly once in the bundle; applied when TIO_BOSS_PETS !== 0 (tools/invented/client_patch.js)", patches }, null, 1));
  for (const { S, swap, extra } of plan) console.log(S.id, S.key, "swap", swap.length, "extra", extra.length);
  console.log("wrote", OUT, code.length, "bytes");
  process.exit(0);
}
function row(icon, name, text) {
  return "<tr><td class=\"shadowed4\" style=\"display:flex\"><img draggable=\"false\" style=\"width:28px;\" class=\" skill-line shadowed4\" src=\"./img/interface/skill-" + icon + ".png\"></img>" +
    "<span class=\"skill-description skill-line shadowed4\">" + name + "<br><span style=\"font-size:12px;opacity:0.85\">" + text + "</span></span></td>" +
    "<td class=\"skill-line-category skill-line shadowed4\">passive</td></tr>";
}
