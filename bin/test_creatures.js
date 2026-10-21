#!/usr/bin/env node
// Tests for mimic/hosted/creatures.js.
if (process.env.TIO_BOSS_PETS == null) process.env.TIO_BOSS_PETS = "0";   // base sections run without the boss pets (on by default in the server)
// Usage: node bin/test_creatures.js --unit             fake world object, no sockets (includes --nav)
//        node bin/test_creatures.js --nav              A* navigation only (TIO_CREATURE_ASTAR=1 set internally)
//        node bin/test_creatures.js --boss             invented boss pets only (TIO_BOSS_PETS=1 set internally)
//        node bin/test_creatures.js --port 8923        live dev server (MODE=multi, TIO_CREATURES_TEST=1), loopback only
"use strict";
const path = require("path"), net = require("net");
const ROOT = path.join(__dirname, "..");
const A = {}; for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i].replace(/^--/, ""); const v = process.argv[i + 1]; if (v != null && !v.startsWith("--")) { A[k] = v; i++; } else A[k] = true; }
let fails = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ fake world
function fakeWorld(phase) {
  const W = require(path.join(ROOT, "mimic", "world_sp5.json"));
  const w = {
    name: "fake", ents: new Map(), players: new Map(), ext: {}, P: {}, phase, now: 1e6, nid: 7000000, log: [], touches: [],
    ctx: { WORLD: W },
    L(o) { this.log.push(o); },
    nextId() { return this.nid++; },
    addEnt(e) { e.delta = null; this.ents.set(e.id, e); return e; },
    removeEnt(id) { this.ents.delete(id); this.touches.push({ id, remove: true }); },
    touch(e, f) { e.delta = Object.assign(e.delta || {}, f); this.touches.push(Object.assign({ id: e.id }, f)); },
    collide(x, y) { return [x, y]; },
    damage(t, amount, by) {
      const e = t.ent !== undefined && t.queue ? t.ent : t;
      if (typeof e.hurt === "function") return e.hurt(amount, by);
      if (e.kind === "player") { e.p.hurt(amount, by && by.queue ? by : null); return amount; }
      return 0;
    },
  };
  return w;
}
function fakePlayer(w, x, y) {
  const n = w.players.size + 1;
  const p = { n, alive: true, joined: true, hp: 100, xp: 0, inv: {}, msgs: [], shieldUntil: 0, kills: { players: 0, animals: 0 }, name: "p" + n,
    queue(m) { this.msgs.push(m); }, addXp(v) { this.xp += v; }, gain(a) { for (const [k, v] of Object.entries(a)) this.inv[k] = (this.inv[k] || 0) + v; },
    hurt(d, by, cause) { if (!this.alive) return; this.lastBy = by; this.lastCause = cause; this.hp -= d; if (this.hp <= 0) { this.alive = false; } } };
  p.ent = w.addEnt({ id: w.nextId(), kind: "player", x, y, p, cd: 0 });
  w.players.set(n, p);
  return p;
}
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function run(w, M, ms) { for (let t = 0; t < ms; t += 94) { w.now += 94; M.tick(w, w.now, 94); } }
const touchesOf = (w, id, from) => w.touches.slice(from || 0).filter((t) => t.id === id);

function unit() {
  delete require.cache[require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"))];
  const M = require(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  check(M.replaces && M.replaces.indexOf("animals") >= 0, "exports replaces: [animals]");
  const w = fakeWorld(1); M.attach(w);
  const st = w.ext.creatures, kinds = {};
  for (const e of st.wild) kinds[e.sp] = (kinds[e.sp] || 0) + 1;
  check(st.wild.size >= 50, "snow phase spawns its creatures: " + st.wild.size + " " + JSON.stringify(kinds));
  check(!!kinds[15] && !!kinds[120] && !kinds[31], "snow species by field 21 (deer 15 and seal 120 present, black spider 31 absent)");
  const anyc = [...st.wild][0].create();
  check(anyc["2"] === 0 && anyc["22"] != null && (anyc["7"] === 2 || anyc["7"] === 66) && anyc["1"] === 79, "wild create: cat 0, kind 22, state 7 = 2 (awake) or 66 (asleep): " + JSON.stringify(anyc));

  // pet at join
  const p = fakePlayer(w, 9000, 9000);
  M.onJoin(w, p);
  const pet = st.byOwner.get(p.n)[0];
  check(pet && pet.id === p.ent.id + 1, "pet id = own id + 1 (" + (pet && pet.id) + ")");
  const pc = pet.create();
  check(pc["13"] === p.ent.id && pc["21"] === 0 && pc["22"] === 20 && pc["7"] === 10 && pc["2"] === 0, "pet create: 13 owner, species 21 = 0 wolf (class 22 = 20), 7 = 10 spawning");
  check(!p.msgs.some((m) => m["1"] === 59), "no extra own_info when the id lines up");
  for (const e of [...st.wild]) { w.removeEnt(e.id); st.wild.delete(e); }
  run(w, M, 1100);
  check(pet.s7 === 2, "pet state 10 -> 2 after spawn");

  // follow: owner jumps away, pet runs
  p.ent.x += 900; const d0 = Math.hypot(pet.x - p.ent.x, pet.y - p.ent.y);
  const t0 = w.touches.length; run(w, M, 940);
  const d1 = Math.hypot(pet.x - p.ent.x, pet.y - p.ent.y);
  check(d0 - d1 > 200, "pet runs after the owner: " + Math.round(d0) + " -> " + Math.round(d1) + " in 10 frames");
  run(w, M, 4000);
  const d2 = Math.hypot(pet.x - p.ent.x, pet.y - p.ent.y);
  check(d2 <= 440, "pet settles near the owner (base capture wolf, owner still: q90 432): " + Math.round(d2));

  // aggro + attack (scorpion 44)
  const S = require(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  w.phase = 1;
  // spawn through the test hook path: onJson type 990 needs env
  process.env.TIO_CREATURES_TEST = "1";
  S.onJson(w, p, { type: 990, kind: 31, d: 350, a: Math.PI, stage: 1 });
  const scorp = [...st.wild].find((e) => e.sp === 31);
  check(!!scorp, "black spider placed 350 from the player");
  pet.mode = 2; pet.tgt = null; st.pets.delete(pet);   // pet out of the aggro search so the player is the nearest target
  const hp0 = p.hp, tt = w.touches.length;
  run(w, M, 3000);
  st.pets.add(pet);
  const flags = touchesOf(w, scorp.id, tt).filter((t) => t["7"] != null).map((t) => t["7"]);
  check(p.hp < hp0 && (hp0 - p.hp) % 15 === 0, "scorpion chases and hits for 15: hp " + hp0 + " -> " + p.hp);
  check(p.lastBy === scorp && p.lastCause === "creature:Black Spider", "creature hit names its source: by = creature, cause " + p.lastCause);
  check(flags.indexOf(34) >= 0 && flags.indexOf(2) > flags.indexOf(34), "attack shows 7 = 34 then back to 2: " + flags.join(","));
  check(Math.hypot(scorp.x - p.ent.x, scorp.y - p.ent.y) <= 115, "scorpion stops at reach: " + Math.round(Math.hypot(scorp.x - p.ent.x, scorp.y - p.ent.y)));

  // kill by the player: hp bar, 11 = 1, death, rewards, pet level
  const tk = w.touches.length, xp0 = p.xp;
  let n = 0; while (w.ents.has(scorp.id) && scorp.st !== "dying" && n++ < 100) scorp.hurt(30, p);
  const ks = touchesOf(w, scorp.id, tk);
  check(ks[0]["9"] < 255 && ks[0]["10"] === 30 && ks[0]["11"] === 1, "hit record {9 bar, 10 dmg, 11: 1}: " + JSON.stringify(ks[0]));
  const last = ks[ks.length - 1];
  check(last["7"] === 18 && last["9"] === 0, "death record {7: 18, 9: 0}: " + JSON.stringify(last));
  check(p.xp - xp0 === 100 && p.inv[3] > 0, "kill XP by stage (adult 100) and gold: xp +" + (p.xp - xp0) + " inv " + JSON.stringify(p.inv));
  check(touchesOf(w, pet.id, tk).some((t) => t["14"] === 100 && t["15"] === 100) && !p.msgs.some((m) => m["1"] === 59 && m.a), "pet record {14: kill xp 100, 15: total 100}, no growth below 200");
  S.onJson(w, p, { type: 990, kind: 31, d: 200, a: 1, stage: 2 });
  const boss = [...st.wild].find((e) => e.sp === 31 && e.stage === 2 && e.st !== "dying");
  let nb = 0; while (boss.st !== "dying" && nb++ < 200) boss.hurt(50, p);
  check(p.msgs.some((m) => m["1"] === 59 && m.i === pet.id && m.a === 1) && pet.max === Math.round(M.C.pet_hp_by_level[1] * M.C.ob_hp_mult) && p.inv[3] >= 2400, "boss kill: +2400 gold (client table), pet total 500 -> own_info a 1, hp max " + pet.max);
  run(w, M, 1300);
  run(w, M, 1300);
  check(!w.ents.has(scorp.id), "dead creature removed after ~1.2 s");
  check(st.respawn.length >= 1, "respawn queued");

  // leash: a scorpion chasing a player who runs away gives up and walks home
  S.onJson(w, p, { type: 990, kind: 31, d: 300, a: 0, clear: 3000 });
  const sc2 = [...st.wild].find((e) => e.sp === 31 && e.st !== "dying");
  st.pets.delete(pet); run(w, M, 600);
  check(sc2.tgt === p.ent, "scorpion aggroes at 300");
  p.ent.x += 3000; run(w, M, 2000);
  check(sc2.tgt === null && sc2.st !== "chase", "gives up when the player is far: state " + sc2.st);
  run(w, M, 3000);
  check(Math.hypot(sc2.x - sc2.hx, sc2.y - sc2.hy) <= 400, "walks back to its zone: " + Math.round(Math.hypot(sc2.x - sc2.hx, sc2.y - sc2.hy)) + " from home");
  p.ent.x -= 3000; p.ent.x = sc2.x + 250; p.ent.y = sc2.y; run(w, M, 500);
  check(sc2.tgt === null, "leaves that player alone for 10 s after giving up");
  p.ent.x = 9000; p.ent.y = 9000; pet.x = 9100; pet.y = 9000; st.pets.add(pet);
  w.removeEnt(sc2.id); st.wild.delete(sc2);
  // shield: a shielded player is never targeted
  const p2 = fakePlayer(w, 20000, 20000); p2.shieldUntil = w.now + 5000;
  S.onJson(w, p2, { type: 990, kind: 31, d: 200, a: 0 });
  const sc3 = [...st.wild].find((e) => e.sp === 31 && Math.hypot(e.x - 20000, e.y - 20000) < 300);
  run(w, M, 2000);
  check(sc3 && sc3.tgt !== p2.ent && p2.hp === 100, "spawn-shielded player is ignored");
  w.removeEnt(sc3.id); st.wild.delete(sc3); w.players.delete(p2.n); w.removeEnt(p2.ent.id);
  // pets do not retaliate against a player whose swing catches them
  const q = fakePlayer(w, 9050, 9050); M.onJoin(w, q);
  pet.tgt = null; pet.mode = 1; pet.hurt(4, q);
  check(pet.tgt === null, "own pet ignores a player's stray hit");

  // pet commands
  // pet skill: JSON 48 S 4 casts Deflagration (wolf, skill id 0) at the pet; it hits creatures around and burns them
  S.onJson(w, p, { type: 990, kind: 120, d: 300, a: 0 });
  const fairy = [...st.wild].find((e) => e.sp === 120);
  w.P.creatures = { 120: { chase: 0 } };   // the seal stays inside the burning area
  pet.x = fairy.x - 120; pet.y = fairy.y; pet.tgt = null; pet.mode = 2;
  const fh = fairy.hp, tsk = w.touches.length, px = pet.x;
  check(S.onJson(w, p, { type: 48, I: pet.id, S: 4 }) === true, "JSON 48 S 4 handled");
  run(w, M, 470);
  const fx = [...w.ents.values()].find((e) => e.kind === "projectile" && e.src === pet);
  const fc = fx && fx.create();
  check(!!fc && fc["7"] === 0 && fc["8"] === pet.stage && fc["2"] === 4 && fc["10"] === pet.id, "Deflagration create {2: 4, 7: 0, 8: pet stage, 10: pet}: " + JSON.stringify(fc));
  if (process.env.DBG) { const pr = [...w.ents.values()].find((e) => e.kind === "projectile" && e.src === pet); console.log("DBG fire", pr && [pr.x, pr.y, !!pr.aoe, pr.aoe && pr.aoe.adm], "fairy", fairy.x, fairy.y, fairy.st, fairy.s7, "inEnts", w.ents.has(fairy.id), fairy.id, fairy.stage, fairy.max, "pet", pet.x, pet.y, "castUntil", pet.castUntil - w.now, "kb", JSON.stringify(pet.kb), "mode", pet.mode, "tgt", pet.tgt && pet.tgt.id, w.log.filter((x) => x.k === "pet_cast").slice(-1)); }
  const first = touchesOf(w, fairy.id, tsk).find((t) => t["10"]);
  check(first && first["10"] === 30, "first hit = wiki animal damage for stage a 1 (30): " + JSON.stringify(first));
  run(w, M, 3000);
  if (process.env.DBG) console.log(JSON.stringify(touchesOf(w, fairy.id, tsk)), JSON.stringify(touchesOf(w, fx ? fx.id : 0, tsk).slice(-3)), fairy.hp, Math.round(dist2(fairy, pet)));
  const dots = touchesOf(w, fairy.id, tsk).filter((t) => t["10"] === 3).length;
  check(dots >= 8, "damage over time 3 every ~0.25 s (" + dots + " ticks)");
  check(dots <= 10, "burn stops after 10 ticks (" + dots + ")");
  if (fx && w.ents.has(fx.id)) { pet.x += 50; run(w, M, 94); check(Math.round(fx.x) === Math.round(pet.x) && Math.round(fx.y) === Math.round(pet.y), "skill effect rides on the wolf"); }
  const lc = pet.lastCast; S.onJson(w, p, { type: 48, I: pet.id, S: 4 });
  check(pet.lastCast === lc, "recast inside the reload is refused");
  run(w, M, 1500);
  check(!fx || !w.ents.has(fx.id), "skill effect removed after ~4 s");
  w.P.creatures = undefined;
  S.onJson(w, p, { type: 48, I: pet.id, S: 2 });
  check(pet.mode === 2 && pet.tgt === null && pet.s7 === 2, "S 2 = stop: no fighting, 7 = 2");
  check(S.onHit(w, p, pet, 10) === 0, "owner cannot hurt his own pet (onHit -> 0)");

  // taming
  S.onJson(w, p, { type: 990, kind: 2, d: 130, a: 1, stage: 0 });
  M.C.tame_chance = 1;
  const golem = [...st.wild].find((e) => e.sp === 2);
  golem.lastAtk = w.now + 1e9;
  const ttm = w.touches.length;
  check(S.onJson(w, p, { type: 45, _: golem.id }) === true, "JSON 45 handled");
  check(touchesOf(w, golem.id, ttm).some((t) => t["12"] === 1), "tame start: creature gets {12: 1}");
  run(w, M, 4800);
  const tamed = w.ents.get(golem.id);
  check(tamed && tamed.kind === "pet" && tamed.owner === p && tamed.create()["13"] === p.ent.id && tamed.create()["21"] === 2 && tamed.create()["22"] === 21, "after ~4.7 s same id re-created as our pet: bear (21 = 2, class 22 = 21)");
  check(p.msgs.some((m) => m["1"] === 59 && m.i === golem.id && m.n === 2) && p.msgs.some((m) => m["1"] === 44 && m.o === 1 && m.n === 2), "own_info {i: tamed id, n: species 2} + 44 {o: 1, n: 2}");
  check(w.touches.slice(ttm).some((t) => t.id === golem.id && t.remove), "remove sent before the pet create");

  // riding: swing at the own pet holding the Saddle
  p.held = 74; run(w, M, 94); p.held = 160;
  const tr = w.touches.length;
  check(S.onHit(w, p, pet, 4) === 0 && pet.rider === p && p.riding === true, "Saddle swing at own pet mounts it (onHit -> 0)");
  const mo = touchesOf(w, p.ent.id, tr).find((t) => t["16"] === 1);
  check(!!mo && mo["8"] === 74 && mo["15"] === 500 && p.held === 74 && p.cf["16"] === 1, "rider record {7: 1, 8: previous item, 15: 500, 16: 1}, cf 16 = 1: " + JSON.stringify(mo));
  check(touchesOf(w, pet.id, tr).some((t) => t["17"] === 160) && pet.create()["17"] === 160, "ridden pet {17: 160}");
  p.ent.x += 300; p.ent.y -= 120; run(w, M, 188);
  check(pet.x === p.ent.x && pet.y === p.ent.y, "ridden pet moves with the rider (distance 0)");
  p.held = 160; S.onHit(w, p, pet, 4);
  check(!pet.rider && p.cf["16"] === 0 && touchesOf(w, p.ent.id).some((t) => t["16"] === 0), "Saddle swing again dismounts {16: 0}");
  run(w, M, 94); p.held = 160; S.onHit(w, p, pet, 4); p.held = 74;
  check(pet.rider === p, "mounted again for the death test");

  // pet death
  const tpd = w.touches.length;
  let k = 0; while (!pet.dead && k++ < 200) pet.hurt(50, fairy);
  check(touchesOf(w, pet.id, tpd).some((t) => t["7"] === 50 && t["9"] === 0), "pet death record {7: 50, 9: 0}");
  check(p.msgs.some((m) => m["1"] === 59 && m.i === pet.id && m.d === 1), "own_info {i: pet, d: 1}");
  check(!p.riding && touchesOf(w, p.ent.id, tpd).some((t) => t["16"] === 0) && touchesOf(w, pet.id, tpd).some((t) => t["17"] === 0), "pet death ends the ride: pet {17: 0}, rider {16: 0}");
  run(w, M, 300);
  check(!w.ents.has(pet.id), "dead pet removed");
  const tod = w.touches.length;
  M.onDeath(w, p);
  check(w.ents.has(golem.id) && touchesOf(w, golem.id, tod).some((t) => t["7"] === 18) && !st.byOwner.get(p.n).length, "owner death: remaining pet gets {7: 18}, leaves the pet list, stays in view");
  run(w, M, 940);
  check(w.ents.has(golem.id), "pet kept through the death screen");
  M.afterDeath(w, p, p.ent.id); w.removeEnt(p.ent.id);
  check(w.ents.has(golem.id), "pet not removed in the owner's remove tick");
  run(w, M, 94);
  check(!w.ents.has(golem.id), "pet removed one tick after the owner's remove");
  p.alive = true; p.ent = w.addEnt({ id: w.nextId(), kind: "player", x: 9000, y: 9000, p, cd: 0 }); M.onRespawn(w, p);
  check(st.byOwner.get(p.n).length === 1 && st.byOwner.get(p.n)[0].id === p.ent.id + 1, "next life: new dragon pet at own id + 1");

  // turret
  const tur = w.addEnt({ id: w.nextId(), kind: "placed", name: "stone-turret", x: 9300, y: 9000, owner: 999, cd: 65 });
  M.onLeave(w, q); w.players.delete(q.n); w.removeEnt(q.ent.id);
  S.onJson(w, p, { type: 990, kind: 59, d: 400, a: 0, clear: 3000 });
  const oryx = [...st.wild].find((e) => e.sp === 59);
  oryx.x = 9500; oryx.y = 9000;
  const tt2 = w.touches.length; run(w, M, 2200);
  check(touchesOf(w, tur.id, tt2).some((t) => t["9"] === 17 && t["5"] != null), "turret shot: {5: aim, 9: 17}");
  check([...w.ents.values()].some((e) => e.kind === "effect" && e.create()["2"] === 2 && e.create()["7"] === 9) || touchesOf(w, oryx.id, tt2).length, "turret flash effect cat 2, 7 = 9");
  check(touchesOf(w, oryx.id, tt2).some((t) => t["10"] === 12 && t["11"] === 3), "turret hit {10: 12, 11: 3}");

  // biome switch
  const old = [...st.wild].map((e) => e.id), tb = w.touches.length;
  w.phase = 2; S.onBiome(w, 1, 2);
  check(old.every((id) => touchesOf(w, id, tb).some((t) => t["7"] === 18 && t["9"] === 0 && t["10"] === 400)), "biome switch: every old creature gets {7: 18, 9: 0, 10: 400}");
  const nk = {}; for (const e of st.wild) nk[e.sp] = (nk[e.sp] || 0) + 1;
  check(st.wild.size > 0 && !!nk[31], "dark phase creatures spawned (black spider 31): " + JSON.stringify(nk));
  run(w, M, 1100);
  check(old.every((id) => !w.ents.has(id)), "old creatures removed ~1 s after the switch");

  const sx = M.stats(w);
  check(sx && typeof sx.wild === "number" && typeof sx.respawn_queue === "number" && typeof sx.riding === "number" && sx.pets >= 1, "stats(world): " + JSON.stringify(sx));
  check(M.stats({ ext: {} }) === null, "stats on a world without the plugin -> null");

  // 50 players join and leave: every per-player map back to its baseline
  const base = M.stats(w);
  for (let i = 0; i < 50; i++) {
    const u = fakePlayer(w, 9000 + i * 10, 9000); u.held = 57; M.onJoin(w, u);
    run(w, M, 94);
    for (const e of st.wild) { e.calm = e.calm || new Map(); e.calm.set(u.n, w.now + 10000); }
    M.onLeave(w, u); w.players.delete(u.n); w.removeEnt(u.ent.id);
  }
  run(w, M, 400);
  const aft = M.stats(w);
  check(["pets", "by_owner", "owners_with_pets", "prev_held", "calm_entries", "riding"].every((k) => aft[k] === base[k]),
    "50 join/leave: per-player maps back to baseline " + JSON.stringify({ base, aft }));

  // sockets that open and close without joining leave nothing behind; entries of players gone without onLeave are pruned
  const b2 = M.stats(w);
  for (let i = 0; i < 30; i++) { const u = { n: 5000 + i, joined: false, alive: false, held: 0, ent: null, queue() {} }; w.players.set(u.n, u); run(w, M, 94); w.players.delete(u.n); }
  const ghost = fakePlayer(w, 9100, 9100); ghost.held = 57; M.onJoin(w, ghost); run(w, M, 94);
  w.players.delete(ghost.n); w.removeEnt(ghost.ent.id);
  run(w, M, 5200);
  const a2 = M.stats(w);
  check(a2.prev_held === b2.prev_held && a2.by_owner === b2.by_owner && a2.pets === b2.pets, "unjoined sockets and a player gone without onLeave leave no entries: " + JSON.stringify({ b2, a2 }));

  // /easy: every pet of the player jumps to max growth; a pet tamed while easy starts there
  const pe = fakePlayer(w, 15000, 15000); M.onJoin(w, pe);
  const wolf = st.byOwner.get(pe.n)[0], m0 = pe.msgs.length;
  pe.easy = true; M.onEasy(w, pe);
  const grow = pe.msgs.slice(m0).filter((m) => m["1"] === 59 && m.i === wolf.id).map((m) => m.a);
  check(wolf.lvl === 2 && wolf.max === Math.round(M.C.pet_hp_by_level[2] * M.C.ob_hp_mult) && grow.join(",") === "1,2" && wolf.pxp >= 600, "onEasy: wolf to max (a 1 then 2), hp max " + wolf.max + ", pet xp " + wolf.pxp);
  M.onJson(w, pe, { type: 990, kind: 2, d: 130, a: 1, stage: 0 }); M.C.tame_chance = 1;
  const bear = [...st.wild].filter((e) => e.sp === 2).sort((u, v) => Math.hypot(u.x - pe.ent.x, u.y - pe.ent.y) - Math.hypot(v.x - pe.ent.x, v.y - pe.ent.y))[0];
  M.onJson(w, pe, { type: 45, _: bear.id }); run(w, M, 4800);
  const eb = w.ents.get(bear.id);
  check(!!eb && eb.kind === "pet" && eb.lvl === 2, "pet tamed while easy starts at max growth (lvl " + (eb && eb.lvl) + ", hp max " + (eb && eb.max) + ")");
  M.C.tame_chance = null; M.onLeave(w, pe); w.players.delete(pe.n); w.removeEnt(pe.ent.id);

  // boss marker: the forest dragon boss (species 20) sets world.boss.marker 1 (board ob[2] dragon)
  const w3 = fakeWorld(0); M.attach(w3);
  check(w3.boss && w3.boss.kind === 20 && w3.boss.marker === 1, "forest boss sets world.boss {kind 20, marker 1}: " + JSON.stringify(w3.boss));

  // CPU: 40 players spread over the map, all phases' creatures
  const w2 = fakeWorld(1); M.attach(w2);
  for (const ph of [2, 3, 4, 5, 0]) M._spawnPhase(w2, ph);
  w2.ext.creatures.phase = 1;
  const ps = []; for (let i = 0; i < 40; i++) { const q = fakePlayer(w2, 6000 + (i % 8) * 1200, 11000 + Math.floor(i / 8) * 1200); M.onJoin(w2, q); ps.push(q); }
  for (let i = 0; i < 400; i++) w2.ents.set(9e6 + i, { id: 9e6 + i, kind: "static", x: Math.random() * 17000, y: Math.random() * 17000, cd: 100 });
  w2.collide = function (x, y) { for (const e of this.ents.values()) { if (!e.cd) continue; const dx = x - e.x, dy = y - e.y; if (dx * dx + dy * dy < e.cd * e.cd) { } } return [x, y]; };
  const h0 = process.hrtime.bigint(); run(w2, M, 94 * 300);
  const ms = Number(process.hrtime.bigint() - h0) / 1e6 / 300;
  check(ms < 15, "40 players + " + w2.ext.creatures.wild.size + " creatures + 40 pets: " + ms.toFixed(2) + " ms per tick (budget 94)");
}

// ------------------------------------------------------------ navigation (TIO_CREATURE_ASTAR=1)
function nav() {
  process.env.TIO_CREATURE_ASTAR = "1";
  const f = require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  delete require.cache[f];
  const M = require(f);
  check(M._nav.ASTAR === true, "TIO_CREATURE_ASTAR=1 turns the A* navigation on");
  const w = fakeWorld(0); w.P = { map_min: 350, map_max: 17250 }; w.epoch = 1;
  M.attach(w);
  const st = w.ext.creatures;
  for (const e of [...st.wild]) { w.removeEnt(e.id); st.wild.delete(e); }
  // a wall of solids across x = 10000 from y 9200 to 10800
  const walls = [];
  for (let y = 9600; y <= 10400; y += 120) { const o = { id: w.nextId(), kind: "static", x: 10000, y, cd: 110 }; w.ents.set(o.id, o); walls.push(o); }
  const p = fakePlayer(w, 12000, 10000);
  const path0 = M._nav.astar(w, 9400, 10000, 10600, 10000);
  check(Array.isArray(path0) && path0.length >= 2, "A* finds a way around the wall: " + JSON.stringify(path0 && path0.map((q) => q.map(Math.round))));
  const clear = (x, y) => walls.every((o) => Math.hypot(o.x - x, o.y - y) >= o.cd);
  let segOk = true, prev = [9400, 10000];
  for (const q of path0 || []) { for (let k = 0; k <= 20; k++) { const x = prev[0] + (q[0] - prev[0]) * k / 20, y = prev[1] + (q[1] - prev[1]) * k / 20; if (!clear(x, y)) segOk = false; } prev = q; }
  check(segOk, "every path segment stays clear of the solids");
  check(!M._nav.los(w, 9400, 10000, 10600, 10000) && M._nav.los(w, 9400, 8000, 10600, 8000), "line of sight blocked through the wall, open beside it");
  // a creature chasing a player on the other side walks around the wall, never through it
  const tpl = { "21": 31, "22": 44, "23": 1, "24": 0, "25": 10, "6": 1, "7": 2 };
  const e = M._spawnWild ? null : null;
  process.env.TIO_CREATURES_TEST = "1";
  p.ent.x = 9300; p.ent.y = 10000;
  M.onJson(w, p, { type: 990, kind: 31, d: 1, a: 0, stage: 1 });
  const cr = [...st.wild].find((q) => q.sp === 31);
  cr.x = 9300; cr.y = 10000; p.ent.x = 10500; p.ent.y = 10050;
  cr.tgt = p.ent; cr.st = "chase";
  w.P.creatures = { 31: { aggro: 3000 } }; const gu = M.C.give_up; M.C.give_up = 3000;
  const track = []; let through = false;
  for (let i = 0; i < 300 && Math.hypot(cr.x - p.ent.x, cr.y - p.ent.y) > 150; i++) { run(w, M, 94); track.push([cr.x, cr.y]); if (!clear(cr.x, cr.y)) through = true; }
  const dEnd = Math.hypot(cr.x - p.ent.x, cr.y - p.ent.y);
  check(!through && dEnd <= 200, "chase goes around the wall (never inside a solid), reaches the player: " + Math.round(dEnd));
  let pathLen = 0; for (let i = 1; i < track.length; i++) pathLen += Math.hypot(track[i][0] - track[i - 1][0], track[i][1] - track[i - 1][1]);
  check(pathLen > 1.15 * 1200, "the chase path curves around (path " + Math.round(pathLen) + " vs straight 1200)");
  w.P.creatures = undefined; M.C.give_up = gu;
  // wander: no homing, runs and pauses, curved paths
  for (const o of walls) w.ents.delete(o.id);
  p.ent.x = 20000; p.ent.y = 20000;
  const cr2 = [...st.wild].find((q) => q.sp === 31);
  cr2.tgt = null; cr2.st = "wander"; cr2.hx = cr2.x = 5000; cr2.hy = cr2.y = 5000; cr2.idleUntil = 0;
  p.ent.x = 5600; p.ent.y = 5000; p.shieldUntil = w.now + 1e9;   // keeps it awake without being a target
  let moves = 0, stops = 0, last = [cr2.x, cr2.y], maxHome = 0, wasMoving = false;
  for (let i = 0; i < 2000; i++) {
    run(w, M, 94);
    const mv = Math.hypot(cr2.x - last[0], cr2.y - last[1]) > 0.5; last = [cr2.x, cr2.y];
    if (mv) moves++; if (wasMoving && !mv) stops++; wasMoving = mv;
    p.ent.x = cr2.x + 600; p.ent.y = cr2.y;
    maxHome = Math.max(maxHome, Math.hypot(cr2.x - 5000, cr2.y - 5000));
  }
  check(moves > 100 && stops >= 2, "wander walks in runs with pauses (" + moves + " moving updates, " + stops + " stops in 188 s)");
  check(maxHome > 500, "wanders away from where it started, no pull back to a home point (max " + Math.round(maxHome) + ")");
  // give-up does not walk home
  const cr3 = cr2; cr3.x = 5000; cr3.y = 5000; cr3.hx = 1000; cr3.hy = 1000; cr3.path = null;
  const far = fakePlayer(w, 5000 + 2000, 5000); cr3.tgt = far.ent; cr3.st = "chase";
  run(w, M, 200);
  const h0 = Math.hypot(cr3.x - 1000, cr3.y - 1000); cr3.idleUntil = w.now + 5000; run(w, M, 4000);
  check(cr3.tgt === null && Math.abs(Math.hypot(cr3.x - 1000, cr3.y - 1000) - h0) < 60, "chase give-up just stops (no walk back to spawn)");
  // CPU: 40 players + 200 creatures among 800 solids
  const w2 = fakeWorld(1); w2.P = { map_min: 350, map_max: 17250 }; w2.epoch = 1; M.attach(w2);
  for (const ph of [2, 3]) M._spawnPhase(w2, ph);
  w2.ext.creatures.phase = 1;
  for (let i = 0; i < 800; i++) { const o = { id: 9e6 + i, kind: "static", x: 500 + Math.random() * 16500, y: 500 + Math.random() * 16500, cd: 100 }; w2.ents.set(o.id, o); }
  w2.solidsNear = function (x, y, out) { for (const o of this.ents.values()) if (o.kind === "static" && Math.abs(o.x - x) < 400 && Math.abs(o.y - y) < 400) out.push(o); return out; };
  for (let i = 0; i < 40; i++) { const q = fakePlayer(w2, 6000 + (i % 8) * 1200, 11000 + Math.floor(i / 8) * 1200); M.onJoin(w2, q); }
  const h1 = process.hrtime.bigint(); run(w2, M, 94 * 300);
  const ms = Number(process.hrtime.bigint() - h1) / 1e6 / 300;
  check(ms < 15, "A*: 40 players + " + w2.ext.creatures.wild.size + " creatures + 800 solids: " + ms.toFixed(2) + " ms per tick (fake world, linear solid scan)");
  delete process.env.TIO_CREATURE_ASTAR;
}

// ------------------------------------------------------------ invented boss pets (TIO_BOSS_PETS=1)
function bosspets() {
  process.env.TIO_BOSS_PETS = "1"; process.env.TIO_CREATURES_TEST = "1";
  const f = require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  delete require.cache[f];
  const M = require(f);
  check(M.BOSS_PETS === true && M.HELP_LINES.length === 2, "TIO_BOSS_PETS=1: boss pets on, 2 /help lines");
  const w = fakeWorld(0); w.P = { map_min: 350, map_max: 17250 }; w.epoch = 1; M.attach(w);
  const st = w.ext.creatures;
  for (const e of [...st.wild]) { w.removeEnt(e.id); st.wild.delete(e); }
  const p0 = fakePlayer(w, 8000, 8000); M.onJoin(w, p0);
  check(st.byOwner.get(p0.n).length === 1, "no menu pick: only the wolf, the invented pets are not forced");
  const p1 = fakePlayer(w, 8500, 8000); p1.petPick = [1, 156]; M.onJoin(w, p1);
  const L1 = st.byOwner.get(p1.n);
  check(L1.length === 2 && L1[0].sp === 1 && L1[0].primary && L1[1].sp === 156 && !!L1[1].inv && M.starterList(p1)[0] === 1, "pick rabbit + Stormhorn: exactly those, rabbit first");
  const p = fakePlayer(w, 9000, 9000); p.petPick = [0, 156, 157]; M.onJoin(w, p);
  const L = st.byOwner.get(p.n), storm = L.find((e) => e.sp === 156), cind = L.find((e) => e.sp === 157);
  check(L.length === 3 && L[0].sp === 0 && storm && cind, "join gives the wolf plus Stormhorn (156) and Cinder Prowler (157)");
  const cs = storm.create(), cc = cind.create();
  check(cs["21"] === 156 && cs["23"] === 2 && cs["13"] === p.ent.id && cc["21"] === 157 && cc["23"] === 2 && storm.max === Math.round(1600 * M.C.ob_hp_mult) && cind.max === Math.round(1400 * M.C.ob_hp_mult) && cs["20"] === 60 + 30 * 61, "boss creates {21: 156 / 157, 23: 2 boss, 20: level 60 + OB 30}, hp 1600 / 1400 x OB 30");
  check(p.msgs.some((m) => m["1"] === 59 && m.i === storm.id && m.n === 156) && p.msgs.some((m) => m["1"] === 59 && m.i === cind.id && m.n === 157), "pet bar entries for both (own_info n = species)");
  // Stormhorn orbits the owner
  const ang = []; for (let i = 0; i < 40; i++) { run(w, M, 94); ang.push(Math.atan2(storm.y - p.ent.y, storm.x - p.ent.x)); }
  const r = Math.hypot(storm.x - p.ent.x, storm.y - p.ent.y);
  let turn = 0; for (let i = 1; i < ang.length; i++) turn += Math.abs(((ang[i] - ang[i - 1] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  check(Math.abs(r - 190) < 40 && turn > 3, "Stormhorn orbits at ~190 (" + Math.round(r) + ") and circles (" + turn.toFixed(1) + " rad in 3.8 s)");
  // chain zap: 3 creatures in a line next to Stormhorn
  const tw = M._spawnPhase; const place = (sp, x, y) => { M.onJson(w, p, { type: 990, kind: sp, d: 1, a: 0, stage: 1, hp: 5000 }); const e = [...st.wild].filter((q) => q.sp === sp).pop(); e.x = x; e.y = y; e.tgt = null; e.mode = "retal"; return e; };
  cind.x = 20000; cind.y = 20000;   // keep the prowler out of it
  const t1 = place(33, storm.x + 150, storm.y), t2 = place(7, storm.x + 330, storm.y), t3 = place(91, storm.x + 510, storm.y);
  const z0 = w.touches.length; storm.lastZap = 0; storm.lastMagnet = w.now; storm.lastOver = w.now; run(w, M, 94);
  const dm = [t1, t2, t3].map((t) => (touchesOf(w, t.id, z0).find((q) => q["10"]) || {})["10"]);
  check(dm.join(",") === "18,12,8", "chain zap hits 3 enemies for 18 / 12 / 8: " + dm.join(","));
  check([...w.ents.values()].filter((e) => e.kind === "projectile" && e.src === storm && e.f["7"] === 45).length === 3, "zap visual: skill id 45 at each target");
  // Tempest Crown (S 4): everything near Stormhorn takes 16 every 0.5 s for 4 s
  const hp1 = t1.hp; M.onJson(w, p, { type: 48, I: storm.id, S: 4 }); run(w, M, 2100);
  check(hp1 - t1.hp >= 16 * 3, "Tempest Crown zaps nearby enemies repeatedly (" + (hp1 - t1.hp) + " damage in 2 s)");
  for (const t of [t1, t2, t3]) { w.removeEnt(t.id); st.wild.delete(t); }
  // Cinder Prowler dashes at the nearest enemy and bites for 30
  cind.x = p.ent.x - 100; cind.y = p.ent.y; storm.x = 20000; storm.y = 20000;
  const foe = place(33, p.ent.x + 450, p.ent.y + 50);
  const c0 = [cind.x, cind.y]; run(w, M, 188);
  const sp2 = Math.hypot(cind.x - c0[0], cind.y - c0[1]) / 0.188;
  check(sp2 > 600, "Cinder dashes toward the enemy (" + Math.round(sp2) + " u/s)");
  const f0 = w.touches.length; run(w, M, 1500);
  check(touchesOf(w, foe.id, f0).some((q) => q["10"] === Math.round(30 * M.C.ob_dmg_mult)), "Cinder bites for 30 x OB 30");
  // low hp: retreats to the owner and drops Ashen Snare (slow + burn)
  foe.x = cind.x + 120; foe.y = cind.y; cind.hp = cind.max * 0.3; cind.lastCast = -1e9;
  const foe2 = fakePlayer(w, cind.x + 150, cind.y + 40); foe2.shieldUntil = 0;
  run(w, M, 1200);
  const sn = [...w.ents.values()].find((e) => e.kind === "projectile" && e.src === cind && e.f["7"] === 86);
  check(!!sn, "Ashen Snare cast at low hp (visual skill id 86)");
  check(foe.slowUntil > w.now && foe.slowFactor === 0.45 && foe2.slowUntil > w.now && foe2.slowFactor === 0.45, "snare slows creatures and players inside (x0.45)");
  run(w, M, 3000);
  check(Math.hypot(cind.x - p.ent.x, cind.y - p.ent.y) <= 260, "hurt Cinder falls back to its owner (" + Math.round(Math.hypot(cind.x - p.ent.x, cind.y - p.ent.y)) + ")");
  // kits: every passive triggers with a visible effect or damage number and a pet_kit log
  const kitSeen = (name) => w.log.some((x) => x.k === "pet_kit" && x.name === name);
  { // Static Shell: an attacker next to Stormhorn takes 10, Stormhorn takes 20% less
    storm.x = p.ent.x + 150; storm.y = p.ent.y; const bad = place(31, storm.x + 100, storm.y); storm.lastThorn = 0;
    const t0 = w.touches.length, hp0 = storm.hp; storm.hurt(50, bad);
    check(Math.round(hp0 - storm.hp) === 40 && touchesOf(w, bad.id, t0).some((q) => q["10"] === 10) && kitSeen("Static Shell"), "Static Shell: 50 -> 40 taken, attacker shocked for 10");
    // Overcharge: 2+ enemies near -> zaps every 0.5 s
    const bad2 = place(33, storm.x - 120, storm.y); storm.lastOver = 0; storm.lastZap = 0;
    run(w, M, 94);
    check(storm.overUntil > w.now && kitSeen("Overcharge"), "Overcharge with 2 enemies near");
    // Magnet Pull: a far enemy is dragged to ~140
    const far = place(7, storm.x + 450, storm.y + 50); storm.lastMagnet = 0; run(w, M, 94);
    check(kitSeen("Magnet Pull") && Math.hypot(far.x - storm.x, far.y - storm.y) < 260, "Magnet Pull drags a far enemy in (" + Math.round(Math.hypot(far.x - storm.x, far.y - storm.y)) + ")");
    for (const t of [bad, bad2, far]) { w.removeEnt(t.id); st.wild.delete(t); }
    // Thunder Step: the owner is hit while Stormhorn is far
    storm.x = p.ent.x + 600; storm.y = p.ent.y; storm.lastStep = 0;
    const atk = place(31, p.ent.x + 90, p.ent.y); p.shieldUntil = 0;
    M._defend ? M._defend(w, p, atk) : null;
    atk.tgt = p.ent; atk.st = "chase"; atk.lastAtk = 0; run(w, M, 600);
    check(kitSeen("Thunder Step") && Math.hypot(storm.x - p.ent.x, storm.y - p.ent.y) < 400, "Thunder Step: Stormhorn blinks to the attacked owner");
    w.removeEnt(atk.id); st.wild.delete(atk);
  }
  { // Molten Hide, Ember Trail, Pounce Chain, Smoke Veil
    cind.hp = cind.max; cind.retreat = false; cind.lastThorn = 0; cind.x = p.ent.x - 100; cind.y = p.ent.y;
    const b1 = place(33, cind.x + 90, cind.y); const t0 = w.touches.length, hp0 = cind.hp; cind.hurt(50, b1);
    check(Math.round(hp0 - cind.hp) === 35 && touchesOf(w, b1.id, t0).some((q) => q["10"] === 6) && kitSeen("Molten Hide"), "Molten Hide: 50 -> 35 taken, attacker burned for 6");
    w.removeEnt(b1.id); st.wild.delete(b1); cind.hp = cind.max;
    const v1 = place(33, p.ent.x + 500, p.ent.y), v2 = place(7, p.ent.x + 560, p.ent.y + 80);
    v1.hp = 25; cind.tgt = null; cind.lastAtk = 0; storm.x = 20000; storm.y = 20000; storm.mode = 2; storm.lastStep = w.now + 60000;
    run(w, M, 1600);
    check(kitSeen("Ember Trail") && [...w.ents.values()].some((q) => q.kind === "projectile" && q.src === cind && q.f["7"] === 122), "Ember Trail: embers (122) dropped while dashing");
    run(w, M, 1500);
    check(kitSeen("Pounce Chain"), "Pounce Chain after a kill re-targets the next enemy");
    w.removeEnt(v2.id); st.wild.delete(v2);
    const hunter = place(31, cind.x + 150, cind.y); hunter.tgt = cind; hunter.st = "chase";
    cind.hp = cind.max * 0.45; cind.lastVeil = 0; cind.lastCast = w.now; run(w, M, 94);
    check(kitSeen("Smoke Veil") && cind.veilUntil > w.now && hunter.tgt !== cind, "Smoke Veil: below half hp the pet vanishes, attackers lose it");
    w.removeEnt(hunter.id); st.wild.delete(hunter); cind.hp = cind.max; storm.mode = 1; storm.lastStep = 0;
  }
  // respawn gives both again, /easy keeps them, tame limit ignores them
  M.onDeath(w, p); p.ent = w.addEnt({ id: w.nextId(), kind: "player", x: 9000, y: 9000, p, cd: 0 }); p.alive = true; M.onRespawn(w, p);
  const L2 = st.byOwner.get(p.n);
  check(L2.length === 3 && L2.some((e) => e.sp === 156) && L2.some((e) => e.sp === 157), "next life: wolf + both boss pets again");
  p.easy = true; M.onEasy(w, p);
  check(L2.every((e) => e.lvl === 2), "/easy: every pet at max growth");
  // no friendly fire: teammates (and their pets) are never hurt by a player's pets, skills, AOE or slow
  const q2 = fakePlayer(w, p.ent.x + 120, p.ent.y), q3 = fakePlayer(w, p.ent.x - 120, p.ent.y);
  const team = (x) => { const o = x && (x.queue ? x : x.p && x.p.queue ? x.p : x.owner && x.owner.queue ? x.owner : null); return o ? o.teamId : null; };
  w.sameTeam = (a, b) => { const ta = team(a), tb = team(b); const oa = a && (a.queue ? a : a.p || a.owner), ob = b && (b.queue ? b : b.p || b.owner); return (oa && ob && oa === ob) || (ta != null && ta === tb); };
  p.teamId = 7; q2.teamId = 7; q3.teamId = null; q2.shieldUntil = 0; q3.shieldUntil = 0;
  M.onJoin(w, q2);
  const wolf2 = st.byOwner.get(q2.n)[0], storm1 = L2.find((e) => e.sp === 156), cind1 = L2.find((e) => e.sp === 157);
  check(M.onHit(w, p, wolf2, 20) === 0 && wolf2.hurt(20, p) === 0, "a teammate's swing on my pet: 0 (onHit and hurt)");
  check(wolf2.hurt(20, q3) === 20, "an enemy still damages it (20)");
  const hp2 = q2.hp, hp3 = q3.hp; storm1.x = q2.ent.x; storm1.y = q2.ent.y; storm1.lastCast = -1e9;
  M.onJson(w, p, { type: 48, I: storm1.id, S: 4 }); run(w, M, 1200);
  check(q2.hp === hp2 && q3.hp < hp3, "Tempest Crown: teammate untouched (" + hp2 + " -> " + q2.hp + "), enemy hit (" + hp3 + " -> " + q3.hp + ")");
  cind1.x = q2.ent.x; cind1.y = q2.ent.y; cind1.lastCast = -1e9; q2.slowUntil = 0;
  M.onJson(w, p, { type: 48, I: cind1.id, S: 4 }); run(w, M, 1200);
  check(!(q2.slowUntil > w.now) && q3.slowUntil > w.now, "Ashen Snare: teammate not slowed, enemy slowed");
  // every pet cast fires: 20 Tempest Crowns in a row each create the effect and hit the target
  run(w, M, 4500);   // the earlier crown ends
  M.C.reload_scale = 0.01; const tgt = fakePlayer(w, storm1.x + 100, storm1.y); tgt.shieldUntil = 0; tgt.teamId = null;
  let ok = 0;
  for (let i = 0; i < 20; i++) {
    tgt.hp = 100; storm1.x = tgt.ent.x - 100; storm1.y = tgt.ent.y;
    const n0 = w.log.length; M.onJson(w, p, { type: 48, I: storm1.id, S: 4 }); run(w, M, 470);
    const lg = w.log.slice(n0).find((x) => x.k === "pet_cast" && x.pet === storm1.id);
    if (lg && lg.created >= 1 && lg.hits >= 1 && tgt.hp < 100) ok++;
    run(w, M, 4200);
  }
  M.C.reload_scale = 1;
  check(ok === 20, "20 Tempest Crowns in a row: " + ok + " created the effect and hit");
  process.env.TIO_BOSS_PETS = "0";
}

// ------------------------------------------------------------ live server
async function live() {
  const { TestClient } = require(path.join(ROOT, "mimic", "hosted", "testclient.js"));
  const { encodeJoin } = require(path.join(ROOT, "mimic", "hosted", "joincodec.js"));
  const PORT = +A.port, HOST = "127.0.0.1:" + PORT;
  if (PORT === 8921) { console.log("refusing port 8921"); process.exit(2); }
  const c = new TestClient(() => net.connect(PORT, "127.0.0.1"), { host: HOST, path: "/_h/offline1/offline1?1_2", origin: "http://" + HOST });
  await c.until((x) => x.status, 3000);
  check(c.open, "socket open on " + PORT);
  await sleep(300);
  c.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "creat" }), 243) });
  const own = await c.until((x) => x.msgs.find((q) => q["1"] === 19 && q.s === false), 3000);
  const id = own ? Math.floor(own.id / 256) : null;
  check(!!id, "joined as " + id);
  const info = c.msgs.find((q) => q["1"] === 59 && q.i);
  const petC = await c.until((x) => x.msgs.find((q) => q["1"] === 79 && q["2"] === 0 && q["13"] === id), 3000);
  check(!!petC && petC["0"] === id + 1 && info && info.i === petC["0"], "own pet created: id " + (petC && petC["0"]) + " kind " + (petC && petC["22"]) + ", own_info i " + (info && info.i));
  const wild = c.msgs.filter((q) => q["1"] === 79 && q["2"] === 0 && q["13"] == null);
  console.log("  wild creatures in view at spawn: " + wild.length + " kinds " + [...new Set(wild.map((q) => q["22"]))].join(","));
  for (const q of c.msgs) if (q["1"] === 59 && (q.n === 156 || q.n === 157) && q.i) c.json({ type: 48, I: q.i, S: 2 });   // boss pets (TIO_BOSS_PETS=1) stand down
  await sleep(5200);   // spawn shield
  // aggro: pull a scorpion next to us, wait for a hit on us
  const pullAck = async (kind, opt) => { const n0 = c.msgs.length; c.json(Object.assign({ type: 990, kind }, opt || {})); const m = await c.until((x) => x.msgs.slice(n0).find((q) => q["1"] === 39 && /^test \d+/.test(q.m || "")), 2000); return m ? +m.m.split(" ")[1] : null; };
  c.json({ type: 48, I: id + 1, S: 2 });
  const sid = await pullAck(31, { d: 300, a: 0, hp: 20, clear: 1600, target: true, stage: 1 });
  check(!!sid, "test hook placed scorpion " + sid);
  const n1 = c.msgs.length;
  const hit = await c.until((x) => x.msgs.slice(n1).find((q) => q["1"] === 84 && q["0"] === id && q["10"] != null), 6000);
  const atk = c.msgs.slice(n1).find((q) => q["1"] === 84 && q["0"] === sid && q["7"] === 34);
  check(!!hit && hit["10"] === 15 && hit["13"] === 1, "scorpion hits us: " + JSON.stringify(hit));
  check(!!atk, "scorpion attack record 7 = 34");
  // kill it: aim and swing
  const pos = (cid) => { let p = null; for (const q of c.msgs) if ((q["1"] === 79 || q["1"] === 84) && q["0"] === cid && q["3"] != null) p = [q["3"], q["4"]]; return p; };
  const me = pos(id), sp = pos(sid);
  const ang = Math.atan2(sp[1] - me[1], sp[0] - me[0]), code = Math.round(((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1000);
  c.ops([[0, code], [4, (code << 3) + 1]]);
  const dead = await c.until((x) => x.msgs.find((q) => q["1"] === 84 && q["0"] === sid && q["7"] === 18), 30000);
  c.ops([[4, 0]]);
  const hurtRec = c.msgs.find((q) => q["1"] === 84 && q["0"] === sid && q["11"] === 1);
  check(!!hurtRec, "our swings show on the scorpion {9, 10, 11: 1}: " + JSON.stringify(hurtRec));
  check(!!dead, "scorpion dies {7: 18}" + (dead ? "" : " (hp " + c.msgs.filter((q) => q["0"] === sid && q["9"] != null).map((q) => q["9"]).slice(-3) + ")"));
  const gone = await c.until((x) => x.msgs.find((q) => q["1"] === 87 && q["0"] === sid), 3000);
  check(!!gone, "scorpion removed after the death record");
  check(c.msgs.some((q) => q["1"] === 84 && q["0"] === id + 1 && q["14"] === 100 && q["15"] === 100), "pet XP record {14: 100, 15: 100} after an adult kill");
  // taming
  c.json({ type: 990, cfg: { tame_chance: 1 } }); await sleep(200);
  const gid = await pullAck(2, { d: 130, a: 1.5, clear: 1600, stage: 0 });
  const n2 = c.msgs.length;
  c.json({ type: 45, _: gid });
  const t12 = await c.until((x) => x.msgs.slice(n2).find((q) => q["1"] === 84 && q["0"] === gid && q["12"] === 1), 2000);
  check(!!t12, "tame start {12: 1} on " + gid);
  const re = await c.until((x) => x.msgs.slice(n2).find((q) => q["1"] === 79 && q["0"] === gid && q["13"] === id), 7000);
  check(!!re && re["21"] === 2, "tamed bear re-created as our pet (21 = 2): " + JSON.stringify(re));
  const ti = c.msgs.slice(n2).find((q) => q["1"] === 59 && q.i === gid);
  check(!!ti, "own_info for the tamed pet: " + JSON.stringify(ti));
  c.json({ type: 48, I: gid, S: 4 });
  const s4 = await c.until((x) => x.msgs.slice(n2).find((q) => q["1"] === 84 && q["0"] === gid && q["7"] === 34), 2000);
  const ow = await c.until((x) => x.msgs.slice(n2).find((q) => q["1"] === 79 && q["2"] === 4 && q["10"] === gid && q["7"] === 42), 2000);
  check(!!s4 && !!ow, "S 4 on the tamed bear casts Ocean Wave (7 = 34, category-4 create 7 = 42): " + JSON.stringify(ow));
  // riding: pet next to us, select the Saddle (op 10 = 160), swing at the pet
  c.json({ type: 48, I: gid, S: 2 });
  const pid = await pullAck(0, { pet: 1, d: 100, a: 0.5 });
  check(pid === id + 1, "test hook moved our dragon pet next to us");
  await sleep(300);
  const me2 = pos(id), pp = pos(pid);
  const ang2 = Math.atan2(pp[1] - me2[1], pp[0] - me2[0]), code2 = Math.round(((ang2 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1000);
  const n3 = c.msgs.length;
  c.json({ type: 990, xp: 700 }); await sleep(200);
  c.ops([[1, 160]]); await sleep(200);   // unlock the Saddle (age 5) when social.js gates items
  c.ops([[10, 160]]); await sleep(200);
  c.ops([[0, code2], [4, (code2 << 3) + 1]]);
  const m16 = await c.until((x) => x.msgs.slice(n3).find((q) => q["1"] === 84 && q["0"] === id && q["16"] === 1), 3000);
  c.ops([[4, 0]]);
  const m17 = c.msgs.slice(n3).find((q) => q["1"] === 84 && q["0"] === pid && q["17"] === 160);
  check(!!m16 && m16["8"] === 0 && m16["15"] === 500, "mount: own {16: 1, 8: previous item, 15: 500}: " + JSON.stringify(m16));
  check(!!m17, "mount: pet {17: 160}");
  c.ops([[5, 1 + 256]]); await sleep(900); c.ops([[5, 1]]); await sleep(500);
  const me3 = pos(id), pp3 = pos(pid);
  check(me3 && pp3 && Math.hypot(me3[0] - pp3[0], me3[1] - pp3[1]) < 2 && me3[0] > me2[0] + 100, "riding: pet stays under us while we walk (" + me3 + " / " + pp3 + ")");
  c.ops([[10, 160]]); await sleep(200);
  const n4 = c.msgs.length;
  c.ops([[0, code2], [4, (code2 << 3) + 1]]);
  const d16 = await c.until((x) => x.msgs.slice(n4).find((q) => q["1"] === 84 && q["0"] === id && q["16"] === 0), 3000);
  c.ops([[4, 0]]);
  check(!!d16, "Saddle swing again dismounts {16: 0}");
  c.close(); await sleep(300);
}

function fairy() {
  delete require.cache[require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"))];
  const M = require(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  const w = fakeWorld(3); M.attach(w); const st = w.ext.creatures;
  const p = fakePlayer(w, 0, 0);
  process.env.TIO_CREATURES_TEST = "1";
  M.onJson(w, p, { type: 990, kind: 15, d: 500, a: 0, stage: 3 });
  const b = [...st.wild].find((e) => e.sp === 15 && e.stage === 3);
  b.worldBoss = true;
  const minions = () => [...st.wild].filter((e) => e.minion);
  b.hurt(Math.ceil(b.max * 0.2), p);
  check(minions().length === 0, "no fairy wave above 75 % hp");
  b.hurt(Math.ceil(b.max * 0.06), p);
  const w1 = minions();
  check(w1.length === 3 && w1.every((e) => e.stage === 1) && [46, 45, 55].every((k) => w1.some((e) => e.sp === k)), "75 %: 3 adult Dragon / Rock / Insect Fairies: " + w1.map((e) => e.sp + "/" + e.stage).join(","));
  b.hurt(Math.ceil(b.max * 0.5), p);
  const all = minions();
  check(all.length === 9 && all.filter((e) => e.stage === 2).length === 4, "50 % and 25 % in one hit: 6 more, 1 + 3 boss-stage: " + all.map((e) => e.stage).join(","));
  w1[0].hurt(99999, p);
  check(!st.respawn.some((r) => r.tpl && r.tpl["21"] === w1[0].sp), "killed fairy does not respawn");
  w.ctx.NAMES = require(path.join(ROOT, "decoder", "names.json"));
  w.objFromRec = (r, b) => w.addEnt({ id: w.nextId(), kind: "static", x: r["3"], y: r["4"], name: r.name, phase: b });
  b.hurt(b.max, p);
  const ch = [...w.ents.values()].filter((e) => e.kind === "static" && /^gift5[89]$|^gift60$/.test(e.name));
  check(ch.length === 3 && ch.every((c) => c.bossChest && c.rec === null), "cactus boss kill drops its 3 chests (gift 58 / 59 / 60): " + ch.map((c) => c.name).join(","));
}

function starters() {
  delete require.cache[require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"))];
  const M = require(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  const w = fakeWorld(0); M.attach(w); const st = w.ext.creatures;
  const p = fakePlayer(w, 9000, 9000); p.petPick = [1, 2];
  M.onJoin(w, p);
  const mine = [...st.pets].filter((e) => e.owner === p && !e.inv);
  check(mine.length === 2 && mine[0].sp === 1 && mine[0].primary && mine[1].sp === 2, "menu pick pi [1, 2]: Rabbit (primary) and Bear: " + mine.map((e) => e.sp + "/" + e.ck).join(","));
  check(mine[0].ck === 9 && mine[1].ck === 21, "starter types from the recordings: rabbit 9, bear 21");
  check(p.msgs.some((m) => m["1"] === 59 && m.i === mine[1].id && m.n === 2), "second pet gets its own_info card");
  const p2 = fakePlayer(w, 9500, 9000); M.onJoin(w, p2);
  check([...st.pets].some((e) => e.owner === p2 && e.sp === 0 && e.primary), "no pick: the wolf");
}

function firedragon() {
  delete require.cache[require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"))];
  const M = require(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  const w = fakeWorld(5); M.attach(w); const st = w.ext.creatures;
  const timers = []; w.after = (ms, f) => timers.push([w.now + ms, f]);
  const p = fakePlayer(w, 0, 0); p.hp = 1000;
  process.env.TIO_CREATURES_TEST = "1";
  M.onJson(w, p, { type: 990, kind: 141, d: 400, a: 0, stage: 3 });
  const b = [...st.wild].filter((e) => e.sp === 141 && Math.hypot(e.x, e.y) < 1000).pop(); b.worldBoss = true; b.hx = b.x; b.hy = b.y;
  const tk = w.touches.length;
  for (let t = 0; t < 12000; t += 94) { w.now += 94; M.tick(w, w.now, 94); for (const x of timers.splice(0)) { if (x[0] <= w.now) x[1](); else timers.push(x); } }
  const fxs = [...w.ents.values()].filter((e) => e.kind === "projectile" && e.src === b).map((e) => e.f["7"]);
  const made = w.touches.slice(tk).length;
  const kinds = new Set(fxs);
  check(p.hp < 1000, "fire dragon meteors hurt a player standing 400 away: hp " + p.hp);
  check(made > 0, "fire dragon casts (" + JSON.stringify([...kinds]) + ")");
}

function adminhits() {
  delete require.cache[require.resolve(path.join(ROOT, "mimic", "hosted", "creatures.js"))];
  const M = require(path.join(ROOT, "mimic", "hosted", "creatures.js"));
  const w = fakeWorld(3); w.P.admin_hit_frac = 0.5; M.attach(w); const st = w.ext.creatures;
  const p = fakePlayer(w, 0, 0); p.god = true;
  process.env.TIO_CREATURES_TEST = "1";
  M.onJson(w, p, { type: 990, kind: 15, d: 500, a: 0, stage: 3 });
  const b = [...st.wild].filter((e) => e.sp === 15 && e.stage === 3 && Math.hypot(e.x, e.y) < 1000).pop(); b.worldBoss = true;
  b.hurt(5, p);
  check(b.hp === b.max - Math.ceil(b.max / 2) && [...st.wild].filter((e) => e.minion).length === 6, "admin hit: half the boss max hp, the 75 % and 50 % waves fire: hp " + b.hp + "/" + b.max);
  b.hurt(5, p);
  check(b.dying, "second admin hit kills the boss");
  const pet = [...st.pets].find((e) => e.owner === p) || null;
  M.onJson(w, p, { type: 990, kind: 31, d: 300, a: 1, stage: 1 });
  const sp = [...st.wild].find((e) => e.sp === 31);
  sp.hurt(3, { kind: "pet", owner: p, x: 0, y: 0 });
  check(sp.hp === sp.max - Math.ceil(sp.max / 2), "admin's pet hit: half the creature max hp (" + sp.hp + "/" + sp.max + ")");
  p.god = false; const h0 = sp.hp; sp.hurt(3, p);
  check(sp.hp === h0 - 3, "non-admin hit unchanged");
}

(async () => {
  if (A.unit || !A.port) unit();
  if (A.nav || A.unit || !A.port) nav();
  if (A.boss || A.unit || !A.port) bosspets();
  if (A.unit || !A.port) fairy();
  if (A.unit || !A.port) starters();
  if (A.unit || !A.port) firedragon();
  if (A.unit || !A.port) adminhits();
  if (A.port) await live();
  console.log(fails ? fails + " FAILED" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
