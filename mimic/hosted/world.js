// Shared multiplayer room (hosted_server.js --mode multi): one World per room, one Player per socket.
// Wire constants are the Atlanta#4 tables (the bundle is pinned to them), field keys are the same on every server.
// Motion is in units per second, simulated in fixed substeps; frames go out every send_ms.
//
// Plugin API (hosted/creatures.js, hosted/social.js; each optional, skipped if missing or if it throws on load).
// A plugin module exports any of:
//   name, attach(world), tick(world, now, dtMs), onJoin(world, player), onLeave(world, player), onRespawn(world, player),
//   onDeath(world, player, by), afterDeath(world, player, entId) (the tick the dead player's entity is removed),
//   onKill(world, killer, target) (once per animal/creature death, killer Player or null;
//   target.boss for boss kinds), canHold(world, player, itemId) -> false blocks select/use, groupOf(itemId) and
//   placedGroup(player, itemId) (placement limit groups; fallback: items.json cat), onJson(world, player, msg) -> true if handled, onOp(world, player, baseOp, value) -> true
//   if handled, onHit(world, attacker, target, damage) -> damage to apply, onBiome(world, oldPhase, newPhase),
//   replaces: ["animals"] (world.js then spawns and moves no animals of its own), ownsTypes: [66, ...] (message types the
//   plugin sends itself; world.js then does not replay them from the world file at join; 68 is skipped when social loads).
// Every call is wrapped in try/catch (log k "plugin_err"). tick runs after players move, before frames are sent.
// onJson gets every client JSON message except join (type 1); onOp gets base ops world.js does not handle.
// onHit: attacker is a Player or null (hazard); target is an entity (player entity: target.p is the Player).
// Stable world surface:
//   world.ents       Map id -> entity {id, kind: static|placed|animal|player|pet|projectile, x, y, f (create fields), ...}
//                    optional e.create() -> create message, e.hurt(dmg, by) -> custom damage, e.solid (0/undefined)
//   world.players    Map n -> Player       world.ext     {} plugin state, keep yours in world.ext[name]
//   world.addEnt(e), world.removeEnt(id), world.touch(e, fields) (queue a move/update for viewers), world.nextId()
//   world.broadcastNear(x, y, msg), world.broadcast(msg), world.broadcastAlive(msg) (joined, alive players),
//   world.killed(target, killer) (fires onKill once; call it when a plugin kills a creature), world.damage(target, amount, by) (target: entity or Player,
//   by: Player, entity or null), world.collide(x, y, scale, self) -> [x, y] (self: the moving entity, skipped), world.blocked(x, y, pad)
//   world.P (game config), world.L (log), world.T (atl4 type ids), world.phase (biome: 0 plain, 1 snow, 2 dark,
//   3 desert, 4 sea, 5 volcanic), world.phaseLeft() (ms), world.now (ms of the current tick), world.after(ms, fn),
//   world.announce(text, ms, color) (atl4 52 banner), world.boss = {x, y, kind} (minimap boss marker, ob) or null
// Stable player surface:
//   player.queue(msg), player.id (entity id or null), player.n (socket number, key in world.players), player.ent,
//   player.x, player.y, player.hp, player.alive, player.inv, player.addXp(n, why), player.gain({slot: n}),
//   player.hurt(dmg, by, cause, src), player.mods = {speed, dmg_taken, gather_bonus: {slot: n}, regen_per_s, xp_mult, pad_immune}
//   (hat modifiers; plugins replace fields, defaults neutral), player.name, player.joined, player.cf (extra create fields merged last, e.g. "14" team)
"use strict";
const fs = require("fs"), path = require("path");
const C = require("../codec");
// owner: invented goofy default cosmetics every player wears without a menu pick (skin Mauve Derpington, accessory Floaty
// McQuackface, footprint trail Squeaky Steps; the hat Brain Cooler 3000 is social.js; client tables tools/invented/client_patch.js, art make_goofy.py)
const GOOFY = { sk: 1093, ac: 0, pa: 511 };   // owner: only the goofy skin and its trail are defaults (no duck ring)
const { encBoard } = require("./crypto");
const { decodeJoin } = require("./joincodec");
const TRK = require("./trinkets");
const CA = require("./chatargs");   // chat command arguments and /help

const PLUGINS = [], PLUGIN_LOAD = [];
for (const n of ["insects", "creatures", "social"]) {   // insects first: its /spawn wasp|leech before the creature /spawn
  const f = path.join(__dirname, n + ".js");
  if (!fs.existsSync(f)) continue;
  try { const m = require(f); PLUGINS.push({ name: (m && m.name) || n, m: m || {} }); PLUGIN_LOAD.push({ name: n, ok: true }); }
  catch (e) { PLUGIN_LOAD.push({ name: n, ok: false, err: String(e && e.stack || e).slice(0, 600) }); }
}

const T = { XP: 27, ITEMCOUNT: 36, CHAT: 39, CREATE: 79, MOVE: 84, REMOVE: 87, OWN: 19, BOARD: 64, MINIMAP: 59, INV: 53, DEATH: 6,
  TIMER: 32, POTIONS: 57, GIFT: 75, PLACED: 81, MARK80: 80, MARK65: 65, ANNOUNCE: 52, ACH: 44 };
const OP = { AIM: 0, ATTACK: 4, KEY: 5, HEARTBEAT: 8, SELECT: 10, ROT: 16 };
const JT = { JOIN: 1, TOKEN: 28, CHAT: 39 };
const KEYDIR = { 0: [-1, 0], 1: [1, 0], 2: [0, 1], 3: [0, -1] };   // a, d, s, w
const CAT_FOOD = 4, CAT_BUILD = new Set([5, 6, 7, 8, 9, 10]);
const TAU = 2 * Math.PI, GRID = 512;
const SLIDE = process.env.TIO_SLIDE !== "0";   // frictionless circle sliding and soft bodies (owner); TIO_SLIDE=0: the old push-out
const ang255 = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 255) % 256;
const ageOf = (xp) => Math.min(60, Math.floor((Math.sqrt(1 + 4 * (Math.max(0, xp - 1) * 2 / 40)) - 1) / 2));

// object kinds the real game places at random per server and per season (owner; scans: 1 % of their spots repeat)
function randomFam(name) { const m = /hollow-log|gift|tumbleweed|thornbush|^creep|^totem$/.exec(name || ""); return m ? m[0] : null; }
function family(name) {
  if (!name) return null;
  if (/golden-flower-bush$/.test(name)) return "bush";   // a food bush with a golden flower, not gold
  if (/^wasp-nest\d$/.test(name)) return "bush";   // desert wasp nest: food on hit (insects.js)
  if (/porous-rock$/.test(name)) return "stone";   // sea leech nest: stone on hit (insects.js)
  const fams = ["spike", "wall", "door", "windmill", "turret", "tower", "hollow-log", "tree", "gold", "stone", "bush", "flower", "plant", "gift", "cactus", "anemone", "urchin", "totem", "pad", "trap"];
  for (const f of fams) if (name.indexOf(f) >= 0) return f;
  return "other";
}

class World {
  constructor(name, ctx) {
    this.name = name; this.ctx = ctx; this.P = ctx.game; this.L = ctx.log;
    this.players = new Map(); this.ents = new Map(); this.nid = Math.max(7000000 + (ctx.index || 0) * 1000000, this.maxWorldId() + 1); this.nPlayers = 0;
    this.grid = new Map(); this.loose = new Set(); this.lgrid = new Map(); this.timers = []; this.epoch = 0; this.hz = []; this.hzDirty = true; this.boss = null;
    this.tickN = 0; this.boardLen = 0; this.blasted = new Set(); this.flying = new Set();
    this.T = T; this.ext = {}; this.phase = 1; this.noDecay = true; this.now = Date.now(); this.plugins = PLUGINS; this.perr = {};
    for (const r of PLUGIN_LOAD) this.L(Object.assign({ k: r.ok ? "plugin_load" : "plugin_err", room: name, hook: "load" }, r));
    this.replaced = new Set(); this.owned = new Set();
    for (const pl of PLUGINS) { for (const x of pl.m.replaces || []) this.replaced.add(x); for (const t of pl.m.ownsTypes || []) this.owned.add(+t); }
    if (PLUGINS.some((pl) => pl.name === "social")) this.owned.add(68);   // no static clan list replay (ghost clans)
    this.build();
    this.plug("attach");
    this.timer = setInterval(() => this.safeTick(), this.P.send_ms);
    const sms = +process.env.TIO_STATS_MS;   // soak stats line every TIO_STATS_MS ms (unset: off)
    if (sms > 0) { this.st = { n: 0, ms: 0, max: 0 }; this.statsTimer = setInterval(() => this.statsLine(), Math.max(1000, sms)); }
  }
  statsLine() {
    try {
      const by = {}; for (const e of this.ents.values()) by[e.kind || "other"] = (by[e.kind || "other"] || 0) + 1;
      const plug = {};
      for (const pl of this.plugins) if (typeof pl.m.stats === "function") { try { plug[pl.name] = pl.m.stats(this); } catch (e) { plug[pl.name] = { err: String(e && e.message || e).slice(0, 200) }; } }
      const st = this.st;
      this.L({ k: "stats", room: this.name, phase: this.phase, players: this.players.size, ents: this.ents.size, ents_by_kind: by, timers: this.timers.length,
        tick_max_ms: +st.max.toFixed(2), tick_avg_ms: st.n ? +(st.ms / st.n).toFixed(3) : 0, ticks: st.n, plug });
      this.st = { n: 0, ms: 0, max: 0 };
    } catch (e) { this.L({ k: "world_err", room: this.name, err: String(e && e.stack || e).slice(0, 600) }); }
  }
  id() { return this.nid++; }
  nextId() { return this.nid++; }
  // ------------------------------------------------------------ plugins
  plugErr(pl, hook, e) {
    const key = pl.name + "." + hook, n = this.perr[key] = (this.perr[key] || 0) + 1;
    if (n <= 20 || n % 1000 === 0) this.L({ k: "plugin_err", room: this.name, plugin: pl.name, hook, n, err: String(e && e.stack || e).slice(0, 600) });
  }
  plug(hook, ...a) {
    for (const pl of this.plugins) {
      const f = pl.m[hook]; if (typeof f !== "function") continue;
      try { f.call(pl.m, this, ...a); } catch (e) { this.plugErr(pl, hook, e); }
    }
  }
  plugFirst(hook, ...a) {   // true once a plugin handled it
    for (const pl of this.plugins) {
      const f = pl.m[hook]; if (typeof f !== "function") continue;
      try { if (f.call(pl.m, this, ...a) === true) return true; } catch (e) { this.plugErr(pl, hook, e); }
    }
    return false;
  }
  plugHit(attacker, target, dmg) {
    for (const pl of this.plugins) {
      const f = pl.m.onHit; if (typeof f !== "function") continue;
      try { const r = f.call(pl.m, this, attacker, target, dmg); if (typeof r === "number" && isFinite(r)) dmg = Math.max(0, r); } catch (e) { this.plugErr(pl, "onHit", e); }
    }
    return dmg;
  }
  plugFn(name) { for (const pl of this.plugins) if (typeof pl.m[name] === "function") return pl; return null; }
  canHold(p, itemId) {
    for (const pl of this.plugins) {
      const f = pl.m.canHold; if (typeof f !== "function") continue;
      try { if (f.call(pl.m, this, p, itemId) === false) return false; } catch (e) { this.plugErr(pl, "canHold", e); }
    }
    return true;
  }
  groupOf(itemId) {
    const pl = this.plugFn("groupOf");
    if (pl) { try { const g = pl.m.groupOf(itemId); if (g != null) return g; } catch (e) { this.plugErr(pl, "groupOf", e); } }
    const it = this.ctx.ITEMS[itemId]; return "cat" + (it ? it.cat : itemId);
  }
  killed(target, killer) {
    if (!target || target.killFired) return;
    target.killFired = true;
    const k = killer instanceof Player ? killer : null;
    if (k) { k.sb.sba++; if (target.boss) k.sb.sbb++; }
    this.plug("onKill", k, target);
  }
  broadcast(msg) { for (const p of this.players.values()) p.queue(msg); }
  broadcastAlive(msg) { for (const p of this.players.values()) if (p.joined && p.alive) p.queue(msg); }
  broadcastNear(x, y, msg) {
    const V = this.P.view_remove;
    for (const p of this.players.values()) if (Math.abs(p.x - x) < V[0] && Math.abs(p.y - y) < V[1]) p.queue(msg);
  }
  // target: entity or Player; by: Player, entity or null
  // no friendly fire: the Player behind a Player / player entity / pet / structure, and its team
  ownerOf(x) {
    if (!x) return null;
    if (x instanceof Player) return x;
    if (x.p instanceof Player) return x.p;
    if (x.owner instanceof Player) return x.owner;
    if (typeof x.owner === "number") return this.players.get(x.owner) || null;
    return null;
  }
  teamOf(x) { const o = this.ownerOf(x); if (o) return o.team(); return x && x.team != null ? x.team : null; }
  sameTeam(a, b) {
    const oa = this.ownerOf(a), ob = this.ownerOf(b);
    if (oa && ob && oa === ob) return true;
    const ta = this.teamOf(a), tb = this.teamOf(b);
    return ta != null && ta === tb;
  }
  damage(target, amount, by) {
    const e = target instanceof Player ? target.ent : target;
    if (!e || !(amount > 0)) return 0;
    // credit: the Player, a player entity, or the owner of a pet / structure (turret)
    const byP = by instanceof Player ? by : !by ? null : by.p instanceof Player ? by.p : by.owner instanceof Player ? by.owner
      : typeof by.owner === "number" ? this.players.get(by.owner) || null : null;
    if (by && e.kind !== "animal" && this.sameTeam(by, e) && !(e.kind === "player" && this.ownerOf(by) === e.p && by === e.p)) return 0;   // no friendly fire
    if (typeof e.hurt === "function") return e.hurt(amount, by) || 0;
    if (e.kind === "player") { if (!e.p.alive) return 0; e.p.hurt(amount, byP, by instanceof Player ? "player" : by && by.kind ? by.kind : "plugin", by instanceof Player ? by.ent : by); return amount; }
    if (e.kind === "animal") { this.hurtAnimal(e, amount, byP); return amount; }
    if (e.kind === "placed") { this.hurtPlaced(e, amount, byP); return amount; }
    return 0;
  }
  stop() { clearInterval(this.timer); if (this.statsTimer) clearInterval(this.statsTimer); }
  after(ms, fn) { this.timers.push({ at: Date.now() + ms, fn }); }
  runTimers(now) {
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= now);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) { try { t.fn(now); } catch (e) { this.L({ k: "world_err", room: this.name, err: String(e && e.stack || e).slice(0, 600) }); } }
  }
  // Air Blast Gun (invented): creatures and pets carry the wave push in e.blastKb (players in Player.kb); it moves them after the
  // creature step and decays by knockback_decay per frame like the recorded knockback; flyFx effects move on along their line
  blastStep(now, dt) {
    const P = this.P;
    for (const e of [...this.blasted]) {
      const k = e.blastKb;
      if (!k || !this.ents.has(e.id) || e.dying || e.dead || e.rider || Math.hypot(k[0], k[1]) < 20) { e.blastKb = null; this.blasted.delete(e); continue; }
      const [nx, ny] = this.collide(e.x + k[0] * dt, e.y + k[1] * dt, 0.8, e, e.cr != null ? e.cr : e.r || P.animal_radius);
      e.x = nx; e.y = ny; this.touch(e, { "3": Math.round(nx), "4": Math.round(ny) });
      k[0] *= P.knockback_decay; k[1] *= P.knockback_decay;
    }
    for (const e of [...this.flying]) {
      if (now >= e.until || !this.ents.has(e.id)) { this.flying.delete(e); this.removeEnt(e.id); continue; }
      e.x += e.vx * dt; e.y += e.vy * dt; this.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) });
    }
  }
  // category-4 effect k flying from x, y along a at speed (units/s) for life ms (fields as creatures.js skill projectiles)
  // age (ms, create field 9): the client starts the effect that far in and plays its sound only when age < 100
  flyFx(k, x, y, a, speed, life, src, age) {
    const id = this.id(), sid = src ? src.id : 0;
    const e = { id, kind: "effect", x, y, cd: 0, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, until: Date.now() + life,
      f: { "0": id, "1": T.CREATE, "2": 4, "6": 1, "7": k, "8": 2, "9": age || 0, "10": sid, "11": sid } };
    e.create = () => Object.assign({}, e.f, { "3": Math.round(e.x), "4": Math.round(e.y), "5": Math.round(((a % TAU) + TAU) % TAU * 200) });
    this.addEnt(e); this.flying.add(e);
    return e;
  }
  announce(m, ms, color) { this.broadcast({ "1": T.ANNOUNCE, m: String(m).slice(0, 200), o: ms || this.P.announce_ms, i: color || this.P.announce_color }); this.logChat({ name: "", text: String(m).slice(0, 200), team: null, to: null, k: "event" }); }
  // ------------------------------------------------------------ world objects
  // building footprint radius: recorded closest same-type spacing / 2 (P.build_r), else collide distance - player radius
  buildR(name, cd) { const B = this.P.build_r_by && this.P.build_r_by[name], r = B != null ? B : this.P.build_r && this.P.build_r[family(name)]; return r != null ? r : Math.max(20, (cd || 0) - this.P.player_radius); }   // build_r_by: per item footprint (pads)
  // owner: how much of the player's squeeze applies against solid e: spikes up to squeeze_max and only while wedged,
  // walls and other solids up to squeeze_wall while he keeps pressing
  squeezeFor(self, e) {
    const P = this.P, q = self && self.p && self.p.squeeze, mv = (self && self.p && self.p.mvSq) || 0;   // owner: a moving player is smaller by his speed (walking move_squeeze, pad-boosted up to speed_squeeze_max), a still one full size
    if (!q) return mv;
    if (P.squeeze_fams && P.squeeze_fams.indexOf(family(e.name)) >= 0) return Math.max(mv, self.p.wedged ? q : 0);
    return Math.max(mv, Math.min(q, P.squeeze_wall || 0));
  }
  collideDist(name) {
    const P = this.P, d = P.collide_by_def[name], bf = family(name);
    // recorded-world walls and spikes block like placed ones (collide_by_def held closest-approach outliers: stone-spike 65)
    if (P.build_r && P.build_r[bf] != null && P.collide_k[bf]) return Math.round((P.player_radius + P.build_r[bf]) * P.collide_k[bf]);
    if (process.env.TIO_COLLIDE_V2 !== "0" && P.collide_measured && P.collide_measured[name] != null) {
      const f = family(name), base = d != null ? d : P.collide_family[f] != null ? P.collide_family[f] : P.collide_family.other;
      return Math.min(base, P.collide_measured[name]);
    }
    if (d != null) return d;
    const f = family(name);
    return P.collide_family[f] != null ? P.collide_family[f] : P.collide_family.other;
  }
  // per biome phase: object records (real + synthetic) and wild creature templates
  loadPhases() {
    const W = this.ctx.WORLD, P = this.P, out = {};
    if (W.phases) {
      // capture-mode scans stitched on (on unless TIO_SCAN_WORLD=0; mimic/world_scan.json, tools/scan/build_world_scan.py):
      // objects the scans saw that the base recording lacks; synthetic fill is dropped in every 600-unit cell a scan saw
      let SW = null;
      if (process.env.TIO_SCAN_WORLD !== "0") { try { SW = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "world_scan.json"), "utf8")).phases; } catch (e) { SW = null; } }
      for (const [b, ph] of Object.entries(W.phases)) {
        const sc = SW && SW[b], cov = sc ? new Set(sc.covered_cells_600.map((c) => c[0] + "," + c[1])) : null;
        const syn = P.synthetic_fill === false ? [] : (ph.synthetic || []).filter((o) => !cov || !cov.has(Math.floor(o["3"] / 600) + "," + Math.floor(o["4"] / 600)));
        out[b] = { objects: (ph.objects || []).concat(sc ? sc.objects : [], syn), creatures: ph.creatures || [], spawn: ph.spawn };
      }
    } else {
      out[1] = { objects: W.objects || [], creatures: W.creatures || [] };
      const NAMES = this.ctx.NAMES;
      for (const s of P.synthetic || []) {
        const idx = NAMES.indexOf(s.name); if (idx < 0) continue;
        out[1].objects.push({ "0": 0, "1": T.CREATE, "2": 3, "3": s.x, "4": s.y, "5": 628, "6": 1, "13": idx, name: s.name });
      }
    }
    // owner: hollow logs, gifts, tumbleweeds, thornbushes and creep sit at random spots on every server and move on every
    // season change (scans: 1 % of their spots repeat across servers); the clan totem is one per server. They are kept
    // out of the fixed layout and scattered at the recorded density (the stitched layout is one real server per 600 cell:
    // count / covered cells) each time a season starts (spawnRandom)
    for (const [b, ph] of Object.entries(out)) {
      const cells = new Set(ph.objects.filter((o) => "3" in o).map((o) => Math.floor(o["3"] / 600) + "," + Math.floor(o["4"] / 600)));
      ph.random = {};
      for (const o of ph.objects) { const f = randomFam(o.name); if (f) { const r = ph.random[f] = ph.random[f] || { names: new Set(), n: 0 }; r.names.add(o.name); r.n++; } }
      for (const r of Object.values(ph.random)) { r.names = [...r.names]; r.per_cell = cells.size ? r.n / cells.size : 0; }
      ph.allObjects = ph.objects; ph.objects = ph.objects.filter((o) => !randomFam(o.name) && !/^wasp-nest\d$|porous-rock$/.test(o.name));   // nests: insects.js places them each biome
    }
    for (const ph of Object.values(out)) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const o of ph.objects) { x0 = Math.min(x0, o["3"]); y0 = Math.min(y0, o["4"]); x1 = Math.max(x1, o["3"]); y1 = Math.max(y1, o["4"]); }
      ph.bbox = ph.objects.length ? [x0, y0, x1, y1] : [P.map_min, P.map_min, P.map_max, P.map_max];
      ph.gifts = [...new Set(ph.allObjects.filter((o) => family(o.name) === "gift").map((o) => o.name))];
    }
    return out;
  }
  maxWorldId() {
    const W = this.ctx.WORLD; let m = 0;
    const scan = (l) => { for (const o of l || []) if (+o["0"] > m) m = +o["0"]; };
    scan(W.objects); scan(W.creatures); if (W.player) m = Math.max(m, +W.player["0"] || 0);
    for (const ph of Object.values(W.phases || {})) { scan(ph.objects); scan(ph.synthetic); scan(ph.creatures); }
    return m;
  }
  phaseMs(b) {
    const P = this.P, W = this.ctx.WORLD;
    if (P.biome_ms_override) return P.biome_ms_override;
    if (P.biome_ms && P.biome_ms[b] != null) return P.biome_ms[b];
    if (W.phase && W.phase.ms && W.phase.ms[b] != null) return W.phase.ms[b];
    return +b === 0 ? 960000 : 480000;
  }
  phaseLeft(now) { return Math.max(0, Math.round(this.phaseEnd - (now || Date.now()))); }
  timerMsg(now) { return { "1": T.TIMER, b: this.phase, d: this.phaseLeft(now) }; }
  // spawn_mode "default": the world file's measured spawn in every phase (players keep meeting); "per_phase": the
  // centroid of the phase layout; spawn_force: game.spawn
  spawnXY() {
    const P = this.P, W = this.ctx.WORLD, S = W.spawns || {};
    const sp = P.spawn_mode === "per_phase" ? S.per_phase && S.per_phase[this.phase] : S.default;
    return sp && !P.spawn_force ? sp : P.spawn;
  }
  objFromRec(o, b, pop) {
    const id = this.id(), f = {};
    for (const [k, v] of Object.entries(o)) if (/^\d+$/.test(k)) f[k] = v;
    f["0"] = id;
    if (pop === "spawn") f["11"] = 1; else delete f["11"];   // 11:1 = freshly spawned; only with the 7:255 pop-in after it
    const e = { id, kind: "static", x: o["3"], y: o["4"], name: o.name, f, cd: this.collideDist(o.name), phase: b, rec: o, hp: 255, epoch: this.epoch };
    if (pop) e.popUntil = Date.now() + this.P.send_ms * 2;
    return this.addEnt(e);
  }
  spawnPhase(b, pop) {
    const ph = this.phases[b]; if (!ph) return 0;
    for (const o of ph.objects) this.objFromRec(o, b, pop);
    return ph.objects.length + this.spawnRandom(b, pop) + this.spawnRareBushes(b, pop);
  }
  // wiki: at the start of each biome a Golden Flower Bush (15 %, Forest 25 %) and an Oathbud (12 %) may spawn anywhere on the map
  // (TIO_RARE_BUSH_MULT scales the chances for tests); broken ones do not come back this biome
  spawnRareBushes(b, pop) {
    const mult = +process.env.TIO_RARE_BUSH_MULT || 1, [x0, y0, x1, y1] = this.phases[b].bbox;
    let n = 0;
    for (const kind of Object.keys(TRK.BUSH)) {
      if (Math.random() >= TRK.SPAWN_CH[kind](+b) * mult) continue;
      const name = TRK.bushName(kind, +b), idx = this.ctx.NAMES.indexOf(name); if (idx < 0) continue;
      for (let i = 0; i < 40; i++) {
        const x = Math.round(x0 + Math.random() * (x1 - x0)), y = Math.round(y0 + Math.random() * (y1 - y0));
        if (this.blocked(x, y, 120)) continue;
        const e = this.objFromRec({ "0": 0, "1": T.CREATE, "2": 3, "3": x, "4": y, "5": 628, "6": 1, "13": idx, name }, b, pop);
        e.rec = null; n++;
        this.L({ k: "rare_bush", room: this.name, name, x, y });
        break;
      }
    }
    return n;
  }
  // the season's random objects at random free spots inside its area (count = base density x area); one totem a server (kept across seasons)
  spawnRandom(b, pop) {
    const ph = this.phases[b], NAMES = this.ctx.NAMES, [x0, y0, x1, y1] = ph.bbox, cells = (x1 - x0) * (y1 - y0) / 360000;
    let n = 0;
    const place = (name, pad) => {
      const idx = NAMES.indexOf(name); if (idx < 0) return false;
      for (let i = 0; i < 30; i++) {
        const x = Math.round(x0 + Math.random() * (x1 - x0)), y = Math.round(y0 + Math.random() * (y1 - y0));
        if (this.blocked(x, y, pad)) continue;
        // recorded logs: 628..1256 (pi..2pi x 200); recorded totems: always 785 (91 creates, scans_dec)
        const ang = name.indexOf("hollow-log") >= 0 ? 628 + Math.floor(Math.random() * 629) : name === "totem" ? 785 : 628;
        const rec = { "0": 0, "1": T.CREATE, "2": 3, "3": x, "4": y, "5": ang, "6": 1, "13": idx, name };
        const dc = name === "totem" && this.P.totem && this.P.totem.default_clan;
        if (dc) rec["14"] = dc;
        const e = this.objFromRec(rec, b, pop); n++;
        if (name === "totem") e.phase = null;   // owner: the totem keeps its spot across biome changes until broken
        return true;
      }
      return false;
    };
    for (const [f, r] of Object.entries(ph.random || {})) {
      if (f === "totem") continue;
      const want = Math.round(r.per_cell * cells);
      for (let i = 0; i < want; i++) place(r.names[Math.floor(Math.random() * r.names.length)], 120);
    }
    if (![...this.ents.values()].some((e) => e.kind === "static" && e.name === "totem")) place("totem", 200);
    return n;
  }
  build() {
    const P = this.P;
    this.phases = this.loadPhases();
    const W = this.ctx.WORLD;
    this.order = P.biome_order || (W.phase && W.phase.order) || [1, 2, 3, 4, 5, 0];
    this.phase = P.biome_start != null ? P.biome_start : W.phase && W.phase.b != null ? W.phase.b : 1;
    this.phaseEnd = Date.now() + this.phaseMs(this.phase) - (P.biome_start_elapsed_ms || 0);
    this.spawnPhase(this.phase, false);
    this.spawnAnimals();
    const t = Date.now();
    this.nextM80 = t + P.marker80_first_ms; this.nextM65 = 0; this.nextBoss = t;
    this.bossI = -1;
  }
  // world.js's own wanderers (only when no plugin replaces animals): the phase's wild creature templates
  spawnAnimals() {
    if (this.replaced.has("animals")) return;
    const P = this.P, ph = this.phases[this.phase], W = this.ctx.WORLD;
    if (this.ctx.WORLD.phases) {
      const recs = ((ph && ph.creatures) || []).filter((c) => c["13"] == null);
      const sp = this.spawnXY();
      recs.sort((a, b) => Math.hypot(a["3"] - sp.x, a["4"] - sp.y) - Math.hypot(b["3"] - sp.x, b["4"] - sp.y));
      for (const c of recs.slice(0, P.animals_max)) this.spawnAnimal(c, c["3"], c["4"]);
      return;
    }
    const tpl = {}; for (const c of W.creatures || []) if (!tpl[c["7"]] && c["13"] == null) tpl[c["7"]] = c;
    let k = 0;
    const sp = this.spawnXY();
    for (const a of P.animals || []) {
      const t = tpl[a.kind]; if (!t) continue;
      for (let i = 0; i < a.n; i++, k++) {
        const ang = k * 2.4, d = 400 + (k % 4) * 260;
        this.spawnAnimal(t, Math.round(sp.x + Math.cos(ang) * d), Math.round(sp.y + Math.sin(ang) * d));
      }
    }
  }
  spawnAnimal(t, hx, hy) {
    const id = this.id(), f = Object.assign({}, t, { "0": id, "3": hx, "4": hy });
    for (const k of Object.keys(f)) if (!/^\d+$/.test(k)) delete f[k];
    this.addEnt({ id, kind: "animal", x: hx, y: hy, hx, hy, tx: hx, ty: hy, f, tpl: t, hp: this.P.animal_hp, a: 0, cd: 0, phase: this.phase });
  }
  // solids (static, placed) live in a coarse grid for collision; other kinds with cd > 0 are checked one by one
  gkey(x, y) { return Math.floor(x / GRID) + Math.floor(y / GRID) * 4096; }
  addEnt(e) {
    e.delta = null; this.ents.set(e.id, e);
    if (e.kind === "static" || e.kind === "placed") {
      e.gk = this.gkey(e.x, e.y);
      let s = this.grid.get(e.gk); if (!s) this.grid.set(e.gk, s = new Set()); s.add(e);
      this.hzDirty = true;
    } else if (e.cd) { this.loose.add(e); this.lgAdd(e); }
    return e;
  }
  removeEnt(id) {
    const e = this.ents.get(id); if (!e) return;
    this.ents.delete(id);
    if (e.gk != null) { const s = this.grid.get(e.gk); if (s) { s.delete(e); if (!s.size) this.grid.delete(e.gk); } this.hzDirty = true; }
    if (this.loose.delete(e)) { const s = this.lgrid.get(e.lk); if (s) s.delete(e); }
    for (const p of this.players.values()) if (p.vis.has(id)) { p.vis.delete(id); p.queue({ "0": id, "1": T.REMOVE }); }
  }
  // moving solids (creatures with cd) are bucketed by cell once per tick (lgrid); a cell is 512 > the largest cd + one tick of motion
  lgAdd(e) { e.lk = this.gkey(e.x, e.y); let s = this.lgrid.get(e.lk); if (!s) this.lgrid.set(e.lk, s = new Set()); s.add(e); }
  lgRebuild() { this.lgrid = new Map(); for (const e of this.loose) this.lgAdd(e); }
  solidsNear(x, y, out) {
    const cx = Math.floor(x / GRID), cy = Math.floor(y / GRID);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const k = cx + i + (cy + j) * 4096, s = this.grid.get(k), l = this.lgrid.get(k);
      if (s) for (const e of s) out.push(e);
      if (l) for (const e of l) out.push(e);
    }
    return out;
  }
  touch(e, fields) { e.delta = Object.assign(e.delta || {}, fields); }
  createMsg(e) {
    if (e.kind === "player") return e.p.createFields();
    if (typeof e.create === "function") return e.create();
    return Object.assign({}, e.f, { "3": Math.round(e.x), "4": Math.round(e.y) }, e.kind === "animal" ? { "5": Math.round((((e.a % TAU) + TAU) % TAU) * 200) } : {});
  }
  // ------------------------------------------------------------ players
  add(p) { this.players.set(p.n, p); }
  remove(p) {
    this.players.delete(p.n);
    if (p.joined) this.plug("onLeave", p);
    if (p.ent) this.removeEnt(p.ent.id);
    for (const e of [...this.ents.values()]) if (e.kind === "placed" && e.owner === p.n) {
      if (this.P.placed_persist) e.ownerGone = true; else this.removeEnt(e.id);
    }
  }
  // owner: a join or a respawn lands at a random free spot of the biome: not in a solid or a structure, not within 1500 of a
  // world boss, not in the ocean statue sanctuary core (TIO_SPAWN_RANDOM=0: the recorded spawn area as before)
  spawnPoint() {
    const P = this.P, sp = this.spawnXY();
    if (process.env.TIO_SPAWN_RANDOM !== "0") {
      const bb = (this.phases && this.phases[this.phase] && this.phases[this.phase].bbox) || [P.map_min, P.map_min, P.map_max, P.map_max];
      const avoid = [...this.ents.values()].filter((e) => !e.dying && (e.worldBoss || e.statue || e.sirenBmb || (e.kind === "placed")));
      for (let i = 0; i < 80; i++) {
        const x = bb[0] + 400 + Math.random() * (bb[2] - bb[0] - 800), y = bb[1] + 400 + Math.random() * (bb[3] - bb[1] - 800);
        if (this.blocked(x, y, 60)) continue;
        if (avoid.some((e) => Math.hypot(e.x - x, e.y - y) < (e.worldBoss ? 1500 : e.kind === "placed" ? 300 : 700))) continue;
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU, d = Math.random() * P.spawn_radius;
      const x = sp.x + Math.cos(a) * d, y = sp.y + Math.sin(a) * d;
      if (!this.blocked(x, y, 20)) return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: sp.x, y: sp.y };
  }
  nearestStatic(x, y) {
    let best = null, bd = 1e18;
    for (const e of this.ents.values()) { if (e.kind !== "static" || e.dying) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; best = e; } }
    return best;
  }
  // ------------------------------------------------------------ tick
  safeTick() {
    const t0 = process.hrtime.bigint();
    try { this.tick(); } catch (e) { this.L({ k: "world_err", room: this.name, err: String(e && e.stack || e).slice(0, 600) }); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    this.tms = (this.tms || 0) + ms; this.tmax = Math.max(this.tmax || 0, ms);
    if (this.st) { this.st.n++; this.st.ms += ms; if (ms > this.st.max) this.st.max = ms; }
    if (this.tickN % 640 === 0 && this.players.size) {   // about once a minute while anyone is in the room
      this.L({ k: "tick_stats", room: this.name, players: this.players.size, ents: this.ents.size, avg_ms: +(this.tms / 640).toFixed(2), max_ms: +this.tmax.toFixed(1) });
      this.tms = 0; this.tmax = 0;
    }
  }
  tick() {
    const P = this.P, now = Date.now();
    this.tickN++; this.now = now;
    if (now >= this.phaseEnd) this.switchPhase(now);
    this.runTimers(now);
    this.lgRebuild();
    const dt = P.send_ms / 1000 / P.substeps;
    for (let s = 0; s < P.substeps; s++) {
      for (const p of this.players.values()) if (p.alive) p.physics(dt, s);
      this.separatePlayers();
      this.animals(dt);
    }
    for (const p of this.players.values()) { try { p.update(now); } catch (e) { this.L({ k: "player_err", n: p.n, err: String(e && e.stack || e).slice(0, 400) }); p.kill("error"); } }
    this.hazards(now);
    try { this.stepTornados(now, P.send_ms / 1000); } catch (e) { this.L({ k: "tornado_err", err: String(e && e.stack || e).slice(0, 300) }); this.tornados = null; }
    this.structures(now);
    this.events(now);
    this.plug("tick", now, P.send_ms);
    this.separateBodies();
    this.blastStep(now, P.send_ms / 1000);
    if (P.board_ticks && this.tickN % P.board_ticks === 0) this.board(now);
    for (const p of this.players.values()) { try { p.stream(now); p.flush(); } catch (e) { this.L({ k: "player_err", n: p.n, err: String(e && e.stack || e).slice(0, 400) }); p.kill("error"); } }
    for (const e of this.ents.values()) e.delta = null;
  }
  // players block each other (owner: nothing walks through anything): a strong push-out every substep moves overlapping
  // bodies fully apart (each half the overlap, an admin keeps his line and the other takes it all), then solids get their
  // say; one pass per substep, so only a pile-up squeezed from all sides keeps a little overlap
  separatePlayers() {
    const P = this.P, R2 = 2 * (P.pvp_body_r || 0); if (!R2) return;
    const L = [...this.players.values()].filter((p) => p.alive && p.ent);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i].ent, b = L[j].ent, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= R2) continue;
      const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0, ov = R2 - d;
      const ga = !!L[i].god, gb = !!L[j].god, fa = ga && !gb ? 0 : gb && !ga ? 1 : 0.5;
      for (const [e, f, sg] of [[a, fa, -1], [b, 1 - fa, 1]]) {
        if (!f) continue;
        const [nx, ny] = this.collide(e.x + sg * ux * ov * f, e.y + sg * uy * ov * f, null, e); e.x = nx; e.y = ny;
      }
    }
  }
  // biome switch, all in one frame: timer, new-phase objects (create + 7:255), old objects {7:0, 10:1}, old creatures
  // dying {7:18, 9:0, 10:dmg}; old objects and creatures are removed biome_remove_ms later
  // chat "/next", "/prev", "/previous" (any player, all or team chat): switch to the next phase now, normal sequence; global cooldown
  cmdNext(p, dir) {
    const now = Date.now();
    if (!p.joined || now - (this.lastNext || 0) < this.P.cmd_next_cooldown_ms) return;
    this.lastNext = now;
    this.L({ k: dir < 0 ? "cmd_prev" : "cmd_next", room: this.name, n: p.n, from: this.phase });
    this.switchPhase(now, dir);
  }
  switchPhase(now, dir, to) {
    const P = this.P, old = this.phase, i = this.order.indexOf(old), L = this.order.length, nb = to != null ? to : this.order[(i + (dir < 0 ? L - 1 : 1)) % L];
    const olds = [...this.ents.values()].filter((e) => e.kind === "static" && e.phase != null);
    this.phase = nb; this.epoch++; this.phaseEnd = now + this.phaseMs(nb);
    const tm = this.timerMsg(now);
    for (const p of this.players.values()) p.queue(tm);
    const n = this.spawnPhase(nb, true);
    for (const e of olds) { e.dying = true; e.cd = 0; this.touch(e, { "7": 0, "10": 1 }); }
    const oldAnimals = this.replaced.has("animals") ? [] : [...this.ents.values()].filter((e) => e.kind === "animal" && e.tpl);
    oldAnimals.forEach((a, k) => { a.dying = true; this.touch(a, { "7": 18, "9": 0, "10": P.biome_kill_dmg[k % P.biome_kill_dmg.length] }); });
    this.after(P.biome_remove_ms, () => {
      for (const e of olds) this.removeEnt(e.id);
      for (const a of oldAnimals) this.removeEnt(a.id);
      this.spawnAnimals();
    });
    this.nextM65 = nb === 5 ? now + P.marker65_first_ms : 0;
    this.plug("onBiome", old, nb);
    this.L({ k: "biome", room: this.name, from: old, to: nb, created: n, old: olds.length, animals: oldAnimals.length, ms: this.phaseMs(nb) });
  }
  blocked(x, y, cdPad, self) {
    for (const e of this.solidsNear(x, y, [])) if (e.cd && !(self && e.ghostFor === self) && Math.hypot(e.x - x, e.y - y) < e.cd + cdPad) return e;
    return null;
  }
  // push a point out of every solid object (slide along the surface), then clamp to the map
  // rad: the mover's body radius (pets, animals): e.cd is the player-center distance, so the block distance is
  // e.cd - player radius + rad; without rad the old scale factor applies
  // owner: frictionless sliding for every mover. A step the solids cut short keeps its full length along the contact
  // tangent, toward the side the mover is offset to; a dead-centre push, or a slide that another solid blocks (two walls,
  // a gap smaller than the body), stops it and self.slideBlk names the solid in the way (creatures bite it).
  collide(nx, ny, scale, self, rad) {
    const r = this.collide0(nx, ny, scale, self, rad);
    if (!SLIDE || !self || self.x == null) return r;
    self.slideBlk = null;
    const dx = nx - self.x, dy = ny - self.y, want = Math.hypot(dx, dy);
    if (want < 0.01) return r;
    const ux = dx / want, uy = dy / want;
    if ((r[0] - self.x) * ux + (r[1] - self.y) * uy >= want * 0.98) return r;
    const o = this.contactOf(self, r[0], r[1], scale, rad, ux, uy); if (!o) return r;
    const c = this.coreOf(o, self.x, self.y), qx = self.x - c[0], qy = self.y - c[1], q = Math.hypot(qx, qy);
    self.slideBlkAt = Date.now();
    if (q < 0.01) { self.slideBlk = o; return r; }
    let tx = -qy / q, ty = qx / q, s = ux * tx + uy * ty;
    if (Math.abs(s) < 1e-3) { self.slideBlk = o; return r; }   // exactly centred: it stops
    if (s < 0) { tx = -tx; ty = -ty; }
    // a slide that turns back on the last one is a pocket (a joint between two solids): blocked, no back and forth
    const sd = self.slideDir, now = Date.now(); self.slideDir = { x: tx, y: ty, t: now };
    if (sd && now - sd.t < 300 && sd.x * tx + sd.y * ty < -0.3) { self.slideBlkAt = now; self.slideBlk = o; self.slideDir = sd; return r; }
    const t = this.collide0(self.x + tx * want, self.y + ty * want, scale, self, rad), g = (t[0] - self.x) * tx + (t[1] - self.y) * ty;
    if (g < want * 0.25) { self.slideBlkAt = Date.now(); self.slideBlk = this.contactOf(self, t[0], t[1], scale, rad, tx, ty, o) || o; return r; }   // the slide is blocked too
    return t;
  }
  // the solid (static, placed or a world boss) the mover at (x, y) touches, most against heading (ux, uy); skip: a solid to pass over
  contactOf(self, x, y, scale, rad, ux, uy, skip) {
    const P = this.P, pl = rad == null && self.kind === "player" && P.player_hit_k;
    let best = null, bs = Infinity;
    for (const e of this.solidsNear(x, y, [])) {
      if (!e.cd || e === self || e === skip || e.ghostFor === self || e.dying) continue;
      if (!(e.kind === "static" || e.kind === "placed" || e.worldBoss)) continue;
      const cd = pl ? this.playerShape(e, 1 - P.player_hit_k + this.squeezeFor(self, e)).cd
        : rad != null ? (e.cr != null ? e.cr + rad : Math.max(0, e.cd - P.player_radius) + rad) : e.cd * (scale || 1);
      const c = this.coreOf(e, x, y), d = Math.hypot(x - c[0], y - c[1]);
      if (d > cd + 2) continue;
      const k = ((x - c[0]) * ux + (y - c[1]) * uy) / (d || 1);   // -1: straight into it
      if (k < bs) { bs = k; best = e; }
    }
    return best && bs < 0.2 ? best : null;
  }
  // owner: pets, players and creatures are soft against each other: overlapping pairs move apart by half the overlap a
  // tick, split by mass (r squared), so they nudge each other; world bosses (and /admin, dashing pets) never give way
  separateBodies() {
    if (!SLIDE) return;
    const P = this.P, now = Date.now(), B = [], G = new Map(), C = 400;   // cell > the biggest pair of radii
    const add = (e) => {
      if (!this.ents.has(e.id) || e.dying || e.dead || e.rider) return;
      const r = e.kind === "player" ? (P.pvp_body_r || P.player_radius) : e.cr != null ? e.cr : e.r || P.animal_radius;
      const b = { e, r, m: r * r, fixed: !!(e.worldBoss || (e.p && e.p.god) || e.dashUntil > now), pl: e.kind === "player", px: 0, py: 0 };
      const k = Math.floor(e.x / C) + Math.floor(e.y / C) * 65536; let c = G.get(k); if (!c) G.set(k, c = []); c.push(b); B.push(b);
    };
    for (const e of this.loose) if (e.kind === "animal" || e.kind === "pet") add(e);
    for (const p of this.players.values()) if (p.alive && p.ent) add(p.ent);
    for (const a of B) {
      const cx = Math.floor(a.e.x / C), cy = Math.floor(a.e.y / C);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const c = G.get(cx + i + (cy + j) * 65536); if (!c) continue;
        for (const b of c) {
          if (b.e.id <= a.e.id || (a.pl && b.pl) || (a.fixed && b.fixed)) continue;   // players vs players: separatePlayers
          const dx = b.e.x - a.e.x, dy = b.e.y - a.e.y, D = a.r + b.r;
          if (dx >= D || dx <= -D || dy >= D || dy <= -D) continue;
          const d = Math.hypot(dx, dy); if (d >= D) continue;
          const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0, ov = (D - d) * 0.5, ka = a.fixed ? 0 : b.fixed ? 1 : b.m / (a.m + b.m);
          a.px -= ux * ov * ka; a.py -= uy * ov * ka; b.px += ux * ov * (1 - ka); b.py += uy * ov * (1 - ka);
        }
      }
    }
    for (const b of B) {   // one solids pass per moved body
      if (Math.abs(b.px) + Math.abs(b.py) < 0.05) continue;
      const e = b.e, [nx, ny] = this.collide0(e.x + b.px, e.y + b.py, b.pl ? null : 0.8, e, b.pl ? undefined : b.r);
      e.x = nx; e.y = ny; this.touch(e, { "3": Math.round(nx), "4": Math.round(ny) });
    }
  }
  collide0(nx, ny, scale, self, rad) {
    const P = this.P;
    let near = this.solidsNear(nx, ny, []);
    const heavy = !!(self && ((self.p && self.p.god) || self.dashUntil > Date.now()));   // /admin and a dashing pet: creatures, pets and players give way, solids still block
    const pl = rad == null && !!(self && self.kind === "player" && P.player_hit_k), S = [];
    if (SLIDE && !heavy) near = near.filter((e) => e.worldBoss || !(e.kind === "animal" || e.kind === "pet" || (e.kind === "player" && !(self && self.kind === "player"))));   // soft: separateBodies
    for (let pass = 0; pass < 3; pass++) for (const e of near) {   // a few passes so two solids pushing apart settle (diagonal gaps)
      if (!e.cd || e === self) continue;
      if (heavy && (e.kind === "animal" || e.kind === "pet" || e.kind === "player")) {
        if (pass || e.dashUntil > Date.now()) continue;   // a dashing pet is not shoved either
        const cd = rad != null ? Math.max(0, e.cd - P.player_radius) + rad : e.cd, dx = e.x - nx, dy = e.y - ny, d = Math.hypot(dx, dy);
        if (d < cd) {
          const ux = d > 0.01 ? dx / d : Math.cos(self.a || 0), uy = d > 0.01 ? dy / d : Math.sin(self.a || 0);
          e.x = Math.max(P.map_min, Math.min(P.map_max, nx + ux * cd)); e.y = Math.max(P.map_min, Math.min(P.map_max, ny + uy * cd));
          if (e.hx != null && e.worldBoss) { e.x = e.hx; e.y = e.hy; continue; }
          this.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) });
        }
        continue;
      }
      if (self && e.ghostFor === self) {   // the placer is walking out: only away from it (owner: never closer, never through)
        const dNew = Math.hypot(nx - e.x, ny - e.y), dOld = Math.hypot(self.x - e.x, self.y - e.y);
        if (dNew >= e.cd) { e.ghostFor = null; continue; }
        if (dNew < dOld && dNew > 0.01) { nx = e.x + (nx - e.x) / dNew * dOld; ny = e.y + (ny - e.y) / dNew * dOld; }
        continue;
      }
      if (pl) {   // owner: smaller player hitbox, squeezing when stuck; solved below as one shape set
        if (!pass) S.push(this.playerShape(e, 1 - P.player_hit_k + this.squeezeFor(self, e)));
        continue;
      }
      const cd = rad != null ? (e.cr != null ? e.cr + rad : Math.max(0, e.cd - P.player_radius) + rad)
        : e.cd * (scale || 1), dx = nx - e.x, dy = ny - e.y, d2 = dx * dx + dy * dy;   // creature pairs: r1 + r2
      if (d2 < cd * cd && d2 > 0.01) { const d = Math.sqrt(d2); nx = e.x + dx / d * cd; ny = e.y + dy / d * cd; }
    }
    if (S.length) [nx, ny] = this.playerSolve(nx, ny, S, self);
    // a building placed on the player: the push out of the others must not take him closer to it either (else he slips out
    // of a closed ring between it and a neighbour); such a step is no step (real: wedged inside the 3rd spike, never out)
    if (pl) for (const e of near) if (e.ghostFor === self && Math.hypot(nx - e.x, ny - e.y) < Math.hypot(self.x - e.x, self.y - e.y) - 0.01) { nx = self.x; ny = self.y; break; }
    return [Math.max(P.map_min, Math.min(P.map_max, nx)), Math.max(P.map_min, Math.min(P.map_max, ny))];
  }
  // player vs solids: every building and object is its own shape (a circle of radius cd; a fallen log a capsule around its
  // center segment), no merging of neighbours (owner: the real game has none); deepest overlap out first, a few rounds.
  // A ghost (a building placed on the player) has no shape for him: he may stay inside it.
  // one solid as the player sees it: radius cd less the hitbox shrink k (x player radius); logs carry their center segment
  playerShape(e, k) {
    const P = this.P, o = { x: e.x, y: e.y, cd: Math.max(0, e.cd - P.player_radius * k) };
    if (P.log_half_len && e.kind === "static" && family(e.name) === "hollow-log") {
      const a = ((e.f && e.f["5"]) || 0) / 100; o.ax = Math.cos(a); o.ay = Math.sin(a); o.L = P.log_half_len;
    }
    return o;
  }
  // closest point of o's collision core to (x, y): its center, or for a fallen log the nearest point of its center segment
  coreOf(o, x, y) {
    const P = this.P;
    if (!(P.log_half_len && o.kind === "static" && family(o.name) === "hollow-log")) return [o.x, o.y];
    const a = ((o.f && o.f["5"]) || 0) / 100, ax = Math.cos(a), ay = Math.sin(a), t = Math.max(-P.log_half_len, Math.min(P.log_half_len, (x - o.x) * ax + (y - o.y) * ay));
    return [o.x + ax * t, o.y + ay * t];
  }
  // debug overlay (owner: O): shapes near the player exactly as collision uses them, plus creatures, pets and players
  debugState(pl) {
    const P = this.P, me = pl && pl.ent; if (!me) return { me: null };
    const R = 1500, out = { me: { x: Math.round(me.x), y: Math.round(me.y), r: P.player_radius, id: me.id }, map: [P.map_min, P.map_max], solids: [], mobs: [], players: [] };
    for (const o of this.ents.values()) {
      if (Math.abs(o.x - me.x) > R || Math.abs(o.y - me.y) > R) continue;
      if ((o.kind === "static" || o.kind === "placed") && o.cd > 0 && !o.dying) {
        const s = this.playerShape(o, 0), r = Math.max(0, o.cd - P.player_radius);
        out.solids.push({ x: Math.round(o.x), y: Math.round(o.y), r: Math.round(r), cd: Math.round(o.cd), L: s.L || 0, a: s.L ? +Math.atan2(s.ay, s.ax).toFixed(3) : 0, ax: s.L ? +s.ax.toFixed(4) : 0, ay: s.L ? +s.ay.toFixed(4) : 0,   // the axis itself: the game client swaps Math.cos / Math.sin in the page
          placed: o.kind === "placed", n: o.name, hp: o.hp != null ? Math.round(o.hp) : null });
      } else if ((o.kind === "animal" || o.kind === "pet") && !o.dead) {
        out.mobs.push({ x: Math.round(o.x), y: Math.round(o.y), r: Math.round(o.cr != null ? o.cr : o.r || P.animal_radius), pet: o.kind === "pet", mine: o.owner === pl,
          sp: o.sp, st: o.stage, hp: o.max ? Math.round(o.hp / o.max * 100) : null });
      } else if (o.kind === "player" && o !== me) out.players.push({ x: Math.round(o.x), y: Math.round(o.y), r: P.player_radius, n: o.p && o.p.name });
    }
    return out;
  }
  playerSolve(nx, ny, S, self) {
    const N = S.filter((s) => !s.ghost && s.cd > 0 && Math.abs(s.x - nx) < s.cd + (s.L || 0) + 160 && Math.abs(s.y - ny) < s.cd + (s.L || 0) + 160);
    const px = self ? self.x : nx, py = self ? self.y : ny, hit = new Set();
    // closest point of a shape core (a center, or a log center segment)
    const core = (A, x, y) => { const t = A.L ? Math.max(-A.L, Math.min(A.L, (x - A.x) * A.ax + (y - A.y) * A.ay)) : 0; return [A.x + (A.L ? A.ax * t : 0), A.y + (A.L ? A.ay * t : 0)]; };
    for (let round = 0; round < 6; round++) {
      let best = 0, bx = 0, by = 0, who = null;
      for (const A of N) {
        const [cx, cy] = core(A, nx, ny), dx = nx - cx, dy = ny - cy, d = Math.hypot(dx, dy);
        if (d < A.cd && A.cd - d > best) {
          best = A.cd - d; who = A;
          if (d > 0.01) { bx = cx + dx / d * A.cd; by = cy + dy / d * A.cd; }
          else { const qx = px - cx, qy = py - cy, q = Math.hypot(qx, qy) || 1; bx = cx + qx / q * A.cd; by = cy + qy / q * A.cd; }
        }
      }
      if (!best) break;
      hit.add(who); nx = bx; ny = by;
    }
    // still inside a circle after the rounds (a gap narrower than the two block distances): the corner where both circles
    // meet on the side of their center line the player came from, so he never crosses between them
    const inside = N.filter((A) => !A.L && Math.hypot(nx - A.x, ny - A.y) < A.cd - 0.05);
    if (inside.length) {
      const A = inside[0], B = N.filter((q) => q !== A && !q.L && Math.hypot(nx - q.x, ny - q.y) < q.cd + 1).sort((p, q) => Math.hypot(nx - p.x, ny - p.y) - p.cd - (Math.hypot(nx - q.x, ny - q.y) - q.cd))[0];
      const D = B ? Math.hypot(B.x - A.x, B.y - A.y) : 0;
      if (B && D > 0.01 && D < A.cd + B.cd && D > Math.abs(A.cd - B.cd)) {
        const ex = (B.x - A.x) / D, ey = (B.y - A.y) / D, a = (A.cd * A.cd - B.cd * B.cd + D * D) / (2 * D), h = Math.sqrt(Math.max(0, A.cd * A.cd - a * a));
        const side = ((px - A.x) * -ey + (py - A.y) * ex) >= 0 ? 1 : -1;
        nx = A.x + ex * a - ey * h * side; ny = A.y + ey * a + ex * h * side; hit.add(A); hit.add(B);
      }
    }
    if (self && self.p) self.p.wedged = hit.size >= 2;   // pressed by two or more solids at once (a gap, a corner, a ring)
    return [nx, ny];
  }
  animals(dt) {
    const P = this.P;
    if (this.replaced.has("animals")) return;
    for (const e of this.ents.values()) {
      if (e.kind !== "animal" || !e.tpl || e.dying) continue;
      const sp = P.animal_speed * dt;
      if (Math.hypot(e.tx - e.x, e.ty - e.y) < sp) {
        if (Math.random() < P.animal_retarget_per_s * dt) { const a = Math.random() * TAU, d = Math.random() * 380; e.tx = e.hx + Math.cos(a) * d; e.ty = e.hy + Math.sin(a) * d; }
        continue;
      }
      e.a = Math.atan2(e.ty - e.y, e.tx - e.x);
      const [nx, ny] = this.collide(e.x + Math.cos(e.a) * sp, e.y + Math.sin(e.a) * sp, 0.8);
      e.x = nx; e.y = ny;
      this.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y), "5": ang255(e.a) });
    }
  }
  // spikes and other hazard objects hurt players (not their owner) and animals in contact
  hazards(now) {
    const P = this.P;
    if (this.hzDirty) {
      this.hz = [];
      for (const e of this.ents.values()) if ((e.kind === "static" || e.kind === "placed") && e.name && P.hazard_match.some((m) => e.name.indexOf(m) >= 0)) this.hz.push(e);
      this.hzDirty = false;
    }
    const hz = this.hz.filter((e) => !e.dying);
    if (!hz.length) return;
    for (const p of this.players.values()) {
      if (!p.alive || now < p.shieldUntil || now - p.lastSpike < P.spike_period_ms) continue;
      for (const e of hz) {
        if (e.owner === p.n || (e.team != null && e.team === p.team())) continue;   // own and teammates' spikes
        if (Math.hypot(e.x - p.x, e.y - p.y) < (e.hz || e.cd || 60) + P.hazard_reach) {
          p.lastSpike = now - p.lastSpike < 2 * P.spike_period_ms ? p.lastSpike + P.spike_period_ms : now;   // keeps the real 0.09 / 0.19 rhythm on 94 ms ticks
          const d = this.plugHit(null, p.ent, P.spike_damage_by_def && P.spike_damage_by_def[e.name] != null ? P.spike_damage_by_def[e.name] : P.spike_damage);
          if (d > 0) p.hurt(d, null, "spike:" + e.name);
          break;
        }
      }
    }
    for (const a of [...this.ents.values()]) {
      if ((a.kind !== "animal" && a.kind !== "pet") || a.dying || a.dead || now - (a.lastSpike || 0) < P.spike_period_ms) continue;
      // owner: spikes hurt wild animals and enemy pets like players; reach = the player contact range (hz) moved out by the body size difference
      // world bosses and BMBs never move onto a spike: their solid body (player stop distance cd - player radius) is what a placed spike touches
      const br = a.cr != null ? a.cr : a.r || P.animal_radius, ar = (a.worldBoss || a.boss || a.stage === 3) && a.cd ? Math.max(br, a.cd - P.player_radius) - P.player_radius : br - P.player_radius;
      for (const e of hz) if (Math.hypot(e.x - a.x, e.y - a.y) < (e.hz || e.cd || 60) + ar + P.hazard_reach) {
        const sp = e.owner != null ? this.players.get(e.owner) : null;
        if (a.kind === "pet" && sp && (this.ownerOf(a) === sp || this.sameTeam(sp, a))) continue;   // own and teammates' pets
        a.lastSpike = now - (a.lastSpike || 0) < 2 * P.spike_period_ms ? a.lastSpike + P.spike_period_ms : now;
        const by = e.owner != null ? this.players.get(e.owner) : null, d = this.plugHit(by || null, a, P.spike_damage_by_def && P.spike_damage_by_def[e.name] != null ? P.spike_damage_by_def[e.name] : P.spike_damage);
        if (d > 0) this.damage(a, d, by || null);
        break;
      }
    }
  }
  hurtAnimal(a, dmg, by) {
    const P = this.P;
    if (a.dying) return;
    a.hp -= dmg;
    this.touch(a, { "9": Math.max(0, Math.round(a.hp / P.animal_hp * 255)) });
    if (a.hp > 0) return;
    this.removeEnt(a.id);
    this.killed(a, by);
    if (by && by.alive) { by.kills.animals++; by.addXp(P.kill_xp_by_stage[a.f && a.f["23"]] || P.xp_animal_kill, "animal_kill"); by.gain({ 0: P.animal_food }); }
    this.L({ k: "animal_kill", room: this.name, by: by ? by.n : null });
    const t = a.tpl, hx = a.hx, hy = a.hy, ph = a.phase;
    if (t) this.after(P.animal_respawn_ms, () => { if (this.ents.size < 100000 && ph === this.phase && !this.replaced.has("animals")) this.spawnAnimal(t, hx, hy); });
  }
  // ------------------------------------------------------------ resources, chests, structures
  toolName(by) { const it = by && this.ctx.ITEMS[by.held]; return by && by.held && it ? it.name : "Hand"; }
  // per-family steps (log, bush, anemone, urchin, thornbush, gold) first, then per tool for trees and stones
  resourceStep(name, by) {
    const P = this.P;
    for (const [m, s] of P.resource_step) if (name.indexOf(m) >= 0 && !(m === "gold" && name.indexOf("golem-") === 0)) return s;   // Gold Golem meteor rocks (golem-gold0) break like stones; map gold stays unbreakable
    const tool = this.toolName(by), t = P.resource_step_by_tool[tool];
    if (t != null) return t;
    const c = P.client[tool], bd = c && c.dmg_building != null ? c.dmg_building : P.wiki_damage && P.wiki_damage.building[tool];   // trees and stones: 400 hp
    return bd != null ? Math.max(1, Math.round(bd * 255 / P.resource_hp_wiki)) : P.resource_step_default;
  }
  // a gathering hit on a natural object: hp byte 7 drops, at 0 {7:0, 10:1}, removed, same-spot respawn later
  hitResource(o, by, ang, stepOver) {   // stepOver: a set hp step (pet bites)
    const P = this.P;
    if (family(o.name) === "gift") return this.hitChest(o, by, ang);
    const step = stepOver != null ? stepOver : this.resourceStep(o.name, by);
    if (!step) { this.touch(o, { "8": ang, "9": 1 }); return; }
    o.hp = Math.max(0, o.hp - step);
    if (o.hp > 0) { this.touch(o, { "7": o.hp, "8": ang, "9": 1 }); return; }
    o.dying = true; o.cd = 0; this.hzDirty = true;
    this.touch(o, { "7": 0, "8": ang, "9": 1, "10": 1 });
    if (TRK.isBush(o.name)) TRK.bushLoot(this, o, by);   // golden flower bush / oathbud drop
    this.after(P.destroy_remove_ms, () => this.removeEnt(o.id));
    const rec = o.rec, b = o.phase, ep = o.epoch;
    if (rec && b != null) this.after(P.resource_respawn_ms, () => { if (this.epoch === ep && this.phase === b) this.objFromRec(rec, b, "spawn"); });
    this.L({ k: "deplete", room: this.name, name: o.name, by: by ? by.n : null });
    this.plug("onDeplete", o, by);   // creatures.js: hive creep / shadow eggs
  }
  giftNo(name) { const m = /gift(\d+)/.exec(name || ""); return m ? +m[1] : 0; }
  // chest: fixed hp steps per hit (5 hits), small gather yield on each non-final hit, loot + type 75 to the opener
  hitChest(o, by, ang) {
    const P = this.P;
    const cs = P.chest_step_by_tool[this.toolName(by)];
    o.chp = (o.chp == null ? 255 : o.chp) - (cs != null ? cs : P.chest_step);
    const hp = Math.max(0, Math.floor(o.chp));
    if (hp > 0) { this.touch(o, { "7": hp, "8": ang, "9": 1 }); return "hit"; }
    o.dying = true; o.cd = 0;
    this.touch(o, { "7": 0, "8": ang, "9": 1, "10": 1 });
    // Gold Golem chest: the boss chest gold (wiki 14k) plus its golem part (creatures.js onChestOpen); statue heart chest: the heart only
    const gi = this.giftNo(o.name), lt = o.golemItem ? { inv: { 3: P.boss_chest_gold } } : o.sirenHeart ? { inv: {} } : P.chest_loot[gi] || P.chest_loot_default[gi % P.chest_loot_default.length];
    if (by) {
      const inv = {};   // a loot value is a number or a [min, max] range (recorded samples per gift type)
      for (const [k, v] of Object.entries(lt.inv)) inv[k] = Array.isArray(v) ? v[0] + Math.floor(Math.random() * (v[1] - v[0] + 1)) : v;
      const m = { "1": T.GIFT, gi };
      if (inv["4"]) m.i = inv["4"];
      by.queue(m);
      by.gain(inv, true);
      if (lt.xp) by.addXp(lt.xp, "chest");
    }
    this.after(P.chest_remove_ms, () => this.removeEnt(o.id));
    const b = o.phase, ep = this.epoch;
    if (b != null && !o.bossChest) this.after(P.chest_respawn_ms, () => { if (this.epoch === ep && this.phase === b) this.spawnChest(b); });
    this.L({ k: "chest_open", room: this.name, gi, by: by ? by.n : null, loot: lt.inv });
    this.plug("onChestOpen", o, by);   // creatures.js: the ocean sanctuary heart wakes the Siren
    return "open";
  }
  // a new gift of the phase at a random free spot inside the phase's area (create 11:1 + pop-in)
  spawnChest(b) {
    const P = this.P, ph = this.phases[b]; if (!ph) return null;
    const defs = ph.gifts.length ? ph.gifts : [...new Set([].concat(...Object.values(this.phases).map((x) => x.gifts)))];
    if (!defs.length) return null;
    const idx = this.ctx.NAMES.indexOf(defs[Math.floor(Math.random() * defs.length)]); if (idx < 0) return null;
    const [x0, y0, x1, y1] = ph.bbox;
    for (let i = 0; i < 40; i++) {
      const x = Math.round(x0 + Math.random() * (x1 - x0)), y = Math.round(y0 + Math.random() * (y1 - y0));
      if (this.blocked(x, y, 140)) continue;
      const name = this.ctx.NAMES[idx];
      const e = this.objFromRec({ "0": 0, "1": T.CREATE, "2": 3, "3": x, "4": y, "5": 628, "6": 1, "13": idx, name }, b, "spawn");
      e.rec = null;
      this.lastGift = e;
      return e;
    }
    return null;
  }
  // player structures: hp byte 7, damage by hits (players and, via world.damage, animals), decay, doors
  // tool hits: struct_step_by_tool / struct_step_tool (32); other damage (hand, creatures, plugins): dmg * struct_byte_per_dmg
  hurtPlaced(e, dmg, by, ang) {
    const P = this.P;
    if (e.dying) return;
    if (by && e.owner != null && this.sameTeam(by, e) && this.ownerOf(by) !== this.ownerOf(e)) return;   // teammates cannot break each other's buildings
    const tool = by instanceof Player && ang != null ? this.toolName(by) : null;
    let step = tool ? this.structStep(e.name, tool, dmg, e) : Math.max(1, Math.round(dmg * P.struct_byte_per_dmg));
    const adm = by instanceof Player ? by : this.ownerOf && by ? this.ownerOf(by) : null;
    if (adm instanceof Player && adm.god) step = Math.ceil(255 * P.admin_hit_frac);   // /admin: half the building per hit
    if (tool && /hammer/i.test(tool) && by.mods && by.mods.bdmg > 1) step = Math.round(step * by.mods.bdmg);   // Broken Pot
    e.hp = Math.max(0, e.hp - step);
    const f = { "7": e.hp, "9": e.door ? (e.open ? P.door_open : P.door_closed) : 1 };
    if (ang != null) f["8"] = ang;
    this.touch(e, f);
    if (e.hp <= 0) this.destroyPlaced(e, by ? "hit" : "damage", by);
  }
  // hp byte step of a tool hit: def|tool, family|tool, def, family (struct_step, sp5 per structure), then per tool, else 32
  // recorded overrides first (spikes 32, doors 38, ruby wall 32), then 255 * client damage-building / building-durability
  structStep(name, tool, dmg, e) {
    const P = this.P, T2 = P.struct_step, f = family(name);
    for (const k of [name + "|" + tool, f + "|" + tool, name, f]) if (T2[k] != null) return T2[k];
    const it = e && this.ctx.ITEMS[e.item], ct = P.client[tool], cs = it && P.client[it.name];
    if (ct && ct.dmg_building != null && cs && cs.durability) return Math.max(1, Math.round(255 * ct.dmg_building / cs.durability));
    if (tool === "Hand") return Math.max(1, Math.round(dmg * P.struct_byte_per_dmg));
    return P.struct_step_by_tool[tool] != null ? P.struct_step_by_tool[tool] : P.struct_step_tool;
  }
  destroyPlaced(e, why, by) {
    const P = this.P;
    if (e.dying) return;
    e.dying = true; e.cd = 0; this.hzDirty = true;
    this.touch(e, { "7": 0, "10": 1 });
    this.after(P.destroy_remove_ms, () => this.removeEnt(e.id));
    const p = this.players.get(e.owner);
    if (p && !e.ownerGone) {
      p.unplaced(e);
      const it = this.ctx.ITEMS[e.item];   // the owner breaking his own structure gets half the cost back (decay: nothing)
      if (by === p && it && it.cost) { const add = {}; it.cost.forEach((c, i) => { if (c) add[i] = Math.floor(c * P.refund_frac); }); if (Object.keys(add).length) p.gain(add); }
    }
    this.L({ k: "struct_gone", room: this.name, name: e.name, why });
  }
  structures(now) {
    const P = this.P, doorTick = this.tickN % 3 === 0;
    for (const e of this.ents.values()) {
      if (e.kind !== "placed" || e.dying) continue;
      if (this.noDecay) e.decayAt = now + P.decay_ms;   // /nodecay: hp kept, timer paused
      if (now >= e.decayAt) {
        e.decayAt = now + P.decay_ms;
        e.hp = Math.max(0, e.hp - P.decay_step);
        this.touch(e, { "7": e.hp });
        if (e.hp <= 0) { this.destroyPlaced(e, "decay"); continue; }
      }
      if (e.pad) this.padPush(e, now);
      if (e.repair && now >= e.nextRepair) this.repairPulse(e, now);
      if (e.gun && !e.ownerGone && now >= e.nextShot) this.gunShot(e, now);   // a left player's towers stay quiet
      if (e.trap && now >= e.trapReady) this.trapTick(e, now);
      if (e.mill && now >= e.nextMill) this.windmill(e, now);
      if (e.door && doorTick) {
        let open = false;
        for (const p of this.players.values()) {
          if (!p.alive || !p.ent || !(p.n === e.owner || (e.team != null && p.team() === e.team))) continue;
          if (Math.hypot(p.ent.x - e.x, p.ent.y - e.y) < P.door_open_dist) { open = true; break; }
        }
        if (open !== e.open) { e.open = open; e.cd = open ? 0 : e.cd0; this.touch(e, { "9": open ? P.door_open : P.door_closed }); }
      }
    }
  }
  // boost pad: a player whose center comes within pad_trigger of the pad is pushed along the placer's aim (awake wild
  // creatures are not), once per pad_cooldown_ms per player. Big Boost Pad: pad_trigger_by, scaled from the sprite (anim 371 px
  // vs 260 px for the recorded 90). Owner: pets and sleeping creatures ride it too (blastKb at the profile's peak speed)
  padPush(e, now) {
    const P = this.P, R = (P.pad_trigger_by && P.pad_trigger_by[e.name]) || P.pad_trigger, k = "pad" + e.id;
    for (const p of this.players.values()) {
      if (!p.alive || !p.ent || (p.mods && p.mods.pad_immune)) continue;
      if (Math.hypot(p.ent.x - e.x, p.ent.y - e.y) > R) continue;
      if (now < (p.padUntil[k] || 0)) continue;
      p.padUntil[k] = now + P.pad_cooldown_ms;
      p.push = { dx: Math.cos(e.padDir), dy: Math.sin(e.padDir), i: 0, u: P.pad_profile[0] };
    }
    const v = Math.max(...P.pad_profile) / (P.send_ms / 1000);
    for (const o of this.ents.values()) {
      if ((o.kind !== "pet" && !(o.kind === "animal" && (o.s7 & 64))) || o.dying || o.dead || o.rider || o.worldBoss || o.dashUntil > now) continue;
      if (Math.abs(o.x - e.x) > R || Math.hypot(o.x - e.x, o.y - e.y) > R) continue;
      o.padUntil = o.padUntil || {}; if (now < (o.padUntil[k] || 0)) continue;
      o.padUntil[k] = now + P.pad_cooldown_ms;
      o.blastKb = [Math.cos(e.padDir) * v, Math.sin(e.padDir) * v]; this.blasted.add(o);
    }
  }
  // ------------------------------------------------------------ clan totems
  // recorded (63 captures, tools/scan scans_dec): the totem is a static object (def 0 "totem") whose create carries the
  // owning clan's tag in field 14 (absent = free) and its level in 12 (1, 2, 5 seen); hits send {7: hp byte, 8: angle, 9: 1},
  // the byte falling ~10.3 per hit (~25 hits). Rules (wiki Totem): breaking it captures it for the breaker's clan (a clan-less
  // breaker frees it: "has lost the Totem"); its clan's members cannot hurt it; per level gold a minute to the clan's
  // players (250 .. 2500), heal clan members near it from level 2, repair their buildings from level 3. Not built: the curse,
  // totem points, chests / masks shop; levels are bought with golden apples the clone does not have, so /totem levels up
  // the nearest own totem (owner's choice of default). Ability cadence and radius: guess (P.totem).
  clanName(id) { const s = this.ext && this.ext.social, t = s && s.teams && s.teams.get(id); return t ? t.name : null; }
  hitTotem(o, by, ang) {
    const P = this.P, T0 = P.totem, team = by && by.team ? by.team() : null;
    if (o.clan != null && team === o.clan) { this.touch(o, { "8": ang, "9": 1 }); return; }
    o.thp = (o.thp == null ? 255 : o.thp) - T0.step;
    if (o.thp > 0) { this.touch(o, { "7": Math.round(o.thp), "8": ang, "9": 1 }); return; }
    const old = o.clan != null ? this.clanName(o.clan) : null, name = team != null ? this.clanName(team) : null;
    const f = Object.assign({}, o.rec || {}, { "13": o.f["13"], "2": 3 }); delete f["12"]; delete f["14"];
    if (name) { f["12"] = 1; f["14"] = name; } else if (T0.default_clan) f["14"] = T0.default_clan;   // clan-less breaker: back to the default name
    this.removeEnt(o.id);
    const e = this.objFromRec(Object.assign(f, { name: o.name, "3": Math.round(o.x), "4": Math.round(o.y) }), o.phase, "spawn");
    e.clan = name ? team : null; e.level = name ? 1 : 0; e.rec = o.rec;
    if (name) this.announce("The clan " + name + " has captured the Totem");
    else if (old) this.announce("The clan " + old + " has lost the Totem");
    this.L({ k: "totem", room: this.name, by: by ? by.n : null, clan: name, lost: old });
  }
  totemLevel(e, lv) { e.level = lv; e.f["12"] = lv; this.touch(e, { "12": lv }); }
  totems(now) {
    const P = this.P, T0 = P.totem; if (!T0) return;
    const gold = now >= (this.totemGoldAt || (this.totemGoldAt = now + 60000)), pulse = now >= (this.totemPulseAt || 0);
    if (!gold && !pulse) return;
    if (gold) this.totemGoldAt = now + 60000;
    if (pulse) this.totemPulseAt = now + T0.ability_ms;
    for (const e of this.ents.values()) {
      if (e.kind !== "static" || e.clan == null || e.dying || !e.level) continue;
      const lv = e.level, heal = T0.heal[lv] || 0, fix = T0.repair[lv] || 0, curse = (T0.curse && T0.curse[lv]) || 0;
      if (gold && T0.points_per_min) { const cp = this.clanPoints || (this.clanPoints = new Map()); cp.set(e.clan, (cp.get(e.clan) || 0) + (T0.points_per_min[lv] || 0)); }
      if (pulse && curse) {   // the nearest enemy in range not cursed lately
        let best = null, bd = T0.r;
        for (const p of this.players.values()) {
          if (!p.alive || !p.ent || p.god || p.team() === e.clan || now < (p.cursedUntil || 0)) continue;
          const d = Math.hypot(p.ent.x - e.x, p.ent.y - e.y); if (d < bd) { bd = d; best = p; }
        }
        const rp = best && best.riding && this.plugFn("riddenPet"), pet = rp && rp.m.riddenPet(this, best);
        if (pet && pet.hp > 1) {   // wiki: a rider's pet takes the curse
          best.cursedUntil = now + T0.curse_ms; pet.hp = Math.max(1, pet.hp - Math.round(pet.max * curse)); this.touch(pet, { "9": Math.round(pet.hp / pet.max * 255) });
          this.L({ k: "totem_curse", room: this.name, n: best.n, lv, pet: pet.id });
        } else if (best && best.hp > 1) { best.cursedUntil = now + T0.curse_ms; best.hp = Math.max(1, best.hp - Math.round(P.max_hp * curse)); best.pending["12"] = Math.round(best.hp);
          this.L({ k: "totem_curse", room: this.name, n: best.n, lv, hp: Math.round(best.hp) }); }
      }
      for (const p of this.players.values()) {
        if (!p.alive || !p.ent || p.team() !== e.clan) continue;
        if (gold) p.gain({ 3: T0.gold_per_min[lv] || 0 });
        if (pulse && heal && p.hp < P.max_hp && Math.hypot(p.ent.x - e.x, p.ent.y - e.y) < T0.r) { p.hp = Math.min(P.max_hp, p.hp + heal); p.pending["12"] = Math.round(p.hp); }
      }
      if (pulse && fix) for (const o of this.ents.values()) {
        if (o.kind !== "placed" || o.dying || o.hp >= 255 || o.team !== e.clan || Math.hypot(o.x - e.x, o.y - e.y) > T0.r) continue;
        o.hp = Math.min(255, o.hp + fix); this.touch(o, { "7": o.hp });
      }
    }
  }
  // repair tower: every reload the most damaged own/team structure in range gets the heal effect (cat 4 kind 1) on it;
  // it pulses repair_pulses times, every repair_pulse_ms, each pulse + repair_heal_k / wiki durability of the structure
  repairPulse(e, now) {
    const P = this.P;
    e.nextRepair = now + e.repairMs;
    let best = null;
    for (const o of this.ents.values()) {
      if (o.kind !== "placed" || o === e || o.dying || o.hp >= 255) continue;
      if (!(o.owner === e.owner || (e.team != null && o.team === e.team))) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) > P.repair_range) continue;
      if (!best || o.hp < best.hp) best = o;
    }
    if (!best) return;
    const a = Math.atan2(best.y - e.y, best.x - e.x), id = this.id(), tgt = best;
    this.touch(e, { "5": ang255(a), "9": P.repair_aim });
    const fx = this.addEnt({ id, kind: "projectile", x: tgt.x, y: tgt.y, cd: 0, f: { "0": id, "1": T.CREATE, "2": 4, "3": Math.round(tgt.x), "4": Math.round(tgt.y),
      "5": Math.round(((a % TAU) + TAU) % TAU * 100), "6": 1, "7": 1, "8": 0, "9": 0, "10": e.id, "11": e.id } });
    const it = this.ctx.ITEMS[tgt.item], dur = (it && P.wiki_durability && P.wiki_durability[it.name]) || P.repair_durability_default;
    const heal = Math.max(1, Math.round(P.repair_heal_k / dur));
    for (let i = 1; i <= P.repair_pulses; i++) this.after(P.repair_first_pulse_ms + (i - 1) * P.repair_pulse_ms, () => {
      if (tgt.dying || !this.ents.has(tgt.id) || tgt.hp >= 255) return;
      tgt.hp = Math.min(255, tgt.hp + heal); this.touch(tgt, { "7": tgt.hp });
    });
    this.after(P.repair_first_pulse_ms + P.repair_pulses * P.repair_pulse_ms, () => this.removeEnt(fx.id));
  }
  // bear traps (wiki Bear Traps): armed arm_ms after placing; an enemy player, pet or a wild creature stepping inside r takes
  // dmg (animal to creatures and pets) and is stunned stun_ms (client paralysis effect on it); then cooldown_ms before it bites
  // again. Trapper's Hat (mods.trap_mult) raises the damage
  trapTick(e, now) {
    const TR = e.trap, P = this.P, own = this.players.get(e.owner), k = (own && own.mods && own.mods.trap_mult) || 1;
    let hit = 0;
    for (const o of [...this.ents.values()]) {
      if (o.kind !== "player" && o.kind !== "pet" && o.kind !== "animal") continue;
      if (o.kind === "player" ? !o.p.alive : o.dying || o.dead) continue;
      if (o.kind !== "animal" && this.sameTeam(e, o)) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) > TR.r + (o.kind === "player" ? 0 : o.cr || 0)) continue;   // creatures: their body reaches it
      const d = this.damage(o, (o.kind === "player" ? TR.dmg : TR.animal) * k, e);
      if (d <= 0 && o.kind !== "animal") continue;
      const h = o.kind === "player" ? o.p : o;
      h.slowUntil = now + P.traps.stun_ms; h.slowFactor = 0;
      const id = this.id();
      this.addEnt({ id, kind: "effect", x: o.x, y: o.y, cd: 0, f: { "0": id, "1": T.CREATE, "2": 4, "3": Math.round(o.x), "4": Math.round(o.y), "5": 0, "6": 1,
        "7": P.traps.fx, "8": 2, "9": 0, "10": e.id, "11": e.id } });
      this.after(P.traps.stun_ms, () => this.removeEnt(id));
      hit++;
    }
    if (hit) { e.trapReady = now + P.traps.cooldown_ms * ((own && own.mods && own.mods.trap_reload) || 1); this.L({ k: "trap", room: this.name, id: e.id, item: e.name, hit }); }
    else e.trapReady = now + P.send_ms;
  }
  // element towers (owner): P.guns entry for a placed item, with its tier's reload (wiki tables); turrets: creatures.js stepTurrets
  gunOf(it) {
    const G = this.P.guns, fam = family(it.icon), mat = it.icon.split("-")[0];
    const m = /-(\w+)-tower$/.exec(it.icon), T = m && G.towers[m[1]];
    if (!T) return null;
    return Object.assign({}, T, { ms: (T.ms[mat] || T.ms.cosmetic) * 1000 });
  }
  // nearest enemy in range: another team's player or pet, or a wild creature
  gunTarget(e, range) {
    let best = null, bd = range;
    for (const o of this.ents.values()) {
      if (o.kind === "player" ? !o.p.alive : o.kind === "pet" ? o.dying || o.dead : o.kind === "animal" ? o.dying || o.dead : true) continue;
      if (o.kind !== "animal" && this.sameTeam(e, o)) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  // an element tower throws its fairy's ball (same effect kind and damage as that fairy's skill) at the target, hitting
  // every enemy within splash_r of where it lands
  gunShot(e, now) {
    const G = e.gun, P = this.P;
    const t = this.gunTarget(e, G.range);
    if (!t) { e.nextShot = now + P.guns.idle_ms; return; }
    e.nextShot = now + G.ms;
    const a = Math.atan2(t.y - e.y, t.x - e.x), d = Math.hypot(t.x - e.x, t.y - e.y), id = this.id();
    this.touch(e, { "5": ang255(a), "9": P.repair_aim });
    this.L({ k: "gun_shot", room: this.name, id: e.id, item: e.name, owner: e.owner, tgt: t.kind, sp: t.sp, d: Math.round(d) });
    // the fairy's own ball (creatures.js fairyBall: same kind, hit, damage over time and radius as the fairy of this type)
    const fb = G.sp != null && this.plugFn("fairyBall"), own = this.players.get(e.owner);
    if (fb && own && fb.m.fairyBall(this, e, G.sp, own, a, d)) return;
    // fallback: the ball flies from the tower to where the target stood and bursts there
    const tx = t.x, ty = t.y, fly = Math.max(P.fx_ms, d / G.speed * 1000);
    this.flyFx(G.k, e.x, e.y, a, G.speed, fly, e);
    this.after(fly, () => this.towerBurst(e, G, tx, ty));
  }
  towerBurst(e, G, tx, ty) {
    const P = this.P;
    for (const o of [...this.ents.values()]) {
      if (o.kind !== "player" && o.kind !== "pet" && o.kind !== "animal") continue;
      if (o.kind === "player" ? !o.p.alive : o.dying || o.dead) continue;
      if (o.kind !== "animal" && this.sameTeam(e, o)) continue;
      if (Math.hypot(o.x - tx, o.y - ty) > P.guns.splash_r) continue;
      this.damage(o, o.kind === "player" ? G.pdmg : G.adm, e);
    }
  }
  // windmill: gold to the owner while connected
  windmill(e, now) {
    const P = this.P, it = this.ctx.ITEMS[e.item], w = (it && P.windmill[it.name]) || P.windmill.default;
    e.nextMill = now + w.ms;
    const p = this.players.get(e.owner);
    if (p && !e.ownerGone && p.alive) p.gain({ 3: w.gold + ((p.mods && p.mods.mill_gold) || 0) });   // Windmill Hat
  }
  // ------------------------------------------------------------ map events
  events(now) {
    const P = this.P;
    this.totems(now);
    if (P.marker80_ms && now >= this.nextM80) {
      this.nextM80 = now + P.marker80_ms;
      // tornado: the biome's tornado object (scans: poison / ice / electric / insect / water / ancient, wandering at ~130/s)
      // at the minimap marker; it hurts and pulls players inside, and a player inside when it ends wakes the biome's boss
      // dog (wiki Tornado / Big Mamma Boss); life, damage, pull and radius: guess
      const bb = this.phases[this.phase] && this.phases[this.phase].bbox, [x0, y0, x1, y1] = bb || [P.map_min, P.map_min, P.map_max, P.map_max];
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      this.broadcastAlive({ "1": T.MARK80, o: Math.round(x / P.marker_div), j: Math.round(y / P.marker_div) });
      try { this.spawnTornado(x, y, now); } catch (e) { this.L({ k: "tornado_err", err: String(e && e.stack || e).slice(0, 300) }); }
    }
    if (P.gift_drop_ms && now >= (this.nextGift || (this.nextGift = now + P.gift_drop_ms))) { this.nextGift = now + P.gift_drop_ms; this.spawnChest(this.phase); }
    if (this.phase === 5 && P.marker65_ms && this.nextM65 && now >= this.nextM65) {
      this.nextM65 = now + P.marker65_ms;
      const [x0, y0, x1, y1] = this.phases[5] ? this.phases[5].bbox : [P.map_min, P.map_min, P.map_max, P.map_max];
      const mx = x0 + Math.random() * (x1 - x0), my = y0 + Math.random() * (y1 - y0);
      this.broadcastAlive({ "1": T.MARK65, o: Math.round(mx / P.marker_div), j: Math.round(my / P.marker_div) });
      const mi = this.ctx.NAMES.indexOf("volcanic-meteorite");   // the meteorite object lands at the marker (scans: static); stays 60 s: guess
      if (mi >= 0 && !this.blocked(mx, my, 100)) { const m = this.objFromRec({ "0": 0, "1": T.CREATE, "2": 3, "3": Math.round(mx), "4": Math.round(my), "5": 628, "6": 1, "13": mi, name: "volcanic-meteorite" }, 5, "spawn"); m.rec = null; this.after(60000, () => { if (this.ents.has(m.id)) this.removeEnt(m.id); }); }
    }
  }
  // nm: a tornado kind other than the biome's own (/spawnall); it still belongs to the current phase
  spawnTornado(x, y, now, nm) {
    const P = this.P, T0 = P.tornado; if (!T0) return;
    nm = nm || T0.name_by_phase[this.phase]; const idx = this.ctx.NAMES.indexOf(nm); if (idx < 0) return;
    const e = this.objFromRec({ "0": 0, "1": T.CREATE, "2": 3, "3": Math.round(x), "4": Math.round(y), "5": 628, "6": 1, "13": idx, name: nm }, this.phase, "spawn");
    e.rec = null; e.cd = 0; e.tornado = { until: now + T0.life_ms, a: Math.random() * Math.PI * 2, nextHit: now, phase: this.phase, hx: x, hy: y };
    (this.tornados = this.tornados || new Set()).add(e);
    this.L({ k: "tornado", room: this.name, name: nm, x: Math.round(x), y: Math.round(y) });
  }
  stepTornados(now, dt) {
    const P = this.P, T0 = P.tornado; if (!T0 || !this.tornados || !this.tornados.size) return;
    for (const e of [...this.tornados]) {
      const t = e.tornado;
      if (!this.ents.has(e.id) || t.phase !== this.phase) { this.tornados.delete(e); if (this.ents.has(e.id)) this.removeEnt(e.id); continue; }
      t.a += (Math.random() - 0.5) * T0.turn * dt;
      if (T0.leash && Math.hypot(e.x - t.hx, e.y - t.hy) > T0.leash) t.a = Math.atan2(t.hy - e.y, t.hx - e.x);   // owner: stays near its minimap marker
      let nx = e.x + Math.cos(t.a) * T0.speed * dt, ny = e.y + Math.sin(t.a) * T0.speed * dt;
      if (nx < P.map_min || nx > P.map_max || ny < P.map_min || ny > P.map_max) { t.a += Math.PI; nx = e.x; ny = e.y; }
      e.x = nx; e.y = ny; this.touch(e, { "3": Math.round(nx), "4": Math.round(ny) });
      const hit = now >= t.nextHit; if (hit) t.nextHit = now + T0.hit_ms;
      let inside = null;
      for (const p of this.players.values()) {
        if (!p.alive || !p.ent) continue;
        const dx = e.x - p.ent.x, dy = e.y - p.ent.y, d = Math.hypot(dx, dy); if (d > T0.r) continue;
        inside = p;
        if (d > 5) { const [px, py] = this.collide(p.ent.x + dx / d * T0.pull * dt, p.ent.y + dy / d * T0.pull * dt, null, p.ent); p.ent.x = px; p.ent.y = py; }
        if (hit && !p.god) p.hurt(T0.dmg, null, "tornado");
      }
      // owner: creatures and pets inside are pulled and hurt the same way (ridden pets are not pulled; world bosses untouched)
      for (const o of this.ents.values()) {
        if ((o.kind !== "animal" && o.kind !== "pet") || o.dying || o.dead || o.worldBoss) continue;   // owner: world bosses ignore tornadoes
        const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy); if (d > T0.r) continue;
        if (d > 5 && !o.rider) {
          const [ox, oy] = this.collide(o.x + dx / d * T0.pull * dt, o.y + dy / d * T0.pull * dt, 0.8, o, o.cr != null ? o.cr : o.r || P.animal_radius);
          o.x = ox; o.y = oy; this.touch(o, { "3": Math.round(ox), "4": Math.round(oy) });
        }
        if (hit) this.damage(o, T0.dmg, null);
      }
      if (now >= t.until) {
        this.tornados.delete(e); this.removeEnt(e.id);
        const sp = T0.boss_dog[t.phase], pf = this.plugFn("spawnAt");
        if (inside && sp != null && pf) pf.m.spawnAt(this, sp, 3, Math.round(e.x), Math.round(e.y));
        this.L({ k: "tornado_end", room: this.name, boss: !!inside });
      }
    }
  }
  // boss marker for the minimap: a plugin may set world.boss = {x, y, kind}; else the measured marker list cycles
  bossMarker(now) {
    const P = this.P;
    // ob[2] indexes the client's boss marker table (0 boss-tree, 1 dragon, 2 ice-golem, 3 boss-mushroom, 4 spectrum,
    // 5 octopus, 6 fir-tree, 7 cactus, 8 dark-tree, 9 stone-golem, 10 ice-dragon, 11 gold-golem, 12 gaze-boss,
    // 13 volcanic-golem, 14 fire-dragon); anything else throws in the client's update loop every frame
    if (this.boss && this.boss.x != null) {
      let k = this.boss.marker != null ? this.boss.marker : P.boss_marker_by_species[this.boss.kind];
      if (!(k >= 0 && k <= P.boss_marker_max)) k = P.boss_marker_default;
      return [Math.round(this.boss.x / P.minimap_div), Math.round(this.boss.y / P.minimap_div), k];
    }
    if (!P.boss_markers || !P.boss_markers.length) return null;
    if (now >= this.nextBoss) { this.bossI = (this.bossI + 1) % P.boss_markers.length; this.nextBoss = now + P.boss_marker_ms; }
    const m = P.boss_markers[this.bossI];
    return m && m[2] >= 0 && m[2] <= P.boss_marker_max ? m : null;
  }
  // top 10 by score = current gold (sp3: own row 5, 10, 200 with inventory slot 3 at 5, 10, 200); full rows every time, then 0 so the client trims the rest; ob/pa minimap markers ride along; alive players only
  board(now) {
    const P = this.P;
    const rows = [...this.players.values()].filter((p) => p.joined && p.ent && !(p.mods && p.mods.hide_board && (p.inv[3] || 0) < 1e6)).sort((a, b) => (b.inv[3] || 0) - (a.inv[3] || 0)).slice(0, 10)
      .map((p) => [p.ent.id, p.name, Math.floor(p.inv[3] || 0), P.player_badge || 0]);   // 4th: badge (client rank image 4th - 1)
    const m = { "1": T.BOARD, o: encBoard(rows.concat([0]), this.boardKey()) };
    const ob = this.bossMarker(now || Date.now()); if (ob) m.ob = ob;
    const pa = P.pa_by_phase && P.pa_by_phase[this.phase]; if (pa) m.pa = pa;
    for (const p of this.players.values()) if (p.joined && p.alive) p.queue(m);
  }
  // the client's board key moves with the join value 86 {o}: key 88 with the atl4 o 59 (v0.2), 62 with the sp5 o 33
  // (a Chrome join showed the first decrypted char off by 88 ^ 62); key = 29 + o
  boardKey() {
    if (this.bkey != null) return this.bkey;
    const W = this.ctx.WORLD, jv = (this.P.join_values || {})[86], m = (W.join || []).find((q) => q["1"] === 86);
    const o = jv && jv.o != null ? jv.o : m ? m.o : 59;
    return (this.bkey = 29 + o);
  }
  // session chat log (cap 500): {seq, t, name, text, team (clan lines) or null, to (private: player n) or null, k (kind for the
  // panel color: sys reply help err event vs ok warn admin) and hl (names to highlight), both optional}; fed to /_chat/stream
  logChat(line) {
    const L = this.chatLog || (this.chatLog = []), subs = this.chatSubs || (this.chatSubs = new Set());
    line.seq = (this.chatSeq = (this.chatSeq || 0) + 1); line.t = Date.now();
    L.push(line); if (L.length > 500) L.splice(0, L.length - 500);
    for (const f of subs) { try { f(line); } catch (e) { } }
  }
  chatVisible(line, p) { return line.to != null ? line.to === p.n : line.team == null || (p.team && line.team === p.team()); }
  chat(p, msg) {
    if (!p.ent) return;
    this.logChat({ name: p.name || "", text: msg, team: null, to: null });
    const m = { "1": T.CHAT, i: p.ent.id, m: msg, mt: 1 };
    for (const q of this.players.values()) if (q === p || q.vis.has(p.ent.id)) q.queue(m);
    this.L({ k: "chat", room: this.name, n: p.n, len: msg.length });
  }
}

const newSb = () => ({ k: 0, ga: 0, sba: 0, sbi: 0, sbb: 0, sbp: 0, sbf: 0, sbw: 0, sbs: 0, sbt: 0, sbu: 0 });
let PN = 0;
class Player {
  constructor(sock, url, world) {
    this.sock = sock; this.url = url; this.w = world; this.n = ++PN; this.P = world.P; this.L = world.L;
    this.enc = new C.ServerEnc(); this.dec = new C.ClientDec(); this.r = 0;
    this.vis = new Set(); this.out = []; this.joined = false; this.alive = false; this.ent = null;
    this.keys = new Set(); this.aim = 0; this.attacking = false; this.lastSwing = 0; this.held = 0; this.pending = {};
    this.vx = 0; this.vy = 0; this.cruise = 0; this.glide = 99; this.wasMoving = false;
    this.xp = 0; this.hp = this.P.max_hp; this.inv = Object.assign({}, this.P.start_inv); this.placedG = {}; this.kills = { players: 0, animals: 0 };
    this.sb = newSb(); this.ach = {}; this.killer = null; this.padUntil = {}; this.push = null; this.kb = null;
    this.mods = { speed: 1, dmg_taken: 1, gather_bonus: {}, regen_per_s: 0, xp_mult: 1, pad_immune: false };
    this.shieldUntil = 0; this.lastSpike = 0; this.lastChat = 0; this.deadAt = 0; this.camDue = []; this.name = "player " + this.n;
    const sp = world.spawnXY(); this.cam = { x: sp.x, y: sp.y };
    this.stats = { rx: 0, tx: 0, ops: {} }; this.closed = false;
    const M = world.ctx.M;
    this.reader = new M.WsReader((op, p) => this.onFrame(op, p));
    sock.on("data", (d) => this.reader.push(d));
    sock.on("close", () => this.close("close"));
    sock.on("error", (e) => this.close("error " + e.message));
    world.add(this);
    this.L({ k: "ws_open", n: this.n, room: world.name });
    for (const m of world.ctx.WORLD.setup) this.queue(m["1"] === T.TIMER ? world.timerMsg() : m);
    this.stream(Date.now());
    const cam = world.nearestStatic(this.cam.x, this.cam.y);
    if (cam) this.queue({ "1": T.OWN, id: cam.id * 256 + 2, s: true });
    this.flush();
  }
  get id() { return this.ent ? this.ent.id : null; }
  team() { return this.cf && this.cf["14"] ? Math.floor(this.cf["14"] / 2) : null; }
  get x() { return this.ent ? this.ent.x : this.cam.x; }
  get y() { return this.ent ? this.ent.y : this.cam.y; }
  close(why) {
    if (this.closed) return; this.closed = true;
    this.w.remove(this);
    this.L({ k: "ws_close", n: this.n, room: this.w.name, why, xp: this.xp, stats: this.stats });
  }
  kill(why) { try { this.sock.destroy(); } catch (e) { } this.close(why); }
  queue(m) { this.out.push(m); }
  flush() {
    if (!this.out.length || this.closed) return;
    const M = this.w.ctx.M, msgs = this.out; this.out = [];
    for (let i = 0; i < msgs.length; i += 120) {
      const fr = C.frame(this.enc, msgs.slice(i, i + 120));
      try { this.sock.write(M.wsFrame(fr, 2)); } catch (e) { }
      this.stats.tx++;
    }
  }
  createFields() {
    const f = Object.assign({}, this.w.ctx.WORLD.player);
    f["0"] = this.ent.id; f["3"] = Math.round(this.ent.x); f["4"] = Math.round(this.ent.y); f["5"] = Math.round(((this.aim % TAU) + TAU) % TAU * 200);
    f["7"] = this.alive ? (Date.now() < this.shieldUntil ? 9 : 1) : 16;
    const cs = this.cos || GOOFY; f["21"] = cs.sk; f["22"] = cs.pa; f["23"] = cs.ac;   // owner: menu cosmetics (client field table: 21 skin, 22 particle, 23 accessory), the goofy defaults without a pick
    f["8"] = this.shownHeld || this.held; f["12"] = Math.round(this.hp); f["18"] = this.name; f["19"] = this.xp; f["20"] = this.P.player_badge || 0;   // 20: badge above the name (client rank image 20 - 1; sp5 players 0..12)
    f["24"] = Math.max(0, this.shieldUntil - Date.now());
    f["26"] = this.P.player_clan != null ? this.P.player_clan : "67";   // owner: the yellow clan tag next to the name (field 26, sp5)
    return Object.assign(f, this.cf || {});
  }
  // ------------------------------------------------------------ input
  onFrame(op, p) {
    this.stats.rx++;
    if (op === 8) { this.kill("ws close frame"); return; }
    if (op === 9) { try { this.sock.write(this.w.ctx.M.wsFrame(p, 10)); } catch (e) { } return; }
    if (op === 10) return;
    if (op !== 1 && op !== 2) { this.kill("bad opcode"); return; }
    if (p.length > this.P.max_msg_bytes) { this.kill("msg too big"); return; }
    const d = this.dec.decode(p, op === 1);
    if (d.json !== undefined) {   // a JSON frame is one list: objects plus plain binary ops (sp5: key release-all after chat)
      const arr = Array.isArray(d.json) ? d.json : [d.json];
      for (const m of arr) {
        if (typeof m === "number" && Number.isFinite(m) && m >= 0 && m < 2 ** 48) { this.onOp(m); continue; }
        if (!m || typeof m !== "object") continue;
        if (m.type === JT.JOIN) this.join(m);
        else if (m.type === JT.CHAT && typeof m.msg === "string" && this.cmd(m.msg.trim())) continue;
        else if (this.w.plugFirst("onJson", this, m)) continue;
        else if (m.type === JT.CHAT && typeof m.msg === "string" && m.msg.trim()[0] === "/") { const r = CA.parse(m.msg), g = r && CA.fuzzy(r.cmd, CA.NAMES); this.say(r && CA.helpFor(r.cmd) ? "Nothing called \"" + r.rest + "\". " + CA.usage(r.cmd) : "Unknown command /" + (r ? r.cmd : "") + (g ? ", did you mean /" + g + "?" : "") + " Type /help", "err"); }
        else if (m.type === JT.CHAT && typeof m.msg === "string") this.onChat(m.msg);
      }
      return;
    }
    for (const v of d.nums || []) this.onOp(v);
  }
  onOp(v) {
    {
      const code = (v & 255) ^ this.r, arg = Math.floor(v / 256);
      this.stats.ops[code] = (this.stats.ops[code] || 0) + 1;
      if (code === OP.ROT) {   // dead: every re-key gets one spectate camera a little later
        this.r ^= arg & 255;
        if (!this.alive && this.camId && this.camDue.length < 8) this.camDue.push(Date.now() + this.P.spectate_cam_delay_ms);
        return;
      }
      // touch joystick (mobile client, headless Android emulation): 11 start, 17 angle in mrad, 14 release
      if (code === 17) { if (arg < 7000) this.joy = arg / 1000; }
      else if (code === 14) this.joy = null;
      else if (code === OP.KEY) { const k = arg & 255, down = (arg >> 8) & 1; if (k === 5) this.keys.clear(); else if (down) this.keys.add(k); else this.keys.delete(k); }
      else if (code === OP.AIM) { if (arg < 7000) this.aim = arg / 1000; }
      else if (code === OP.ATTACK) {
        // low 3 bits (headless repro): 1 press, 2 auto attack on (E), 4 auto attack off (E again, no angle), 0 release
        const fl = arg & 7;
        if (arg && fl !== 4 && this.P.attack_aim !== false) this.aim = ((arg >> 3) % 7000) / 1000;   // Pages build: off, the client's tamper sabotage swaps x / y in this angle after a few minutes (owner); the AIM op stays right
        this.attacking = arg !== 0 && fl !== 4;   // owner: turning auto attack off kept attacking until the next click
        if (this.attacking && !this.usable()) this.clicked = true;   // owner: a quick click (down and up inside one tick) still swings once (saddle mount / dismount)
        if (this.attacking && this.usable()) this.useItem();
      } else if (code === OP.SELECT) {
        const it = this.w.ctx.ITEMS[arg];
        if (it && !this.w.canHold(this, arg)) return;
        const cur = this.w.ctx.ITEMS[this.held];
        if (!cur || !(cur.cat === CAT_FOOD || CAT_BUILD.has(cur.cat))) this.prevHeld = this.held;
        this.restoreAt = 0;
        this.held = it ? arg : 0; this.pending["8"] = this.held;
      } else if (code !== OP.HEARTBEAT) this.w.plugFirst("onOp", this, code, arg);
    }
  }
  onChat(msg) {
    const now = Date.now();
    if (!this.alive || now - this.lastChat < this.P.chat_min_ms) return;
    this.lastChat = now;
    msg = msg.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, "").trim().slice(0, this.P.chat_max_len);
    if (msg) this.w.chat(this, msg);
  }
  decodeName(c) {
    try {
      const s = decodeJoin(String(c || "").slice(0, 4000), this.w.ctx.join);
      if (!s) return null;
      const j = JSON.parse(s);
      // pi: the pets picked in the menu (species ids, the client trims them to the rank's slot count)
      this.potPick = Array.isArray(j.po) ? j.po.filter((x) => Number.isInteger(x) && x >= 0 && x < 400).slice(0, 3) : [];   // po: the potions picked in the menu
      this.petPick = Array.isArray(j.pi) ? j.pi.filter((x) => Number.isInteger(x) && x >= 0 && x < 400).slice(0, 3) : null;
      // owner: menu cosmetics (skin, accessory, walking particle) and the skin picked for each pet slot
      const ci = (v) => { v = +v; return Number.isInteger(v) && v >= 0 && v < 100000 ? v : 0; };
      this.cos = { sk: j.sk === undefined ? GOOFY.sk : ci(j.sk), ac: j.ac === undefined ? GOOFY.ac : ci(j.ac), pa: j.pa === undefined ? GOOFY.pa : ci(j.pa) };
      this.petSkinPick = Array.isArray(j.pi) && Array.isArray(j.ps) ? j.pi.slice(0, 3).map((sp, i) => [sp, ci(j.ps[i])]) : [];
      this.trinketRows = Array.isArray(j.pt) ? j.pt.slice(0, 3) : [];   // pt rows by team slot (potion pets inherit them)
      this.trinketPick = Array.isArray(j.pi) && Array.isArray(j.pt) ? j.pi.slice(0, 3).map((sp, i) => [sp, j.pt[i]]) : [];   // pt: trinkets per team slot
      this.petNamePick = Array.isArray(j.pi) && Array.isArray(j.pn) ? j.pi.slice(0, 3).map((sp, i) => [sp, typeof j.pn[i] === "string" ? j.pn[i] : ""]) : [];   // owner: menu pet names
      let nm = typeof j.name === "string" ? j.name : "";
      nm = nm.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, "").trim().slice(0, 16);
      return nm || null;
    } catch (e) { return null; }
  }
  join(msg) {
    if (this.alive) return;
    const P = this.P, W = this.w.ctx.WORLD, now = Date.now();
    const nm = this.decodeName(msg.c);
    this.name = nm || "player " + this.n;
    const first = !this.joined;
    // the static join values (31, 68, 58, 11, 86 from the world file + join_extra 66 / 44) on every join and respawn
    const owned = this.w.owned, extra = P.join_extra || [];
    const jv = P.join_values || {};
    const put = (m) => { if (!owned.has(m["1"])) this.queue(jv[m["1"]] ? Object.assign({}, m, jv[m["1"]]) : m); };
    for (const m of W.join) {
      if (m["1"] === T.OWN || m["1"] === T.INV) continue;
      if (m["1"] === T.TIMER) { this.queue(this.w.timerMsg(now)); continue; }
      if (m["1"] === T.MINIMAP && m.i) continue;
      for (const x of extra) if (x.before === m["1"]) put(x.m);
      put(m);
      for (const x of extra) if (x.after === m["1"]) put(x.m);
    }
    const fresh = this.freshNext;
    if (fresh) { this.freshNext = false; this.xp = 0; this.inv = Object.assign({}, P.start_inv); }   // after /reset
    if (!first && !fresh) {   // respawn: part of the XP and the stock carries over
      this.xp = Math.floor(this.xp * P.respawn_keep_xp + 1e-9);
      const inv = {};
      for (const [k, v] of Object.entries(this.inv)) {
        const fr = P.respawn_keep_inv[k] != null ? P.respawn_keep_inv[k] : 0;
        inv[k] = Math.max(P.start_inv[k] || 0, Math.floor(v * fr));
      }
      this.inv = inv;
    }
    const pa = P.potion_start_age || {}, age = Math.max(0, ...(this.potPick || []).map((id) => pa[id] || 0));
    if (age) this.xp = Math.max(this.xp, 20 * age * (age + 1) + 1);   // ageOf() inverse
    this.camId = 0; this.camDue = []; this.prevHeld = 0; this.restoreAt = 0; this.hot = null;
    this.sb = newSb(); this.ach = {}; this.killer = null; this.padUntil = {}; this.push = null; this.kb = null;
    this.mods = { speed: 1, dmg_taken: 1, gather_bonus: {}, regen_per_s: 0, xp_mult: 1, pad_immune: false }; this.kills = { players: 0, animals: 0 };
    this.joined = true; this.alive = true; this.joinedAt = now; this.hp = P.max_hp; this.held = 0;
    this.vx = this.vy = 0; this.glide = 99; this.keys.clear(); this.joy = null; this.attacking = false;
    this.shieldUntil = now + P.spawn_shield_ms;
    const sp = this.w.spawnPoint();
    this.ent = this.w.addEnt({ id: this.w.id(), kind: "player", x: sp.x, y: sp.y, p: this, cd: 0 });
    if (!this.firstSpawn) this.firstSpawn = { x: sp.x, y: sp.y };
    const sl = this.w.plugFn("starterList"), sp0 = sl ? sl.m.starterList(this)[0] : 0;   // the first pet card shows the picked species
    this.queue({ "1": T.MINIMAP, i: this.ent.id + 1, n: sp0, ag: 0, na: null, mi: 0, h: 0, s: 0 });
    this.vis.add(this.ent.id); this.queue(this.createFields());
    this.queue({ "1": T.OWN, id: this.ent.id * 256 + 2, s: false });
    this.queue({ "1": T.INV, i: Object.assign({}, this.inv) }); this.sentInv = Object.assign({}, this.inv);
    this.queue({ "1": T.XP, i: this.xp });
    this.ageAch();
    this.stream(now);
    this.queue({ "1": T.POTIONS, o: (this.potPick || []).slice() });   // the used-potion icons left of the Age bar ([] clears them)
    this.flush();
    this.say("[Server] Welcome to Offline #1! Type /help to see all commands. Press O for debug mode (hitboxes, map grid).", "sys");   // private, every join and respawn
    this.L({ k: "join", n: this.n, room: this.w.name, pid: this.ent.id, x: sp.x, y: sp.y, named: !!nm, pi: this.petPick, tk: this.trinketPick });
    if (P.announce_on_join) this.queue({ "1": T.ANNOUNCE, m: String(P.announce_on_join).slice(0, 200), o: P.announce_ms, i: P.announce_color });
    this.w.plug(first ? "onJoin" : "onRespawn", this);
  }
  // ------------------------------------------------------------ simulation
  // still inside a gap the squeeze opened (the normal hitbox would overlap a solid): the squeeze holds until he is out
  tight() {
    const P = this.P, e = this.ent, S = [];
    for (const o of this.w.solidsNear(e.x, e.y, [])) if (o.cd && o !== e && o.ghostFor !== e && (o.kind === "static" || o.kind === "placed")) { const q = this.w.playerShape(o, 1 - P.player_hit_k); q.cd -= 0.5; S.push(q); }
    const [x, y] = this.w.playerSolve(e.x, e.y, S, e);
    return Math.hypot(x - e.x, y - e.y) > 0.01;
  }
  speedFactor() {
    const P = this.P, it = this.w.ctx.ITEMS[this.held];
    if (!it || this.held === 0) return 1;
    if (CAT_BUILD.has(it.cat)) return P.speed_build;   // owner: holding a building item (spike, wall, ...) never slows the player
    if (P.blast && this.held === P.blast.item && P.blast.speed != null) return P.blast.speed;
    if (P.speed_by_item[it.name] != null) return P.speed_by_item[it.name];
    if (P.client[it.name] && P.client[it.name].speed != null) return P.client[it.name].speed / 100;
    if (P.wiki_speed && P.wiki_speed[it.name] != null) return P.wiki_speed[it.name];
    if (it.cat === CAT_FOOD) return P.speed_food;
    for (const [pat, f] of P.speed_by_pattern) if (it.icon && it.icon.indexOf(pat) >= 0) return f;
    return 1;
  }
  physics(dt, sub) {
    const P = this.P, e = this.ent;
    let ix = 0, iy = 0;
    for (const k of this.keys) { const d = KEYDIR[k]; if (d) { ix += d[0]; iy += d[1]; } }
    if (this.joy != null && this.alive) { ix += Math.cos(this.joy); iy += Math.sin(this.joy); }
    const m = Math.hypot(ix, iy);
    this.moving = m > 0;
    if (m > 0) {
      const sp = P.walk_speed * this.speedFactor() * (this.mods ? this.mods.speed : 1) * (this.foodBuff && this.foodBuff.speed && Date.now() < this.foodBuff.until ? this.foodBuff.speed : 1) * (this.slowUntil && Date.now() < this.slowUntil && !(this.mods && this.mods.status_immune) ? (this.slowFactor || 1) : 1) * (this.mods && this.mods.net_speed && /bug-net/.test((this.w.ctx.ITEMS[this.held] || {}).icon || "") ? this.mods.net_speed : 1);
      const it0 = this.held ? this.w.ctx.ITEMS[this.held] : null, sf = P.start_fraction_by_item[it0 ? it0.name : "Hand"];
      const frac = this.wasMoving ? 1 : sf != null ? sf : P.start_fraction;
      this.vx = ix / m * sp * frac; this.vy = iy / m * sp * frac; this.cruise = sp;
      this.dirx = ix / m; this.diry = iy / m; this.glide = 0;
      if (sub === P.substeps - 1) this.wasMoving = true;
    } else {
      this.wasMoving = false;
      const g = P.stop_glide[Math.min(this.glide, P.stop_glide.length - 1)] || 0;
      this.vx = (this.dirx || 0) * this.cruise * g; this.vy = (this.diry || 0) * this.cruise * g;
      if (sub === P.substeps - 1 && this.glide < 99) this.glide++;
    }
    let ex = 0, ey = 0;   // pad push and knockback ride on top of walking
    const tick = 1000 / P.send_ms;
    if (this.push) { ex += this.push.dx * this.push.u * tick; ey += this.push.dy * this.push.u * tick; }
    if (this.kb) { ex += this.kb.vx; ey += this.kb.vy; }
    if (sub === P.substeps - 1) {
      if (this.push) { const q = this.push; q.i++; q.u = q.i < P.pad_profile.length ? P.pad_profile[q.i] : q.u * P.pad_decay; if (q.u < 3) this.push = null; }
      if (this.kb) { this.kb.vx *= P.knockback_decay; this.kb.vy *= P.knockback_decay; if (Math.hypot(this.kb.vx, this.kb.vy) < 30) this.kb = null; }
    }
    // owner (real taming): the squeeze grows with speed: walking move_squeeze, a pad launch up to speed_squeeze_max, so a
    // boosted player rams into a spike gap walking cannot enter and stays wedged there (squeeze kept while tight)
    const spd = Math.hypot(this.vx + ex, this.vy + ey);
    this.mvSq = this.moving || ex || ey ? Math.min(P.speed_squeeze_max || P.move_squeeze || 0, Math.max(this.moving ? P.move_squeeze || 0 : 0, (P.move_squeeze || 0) * spd / P.walk_speed)) : 0;
    if (this.vx || this.vy || ex || ey) {
      const want = Math.hypot((this.vx + ex) * dt, (this.vy + ey) * dt), x0 = e.x, y0 = e.y;
      const [nx, ny] = this.w.collide(e.x + (this.vx + ex) * dt, e.y + (this.vy + ey) * dt, null, e);
      const pad = -6 - P.player_radius * ((P.player_hit_k ? 1 - P.player_hit_k : 0) + Math.max(this.squeeze || 0, this.mvSq || 0));   // the overlap the smaller hitbox allows
      if (!this.w.blocked(nx, ny, pad, e) || this.w.blocked(e.x, e.y, pad, e)) { e.x = nx; e.y = ny; }   // a squeeze that still overlaps a solid by > 6 is no move
      // owner: walking but barely moving (pressed into solids) -> hitbox squeezes a little more each substep
      const got = Math.hypot(e.x - x0, e.y - y0);
      if (this.mvSq > (P.move_squeeze || 0) && this.tight()) this.squeeze = Math.max(this.squeeze || 0, this.mvSq);   // rammed in at speed: stays wedged
      if (P.squeeze_max && want > 0.5 && got < want * 0.35 && !ex && !ey) this.squeeze = Math.max(this.squeeze || 0, Math.min(P.squeeze_max, (this.squeeze || 0) + P.squeeze_step));   // grows while pressing (never lowers a rammed-in squeeze); squeezeFor caps it per solid
      else if (this.squeeze && !this.tight()) this.squeeze = Math.max(0, this.squeeze - P.squeeze_relax);
    } else if (this.squeeze && !this.tight()) this.squeeze = Math.max(0, this.squeeze - P.squeeze_relax);
    if (P.move_squeeze && !this.moving && !this.squeeze && this.tight()) { const [nx, ny] = this.w.collide0(e.x, e.y, null, e); e.x = nx; e.y = ny; }   // stopped: back to full size
    if (this.easeOut) {   // owner: slide out of a wall / spike placed on top of him, a little per substep
      const b = this.easeOut, dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy);
      if (!this.w.ents.has(b.id) || b.dying || d >= b.cd || b.ghostFor !== e) this.easeOut = null;
      else {
        const ux = d > 0.01 ? dx / d : Math.cos(this.aim + Math.PI), uy = d > 0.01 ? dy / d : Math.sin(this.aim + Math.PI), s = Math.min(Math.max(P.ease_out_step || 0.5, (b.cd - d) * (P.ease_out_frac || 0)), b.cd - d);
        const [nx, ny] = this.w.collide(e.x + ux * s, e.y + uy * s, null, e); e.x = nx; e.y = ny;
      }
    }
    if (this.fart) {   // /fart: fart_v decaying with fart_tau for fart_ms, moved in short steps so walls still stop it
      const t = (Date.now() - this.fart.t0) / 1000;
      if (t > P.fart_ms / 1000 || !this.alive) this.fart = null;
      else for (let s = P.fart_v * Math.exp(-t / P.fart_tau) * dt; s > 0; s -= 40) {
        const d = Math.min(s, 40), [nx, ny] = this.w.collide(e.x + this.fart.dx * d, e.y + this.fart.dy * d);
        e.x = nx; e.y = ny;
      }
    }
  }
  update(now) {
    const P = this.P;
    if (!this.alive) {
      if (this.deadAt && now - this.deadAt >= P.death_screen_ms) this.afterDeath(now);
      else while (this.camDue.length && now >= this.camDue[0]) { this.camDue.shift(); this.queue({ "1": T.OWN, id: this.camId, s: true }); }
      return;
    }
    const e = this.ent, f = {};
    const rx = Math.round(e.x), ry = Math.round(e.y);
    if (rx !== e.sx || ry !== e.sy) { f["3"] = rx; f["4"] = ry; e.sx = rx; e.sy = ry; }
    const a = ang255(this.aim); if (a !== e.sa) { f["5"] = a; e.sa = a; }
    if (this.mods && this.mods.regen_per_s > 0 && this.hp < P.max_hp && now - (this.lastRegen || 0) >= 1000) {
      this.lastRegen = now; this.hp = Math.min(P.max_hp, this.hp + this.mods.regen_per_s); this.pending["12"] = Math.round(this.hp);
    }
    if (this.restoreAt && now >= this.restoreAt) { this.restoreAt = 0; this.setHeld(this.prevHeld); }
    if (this.hot && now >= this.hot.next) {   // heal over time after eating
      const h = this.hot, before = this.hp;
      this.hp = Math.min(P.max_hp, this.hp + h.per);
      if (this.hp > before) { this.pending["11"] = Math.round(this.hp - before); this.pending["12"] = Math.round(this.hp); }
      h.next += P.heal_tick_ms; if (--h.left <= 0) this.hot = null;
    }
    Object.assign(f, this.pending); this.pending = {};
    const ench = this.enchantStage(), hi = this.held && this.w.ctx.ITEMS[this.held], hic = (hi && hi.icon) || "";
    const rap = !ench && this.raptorUntil > now && /dagger/.test(hic) && !/mantis/.test(hic) ? this.raptorLvl || 1 : 0;   // boss mantis skill
    const shown = ench ? P.enchant.items[ench - 1] : rap ? P.raptor_items[rap - 1] : 0;
    if (shown !== (this.shownHeld || 0) || (shown && "8" in f)) { this.shownHeld = shown; f["8"] = shown || this.held; }
    if (P.place_hold && this.attacking && this.usable() && CAT_BUILD.has((this.w.ctx.ITEMS[this.held] || {}).cat)) this.useItem();   // owner: hold to spam-place, no delay (overlap check unchanged)
    if (this.attacking && !this.restoreAt && (this.w.ctx.ITEMS[this.held] || {}).cat === CAT_FOOD) this.useItem();   // owner (real taming): auto attack on, picking food eats it, then back to the weapon still attacking
    if ((this.attacking || this.clicked) && !this.usable()) {
      const it = this.w.ctx.ITEMS[this.held], nm = this.held && it ? it.name : "Hand", R = P.ranged[nm], B = P.blast && this.held && this.held === P.blast.item ? P.blast : null;
      const ST = !B && !R && P.staffs && P.staffs.items[this.held];   // invented fairy staff (staffCast)
      const period = B ? B.ms : R ? R.ms : ST ? ST.ms : P.swing_ms_by_item[nm] != null ? P.swing_ms_by_item[nm] : ((it && it.reload) || 500) + P.swing_extra_ms;
      if (now - this.lastSwing >= period) {
        this.lastSwing = now - this.lastSwing < 2 * period ? this.lastSwing + period : now; this.clicked = false;   // keep the cadence across 94 ms ticks (ranged 125 ms -> 8 shots/s, not 5; owner: melee too, Golden Cleavers 499 swung every 575, Stone Sword 882 every 958)
        f["15"] = P.f15_by_item[nm] != null ? P.f15_by_item[nm] : this.held === 0 ? 300 : 500;
        if (B) this.blast(B); else if (R) { if (!this.shoot(now, it, R)) delete f["15"]; } else if (ST) { if (!this.staffCast(it, ST)) delete f["15"]; } else { this.swing(now); if (ench) this.enchantShot(now, ench); }
      }
    }
    if (Object.keys(f).length) this.w.touch(e, f);
    if (this.w.tickN % P.minimap_ticks === 0) {   // one pair per pet card, like the real server (p: [] with no pets)
      const pl = this.w.plugFn("minimapPets"), L = pl ? pl.m.minimapPets(this.w, this) : [e], p = [];
      for (const q of L) p.push(Math.round(q.x / P.minimap_div), Math.round(q.y / P.minimap_div));
      this.queue({ "1": T.MINIMAP, p });
    }
  }
  // src: the hitting entity (player or creature): knockback away from it
  hurt(dmg, by, cause, src) {
    if (!this.alive || this.god || this.noDmg) return;   // /god: no damage
    if (by && by !== this && this.w.sameTeam(by, this)) return;   // no friendly fire
    const now = Date.now(), P = this.P;
    if (now < this.shieldUntil) return;
    dmg *= this.mods ? this.mods.dmg_taken : 1;
    if (this.foodBuff && this.foodBuff.def && now < this.foodBuff.until) dmg *= this.foodBuff.def;   // defense buff food
    const tr = this.mods && this.mods.type_resist, tf = tr && src && src.sp != null && Object.keys(tr).length && this.w.plugFn("typesOf");
    if (tf) { let k = 1; for (const t of tf.m.typesOf(src.sp)) if (tr[t]) k = Math.min(k, tr[t]); dmg *= k; }   // capes: resistant to a type
    if (by instanceof Player && by.god && by !== this) dmg = Math.ceil(P.max_hp * P.admin_hit_frac);   // /admin: any hit takes half the max hp
    const s = src || (by && by.ent);
    if (s && s !== this.ent && P.knockback_peak && (s.kind === "player" || s.kind === "animal" || s.kind === "pet")) {
      // creatures: the recorded peak; players: scaled by the weapon's wiki knockback (100 = the recorded peak)
      let peak = P.knockback_peak;
      if (by instanceof Player && s === by.ent) { const it = this.w.ctx.ITEMS[by.held], c = P.client[by.held && it ? it.name : "Hand"], kb = c && c.knockback != null ? c.knockback : by.held && it ? P.wiki_knockback[it.name] : P.knockback_hand; peak *= (kb != null ? kb : P.knockback_hand) / 100 * ((by.mods && by.mods.kb_mult) || 1) * (P.knockback_pvp != null ? P.knockback_pvp : 1); }
      const a = Math.atan2(this.ent.y - s.y, this.ent.x - s.x), v = peak * 1000 / P.send_ms;
      if (v > 0) this.kb = { vx: Math.cos(a) * v, vy: Math.sin(a) * v };
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.w.touch(this.ent, { "10": Math.max(1, Math.round(dmg)), "12": Math.round(this.hp), "13": 1 });
    if (this.hp <= 0) this.die(now, by, cause);
  }
  die(now, by, cause) {
    this.killer = by && by !== this ? [1, by.name || ""] : [0];
    this.alive = false; this.deadAt = now; this.foodBuff = null; this.keys.clear(); this.joy = null; this.attacking = false;
    this.w.touch(this.ent, { "7": 16, "12": 0 });
    this.cam = { x: this.ent.x, y: this.ent.y };
    if (by && by !== this && by.alive) { by.kills.players++; by.sb.k++; by.addXp(Math.max(this.P.xp_player_kill_min, Math.floor(this.xp * this.P.xp_player_kill_frac)), "player_kill"); }
    this.L({ k: "death", n: this.n, room: this.w.name, by: by ? by.n : null, cause, xp: this.xp });
    this.w.plug("onDeath", this, by || null);
  }
  // capture order: scoreboard, camera on the own (dead) id in spectate mode, remove of the own entity
  scoreboard(now) {
    const P = this.P, sb = this.sb;
    return { k: this.kills.players, ga: sb.ga, t: now - (this.joinedAt || now), s: this.xp, p: [], re: ageOf(Math.floor(this.xp * P.respawn_keep_xp)),
      it: {}, sbk: this.killer || [0], sba: sb.sba, sbi: sb.sbi, sbb: sb.sbb, sbp: sb.sbp, sbf: sb.sbf, sbw: sb.sbw, sbs: sb.sbs, sbt: sb.sbt, sbu: sb.sbu };
  }
  afterDeath(now) {
    this.deadAt = 0;
    this.queue({ "1": T.DEATH, o: this.scoreboard(now) });
    const id = this.ent.id;
    this.camId = id * 256 + 2; this.camDue = [];
    this.queue({ "1": T.OWN, id: this.camId, s: true });
    this.ent = null;
    this.w.removeEnt(id);
    this.w.plug("afterDeath", this, id);
  }
  setHeld(id) { const it = this.w.ctx.ITEMS[id]; this.held = id && it && this.w.canHold(this, id) ? id : 0; this.pending["8"] = this.held; }
  placedTotal() { let n = 0; for (const v of Object.values(this.placedG)) n += v; return n; }
  // an own structure is gone (destroyed or decayed): placed_list remove and the lower group count
  unplaced(e) {
    const g = e.grp; this.placedG[g] = Math.max(0, (this.placedG[g] || 0) - 1);
    if (!this.god) { this.queue({ "1": T.PLACED, o: [[e.id]] }); this.queue({ "1": T.ITEMCOUNT, B: [e.item * 256 + this.placedG[g]] }); }
  }
  // private banner to this player only (atl4 52)
  // private reply: one chat-log line per line of text, seen only by this player; k / hl: panel kind and names (logChat)
  say(text, k, hl) { for (const t of String(text).split("\n")) if (t) this.w.logChat({ name: "", text: t.slice(0, 200), team: null, to: this.n, k: k || null, hl: hl || null }); }
  // -p <player> / @player of a parsed command (chatargs.parse): that player, this player when none, null (and why, in red) when unknown
  target(r) {
    if (!r || r.target == null) return this;
    const f = CA.findPlayer([...this.w.players.values()].filter((q) => q.joined), r.target);
    if (!f.p) this.say(f.err, "err");
    return f.p || null;
  }
  // chat commands (any player), never broadcast; one parser for all (chatargs.js); /spawn <creature|boss>, /pet, /versus,
  // /event, /hive, /restart, /cast, /clear and /spawnall fall through to creatures.js, /spawn <insect> to insects.js
  cmd(t) {
    const r = CA.parse(t); if (!r) return false;
    const c = r.cmd, a = r.args, w = this.w, P = this.P, now = Date.now(), e = this.ent;
    const log = (ok) => this.L({ k: "cmd", n: this.n, cmd: c, args: (a.join(" ") + (r.target != null ? " -p " + r.target : "")).slice(0, 60), ok });
    const ok = (text, hl) => { this.say(text, "ok", hl); log(true); return true; };
    const bad = (text) => { this.say(text, "err"); log(false); return true; };
    const use = () => bad(CA.usage(c));
    const BIOMES = { forest: 0, plain: 0, plains: 0, snow: 1, winter: 1, dark: 2, darkness: 2, desert: 3, sea: 4, ocean: 4, volcanic: 5, volcano: 5 };
    const BNAME = ["forest", "snow", "dark", "desert", "sea", "volcanic"];
    const RES = { food: 0, wood: 1, stone: 2, gold: 3 };
    const AGE = (L) => 20 * L * (L + 1) + 1;
    const named = (q) => q.name || "player " + q.n;
    const you = (q) => q === this ? "you" : named(q);
    const onOff = (cur, s) => { s = (s || "").toLowerCase(); return s === "on" || s === "1" || s === "true" ? true : s === "off" || s === "0" || s === "false" ? false : !cur; };
    // a teleport re-creates the player on every client that sees it: the client glides its own player (and so the camera)
    // toward a far position at walking speed, which left the view seconds behind the server (debug circles off the art)
    const moveTo = (q, x, y) => {
      const qe = q.ent; if (!qe) return;
      qe.x = Math.max(P.map_min, Math.min(P.map_max, +x)); qe.y = Math.max(P.map_min, Math.min(P.map_max, +y)); q.vx = q.vy = 0; q.kb = q.push = null;
      for (const o of w.players.values()) {
        if (!o.vis || !o.vis.has(qe.id)) continue;
        o.queue({ "1": T.REMOVE, "0": qe.id });
        o.queue(o === q ? q.createFields() : w.createMsg(qe));
        if (o === q) o.queue({ "1": T.OWN, id: qe.id * 256 + 2, s: false });
      }
    };
    const TARGETED = new Set(["tp", "teleport", "speed", "admin", "god", "ungod", "give", "take", "age", "heal", "easy", "kill", "die", "kick", "pet", "versus", "fart"]);
    if (r.target != null && !TARGETED.has(c) && CA.helpFor(c)) return bad("/" + c + " does not take -p");
    switch (c) {
      case "version": return ok("Clone " + (process.env.TIO_VER_TEXT || "dev"));
      case "help": case "commands": case "h": case "?": {
        if (a[0]) { const h = CA.helpOne(a[0]); if (!h) return bad("No command /" + a[0].replace(/^\//, "") + ", type /help for the list"); this.say(h.join("\n"), "help"); log(true); return true; }
        const L = CA.helpList();
        if (process.env.TIO_BOSS_PETS !== "0") L.splice(L.indexOf("# Clan and totem"), 0, "Stormhorn (boss pet): orbits you and chain-zaps up to 3 enemies; ultimate Tempest Crown zaps everything near it for 4 s",
          "Cinder Prowler (boss pet): dashes at the nearest enemy, falls back to you when hurt; ultimate Ashen Snare slows and burns enemies for 5 s");
        this.say(L.join("\n"), "help"); log(true); return true;
      }
      case "who": case "players": case "list": {
        const L = [...w.players.values()].filter((q) => q.joined);
        this.say("Players online (" + L.length + "): " + L.map((q) => named(q) + " #" + q.n + (q.alive ? "" : " (dead)") + (q.god ? " (admin)" : "")).join(", "), "reply", L.map(named)); log(true); return true;
      }
      case "next": case "prev": case "previous": w.cmdNext(this, c === "next" ? 1 : -1); log(true); return true;
      case "reset": {
        if (now - (w.lastReset || 0) < 10000) return bad("Reset is on cooldown (10 s)");
        w.lastReset = now; this.L({ k: "cmd_reset", n: this.n, phase: w.phase }); w.noDecay = true;
        for (const x of [...w.ents.values()]) if (x.kind === "placed" || x.kind === "static") w.removeEnt(x.id);
        w.spawnPhase(w.phase, false);
        w.plug("onReset");
        for (const q of w.players.values()) {
          if (!q.joined) continue;
          q.god = false; q.noDmg = false; q.easy = false; q.freshNext = true; q.placedG = {}; if (q.mods) q.mods.speed = 1;
          if (q.alive && q.ent) q.die(now, null, "reset");
          q.say("The server was reset: press Play to start fresh", "warn");
        }
        return true;
      }
      case "totem": {
        const t = this.team(), e = this.ent;
        let best = null, bd = 400;
        for (const o of w.ents.values()) if (o.kind === "static" && o.clan != null && o.clan === t && e) { const q = Math.hypot(o.x - e.x, o.y - e.y); if (q < bd) { bd = q; best = o; } }
        if (!best) return bad("Stand next to a totem your clan owns (break a totem while in a clan to capture it)");
        const sub = (a[0] || "").toLowerCase();
        if (sub === "shop" || sub === "buy") {   // wiki Totem shop (P.totem.shop)
          const SH = this.P.totem.shop, lv = best.level, what = (a[1] || "").toLowerCase();
          if (sub === "shop" || !SH[what]) { this.say("Totem shop (level " + lv + "): " + Object.entries(SH).map(([k, v]) => k + (k === "mask" ? "" : " chest " + v[1] + " golden apples") + (lv >= v[0] ? "" : " (level " + v[0] + ")")).join(", ") + ". /totem buy <wood|stone|food|mask>", sub === "buy" ? "err" : "reply"); log(sub === "shop"); return true; }
          if (lv < SH[what][0]) return bad("The totem needs level " + SH[what][0] + " for that");
          if (now < (this.shopAt || 0)) return bad("Wait a few seconds before buying again");
          this.shopAt = now + this.P.totem.shop_ms;
          if (what !== "mask") { this.gain({ [SH[what][2]]: 500 }); return ok("+500 " + what); }
          const kinds = [[2, "untamed"], [3, "baby"], [4, "adult"], [6, "boss"]].filter((k) => lv >= k[0]), pick = kinds[Math.floor(Math.random() * kinds.length)][1];
          const tm = w.plugFn("totemMask"); if (tm) tm.m.totemMask(w, this, best, pick, this.P.totem.masks);
          log(true); return true;
        }
        if (sub) return use();
        if (best.level >= 6) return bad("This totem is at the top level (6)");
        w.totemLevel(best, best.level + 1); this.say("Totem level " + best.level + ": " + this.P.totem.gold_per_min[best.level] + " gold and " + (this.P.totem.points_per_min || [])[best.level] + " totem points a minute to your clan (" + ((w.clanPoints && w.clanPoints.get(t)) || 0) + " points so far)" + (this.P.totem.curse && this.P.totem.curse[best.level] ? ", curses the nearest enemy for " + Math.round(this.P.totem.curse[best.level] * 100) + " % of their life" : ""), "ok");
        log(true); return true;
      }
      case "easy": {
        const q = this.target(r); if (!q) { log(false); return true; }
        q.easy = onOff(q.easy, a[0]);
        if (q.easy) w.plug("onEasy", q);   // pets jump to max level (creatures.js)
        if (q !== this) q.say("Easy mode " + (q.easy ? "on" : "off") + " (by " + named(this) + ")", "admin");
        return ok("Easy mode " + (q.easy ? "on" : "off") + " for " + you(q), [named(q)]);
      }
      case "nodecay": case "dodecay":
        w.noDecay = c === "nodecay";
        w.logChat({ name: "", text: "Building decay " + (w.noDecay ? "off" : "on") + " (" + named(this) + ")", team: null, to: null });
        log(true); return true;
      case "die": case "kill": case "slay": {
        if (c === "die" && a.length && r.target == null) return use();
        const q = r.target != null ? this.target(r) : a.length ? this.target({ target: a.join(" ") }) : this;
        if (!q) { log(false); return true; }
        if (!q.alive || !q.ent) return bad(q === this ? "You are already dead" : named(q) + " is dead already");
        this.L({ k: "cmd_die", n: this.n, who: q.n });
        q.die(now, q === this ? null : this, "command");
        if (q === this) { log(true); return true; }
        q.say("Killed by " + named(this) + " (/kill)", "warn");
        return ok("Killed " + named(q), [named(q)]);
      }
      case "admin": {
        const q = this.target(r); if (!q) { log(false); return true; }
        q.god = onOff(q.god, a[0]);
        if (q.god && q.xp < AGE(67)) q.addXp(AGE(67) - q.xp, "admin");   // owner: /admin gives age 67
        if (q.god) { for (const k of [0, 1, 2, 3]) q.inv[k] = 9999999999; q.sendInv(); }
        q.say(q.god ? "Admin on" + (q === this ? "" : " (by " + named(this) + ")") : "Admin off" + (q === this ? "" : " (by " + named(this) + ")"), "admin");
        if (q !== this) this.say("Admin " + (q.god ? "on" : "off") + " for " + named(q), "admin", [named(q)]);
        this.L({ k: "cmd_admin", n: this.n, who: q.n, god: q.god }); return true;
      }
      case "god": case "ungod": {
        const q = this.target(r); if (!q) { log(false); return true; }
        q.noDmg = c === "ungod" ? false : onOff(q.noDmg, a[0]);
        if (q !== this) q.say("God mode " + (q.noDmg ? "on" : "off") + " (by " + named(this) + ")", "admin");
        return ok("God mode " + (q.noDmg ? "on: no damage" : "off") + " for " + you(q), [named(q)]);
      }
      case "biome": case "season": {
        const b = BIOMES[(a[0] || "").toLowerCase()];
        if (b == null) return use();
        if (b !== w.phase) w.switchPhase(now, 1, b);
        return ok("Biome: " + BNAME[b]);
      }
      case "boss": {   // the forest's Grove Colossus comes to you; elsewhere: teleport next to the world boss
        if (!e) return bad("You are dead");
        const bp = w.plugFn("bossToPlayer"); if (bp && bp.m.bossToPlayer(w, this)) return ok("The boss is coming");
        const b = w.boss; if (!b || b.x == null) return bad("No world boss right now");
        const [nx, ny] = w.collide(b.x + 260, b.y, null, e); moveTo(this, nx, ny); return ok("Teleported to the world boss");
      }
      case "tp": case "teleport": {
        const q = this.target(r); if (!q) { log(false); return true; }
        if (!q.ent) return bad(q === this ? "You are dead" : named(q) + " is dead");
        const qe = q.ent, s = (a[0] || "").toLowerCase(), who = q === this ? "" : named(q) + " ";
        if (!a.length) return use();
        const xs = a.map((v) => v.replace(/,$/, "")).filter((v) => v !== ""), x = CA.num(xs[0]), y = CA.num(xs[1]);
        if (xs.length === 2 && x != null && y != null) { moveTo(q, x, y); return ok("Teleported " + (who || "you ") + "to " + Math.round(qe.x) + " " + Math.round(qe.y), who ? [named(q)] : null); }
        if (s === "spawn" || s === "home") { const sp = q.firstSpawn || w.spawnPoint(); moveTo(q, sp.x, sp.y); return ok("Teleported " + (who || "you ") + "to spawn"); }
        if (s === "boss") {
          const b = w.boss; if (!b || b.x == null) return bad("No world boss right now (try /boss)");
          const [nx, ny] = w.collide(b.x + 260, b.y, null, qe); moveTo(q, nx, ny); return ok("Teleported " + (who || "you ") + "to the world boss");
        }
        if (s === "bug" || s === "insect") {   // next to the nearest insect, facing it (insects.js tests)
          const B = w.ext.insects ? [...w.ext.insects.bugs].sort((u, v) => Math.hypot(u.x - qe.x, u.y - qe.y) - Math.hypot(v.x - qe.x, v.y - qe.y))[0] : null;
          if (!B) return bad("No insect in this biome (try /spawn insects)");
          moveTo(q, B.x - 70, B.y); return ok("Teleported " + (who || "you ") + "next to an insect");
        }
        if (BIOMES[s] != null && a.length === 1) { if (BIOMES[s] !== w.phase) w.switchPhase(now, 1, BIOMES[s]); return ok("Biome: " + BNAME[BIOMES[s]] + " (the whole map is one biome at a time)"); }
        const f = CA.findPlayer([...w.players.values()].filter((o) => o.joined), a.join(" "));
        if (!f.p) return bad(f.err + ". " + CA.usage(c));
        if (f.p === q) return bad("That is " + (q === this ? "you" : "the same player"));
        if (!f.p.ent) return bad(named(f.p) + " is dead");
        moveTo(q, f.p.ent.x + 60, f.p.ent.y); return ok("Teleported " + (who || "you ") + "to " + named(f.p), [named(f.p), named(q)]);
      }
      case "age": {
        const q = this.target(r); if (!q) { log(false); return true; }
        const s = (a[0] || "").toLowerCase(), v = s === "max" ? 67 : CA.num(s);
        if (v == null || a.length !== 1) return use();
        const L = Math.max(0, Math.min(67, Math.floor(v))), want = L ? AGE(L) : 0;
        if (want > q.xp) q.addXp(want - q.xp, "cmd"); else { q.xp = want; q.queue({ "1": T.XP, i: q.xp }); }
        return ok("Age " + L + " for " + you(q), [named(q)]);
      }
      case "heal": {
        const q = this.target(r); if (!q) { log(false); return true; }
        if (!q.alive || !q.ent) return bad(q === this ? "You are dead" : named(q) + " is dead");
        q.hp = P.max_hp; q.pending["12"] = Math.round(q.hp);
        return ok("Healed " + you(q), [named(q)]);
      }
      case "fart": {
        const q = this.target(r); if (!q) { log(false); return true; }
        if (!q.alive || !q.ent) return bad(q === this ? "You are dead" : named(q) + " is dead");
        if (now < (q.fartUntil || 0)) return bad("Fart recharging");
        q.fartUntil = now + P.fart_cd_ms;
        const qe = q.ent, dx = Math.cos(q.aim), dy = Math.sin(q.aim), fid = w.id(), fx = qe.x - dx * P.player_radius * 1.3, fy = qe.y - dy * P.player_radius * 1.3;
        q.fart = { dx, dy, t0: now };
        w.addEnt({ id: fid, kind: "effect", x: fx, y: fy, cd: 0, f: { "0": fid, "1": T.CREATE, "2": 4, "3": Math.round(fx), "4": Math.round(fy), "5": 0, "6": 1,
          "7": P.fart_fx, "8": 2, "9": 0, "10": qe.id, "11": qe.id } });
        w.after(P.fart_fx_ms, () => w.removeEnt(fid));
        q.onChat("*PFFFRRRT*");
        log(true); return true;
      }
      case "speed": {
        const q = this.target(r); if (!q) { log(false); return true; }
        const v = a[0] == null ? 1 : (a[0].toLowerCase() === "normal" || a[0].toLowerCase() === "reset") ? 1 : CA.num(a[0].replace(/^x/i, ""));
        if (v == null || a.length > 1) return use();
        const x = Math.max(0.1, Math.min(10, v)); q.mods.speed = x;
        return ok("Speed x" + x + " for " + you(q), [named(q)]);
      }
      case "kick": {
        const spec = r.target != null ? r.target : a.join(" ");
        if (!spec) return use();
        const q = this.target({ target: spec }); if (!q) { log(false); return true; }
        if (q === this) return bad("You can't kick yourself");
        const nm = named(q); q.kill("kicked"); return ok("Kicked " + nm, [nm]);
      }
      case "give": case "take": {
        const q = this.target(r); if (!q) { log(false); return true; }
        if (!a.length) return use();
        // resource and amount in either order: /give food 1000, /give 1k food, /give food (1,000), /take gold all
        const lo = a.map((x) => x.toLowerCase()), RN = Object.keys(RES), all = lo.includes("all") || lo.includes("max");
        const nums = lo.map(CA.num).filter((v) => v != null), words = lo.filter((x) => CA.num(x) == null && x !== "all" && x !== "max");
        const res = words.length === 1 ? (RES[words[0]] != null ? words[0] : RN.find((k) => k.startsWith(words[0]) && words[0].length >= 2) || (words[0] === "resources" || words[0] === "everything" ? "all" : null)) : null;
        if (res && nums.length <= 1) {
          const n = all ? 9999999999 : nums.length ? Math.floor(nums[0]) : 1000;
          if (!(n > 0)) return bad("The amount must be above 0");
          const keys = res === "all" ? RN : [res], got = {};
          for (const k of keys) {
            const i = RES[k], cur = q.inv[i] || 0;
            q.inv[i] = c === "take" ? Math.max(0, cur - n) : Math.min(9999999999, cur + n); got[k] = Math.abs(q.inv[i] - cur);
          }
          q.sendInv();
          const what = keys.map((k) => CA.fmt(got[k]) + " " + k).join(", ");
          if (q !== this) q.say((c === "take" ? named(this) + " took " : named(this) + " gave you ") + what, "ok", [named(this)]);
          const capped = c === "give" && keys.every((k) => (q.inv[RES[k]] || 0) >= 9999999999);
          return ok((c === "take" ? "Took " + what + " from " : "Gave ") + (c === "take" ? you(q) : you(q) + " " + what) + (capped ? " (at the 9,999,999,999 cap: /admin fills it)" : ""), [named(q)]);
        }
        if (c === "take") return use();
        // an item into the hand: id, exact name, then a close name
        const ITEMS = w.ctx.ITEMS, name = a.filter((x) => !(nums.length === 1 && CA.num(x) != null && a.length > 1)).join(" ");
        const byName = {}; for (const k of Object.keys(ITEMS)) if (ITEMS[k].name) byName[ITEMS[k].name] = k;
        const id = ITEMS[name] ? name : byName[CA.fuzzy(name, Object.keys(byName))];
        if (id == null) return bad("No resource or item \"" + name + "\". " + CA.usage(c));
        if (!q.alive || !q.ent) return bad(q === this ? "You are dead" : named(q) + " is dead");
        const was = q.god; q.god = true; q.setHeld(+id); q.god = was;
        if (q !== this) q.say(named(this) + " gave you " + ITEMS[id].name, "ok", [named(this)]);
        return ok("Gave " + you(q) + " " + ITEMS[id].name + " (in hand)", [named(q)]);
      }
      case "spawn": {
        const lo = a.map((x) => x.toLowerCase()), what = lo[0] || "";
        if (!what) return use();
        const fam = lo[1] && CA.num(lo[1]) == null ? null : { majestic: "golden-flower-bush", trinket: "seeds-plant", gift: "gift" }[what];   // "majestic butterfly": insects.js
        if (!fam) return false;   // creature or boss: creatures.js
        if (!e) return bad("You are dead");
        const n = Math.max(1, Math.min(30, Math.floor(CA.num(lo[1]) || 1)));
        const NAMES = w.ctx.NAMES, kind = what === "majestic" || what === "trinket" ? what : null;
        const list = kind ? [TRK.bushName(kind, w.phase)] : NAMES.filter((x) => x && x.indexOf(fam) >= 0);   // the current biome's bush
        if (!list.length) return bad("No " + what + " defs");
        for (let i = 0; i < n; i++) {
          const ang = i * 2.4, d = 220 + (i % 5) * 90, nm = list[i % list.length];
          const x = Math.round(e.x + Math.cos(ang) * d), y = Math.round(e.y + Math.sin(ang) * d);
          const o = w.objFromRec({ "0": 0, "1": T.CREATE, "2": 3, "3": x, "4": y, "5": 628, "6": 1, "13": NAMES.indexOf(nm), name: nm }, w.phase, "spawn");
          if (o) o.rec = null;
        }
        return ok("Spawned " + n + " " + what + (n > 1 && what !== "majestic" ? "s" : "") + (kind ? " bush" + (n > 1 ? "es" : "") : ""));
      }
    }
    return false;
  }
  // achievement 44 {o: 2, n: "0"} "A New Adventure" once per life when the life reaches age 1 (sp5 t 57 s; respawn frames)
  ageAch() { if (!this.P.achievements_done && !this.ach["0"] && ageOf(this.xp) >= 1) { this.ach["0"] = 1; this.queue({ "1": T.ACH, o: 2, n: "0" }); } }
  addXp(n, why) {
    if (!n) return;
    n = Math.round(n * (this.mods && this.mods.xp_mult != null ? this.mods.xp_mult : 1));
    if (this.easy && why !== "admin" && why !== "cmd") n *= 10;   // /easy: 10x XP
    this.xp += n;
    this.queue({ "1": T.XP, i: this.xp });
    if (this.ach) this.ageAch();
  }
  gain(add) {
    for (const [k, v] of Object.entries(add)) this.inv[k] = (this.inv[k] || 0) + v;
    this.sendInv();
  }
  // sp5: after the join frame the inventory message carries only the changed slots (rows 22914, 22966, 31201, 31224);
  // slot 4 (golden apples) is a one-shot award the client pops as "+n" whenever the key is present, so it is sent
  // once and not kept (a full inventory with 4:2 in every update made the client pop "2 gapple" on every hit)
  sendInv() {
    const d = {}, sent = this.sentInv || {};
    for (const [k, v] of Object.entries(this.inv)) if (sent[k] !== v) d[k] = v;
    if (!Object.keys(d).length) return;
    this.queue({ "1": T.INV, i: d });
    this.sentInv = Object.assign({}, this.inv);
    if (this.inv[4]) { this.inv[4] = 0; this.sentInv[4] = 0; }
  }
  // Rogue's Hood: each hit on a player takes up to n of his food and gold
  steal(q, n) {
    if (!q || q === this || q.god) return;
    let got = false;
    for (const r of [0, 3]) { const k = Math.min(n, q.inv[r] || 0); if (k > 0) { q.inv[r] -= k; this.inv[r] = (this.inv[r] || 0) + k; got = true; } }
    if (got) { q.sendInv(); this.sendInv(); }
  }
  usable() { const it = this.w.ctx.ITEMS[this.held]; return !!it && (it.cat === CAT_FOOD || CAT_BUILD.has(it.cat)); }
  // ranged weapons the capture fired: each shot pays the item cost, own {15}, a cat-2 muzzle effect {7: fx}, then hits the
  // first player or creature on the line within range (damage from the wiki)
  shoot(now, it, R) {
    const P = this.P, e = this.ent;
    if (!this.canPay(it.cost)) return false;
    this.pay(it.cost); this.sendInv();
    let best = null, bd = R.range;
    for (const o of this.w.ents.values()) {
      if (o === e || !(o.kind === "player" ? o.p.alive : o.kind === "animal" || o.kind === "pet")) continue;
      const dx = o.x - e.x, dy = o.y - e.y, along = dx * Math.cos(this.aim) + dy * Math.sin(this.aim);
      if (along <= 0 || along > bd) continue;
      const off = Math.abs(-dx * Math.sin(this.aim) + dy * Math.cos(this.aim));
      if (off > (o.kind === "player" ? P.player_radius : o.r || P.animal_radius)) continue;
      bd = along; best = o;
    }
    // owner: the shot stops at the first solid on its line (same shapes as collision); a building in the way takes it
    let wall = null, wd = bd;
    for (const o of this.w.solidsNear(e.x + Math.cos(this.aim) * bd / 2, e.y + Math.sin(this.aim) * bd / 2, [])) {
      if (!o.cd || o.dying || (o.kind !== "static" && o.kind !== "placed") || o.ghostFor === e) continue;
      for (let t = 0; t <= wd; t += 20) {
        const x = e.x + Math.cos(this.aim) * t, y = e.y + Math.sin(this.aim) * t, c = this.w.coreOf(o, x, y);
        if (Math.hypot(c[0] - x, c[1] - y) < Math.max(10, o.cd - P.player_radius)) { if (t > P.player_radius) { wd = t; wall = o; } break; }
      }
    }
    if (wall) { best = null; if (wall.kind === "placed") { const d = this.w.plugHit(this, wall, this.damage("player")); if (d > 0) this.w.hurtPlaced(wall, d, this, ang255(this.aim)); }
      else if (P.shot_gather && this.resourceOf(wall.name) && !/gold/i.test(wall.name || "") && !wall.hiveHit) { const r = this.w.hitResource(wall, this, ang255(this.aim)); if (r !== "open") this.payGather(this.gatherYield(wall.name, true)); } }   // owner: shots gather from trees, stones, bushes, logs like a hit
    // the projectile flies out from the muzzle at proj_speed (moved each tick like flyFx) and vanishes where the shot stops
    const r0 = P.player_radius * 1.6, mx = e.x + Math.cos(this.aim) * r0, my = e.y + Math.sin(this.aim) * r0, id = this.w.id(), sp = R.speed || P.proj_speed;
    const pe = { id, kind: "effect", x: mx, y: my, cd: 0, vx: Math.cos(this.aim) * sp, vy: Math.sin(this.aim) * sp, until: now + Math.max(P.fx_ms, (Math.min(bd, wd) - r0) / sp * 1000),
      f: { "0": id, "1": T.CREATE, "2": 2, "5": Math.round(((this.aim % TAU) + TAU) % TAU * 100), "6": 1, "7": R.fx } };
    pe.create = () => Object.assign({}, pe.f, { "3": Math.round(pe.x), "4": Math.round(pe.y) });
    this.w.addEnt(pe); this.w.flying.add(pe);
    // Appletor apples heal (wiki: players 10 / 20, animals and pets 20 / 40); a wild creature goes through creatures.js onHit
    // (heal + tame chance)
    const H = P.appletor_heal && P.appletor_heal[it.name];
    if (best && H && best.kind !== "animal") {
      const nk = (this.mods && this.mods.appletor_mult) || 1;   // Nurse Hat
      if (best.kind === "player") { const q = best.p; if (q.alive && q.hp < P.max_hp) { const b0 = q.hp; q.hp = Math.min(P.max_hp, q.hp + H.player * nk); q.pending["12"] = Math.round(q.hp); q.pending["11"] = Math.round(q.hp - b0); } }
      else if (!best.dead && best.max && best.hp < best.max) { best.hp = Math.min(best.max, best.hp + H.pet * nk); this.w.touch(best, { "9": Math.round(best.hp / best.max * 255) }); }
      return true;
    }
    if (best) {
      const vs = best.kind === "player" ? "player" : best.kind === "pet" ? "pet" : "creature", d = this.w.plugHit(this, best, this.damage(vs));
      if (d > 0) { if (best.kind === "player") best.p.hurt(d, this, "player", e); else this.w.damage(best, d, this); }
    }
    return true;
  }
  // invented fairy staff (game_config staffs): each cast pays the item cost and throws the staff fairy's boss-stage ball
  // (creatures.js fairyBall, the tower path) from the player along the aim to the first enemy or solid on the line within
  // range, else to the range; the field lasts staffs.life_ms. Hits are credited to this player (the ball's src is his entity)
  staffCast(it, ST) {
    const SF = this.P.staffs, e = this.ent, fb = this.w.plugFn("fairyBall");
    if (!fb || !this.canPay(it.cost)) return false;
    // owner: the ball never stops on anything: it flies through buildings, solids and creatures to the full range, hitting
    // everything it passes (pass), then its field lasts the fairy skill's own life
    const t = this.lineTarget(SF.range, true), dd = SF.range;
    if (!fb.m.fairyBall(this.w, e, ST.sp, this, this.aim, dd, Object.assign({ pass: true }, SF.life_ms ? { life: SF.life_ms } : null))) return false;
    this.pay(it.cost); this.sendInv();
    if (SF.gather_as && this.w.ctx.ITEMS[SF.gather_as]) {   // owner: gathers and hits buildings like a Stone Spear swing
      const held = this.held; this.held = SF.gather_as;
      try { this.swing(Date.now(), true); } finally { this.held = held; }
    }
    this.L({ k: "staff", n: this.n, room: this.w.name, el: ST.el, x: Math.round(e.x), y: Math.round(e.y), dd: Math.round(dd), at: t.best ? t.best.kind : null });
    return true;
  }
  // Enchanting Gaze (wiki "Enchanted spear"): with a boss-stage Enchanting Gaze of his own near him, a spear or naginata shows
  // as the pink Enchanted Spear (P.enchant.items by how many such gazes are near, up to 3) and every swing also launches a
  // fairy energy arrow (client effect 211 / 333 / 335). Canceled while another own boss gaze is nearer.
  enchantStage() {
    const E = this.P.enchant, e = this.ent, it = this.w.ctx.ITEMS[this.held];
    if (!E || !e || !this.alive || !it || !/spear|naginata/.test(it.icon || "") || /enchanted/.test(it.icon || "")) return 0;
    let n = 0, near = Infinity, other = Infinity;
    for (const o of this.w.ents.values()) {
      if (o.kind !== "pet" || o.owner !== this || o.stage !== 2 || o.dying || !(o.hp > 0)) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (o.sp === E.sp) { if (d <= E.r) { n++; near = Math.min(near, d); } }
      else if (E.gazes.indexOf(o.sp) >= 0) other = Math.min(other, d);
    }
    return n && near <= other ? Math.min(3, n) : 0;
  }
  enchantShot(now, n) {
    const E = this.P.enchant, e = this.ent, a = this.aim, r0 = this.P.player_radius * 1.6;
    const t = this.lineTarget(E.range), stop = Math.max(r0 + 1, t.dist);
    this.w.flyFx(E.fx[n - 1], e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0, a, E.speed, Math.max(this.P.fx_ms, (stop - r0) / E.speed * 1000), e);
    if (!t.best) return;
    const vs = t.best.kind === "player" ? "player" : t.best.kind === "pet" ? "pet" : "creature", d = this.w.plugHit(this, t.best, E.dmg[vs] * n);
    if (d > 0) { if (t.best.kind === "player") t.best.p.hurt(d, this, "player", e); else this.w.damage(t.best, d, this); }
  }
  // first player / creature / pet on the aim line within range (own pets skipped), a solid on the line stops the shot first
  lineTarget(range, overSolids) {
    const P = this.P, e = this.ent, ca = Math.cos(this.aim), sa = Math.sin(this.aim);
    let best = null, bd = range;
    for (const o of this.w.ents.values()) {
      if (o === e || !(o.kind === "player" ? o.p.alive : o.kind === "animal" || o.kind === "pet")) continue;
      if (o.kind === "pet" && o.owner === this) continue;
      const dx = o.x - e.x, dy = o.y - e.y, along = dx * ca + dy * sa;
      if (along <= 0 || along > bd) continue;
      if (Math.abs(-dx * sa + dy * ca) > (o.kind === "player" ? P.player_radius : o.r || P.animal_radius)) continue;
      bd = along; best = o;
    }
    if (!overSolids) for (const o of this.w.solidsNear(e.x + ca * bd / 2, e.y + sa * bd / 2, [])) {
      if (!o.cd || o.dying || (o.kind !== "static" && o.kind !== "placed") || o.ghostFor === e) continue;
      for (let t = 0; t <= bd; t += 20) {
        const x = e.x + ca * t, y = e.y + sa * t, c = this.w.coreOf(o, x, y);
        if (Math.hypot(c[0] - x, c[1] - y) < Math.max(10, o.cd - P.player_radius)) { if (t > P.player_radius) { bd = t; best = null; } break; }
      }
    }
    return { best, dist: bd };
  }
  // Air Blast Gun (invented, owner request; numbers in game_config blast): every shot pokes everything in the cone once
  // (B.dmg, the usual hurt / damage paths: friendly fire and /admin rules apply) and sends B.waves air waves B.gap_ms apart;
  // each wave pushes every player, creature and pet in the cone (own and teammates too, never buildings or world objects)
  // straight away from the shooter, a little weaker each time (B.push, units per frame like knockback_peak), and reaches
  // B.reach_step further than the last so a pushed target is caught again; world bosses stay on their spot
  blast(B) {
    const a0 = this.aim;
    this.L({ k: "blast", n: this.n, room: this.w.name, x: Math.round(this.ent.x), y: Math.round(this.ent.y), aim: +a0.toFixed(3) });
    this.blastWave(0, a0, B);
    for (let i = 1; i < B.waves; i++) this.w.after(i * B.gap_ms, () => this.blastWave(i, a0, B));
    if (B.gather_as && this.w.ctx.ITEMS[B.gather_as]) {   // owner: gathers and hits buildings like a naginata swing
      const held = this.held; this.held = B.gather_as;
      try { this.swing(Date.now(), true); } finally { this.held = held; }
    }
  }
  blastWave(i, a0, B) {
    const e = this.ent, w = this.w, P = this.P;
    if (!this.alive || !e) return;
    const reach = B.range + i * B.reach_step, half = B.cone_deg * Math.PI / 360, v = (B.push[i] != null ? B.push[i] : B.push[B.push.length - 1]) * 1000 / P.send_ms;
    let n = 0;
    for (const o of [...w.ents.values()]) {
      if (o === e || o.dying || o.dead) continue;
      const pl = o.kind === "player";
      if (pl ? !o.p.alive : o.kind !== "animal" && o.kind !== "pet") continue;
      const r = pl ? P.player_radius : o.r || P.animal_radius, dx = o.x - e.x, dy = o.y - e.y, d = Math.hypot(dx, dy);
      if (d - r > reach) continue;
      let da = Math.abs(Math.atan2(dy, dx) - a0) % TAU; da = Math.min(da, TAU - da);
      if (d > 1 && da > half + Math.asin(Math.min(1, r / d))) continue;
      n++;
      const ux = d > 1 ? dx / d : Math.cos(a0), uy = d > 1 ? dy / d : Math.sin(a0);
      if (pl) { const q = o.p, k = q.kb || { vx: 0, vy: 0 }; q.kb = { vx: k.vx + ux * v, vy: k.vy + uy * v }; }
      else if (!o.worldBoss && !o.rider && !(o.dashUntil > Date.now())) { const k = o.blastKb || [0, 0]; o.blastKb = [k[0] + ux * v, k[1] + uy * v]; w.blasted.add(o); }
      if (i === 0 && !w.sameTeam(this, o)) {   // the poke; teammates and own pets are pushed, never hurt
        const vs = pl ? "player" : o.kind === "pet" ? "pet" : "creature", d0 = w.plugHit(this, o, B.dmg[vs]);
        if (d0 > 0) { if (pl) o.p.hurt(d0, this, "player", e); else w.damage(o, d0, this); }
      }
    }
    const r0 = P.player_radius * 1.6, life = B.fx_life, sp = Math.max(0, reach - r0) / (life / 1000);
    // owner: the effect sound (fx 61 = thundercloud) sounds once, with the shot; later waves send fx with age B.quiet_age so the
    // client skips their sound (it played again 190 / 380 ms after the shot and read as a late shot sound)
    for (const off of B.fx_fan) w.flyFx(B.fx, e.x + Math.cos(a0 + off) * r0, e.y + Math.sin(a0 + off) * r0, a0 + off, sp, life, e, i ? B.quiet_age : 0);
    this.L({ k: "blast_wave", n: this.n, room: w.name, wave: i, hit: n });
  }
  canPay(cost) { return this.god || (cost || []).every((c, i) => !c || (this.inv[i] || 0) >= c); }
  pay(cost) { if (this.god) return; (cost || []).forEach((c, i) => { if (c) this.inv[i] -= c; }); }
  useItem() {
    const it = this.w.ctx.ITEMS[this.held], P = this.P;
    if (!it || !this.alive || !this.w.canHold(this, this.held)) return;
    if (it.cat === CAT_FOOD) {
      const fb = P.food_buff && P.food_buff[it.name];
      if ((this.hp >= P.max_hp && !fb) || !this.canPay(it.cost)) return;
      this.pay(it.cost);
      const before = this.hp, now = Date.now();
      if (fb) { this.foodBuff = Object.assign({ until: now + P.food_buff_ms }, fb); this.L({ k: "food_buff", n: this.n, item: it.name, ...fb }); }
      this.hp = Math.min(P.max_hp, this.hp + Math.abs(it.heal || 0));
      this.pending["12"] = Math.round(this.hp); this.pending["11"] = Math.round(this.hp - before); this.pending["15"] = P.eat_anim_ms;
      const per = P.heal_tick_by_item[it.name];
      this.hot = per ? { per, left: P.heal_ticks, next: now + P.heal_first_ms } : null;
      this.restoreAt = now + P.eat_restore_ms;
      this.sendInv();
      const v = P.eat_fx_variant[it.name], fid = this.w.id(), e = this.ent;
      if (v != null) {
        this.w.addEnt({ id: fid, kind: "effect", x: e.x, y: e.y, cd: 0, f: { "0": fid, "1": T.CREATE, "2": 4, "3": Math.round(e.x), "4": Math.round(e.y), "5": 0, "6": 1,
          "7": P.eat_fx, "8": v, "9": 0, "10": e.id, "11": e.id } });
        this.w.after(P.eat_fx_ms, () => this.w.removeEnt(fid));
      }
    } else if (CAT_BUILD.has(it.cat)) {
      const grp = this.w.groupOf(it.id), cnt = this.placedG[grp] || 0;
      if (it.limit && cnt >= it.limit && !this.god) return;
      if (!this.canPay(it.cost)) return;
      const idx = this.w.ctx.NAMES.indexOf(it.icon);
      if (idx < 0) return;
      const V2 = process.env.TIO_PLACE_V2 !== "0", rb = this.w.buildR(it.icon, this.w.collideDist(it.icon));
      const hz = V2 ? P.player_radius + rb : this.w.collideDist(it.icon), dist = it.place || (V2 ? P.player_radius + rb + P.place_gap : P.place_dist);   // items.json place: measured 61.4..62.4 from the player center (sp5)
      const x = this.ent.x + Math.cos(this.aim) * dist, y = this.ent.y + Math.sin(this.aim) * dist;
      if (x < P.map_min || x > P.map_max || y < P.map_min || y > P.map_max) return;
      const ck = P.collide_k[family(it.icon)], cd = ck ? Math.round(hz * ck) : hz;   // owner: spikes and walls block 5 % less than their footprint; contact damage keeps hz
      for (const e of this.w.ents.values()) {
        if (e === this.ent) continue;
        // structures and world objects: body radius ~ collide distance - player radius; sp5 builds sat 100..160 apart (work/placedist.py)
        const need = V2
          ? (e.kind === "player" ? P.player_radius + rb : e.kind === "animal" ? (e.r || P.animal_radius) + rb
            : e.kind === "placed" ? (P.space_pair && family(e.name) === family(it.icon) && P.space_pair[family(it.icon)] != null ? P.space_pair[family(it.icon)] : this.w.buildR(e.name, e.cd0 || e.cd) + rb) : e.cd ? (e.cd - P.player_radius) + rb : 0)
          : e.kind === "player" || e.kind === "animal" ? P.place_clear_mobile : (e.cd ? Math.max(40, ((e.cd - P.player_radius) + (cd - P.player_radius)) * 0.9) : 0);
        if (Math.hypot(e.x - x, e.y - y) < need) { this.L({ k: "place_blocked", n: this.n, item: it.name, by: e.name || e.kind }); return; }
      }
      this.pay(it.cost);
      const off = P.place_angle_off[family(it.icon)] || 0, fam0 = family(it.icon);   // walk_fams (pads, traps): walked over, never solid; cd0 keeps the footprint for spacing
      const a01 = ((this.aim % TAU) + TAU) % TAU, r100 = P.place_rot_100 && P.place_rot_100[family(it.icon)];
      const id = this.w.id(), ang = r100 != null ? Math.round(a01 * 100) + r100 : Math.round(((((this.aim + off) % TAU) + TAU) % TAU) * 100);
      const team = this.team(), now = Date.now();
      const ownF = !P.place_owner_fams || P.place_owner_fams.indexOf(family(it.icon)) >= 0;
      const f = { "0": id, "1": T.CREATE, "2": 3, "3": Math.round(x), "4": Math.round(y), "5": ang, "6": 1, "11": 1, "13": idx };
      if (ownF) f["16"] = this.ent.id;
      if (team != null && ownF) f["15"] = team;
      const door = family(it.icon) === "door", fam = family(it.icon);
      const placedEnt = this.w.addEnt({ id, kind: "placed", x: Math.round(x), y: Math.round(y), name: it.icon, cd: P.walk_fams && P.walk_fams.indexOf(fam0) >= 0 ? 0 : cd, cd0: cd, hz, owner: this.n, team, item: it.id, grp,
        pad: fam === "pad" && /boost/.test(it.icon), padDir: this.aim, repair: /repair-tower/.test(it.icon), nextRepair: now + P.repair_first_ms,
        mill: fam === "windmill", nextMill: now + ((P.windmill[it.name] || P.windmill.default).ms),
        repairMs: (P.repair_reload_ms[it.name] || P.repair_reload_ms.default), gun: this.w.gunOf(it), nextShot: now + P.guns.first_ms, trap: P.traps[it.name] || null, trapReady: now + P.traps.arm_ms,
        hp: 255, decayAt: now + P.decay_ms, door, open: false, popUntil: now + P.send_ms * 2, popExtra: Object.assign(door ? { "9": P.door_closed } : {}, team != null && ownF ? { "15": team } : {}), f });
      this.placedG[grp] = cnt + 1;
      if (placedEnt.cd && Math.hypot(this.ent.x - x, this.ent.y - y) < cd) {   // placed on top of the placer: he walks out freely (ghost); walked-over pads / traps never (a ghost blocks steps toward it)
        placedEnt.ghostFor = this.ent;
        if (fam === "wall" || fam === "spike") this.easeOut = placedEnt;   // owner: and slides out gradually, never snapped (real LA#2 wall: 62 -> 87)
      }
      this.setHeld(this.prevHeld);   // owner: back to the weapon after every placement, as in the real game (re-select places at once)
      this.sendInv();
      this.queue({ "1": T.ITEMCOUNT, B: [it.id * 256 + (this.god ? 0 : this.placedG[grp])] });   // admin: the client never sees the limit reached
      if (!this.god) this.queue({ "1": T.PLACED, o: [[id, Math.round(x / P.placed_div), Math.round(y / P.placed_div), it.icon]], p: this.placedTotal() });   // admin: the client never counts toward its limit
      this.sb.sbp++;
      const so = this.w.ext.social; if (so && typeof so.count === "function") { try { so.count(this, 5); } catch (e) { } }
      this.L({ k: "place", n: this.n, room: this.w.name, item: it.name, id });
    }
  }
  // wrench on an own or clan building: repair instead of damage (P.wrench, wiki Wrenches; Worksite Helmet mods.wrench_mult)
  wrenchFix(o) {
    const it = this.w.ctx.ITEMS[this.held], P = this.P;
    if (!it || !/wrench/.test(it.icon || "") || !P.wrench) return false;
    if (!(this.w.ownerOf(o) === this || this.w.sameTeam(this, o))) return false;   // an enemy building takes the normal hit
    if (o.hp >= 255) return true;
    const W = P.wrench[String(it.name).split(" ")[0]] || P.wrench.other, cost = [0, 0, W[1], W[2]];
    if (!this.canPay(cost)) return true;
    this.pay(cost); this.sendInv();
    const bi = this.w.ctx.ITEMS[o.item], dur = (bi && P.wiki_durability && P.wiki_durability[bi.name]) || P.repair_durability_default;
    o.hp = Math.min(255, o.hp + Math.max(1, Math.round(255 * W[0] * ((this.mods && this.mods.wrench_mult) || 1) / dur)));
    this.w.touch(o, { "7": o.hp });
    return true;
  }
  // gloves (P.knockout, wiki Gloves): the 3rd hit in a row on the same tamer or pet may knock it out
  knockout(o, now) {
    const K = this.P.knockout, it = this.w.ctx.ITEMS[this.held], icon = this.held && it ? it.icon || "" : "hand";
    if (!K || icon.indexOf("punch") < 0) { this.combo = null; return; }
    const c = this.combo && this.combo.id === o.id && now - this.combo.at <= K.combo_gap_ms ? this.combo : (this.combo = { id: o.id, n: 0 });
    c.n++; c.at = now;
    if (c.n < K.combo) return;
    this.combo = null;
    if (Math.random() >= K.chance * ((this.mods && this.mods.ko_mult) || 1)) return;
    const q = o.kind === "player" ? o.p : null, qi = q && this.w.ctx.ITEMS[q.held];
    if (q && qi && /shield/.test(qi.icon || "")) return;   // a shield protects
    const t = q || o; t.slowUntil = now + K.stun_ms; t.slowFactor = K.slow;
    if (o.kind === "pet") o.koUntil = now + K.stun_ms;
    this.w.plug("onKnockout", o);   // creatures.js: dismount
    if (q) q.say("Knocked out!");
    this.say("KNOCKOUT!");
    this.L({ k: "knockout", n: this.n, room: this.w.name, target: o.kind, id: o.id });
  }
  // vs: player | creature | pet: sp5 measured (damage_vs), then the wiki weapon tables, then the guessed patterns
  // worn hat / wing modifiers on top of the item's damage (social.js applyMods: wdmg per weapon family, gloves, hands)
  damage(vs) {
    let d = this.baseDamage(vs);
    const m = this.mods, it = this.w.ctx.ITEMS[this.held], icon = this.held && it ? it.icon || "" : "hand";
    if (!m) return d;
    for (const [pat, k] of Object.entries(m.wdmg || {})) if (icon.indexOf(pat) >= 0 && !(pat === "bow" && icon.indexOf("crossbow") >= 0) && !(pat === "axe" && icon.indexOf("pickaxe") >= 0)) d *= k;
    if (icon === "hand" || icon.indexOf("punch") >= 0) { d = d * (m.glove_mult || 1) + (m.hand_flat || 0); }
    return d;
  }
  baseDamage(vs) {
    const P = this.P, it = this.w.ctx.ITEMS[this.held], nm = this.held && it ? it.name : "Hand", c = P.client[nm];
    if (c) { const d = vs === "player" ? c.dmg_player : c.dmg_animal; if (d != null) return d; }   // client tooltip table
    const t = P.damage_vs[vs || "player"] || {};
    if (t[nm] != null) return t[nm];
    const w = P.wiki_damage[vs === "player" ? "player" : "animal"] || {};
    if (w[nm] != null) return w[nm];
    if (!it || this.held === 0) return P.damage_hand;
    if (P.damage_by_item[it.name] != null) return P.damage_by_item[it.name];
    for (const [pat, d] of P.damage_by_pattern) if (it.icon && it.icon.indexOf(pat) >= 0) return d;
    return P.damage_default;
  }
  // every player and animal in front (arc, reach from the body edge) takes the hit; the nearest resource there is gathered
  // objectsOnly: resources and buildings only (the Air Blast Gun's naginata-like gathering), no player / creature hits
  swing(now, objectsOnly) {
    const sw = !objectsOnly && this.w.plugFn("onSwing"); if (sw && sw.m.onSwing(this.w, this) === true) return;   // e.g. the saddle swing that dismounts
    const P = this.P, e = this.ent, dmg = this.damage("player"), objs = [];
    const ci = P.client[this.held && this.w.ctx.ITEMS[this.held] ? this.w.ctx.ITEMS[this.held].name : "Hand"], reach = ci && ci.range != null ? ci.range : P.reach;
    const inArc = (o, c) => { let da = Math.abs(Math.atan2((c ? c[1] : o.y) - e.y, (c ? c[0] : o.x) - e.x) - this.aim) % TAU; da = Math.min(da, TAU - da); return da <= P.hit_arc; };
    for (const o of [...this.w.ents.values()]) {
      if (o === e) continue;
      if (objectsOnly && (o.kind === "player" || o.kind === "animal" || o.kind === "pet")) continue;
      if (o.kind === "player") {
        if (o.p.alive && Math.hypot(o.x - e.x, o.y - e.y) - 2 * P.player_radius <= reach && inArc(o)) { const d = this.w.plugHit(this, o, dmg); if (d > 0) { o.p.hurt(d, this, "player", e); this.knockout(o, now); if (this.mods && this.mods.steal) this.steal(o.p, this.mods.steal); } }
      } else if (o.kind === "animal" || o.kind === "pet") {
        if (Math.hypot(o.x - e.x, o.y - e.y) - Math.max(P.player_radius + (o.r || P.animal_radius), o.cd || 0) <= reach && inArc(o)) { const d = this.w.plugHit(this, o, this.damage(o.kind === "pet" ? "pet" : "creature")); if (d > 0) { this.w.damage(o, d, this); if (o.kind === "pet") this.knockout(o, now); } }
      } else if (!o.dying && (o.kind === "placed" || (o.kind === "static" && (this.resourceOf(o.name) || family(o.name) === "totem" || o.hiveHit)))) {   // hiveHit: hive creep / shadow eggs (creatures.js)
        const c = this.w.coreOf(o, e.x, e.y), edge = Math.hypot(c[0] - e.x, c[1] - e.y) - (o.cd || o.cd0 || 80);   // owner: a log's hitbox = its capsule
        if (edge <= reach && inArc(o, c)) objs.push(o);
      }
    }
    // every object in reach and arc is hit, each pays its own yield (sp5: 371 swings hit 2 objects, 29 hit 3, 9 hit 4)
    const got = {};
    for (const res of objs) {
      const ang = ang255(Math.atan2(res.y - e.y, res.x - e.x));
      if (res.kind === "placed" && this.wrenchFix(res)) continue;
      if (res.kind === "placed") { const d = this.w.plugHit(this, res, dmg); if (d > 0) this.w.hurtPlaced(res, d, this, ang); continue; }
      if (family(res.name) === "totem") { this.w.hitTotem(res, this, ang); continue; }
      if (res.hiveHit) { this.w.hitResource(res, this, ang, res.hiveStep); if (res.hitGain) this.gain(res.hitGain); continue; }   // hitGain: event eggs (gold / food a hit)   // no gather yield, own hp step
      const r = this.w.hitResource(res, this, ang);
      if (r === "open") continue;   // the opening hit pays the loot only
      for (const [k, v] of Object.entries(this.gatherYield(res.name))) got[k] = (got[k] || 0) + v;
    }
    this.payGather(got);
  }
  payGather(got) {   // a hit's gathered resources: bonuses, /easy, scoreboard, achievements, XP
    const P = this.P;
    if (!Object.keys(got).length) return;
    for (const [k, v] of Object.entries((this.mods && this.mods.gather_bonus) || {})) if (got[k]) got[k] += v;
    if (this.easy) for (const k of Object.keys(got)) got[k] *= 10;   // /easy: 10x gathering
    this.gain(got);
    if (got[0]) this.sb.sbf += got[0];
    if (got[1]) this.sb.sbw += got[1];
    if (got[2]) this.sb.sbs += got[2];
    if (!P.achievements_done) for (const [key, n, need] of P.achievements) if (!this.ach[n] && this.sb[key] >= need) { this.ach[n] = 1; this.queue({ "1": T.ACH, o: 2, n }); }
    this.addXp(Object.values(got).reduce((a, b) => a + b, 0) * P.xp_per_resource / (this.easy ? 10 : 1), "gather");   // easy: XP once x10 (addXp), not on the x10 resources
  }
  resourceOf(name) {
    const f = family(name);
    return this.P.gather_slot[f] != null ? f : null;
  }
  gatherYield(name, hand) {   // hand: a shot gathers like a bare-hand hit
    if (/porous-rock$/.test(name)) return { 2: 5 };   // wiki: a sea porous rock gives 5 stone per hit
    const P = this.P, f = this.resourceOf(name), it = hand ? null : this.w.ctx.ITEMS[this.held];
    const tool = it ? it.name : "Hand", slot = P.gather_slot[f];
    const tab = P.gather_yield[tool + "|" + f] || P.gather_yield[(it && it.icon && P.gather_tool_family.find((t) => it.icon.indexOf(t) >= 0) || "hand") + "|" + f];
    if (tab) return Object.assign({}, tab);
    const c = P.client[tool];   // client harvest table [food, wood, stone, gold] per hit
    if (c && c.harvest && c.harvest[slot] != null) return { [slot]: c.harvest[slot] + (P.gather_extra[f] || 0) };
    return { [slot]: P.gather_default };
  }
  // ------------------------------------------------------------ visibility
  stream(now) {
    const P = this.P, cx = this.x, cy = this.y;
    for (const e of this.w.ents.values()) {
      const dx = Math.abs(e.x - cx), dy = Math.abs(e.y - cy), has = this.vis.has(e.id);
      if (!has) {
        if (!e.dying && dx < P.view_create[0] && dy < P.view_create[1]) {
          this.vis.add(e.id); this.queue(this.w.createMsg(e));
          if (e.popUntil && now < e.popUntil) {
            this.queue(Object.assign({ "0": e.id, "1": T.MOVE, "7": 255 }, e.popExtra || {}));
            if (e.delta) this.queue(Object.assign({ "0": e.id, "1": T.MOVE }, e.delta));
          }
        }
      } else if (e !== this.ent && (dx > P.view_remove[0] || dy > P.view_remove[1])) {
        this.vis.delete(e.id); this.queue({ "0": e.id, "1": T.REMOVE });
      } else if (e.delta) {
        this.queue(Object.assign({ "0": e.id, "1": T.MOVE }, e.delta));
      } else if ((e.id + this.w.tickN) % P.keepalive_ticks === 0) {
        this.queue({ "0": e.id, "1": T.MOVE });
      }
    }
    for (const id of [...this.vis]) if (!this.w.ents.has(id)) { this.vis.delete(id); this.queue({ "0": id, "1": T.REMOVE }); }
  }
}

module.exports = { World, Player, T, OP, family, ageOf };
