#!/usr/bin/env node
// Owned pet control (owner, Oct 19): right-click {type 48, I, S 3, _: [x, y], T} as the real client sends it.
// Straight-line moves with slide and squeeze, biting what blocks it (gold and world boss things never break),
// right-click on an enemy building or player makes the pet bite it, recorded run speed.
// usage: node bin/test_pet_control.js
"use strict";
process.env.TIO_BOSS_PETS = "0";
const path = require("path"), ROOT = path.join(__dirname, "..");
const { World } = require(ROOT + "/mimic/hosted/world.js");
const HC = JSON.parse(require("fs").readFileSync(ROOT + "/mimic/hosted_config.json", "utf8"));
const P = require(ROOT + "/mimic/hosted/game_config.js").gameConfig(HC.game);
const M = require(ROOT + "/mimic/hosted/creatures.js");
let fails = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails++; };
const r0 = (v) => Math.round(v);

function mkWorld() {
  const w = Object.create(World.prototype);
  Object.assign(w, { name: "t", P, grid: new Map(), lgrid: new Map(), loose: new Set(), ents: new Map(), players: new Map(), ext: {}, phase: 0, now: 1e6, nid: 7000000,
    ctx: { WORLD: require(ROOT + "/mimic/world_sp5.json"), ITEMS: {} }, epoch: 1, hits: [], timers: [] });
  w.L = () => {}; w.nextId = function () { return this.nid++; };
  w.addEnt = function (e) { e.delta = null; this.ents.set(e.id, e); if (e.kind === "static" || e.kind === "placed") { const k = Math.floor(e.x / 512) + Math.floor(e.y / 512) * 4096; if (!this.grid.has(k)) this.grid.set(k, new Set()); this.grid.get(k).add(e); } return e; };
  w.removeEnt = function (id) { const e = this.ents.get(id); if (!e) return; this.ents.delete(id); for (const s of this.grid.values()) s.delete(e); };
  w.touch = function (e, f) { e.delta = Object.assign(e.delta || {}, f); };
  w.ownerOf = (x) => (x.queue ? x : x.p && x.p.queue ? x.p : x.owner && x.owner.queue ? x.owner : typeof x.owner === "number" ? w.players.get(x.owner) : null);
  w.teamOf = () => null;
  w.damage = function (t, amount, by) {
    if (by && t.kind !== "animal" && this.sameTeam(by, t)) return 0;
    this.hits.push({ id: t.id, amount });
    if (t.kind === "placed") { t.hp = (t.hp == null ? 100 : t.hp) - amount; if (t.hp <= 0) this.removeEnt(t.id); return amount; }
    if (t.kind === "player") { t.p.hurt(amount, by); return amount; }
    if (typeof t.hurt === "function") return t.hurt(amount, by);
    return 0;
  };
  M.attach(w);
  const st = w.ext.creatures; for (const e of [...st.wild]) { w.ents.delete(e.id); st.wild.delete(e); }
  return w;
}
function mkPlayer(w, x, y) {
  const n = w.players.size + 1;
  const p = { n, alive: true, joined: true, hp: 100, xp: 0, inv: {}, msgs: [], shieldUntil: 0, kills: { players: 0, animals: 0 }, name: "p" + n,
    queue(m) { this.msgs.push(m); }, addXp() {}, gain() {}, hurt(d) { this.hp -= d; } };
  p.ent = w.addEnt({ id: w.nextId(), kind: "player", x, y, p, cd: 0 });
  w.players.set(n, p);
  return p;
}
const run = (w, ms, each) => {   // only the test's own pets and players: wild creatures and bosses that spawn are removed
  const st = w.ext.creatures;
  for (let t = 0; t < ms; t += 94) { w.now += 94; M.tick(w, w.now, 94); for (const e of [...st.wild]) { w.ents.delete(e.id); st.wild.delete(e); } if (each) each(); }
};
const wall = (w, x, y, name, owner) => w.addEnt({ id: w.nextId(), kind: "placed", name: name || "wooden-wall", x, y, cd: 100, owner: owner != null ? owner : null });
const pet0 = (w, p) => w.ext.creatures.byOwner.get(p.n)[0];
const rclick = (w, p, pet, x, y, T) => M.onJson(w, p, Object.assign({ type: 48, I: pet.id, S: 3, _: [x, y] }, T != null ? { T } : {}));
const turned = (tr) => { let n = 0; for (let i = 2; i < tr.length; i++) { const a = Math.atan2(tr[i - 1][1] - tr[i - 2][1], tr[i - 1][0] - tr[i - 2][0]), b = Math.atan2(tr[i][1] - tr[i - 1][1], tr[i][0] - tr[i - 1][0]); const d = Math.abs(((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); if (Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]) > 2 && Math.hypot(tr[i - 1][0] - tr[i - 2][0], tr[i - 1][1] - tr[i - 2][1]) > 2 && d > 0.05) n++; } return n; };

// 1. open ground: straight line at the recorded run speed, arrives and stays
{
  const w = mkWorld(), p = mkPlayer(w, 5000, 5000); M.onJoin(w, p); const e = pet0(w, p);
  e.x = 5000; e.y = 5100; rclick(w, p, e, 6500, 5100);
  const tr = []; let maxSp = 0, last = [e.x, e.y];
  run(w, 9000, () => { if (e.goto) tr.push([e.x, e.y]); maxSp = Math.max(maxSp, Math.hypot(e.x - last[0], e.y - last[1]) / 0.094); last = [e.x, e.y]; });
  check(e.anchor && Math.abs(e.anchor.x - 6500) < 20 && tr.slice(0, 40).every((q) => Math.abs(q[1] - 5100) < 2), "right-click spot reached in a straight line: " + r0(e.x) + "," + r0(e.y));
  check(turned(tr) === 0, "no turning on open ground (" + turned(tr) + " heading changes)");
  check(Math.abs(maxSp - 270) < 15, "wolf runs at the recorded 270/s (" + r0(maxSp) + ")");
}
// 2. one rock in the way: slides around it, never inside, still gets there
{
  const w = mkWorld(), p = mkPlayer(w, 5000, 5000); M.onJoin(w, p); const e = pet0(w, p);
  const rock = w.addEnt({ id: w.nextId(), kind: "static", name: "stone2", x: 5700, y: 5110, cd: 130 });
  e.x = 5000; e.y = 5100; rclick(w, p, e, 6500, 5100);
  let inside = false; run(w, 10000, () => { if (Math.hypot(e.x - rock.x, e.y - rock.y) < rock.cd - P.player_radius + e.cr * 0.75) inside = true; });
  check(!inside && e.anchor && Math.hypot(e.anchor.x - 6500, e.anchor.y - 5100) < 30, "slides around a rock (never through it), arrives: " + r0(e.x) + "," + r0(e.y));
  check(w.hits.length === 0, "a rock is bitten at most for show, never damaged");
}
// 3. a line of enemy walls across the way: stuck, bites through (gold wall in the middle never breaks)
{
  const w = mkWorld(), p = mkPlayer(w, 5000, 5000), q = mkPlayer(w, 9000, 9000); M.onJoin(w, p); const e = pet0(w, p);
  const W = []; for (let y = 4500; y <= 5700; y += 150) W.push(wall(w, 5600, y, y === 4800 ? "golden-wall" : "wooden-wall", q.n));
  e.x = 5000; e.y = 5100; rclick(w, p, e, 6400, 5100);
  run(w, 25000);
  const gold = W.find((o) => o.name === "golden-wall");
  check(w.hits.some((h) => h.id !== gold.id), "stuck pet bites the enemy wall in front of it (" + w.hits.length + " bites)");
  check(!w.hits.some((h) => h.id === gold.id), "gold wall never takes pet damage");
  check(e.x > 5600, "bit its way through and went on: x " + r0(e.x));
}
// 4. own walls: not damaged; the pet gives up after 3 s stuck and stays
{
  const w = mkWorld(), p = mkPlayer(w, 5000, 5000); M.onJoin(w, p); const e = pet0(w, p);
  for (let y = 3800; y <= 6400; y += 150) wall(w, 5600, y, "stone-wall", p.n);
  e.x = 5000; e.y = 5100; rclick(w, p, e, 6400, 5100);
  run(w, 8000);
  check(w.hits.length === 0 && !e.goto && e.x < 5600, "own walls never bitten through; pet stays at the wall after 3 s stuck (x " + r0(e.x) + ")");
}
// 5. right-click on an enemy building (T) or a spot inside it: the pet bites it until it breaks; own building: no target
{
  const w = mkWorld(), p = mkPlayer(w, 5000, 5000), q = mkPlayer(w, 9000, 9000); M.onJoin(w, p); const e = pet0(w, p);
  const b = wall(w, 5500, 5000, "wooden-wall", q.n), mine = wall(w, 4500, 5000, "wooden-wall", p.n);
  e.x = 5000; e.y = 5100; rclick(w, p, e, 5500, 5000, b.id);
  check(e.tgt === b, "right-click with T = enemy wall: target");
  run(w, 60000);
  check(!w.ents.has(b.id), "enemy wall bitten until it breaks (" + w.hits.filter((h) => h.id === b.id).length + " bites)");
  const b2 = wall(w, 5600, 5300, "spike", q.n); rclick(w, p, e, 5610, 5310);
  check(e.tgt === b2, "right-click spot inside an enemy building (no T): target");
  rclick(w, p, e, 4500, 5000, mine.id);
  check(e.tgt !== mine && e.goto, "own building: no target, walks there");
  const gb = wall(w, 5300, 4700, "golden-wall", q.n); rclick(w, p, e, 5300, 4700, gb.id);
  check(e.tgt !== gb, "gold building: no target");
}
// 6. right-click on an enemy player: the pet runs over and bites him
{
  const w = mkWorld(), p = mkPlayer(w, 5000, 5000), q = mkPlayer(w, 5800, 5000); M.onJoin(w, p); const e = pet0(w, p);
  e.x = 5000; e.y = 5100; rclick(w, p, e, q.ent.x, q.ent.y, q.ent.id);
  run(w, 5000);
  check(e.tgt === q.ent && q.hp < 100, "pinged player gets bitten (hp " + q.hp + ")");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
