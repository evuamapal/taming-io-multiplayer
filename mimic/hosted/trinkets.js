// Trinkets (wiki Trinkets page, mimic/data/wiki/raw/Trinkets.wiki, game update 0.126) and the two rare bushes that give them.
//  Client ids (trinket table in the bundle, 5 levels per trinket, level n = base + n - 1; the icons are item-trinket<base>.png):
//   15 Dead Bud, 20 Goliath Berry, 25 Wilted Goliath Berry, 30 Mimic Cap, 35 Rotten Mimic Cap, 40 Frostberry, 45 Wilted Frostberry,
//   50 Frostguard Gem, 55 Wilted Frostguard Gem, 60 Spectrumleaf, 65 Wilted Spectrumleaf, 70 Twisted Turnip, 75 Wilted Twisted Turnip,
//   80 Goldenhead, 85 Wilted Goldenhead, 90 Tidebladder, 95 Wilted Tidebladder, 100 Surgeberry, 105 Wilted Surgeberry, 110 Firemoss,
//   115 Wilted Firemoss, 120 Spiteweed, 125 Wilted Spiteweed, 130 Majestic Flower, 135 Wilted Majestic Flower, 140 Trentwood Ring,
//   145 Heart of the Forest
//  The account keeps them as inventory["4"] {id: count}; the menu stores the equipped ones per team slot (localStorage
//  petTrinkets<slot>) and sends them with the join as pt: [[slot0 x3], [slot1 x3], [slot2 x3]] (-1 = empty).
//  Bushes (wiki Resource Deposits, Trinkets): at the start of each biome a Golden Flower Bush spawns with 15 % (25 % in the
//  Forest) and an Oathbud with 12 %, anywhere on the map. Golden Flower Bush: food on hit; broken in the Forest 50 % Majestic
//  Flower Seeds. Oathbud: one random seed of its biome pool. The clone has no plant plot growing, so a seed is granted as its
//  grown level 1 trinket (wiki: 95 % of grown trinkets are level 1).
"use strict";
const fs = require("fs"), path = require("path");
const PROFILE = require("./profile");

const L5 = (a) => (lvl) => a[Math.max(0, Math.min(4, lvl - 1))];
// per trinket base id: level -> effect numbers (wiki tables, % as fractions)
const DEF = {
  15: { name: "Dead Bud" },
  20: { name: "Goliath Berry", healCh: L5([.10, .15, .20, .25, .30]), heal: L5([25, 35, 45, 55, 65]), atk: L5([-.10, -.12, -.14, -.16, -.18]) },
  25: { name: "Wilted Goliath Berry", selfCh: L5([.02, .04, .06, .08, .10]), selfDmg: L5([20, 40, 60, 80, 100]) },
  30: { name: "Mimic Cap", every: 5000, petHeal: L5([25, 33, 41, 49, 57]), drain: L5([2, 3, 4, 5, 6]) },
  35: { name: "Rotten Mimic Cap", every: 5000, drain: L5([2, 3, 4, 5, 6]) },
  40: { name: "Frostberry", type: "Ice", freezeCh: L5([.05, .06, .07, .08, .09]), def: L5([-.03, -.06, -.09, -.12, -.15]) },
  45: { name: "Wilted Frostberry", selfFreezeCh: L5([.05, .06, .07, .08, .09]) },
  50: { name: "Frostguard Gem", type: "Ice", shieldCh: L5([.05, .07, .09, .11, .13]), speed: L5([-10, -17, -24, -31, -38]) },
  55: { name: "Wilted Frostguard Gem", selfDefCh: L5([.05, .06, .07, .08, .09]) },
  60: { name: "Spectrumleaf", type: "Spectrum", auraCh: L5([.05, .07, .09, .11, .13]), def: L5([-.02, -.04, -.06, -.08, -.10]) },
  65: { name: "Wilted Spectrumleaf", wildAuraCh: L5([.05, .06, .07, .08, .09]) },
  70: { name: "Twisted Turnip", type: "Poison", tentacleCh: L5([.05, .07, .09, .11, .13]), def: L5([-.05, -.07, -.09, -.11, -.13]) },
  75: { name: "Wilted Twisted Turnip", selfSlowCh: L5([.05, .06, .07, .08, .09]) },
  80: { name: "Goldenhead", critCh: L5([.06, .07, .08, .09, .10]), crit: L5([.20, .23, .26, .29, .32]), def: L5([-.10, -.14, -.18, -.22, -.26]) },
  85: { name: "Wilted Goldenhead", weakCh: L5([.10, .12, .14, .16, .18]), weak: L5([.20, .22, .24, .26, .28]) },
  90: { name: "Tidebladder", lowHeal: L5([60, 120, 180, 240, 300]), lowEvery: L5([30000, 28000, 26000, 24000, 22000]), regen: L5([-.15, -.18, -.21, -.24, -.27]) },
  95: { name: "Wilted Tidebladder", lowDmg: L5([20, 40, 60, 80, 100]), lowEvery: L5([29000, 28000, 27000, 26000, 25000]) },
  100: { name: "Surgeberry", type: "Electric", surgeCh: L5([.05, .07, .09, .11, .13]), atk: L5([-.05, -.07, -.09, -.11, -.13]) },
  105: { name: "Wilted Surgeberry", selfSlowCh: L5([.05, .06, .07, .08, .09]) },
  110: { name: "Firemoss", type: "Fire", burnCh: L5([.05, .07, .09, .11, .13]), def: L5([-.05, -.07, -.09, -.11, -.13]) },
  115: { name: "Wilted Firemoss", selfBurnCh: L5([.05, .06, .07, .08, .09]) },
  120: { name: "Spiteweed", spite: L5([1, 2, 3, 4, 5]) },
  125: { name: "Wilted Spiteweed" },
  130: { name: "Majestic Flower", xp: L5([.10, .15, .20, .25, .30]), def: L5([-.05, -.06, -.07, -.08, -.09]), atk: L5([-.05, -.06, -.07, -.08, -.09]), speed: L5([-10, -15, -20, -25, -30]) },
  135: { name: "Wilted Majestic Flower", xp: L5([-.05, -.10, -.15, -.20, -.25]) },
  140: { name: "Trentwood Ring", type: "Plant", stealCh: L5([.10, .12, .14, .16, .18]), steal: L5([.40, .50, .60, .70, .80]), regen: L5([-.21, -.24, -.27, -.30, -.33]) },
  145: { name: "Heart of the Forest", type: "Plant", thornCh: L5([.05, .07, .09, .11, .13]), regen: L5([-.05, -.07, -.09, -.11, -.13]) },
};
// status lengths and strengths the wiki does not give: invented, kept short ("for a few seconds")
const FX = { freeze_ms: 1500, slow_ms: 3000, slow: 0.5, shield_ms: 3000, selfdef_ms: 3000, selfdef: -0.3, surge_ms: 3000, surge: 1.6,
  burn_n: 5, burn_ms: 500, burn: 3, aura_r: 180, aura: 15, paralyse_r: 160, paralyse: 6, tentacle_ms: 3000, tentacle_n: 6, tentacle: 4, thorn_r: 200, thorn: 12 };
const VFX = { surge: 45, aura: 63 };   // client skill visuals: 45 thunder, 63 infernal mud

// oathbud pools per biome (0 forest, 1 snow, 2 dark, 3 desert, 4 sea, 5 volcanic), each seed grows into its level 1 trinket
const OATHBUD = { 0: [20, 30], 1: [40, 50], 2: [60, 70], 3: [80], 4: [90, 100], 5: [110] };
const PRE = ["", "snow-", "dark-", "desert-", "sea-", "volcanic-"];
const BUSH = { majestic: "golden-flower-bush", trinket: "seeds-plant" };
const SPAWN_CH = { majestic: (b) => (b === 0 ? 0.25 : 0.15), trinket: () => 0.12 };

let TYPES = null;   // species id -> wiki type (Ice, Fire, Plant ...)
function typeOf(sp) {
  if (!TYPES) {
    TYPES = {};
    try {
      const A = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "wiki", "animals.json"), "utf8"));
      const R = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "creature_radius.json"), "utf8"));
      const byName = {}; for (const [n, v] of Object.entries(A)) if (v.type) byName[n.toLowerCase()] = v.type.value;
      for (const [k, r] of Object.entries(R)) { const t = byName[String(r[0]).toLowerCase()]; if (t) TYPES[+k] = t; }
    } catch (e) { }
  }
  return TYPES[sp] || "";
}
const baseOf = (id) => (id >= 15 && id < 150 ? id - (id % 5) : null);
// the pet's trinkets as [{b, lvl, d}] from a join pt row (ids the account does not have are kept: the menu already checked)
function parse(row) {
  const out = [];
  for (const id of Array.isArray(row) ? row.slice(0, 3) : []) {
    if (!Number.isInteger(id)) continue;
    const b = baseOf(id); if (b == null || !DEF[b]) continue;
    out.push({ id, b, lvl: id - b + 1, d: DEF[b] });
  }
  return out;
}
function attach(e, row) { const t = parse(row); e.trk = t.length ? t : null; return e.trk; }
const sum = (e, k) => { let s = 0; for (const t of e.trk || []) if (t.d[k]) s += t.d[k](t.lvl); return s; };
const chance = (e, t, k) => t.d[k](t.lvl) * (t.d.type && typeOf(e.sp) === t.d.type ? 2 : 1);
const CH_MULT = +process.env.TIO_TRINKET_CHANCE_MULT || 1;   // tests: every proc chance x this
const rnd = () => Math.random() / CH_MULT;

let API = null;   // creatures.js helpers: hit, enemiesNear, fx, now
function init(api) { API = api; }

function heal(world, e, n) {
  if (!n || e.dead || !(e.hp < e.max)) return;
  e.hp = Math.min(e.max, e.hp + n);
  world.touch(e, { "9": Math.round(e.hp / e.max * 255) });
}
function selfHurt(world, e, n) { if (n > 0 && !e.dead && e.hurt) e.hurt(n, null); }
function slowEnt(t, ms, f, now) {
  if (t.kind === "player" && t.p) { t.p.slowUntil = now + ms; t.p.slowFactor = f; return; }
  t.slowUntil = now + ms; t.slowFactor = f;
}
function dot(world, src, t, n, every, dmg) {
  for (let i = 1; i <= n; i++) world.after(every * i, () => { if (world.ents.has(t.id) && !t.dead && !t.dying) API.hit(world, t, dmg, src); });
}
function ring(world, e, r, dmg, slow, now, all) {
  const L = API.enemiesNear(world, e, e.x, e.y, r);
  for (const w of L) { API.hit(world, w, dmg, e); if (slow) slowEnt(w, FX.slow_ms, 0, now); }
  if (all) { selfHurt(world, e, dmg); const o = e.owner; if (o && o.alive && o.ent && Math.hypot(o.ent.x - e.x, o.ent.y - e.y) < r) o.hurt(dmg, null, "trinket"); }
  return L.length;
}
function log(world, e, t, what) { world.L({ k: "trinket", room: world.name, n: e.owner && e.owner.n, sp: e.sp, t: t.d.name, lvl: t.lvl, what }); }

// a pet bite: the damage after attack bonus / malus, crit and weak bites; procs that need the target run after the hit (afterBite)
function bite(world, e, tgt, dmg) {
  if (!e.trk) return dmg;
  let m = 1 + sum(e, "atk");
  for (const t of e.trk) {
    if (t.d.critCh && rnd() < chance(e, t, "critCh")) { m += t.d.crit(t.lvl); log(world, e, t, "crit"); }
    if (t.d.weakCh && rnd() < t.d.weakCh(t.lvl)) { m -= t.d.weak(t.lvl); log(world, e, t, "weak"); }
  }
  return Math.max(1, Math.round(dmg * Math.max(0.1, m)));
}
function afterBite(world, e, tgt, dealt) {
  if (!e.trk || e.dead) return;
  const now = API.now(world);
  // Goliath Berry: chances of the same trinket average out (wiki), so one roll on the mean chance and mean heal
  const gol = e.trk.filter((t) => t.d.healCh);
  if (gol.length && rnd() < gol.reduce((a, t) => a + t.d.healCh(t.lvl), 0) / gol.length) { heal(world, e, Math.round(gol.reduce((a, t) => a + t.d.heal(t.lvl), 0) / gol.length)); log(world, e, gol[0], "heal"); }
  for (const t of e.trk) {
    const d = t.d, alive = tgt && world.ents.has(tgt.id) && !tgt.dead && !tgt.dying;
    if (d.selfCh && rnd() < d.selfCh(t.lvl)) { selfHurt(world, e, d.selfDmg(t.lvl)); log(world, e, t, "self_dmg"); }
    if (d.freezeCh && alive && rnd() < chance(e, t, "freezeCh")) { slowEnt(tgt, FX.freeze_ms, 0, now); log(world, e, t, "freeze"); }
    if (d.selfFreezeCh && rnd() < d.selfFreezeCh(t.lvl)) { e.trkStopUntil = now + FX.freeze_ms; log(world, e, t, "self_freeze"); }
    if (d.shieldCh && rnd() < chance(e, t, "shieldCh")) { e.trkShieldUntil = now + FX.shield_ms; log(world, e, t, "shield"); }
    if (d.selfDefCh && rnd() < d.selfDefCh(t.lvl)) { e.trkDefDownUntil = now + FX.selfdef_ms; log(world, e, t, "self_def_down"); }
    if (d.auraCh && rnd() < chance(e, t, "auraCh")) { API.fx(world, VFX.aura, e.x, e.y, 800, e); ring(world, e, FX.aura_r, FX.aura, false, now, false); log(world, e, t, "aura"); }
    if (d.wildAuraCh && rnd() < d.wildAuraCh(t.lvl)) { API.fx(world, VFX.aura, e.x, e.y, 800, e); ring(world, e, FX.aura_r, FX.aura, false, now, true); log(world, e, t, "wild_aura"); }
    if (d.tentacleCh && alive && rnd() < chance(e, t, "tentacleCh")) {
      slowEnt(tgt, FX.tentacle_ms, FX.slow, now); dot(world, e, tgt, FX.tentacle_n, FX.tentacle_ms / FX.tentacle_n, FX.tentacle);
      world.after(FX.tentacle_ms, () => heal(world, e, FX.tentacle_n * FX.tentacle));   // vampiric: heals what it drained
      log(world, e, t, "tentacle");
    }
    if (d.selfSlowCh && rnd() < d.selfSlowCh(t.lvl)) { e.trkSlowUntil = now + FX.slow_ms; log(world, e, t, "self_slow"); }
    if (d.surgeCh && rnd() < chance(e, t, "surgeCh")) { e.trkSurgeUntil = now + FX.surge_ms; API.fx(world, VFX.surge, e.x, e.y, 800, e); ring(world, e, FX.paralyse_r, FX.paralyse, true, now, false); log(world, e, t, "surge"); }
    if (d.burnCh && alive && rnd() < chance(e, t, "burnCh")) { dot(world, e, tgt, FX.burn_n, FX.burn_ms, FX.burn); log(world, e, t, "burn"); }
    if (d.selfBurnCh && rnd() < d.selfBurnCh(t.lvl)) { for (let i = 1; i <= FX.burn_n; i++) world.after(FX.burn_ms * i, () => selfHurt(world, e, FX.burn)); log(world, e, t, "self_burn"); }
    if (d.spite) selfHurt(world, e, d.spite(t.lvl));
    if (d.stealCh && dealt > 0 && rnd() < chance(e, t, "stealCh")) { heal(world, e, Math.round(dealt * d.steal(t.lvl))); log(world, e, t, "lifesteal"); }
    if (d.thornCh && rnd() < chance(e, t, "thornCh")) { API.fx(world, VFX.aura, e.x, e.y, 800, e); ring(world, e, FX.thorn_r, FX.thorn, false, now, false); heal(world, e, FX.thorn); log(world, e, t, "thornbush"); }
  }
}
// damage taken by the pet: defense maluses (and Wilted Frostguard's short defense drop), Frostguard shield
function hurt(e, dmg, now) {
  if (!e.trk) return dmg;
  if (e.trkShieldUntil > now) return 0;
  const def = sum(e, "def") + (e.trkDefDownUntil > now ? FX.selfdef : 0);
  return dmg * (1 - def);
}
function regenMult(e) { return e.trk ? Math.max(0, 1 + sum(e, "regen")) : 1; }
function xpMult(e) { return e && e.trk ? Math.max(0, 1 + sum(e, "xp")) : 1; }
function speed(e, v, now) {
  if (!e.trk) return v;
  if (e.trkStopUntil > now) return 0;
  v = Math.max(40, v + sum(e, "speed"));
  if (e.trkSurgeUntil > now) v *= FX.surge;
  if (e.trkSlowUntil > now) v *= FX.slow;
  return v;
}
function stopped(e, now) { return !!(e.trk && e.trkStopUntil > now); }
// every pet step: Mimic Cap heal and tamer drain (never below 1 hp), Tidebladder low health heal / wilted damage
function tick(world, e, now) {
  if (!e.trk || e.dead) return;
  const t0 = e.trkT = e.trkT || {};
  for (const t of e.trk) {
    const d = t.d, k = t.id + ":" + e.trk.indexOf(t);
    if (d.every) {
      if (t0[k] == null) t0[k] = now;
      if (now - t0[k] >= d.every) {
        t0[k] = now;
        if (d.petHeal) heal(world, e, d.petHeal(t.lvl));
        const p = e.owner;
        if (p && p.alive && p.ent && d.drain) { const hp = p.hp != null ? p.hp : null, n = hp != null ? Math.min(d.drain(t.lvl), Math.max(0, hp - 1)) : d.drain(t.lvl); if (n > 0) p.hurt(n, null, "trinket"); }
        log(world, e, t, "mimic");
      }
    }
    if (d.lowEvery && e.hp < e.max * 0.2) {
      if (t0[k] == null || now - t0[k] >= d.lowEvery(t.lvl)) {
        t0[k] = now;
        if (d.lowHeal) heal(world, e, d.lowHeal(t.lvl)); else selfHurt(world, e, d.lowDmg(t.lvl));
        log(world, e, t, d.lowHeal ? "low_heal" : "low_dmg");
      }
    }
  }
}

// ---------------------------------------------------------------- bushes
function bushName(kind, b) { return (PRE[b] || "") + BUSH[kind]; }
function isBush(name) { return /(^|-)golden-flower-bush$|(^|-)seeds-plant$/.test(name || ""); }
// the account: a granted trinket goes to inventory["4"] (the menu's trinket bag, kept for this server run)
function grant(id) { if (PROFILE.trinket) PROFILE.trinket(id, 1); }
// a broken rare bush: the breaker gets its drop (o.phase = the biome it spawned in)
function bushLoot(world, o, by) {
  const b = o.phase != null ? o.phase : world.phase;
  if (/golden-flower-bush$/.test(o.name)) { try { require("./insects").spawnBug(world, 24, o.x, o.y); } catch (e) { } }   // wiki: a Majestic Butterfly comes out
  if (!by || !by.queue) return;
  let got = null;
  if (/seeds-plant$/.test(o.name)) { const pool = OATHBUD[b] || OATHBUD[0]; got = pool[Math.floor(Math.random() * pool.length)]; }
  else if (/golden-flower-bush$/.test(o.name) && b === 0 && Math.random() < 0.5) got = 130;
  if (got == null) { world.L({ k: "bush_loot", room: world.name, name: o.name, by: by.n, got: null }); return; }
  grant(got);
  by.say("[Trinket] You found " + DEF[got].name + " seeds. They grew into a " + DEF[got].name + " trinket: equip it from the pet menu (trinket slots).");
  world.L({ k: "bush_loot", room: world.name, name: o.name, by: by.n, got, trinket: DEF[got].name });
}
module.exports = { DEF, OATHBUD, BUSH, SPAWN_CH, FX, init, parse, attach, bite, afterBite, hurt, regenMult, xpMult, speed, stopped, tick, bushName, isBush, bushLoot, typeOf };
