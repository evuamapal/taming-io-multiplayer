// Insects and insect nests (plugin, see world.js Plugin API).
//  Insects on the wire (capture-mode scans, scans_dec; client: species 57 at stage 3 reads its insect from the skin field):
//  a creature create {2: 0, 7: 2, 21: 57, 22: 11, 23: 3, 24: insect id, 25: 10}. The client insect table (64 ids) names them:
//  0..24 butterflies (24 Majestic Butterfly), 25 Firefly, 26 Bee, 27 Wasp, 28 Bumblebee, 29 Ladybug, 30 Black Beetle,
//  31 Purple Beetle, 32 Fly, 33 Maggot, 34 Caterpillar, 35 Woodlouse, 36 Little Moth, 37 Dragonfly, 38 Leech, 39 Ramshorn
//  Snail, 40 Mayfly, 41 Water Strider, 42 Gammarus, 43 Great Snail, (44..48 ingredients), 49 Volcanic Moth, 50..63 motes.
//  Ambient insects: this plugin owns every species 57 stage 3 creature (creatures.js leaves them out). Each biome holds
//  round(4 x mean insects per scan view) of them (the creatures.js scan-fill factor), drawn from the biome's scan mix
//  (mimic/data/insect_spawns.json, tools/scan/build_insects.py) plus every other insect at a small weight: the ones the
//  client says appear in that biome, and the event ones (Trent / tamer / mote / building insects) everywhere. A caught or
//  killed insect is replaced after REPLACE_MS somewhere else in the biome.
//  Wiki (Inventory): 10 HP, regenerate ~1 HP/s, capturing or killing one pays 50 gold; the Bug Net / Golden Bug Net catches
//  in one hit into the account inventory["0"]; the Toad's tongue also catches. Owner: the tongue catches only a bug at its
//  tip, a bug touched by the rest of the tongue is hurt and runs away; bugs avoid nearby players (flee bursts slower than a
//  tamer holding the net, 488 x 0.6 = 293 u/s, then they wander back). Speeds, flee radius and burst lengths: invented.
//  Nests (wiki Resource Deposits, changelog): Desert Wasp Nests 2 (56 %) / 1 (38 %) / 0 (6 %) per biome start, Sea Porous
//  Rocks (leech nests) the same split assumed; breaking one releases a Wasp (27) / Leech (38). A broken Golden Flower Bush
//  releases a Majestic Butterfly (24, trinkets.js calls spawnBug).
"use strict";
const fs = require("fs"), path = require("path");
let PROFILE = null; try { PROFILE = require("./profile"); } catch (e) { }
const CA = require("./chatargs");   // chat command arguments

const NEST = { 3: { names: ["wasp-nest0", "wasp-nest1"], bug: 27 }, 4: { names: ["sea-porous-rock"], bug: 38 } };
const COUNT = [[0.06, 0], [0.38, 1], [0.56, 2]];
const NAMES = ["Red Butterfly", "Orange Butterfly", "Green Butterfly", "Cyan Butterfly", "Blue Butterfly", "Purple Butterfly",
  "Fire Butterfly", "Water Butterfly", "Plant Butterfly", "Electric Butterfly", "Poison Butterfly", "Ice Butterfly", "Dragon Butterfly",
  "Combat Butterfly", "Rock Butterfly", "Normal Butterfly", "Insect Butterfly", "Spectrum Butterfly", "Tiger Butterfly",
  "Rainbow Butterfly", "Heart Butterfly", "Cheese Butterfly", "Ghost Butterfly", "Black Butterfly", "Majestic Butterfly", "Firefly",
  "Bee", "Wasp", "Bumblebee", "Ladybug", "Black Beetle", "Purple Beetle", "Fly", "Maggot", "Caterpillar", "Woodlouse", "Little Moth",
  "Dragonfly", "Leech", "Ramshorn Snail", "Mayfly", "Water Strider", "Gammarus", "Great Snail", "", "", "", "", "", "Volcanic Moth",
  "Normal Mote", "Rock Mote", "Water Mote", "Electric Mote", "Plant Mote", "Poison Mote", "Insect Mote", "Combat Mote", "Fire Mote",
  "Ice Mote", "Spectrum Mote", "Dragon Mote", "Fairy Mote", "Ancient Mote"];
const BUGS = NAMES.map((n, i) => i).filter((i) => NAMES[i]);   // 59 insects (44..48 are ingredients)
// client movement kinds: bug0 crawling, bug2 flying, the rest butterflies (bug1)
const CRAWL = new Set([29, 30, 31, 33, 34, 35, 38, 39, 41, 42, 43]), FLY = new Set([25, 26, 27, 28, 32, 37, 40, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63]);
const MOVE = { crawl: { speed: 60, flee: 120 }, fly: { speed: 150, flee: 220 }, flutter: { speed: 110, flee: 200 } };
const kindOf = (id) => (CRAWL.has(id) ? "crawl" : FLY.has(id) ? "fly" : "flutter");
// client table "Appears in ..." per biome (0 forest, 1 winter, 2 dark, 3 desert, 4 sea, 5 volcanic); nest insects are not ambient
const WHERE = { 0: [1, 2, 28, 33, 34, 37, 43], 1: [3], 2: [4, 5, 19, 21, 25], 3: [0, 1, 30, 32], 4: [3, 33, 39, 40, 41], 5: [0, 1, 30, 49] };
const EVENT = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 23, 24, 26, 29, 31, 35, 36, 42, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63];
const KILL_XP = 75;   // wiki Age (XP System)
const HP = 10, REGEN = 1, GOLD = 50, NETS = /bug-net/, FLEE_R = 220, BURST_MS = 1500, REST_MS = 1800, REPLACE_MS = 30000;
const TOAD = 67, TIP_R = 45, TONGUE_W = 40;
const TAU = Math.PI * 2, norm = (a) => ((a % TAU) + TAU) % TAU;
const ang255 = (a) => Math.round(norm(a) / TAU * 255) % 256, ang200 = (a) => Math.round(norm(a) * 200);
const S = (w) => w.ext.insects;

let MIX = null;   // phase -> {weights: [[id, w]], want}
function mix(b) {
  if (!MIX) {
    MIX = {};
    let D = {}; try { D = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "insect_spawns.json"), "utf8")).phases || {}; } catch (e) { }
    for (let p = 0; p < 6; p++) {
      const d = D[String(p)] || { ids: [], per_scan: [] }, W = new Map(d.ids.filter(([id]) => id !== 27 && id !== 38));
      for (const id of WHERE[p] || []) W.set(id, Math.max(W.get(id) || 0, 3));
      for (const id of EVENT) if (!W.has(id)) W.set(id, 1);
      const ps = d.per_scan || [], mean = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 3;
      MIX[p] = { weights: [...W.entries()], want: Math.max(8, Math.round(4 * mean)) };
    }
  }
  return MIX[b] || MIX[0];
}
function pick(b) {
  const W = mix(b).weights, tot = W.reduce((a, [, n]) => a + n, 0);
  let r = Math.random() * tot; for (const [id, n] of W) { r -= n; if (r <= 0) return id; }
  return W[0][0];
}
function freeSpot(w, b, pad) {
  const ph = w.phases && w.phases[b]; if (!ph) return null;
  const [x0, y0, x1, y1] = ph.bbox;
  for (let t = 0; t < 40; t++) {
    const x = Math.round(x0 + Math.random() * (x1 - x0)), y = Math.round(y0 + Math.random() * (y1 - y0));
    if (!w.blocked(x, y, pad)) return [x, y];
  }
  return null;
}

function nestCount() { let r = Math.random(); for (const [p, n] of COUNT) { if (r < p) return n; r -= p; } return 2; }
function spawnNests(w, b) {
  const st = S(w), def = NEST[b]; if (!def) return 0;
  const n = Math.max(nestCount(), +process.env.TIO_NEST_MIN || 0);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const name = def.names[Math.floor(Math.random() * def.names.length)], idx = w.ctx.NAMES.indexOf(name), at = freeSpot(w, b, 120);
    if (idx < 0 || !at) continue;
    const o = w.objFromRec({ "0": 0, "1": w.T.CREATE, "2": 3, "3": at[0], "4": at[1], "5": 628, "6": 1, "13": idx, name }, b, true);
    o.rec = null; o.nestBug = def.bug; st.nests.add(o); k++;
    w.L({ k: "nest", room: w.name, name, x: at[0], y: at[1] });
  }
  return k;
}
function spawnNestAt(w, name, x, y) {   // /spawn wasp-nest, /spawn leech-nest
  const idx = w.ctx.NAMES.indexOf(name); if (idx < 0) return null;
  const o = w.objFromRec({ "0": 0, "1": w.T.CREATE, "2": 3, "3": Math.round(x), "4": Math.round(y), "5": 628, "6": 1, "13": idx, name }, w.phase, true);
  o.rec = null; o.nestBug = /porous/.test(name) ? 38 : 27; S(w).nests.add(o);
  return o;
}
function spawnAmbient(w, b, n) {
  let k = 0;
  for (let i = 0; i < n; i++) { const at = freeSpot(w, b, 60); if (!at) continue; spawnBug(w, pick(b), at[0], at[1], true); k++; }
  return k;
}
function spawnBug(w, id, x, y, ambient) {
  const st = S(w); if (!st) return null;
  const eid = w.nextId(), a = Math.random() * TAU;
  const e = { id: eid, kind: "animal", insect: id, x, y, hx: x, hy: y, a, hp: HP, max: HP, r: 30, cd: 0, phase: w.phase, f: {}, lastHurt: 0, plug: "insects", ambient: !!ambient };
  e.create = () => ({ "0": e.id, "1": w.T.CREATE, "2": 0, "3": Math.round(e.x), "4": Math.round(e.y), "5": ang200(e.a), "6": 1, "7": 2, "21": 57, "22": 11, "23": 3, "24": e.insect, "25": 10 });
  e.hurt = (dmg, by) => hurtBug(w, e, dmg, by);
  e.name = NAMES[id] || "Insect";
  w.addEnt(e); st.bugs.add(e);
  if (!ambient) w.L({ k: "insect_spawn", room: w.name, insect: id, x: Math.round(x), y: Math.round(y) });
  return e;
}
function playerOf(by) { return by && by.queue ? by : by && by.p && by.p.queue ? by.p : by && by.owner && by.owner.queue ? by.owner : null; }
// caught (Bug Net hit or a toad tongue tip): 50 gold + inventory; killed (10 HP gone): 50 gold
function take(w, e, p, how) {
  if (e.gone) return;
  e.gone = true; S(w).bugs.delete(e);
  if (how === "kill") { w.touch(e, { "7": 18, "9": 0 }); w.after(500, () => w.removeEnt(e.id)); } else w.removeEnt(e.id);
  if (p) {
    p.gain({ 3: GOLD });
    if (how === "kill" && typeof p.addXp === "function") p.addXp(KILL_XP, "insect_kill");   // wiki Age: killing an insect gives 75 XP
    if (how !== "kill" && PROFILE && PROFILE.catchInsect) PROFILE.catchInsect(e.insect);
    if (how === "kill") p.say("[Insect] You killed a " + e.name + " (+" + GOLD + " gold). Use a Bug Net to catch it.");
    else if (p.queue) p.queue({ "1": 44, o: 0, n: e.insect, i: 1 });   // owner: the client's bottom pop-up ("You caught 1 bug!"), not a chat line
  }
  w.L({ k: how === "kill" ? "insect_kill" : "insect_catch", room: w.name, insect: e.insect, how, by: p ? p.n : null });
  const b = e.phase, ep = w.epoch;
  if (e.ambient) w.after(REPLACE_MS, () => { if (w.epoch === ep && w.phase === b && S(w)) spawnAmbient(w, b, 1); });
}
function scare(w, e, from, now) {
  e.fleeFrom = from ? [from.x, from.y] : null; e.fleeUntil = now + BURST_MS; e.restUntil = e.fleeUntil + REST_MS;
}
function hurtBug(w, e, dmg, by) {
  if (e.gone || !(dmg > 0)) return 0;
  const p = playerOf(by), it = p && w.ctx.ITEMS[p.held], now = w.now || Date.now();
  if (by === p && it && NETS.test(it.icon || "")) { take(w, e, p, "net"); return dmg; }   // the Bug Net catches in one hit
  e.hp -= dmg; e.lastHurt = now;
  if (e.hp <= 0) { take(w, e, p, "kill"); return dmg; }
  w.touch(e, { "9": Math.round(e.hp / e.max * 255), "10": Math.round(dmg) });
  scare(w, e, by && by.x != null ? by : p && p.ent, now);   // hurt: runs away
  return dmg;
}
// Toad tongue (a toad's skill projectile): the tip catches, the rest of the tongue hurts and scares; once per tongue per bug
function tongues(w, now) {
  const C = w.ext.creatures; if (!C || !C.proj) return;
  for (const pr of C.proj) {
    const src = pr.src; if (!src || src.sp !== TOAD || !w.ents.has(pr.id)) continue;
    const seen = pr.bugsTouched = pr.bugsTouched || new Set(), owner = src.kind === "pet" ? src.owner : null;
    const lx = pr.x - src.x, ly = pr.y - src.y, L = Math.hypot(lx, ly) || 1;
    for (const e of [...S(w).bugs]) {
      if (seen.has(e.id) || e.gone) continue;
      if (Math.hypot(e.x - pr.x, e.y - pr.y) <= TIP_R) { seen.add(e.id); take(w, e, owner, "tongue"); continue; }
      const t = ((e.x - src.x) * lx + (e.y - src.y) * ly) / (L * L);
      if (t < 0 || t > 1) continue;
      const d = Math.abs((e.x - src.x) * ly - (e.y - src.y) * lx) / L;
      if (d <= TONGUE_W) { seen.add(e.id); w.L({ k: "insect_tongue_miss", room: w.name, insect: e.insect }); hurtBug(w, e, 4, src); scare(w, e, src, now); }
    }
  }
}
function stepBug(w, e, now, dt) {
  const M = MOVE[kindOf(e.insect)];
  if (e.hp < e.max && now - e.lastHurt > 1000) { const b0 = Math.round(e.hp / e.max * 255); e.hp = Math.min(e.max, e.hp + REGEN * dt); const b1 = Math.round(e.hp / e.max * 255); if (b1 !== b0) w.touch(e, { "9": b1 }); }
  if (!(e.fleeUntil > now) && !(e.restUntil > now)) {   // a tamer too close: a short flee burst (rested bugs only)
    for (const p of w.players.values()) if (p.alive && p.ent && Math.hypot(p.ent.x - e.x, p.ent.y - e.y) < FLEE_R) { scare(w, e, p.ent, now); break; }
  }
  let tx, ty, v;
  if (e.fleeUntil > now && e.fleeFrom) { const a = Math.atan2(e.y - e.fleeFrom[1], e.x - e.fleeFrom[0]); tx = e.x + Math.cos(a) * 200; ty = e.y + Math.sin(a) * 200; v = M.flee; }
  else {
    if (!e.goal || Math.hypot(e.goal[0] - e.x, e.goal[1] - e.y) < 20 || now > e.goalUntil) {   // wander, drifting back home
      const a = Math.random() * TAU, r = Math.random() * 200;
      e.goal = [e.hx + Math.cos(a) * r, e.hy + Math.sin(a) * r]; e.goalUntil = now + 2000 + Math.random() * 3000;
    }
    [tx, ty] = e.goal; v = M.speed;
  }
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy); if (d < 1) return;
  const s = Math.min(d, v * dt);
  const [nx, ny] = w.collide(e.x + dx / d * s, e.y + dy / d * s, 0.5, e);
  if (Math.abs(nx - e.x) + Math.abs(ny - e.y) < 0.5) { e.goal = null; return; }
  e.a = Math.atan2(ny - e.y, nx - e.x); e.x = nx; e.y = ny;
  w.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y), "5": ang255(e.a) });
}
function startBiome(w, b) {
  const st = S(w);
  for (const e of st.bugs) { e.gone = true; w.removeEnt(e.id); }
  st.bugs.clear(); st.nests.clear(); st.phase = b;
  spawnNests(w, b);
  if (process.env.TIO_AMBIENT_INSECTS !== "0") spawnAmbient(w, b, mix(b).want);
}

module.exports = {
  name: "insects",
  NEST, NAMES, BUGS, spawnBug, mix,
  attach(w) { w.ext.insects = { nests: new Set(), bugs: new Set(), phase: null, last: Date.now() }; },
  onBiome(w, oldB, nb) { startBiome(w, nb); },
  tick(w, now) {
    const st = S(w); if (!st) return;
    if (st.phase !== w.phase) startBiome(w, w.phase);   // the first biome (no onBiome)
    const dt = Math.min(0.25, Math.max(0, (now - st.last) / 1000)); st.last = now;
    for (const o of [...st.nests]) if (o.dying || !w.ents.has(o.id)) { st.nests.delete(o); if (o.dying && o.phase === w.phase) spawnBug(w, o.nestBug, o.x, o.y); }
    tongues(w, now);
    for (const e of [...st.bugs]) stepBug(w, e, now, dt);
  },
  // chat /spawn <insect name or id | insects | wasp-nest | leech-nest> [n]: next to the player (admin test helper); parsed by chatargs.js
  onJson(w, p, m) {
    if (!m || m.type !== 39 || typeof m.msg !== "string" || !p.ent) return false;
    const r = CA.parse(m.msg); if (!r || r.cmd !== "spawn" || !r.args.length || r.target != null) return false;
    const a = r.args.map((x) => x.toLowerCase());
    let n = 1;
    if (a.length > 1 && CA.num(a[a.length - 1]) != null) n = CA.num(a.pop()); else if (a.length > 1 && CA.num(a[0]) != null) n = CA.num(a.shift());
    n = Math.max(1, Math.min(20, Math.floor(n)));
    const what = a.join(" "), sq = (x) => x.toLowerCase().replace(/[\s_-]+/g, "");
    let id = /^bug(\d+)$/.test(what) ? +what.slice(3) : NAMES.findIndex((x) => x && (x.toLowerCase() === what || sq(x) === sq(what)));
    if (what === "insects" || what === "bugs" || what === "insect" || what === "bug") id = -2;
    const nest = sq(what) === "waspnest" ? "wasp-nest" : sq(what) === "leechnest" ? "leech-nest" : null;
    if (id < 0 && id !== -2 && !nest) return false;
    for (let i = 0; i < n; i++) {
      const ang = i * 2.4, d = 180 + (i % 4) * 60, x = p.ent.x + Math.cos(ang) * d, y = p.ent.y + Math.sin(ang) * d;
      if (nest === "wasp-nest") spawnNestAt(w, "wasp-nest" + (i % 2), x, y);
      else if (nest === "leech-nest") spawnNestAt(w, "sea-porous-rock", x, y);
      else spawnBug(w, id === -2 ? BUGS[(i + Math.floor(Math.random() * BUGS.length)) % BUGS.length] : id, x, y);
    }
    if (typeof p.say === "function") p.say("Spawned " + n + " " + (nest || (id === -2 ? "random insect" + (n > 1 ? "s" : "") : NAMES[id])), "ok");
    w.L({ k: "cmd", n: p.n, cmd: "spawn", args: what + " " + n, ok: true });
    return true;
  },
  stats(w) { const st = S(w); return st ? { nests: st.nests.size, insects: st.bugs.size } : null; },
};
