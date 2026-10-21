#!/usr/bin/env node
// Tests for mimic/hosted/social.js.
// Usage: node bin/test_social.js --unit            (fake world, no server)
//        node bin/test_social.js --port 8924 [--log logs/hosted_dev_social/server.jsonl]   (running hosted server, --mode multi)
"use strict";
const net = require("net"), path = require("path");
const S = require(path.join(__dirname, "..", "mimic", "hosted", "social.js"));
const A = {}; for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i].replace(/^--/, ""); const v = process.argv[i + 1]; if (v && !v.startsWith("--")) { A[k] = v; i++; } else A[k] = true; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (ok) passes++; else fails++; };
const CLAN = 68, CHAT = 39, ITEMCOUNT = 36, COUNT = 37, MOVE = 84, CREATE = 79;
const M = S.M;
// what the real client sends as JSON 68 o (payload {type: 68, o, n?}); browser = frames decoded by the real-browser proof,
// client = the client clan module through the atlanta4 type table (the same table gives the sp5 capture values)
const O = {
  OPEN: 77,      // browser {"type":68,"o":77}
  CREATE: 51,    // browser {"type":68,"o":51,"n":"ProofClan"}
  DECLINE: 72,   // browser {"type":68,"o":72} (logs/hosted_proof_20261017_150337 social_decline A_sent)
  ASK: 60, ACCEPT: 54, KICK: 38, LOCK: 49, LOCKJOIN: 55, HIDE: 25,   // browser: work end to end; client: same codes
  LEADER: 24, NEXT: 85, LEAVE: 33, CLOSE: 30,                        // client (sp5 capture: leader 32, close 53)
};
const FIXTURES = [{ type: 68, o: 77 }, { type: 68, o: 51, n: "ProofClan" }, { type: 68, o: 72 }];

// ------------------------------------------------------------ unit: fake world
function fakeWorld() {
  const w = { ext: {}, P: { minimap_div: 69.5, chat_min_ms: 0, chat_max_len: 80, view_remove: [1521, 1053] }, players: new Map(), logs: [], touched: [] };
  w.L = (o) => w.logs.push(o);
  w.ctx = { ITEMS: require(path.join(__dirname, "..", "mimic", "data", "items.json")) };
  w.touch = (e, f) => w.touched.push([e.id, f]);
  w.broadcast = (m) => { for (const p of w.players.values()) p.queue(m); };
  S.attach(w);
  return w;
}
let PID = 0;
function fakePlayer(w, name, x, y) {
  const n = ++PID, ent = { id: 5000 + n, kind: "player", x: x || 1000, y: y || 1000 };
  const p = { n, name, ent, id: ent.id, inv: { 0: 20, 1: 20, 2: 20, 3: 0 }, pending: {}, held: 0, mods: { speed: 1, dmg_taken: 1, gather_bonus: {}, regen_per_s: 0, xp_mult: 1, pad_immune: false }, get x() { return ent.x; }, get y() { return ent.y; }, alive: true, joined: true, xp: 0, placed: {}, out: [] };
  p.queue = (m) => p.out.push(m);
  p.createFields = function () { return { "0": this.id, "14": 0, "18": this.name }; };
  w.players.set(n, p); S.onJoin(w, p);
  return p;
}
const got = (p, f) => p.out.filter(f);
const clan = (p, m) => p.out.filter((q) => q["1"] === CLAN && q.m === m);
const act = (w, p, o, n, keep) => { if (!keep) w.ext.social.ps.get(p.n).bJson = 10; return S.onJson(w, p, n === undefined ? { type: CLAN, o } : { type: CLAN, o, n }); };

function unit() {
  const bad = Object.keys(O).filter((k) => S.O[k] !== O[k]);
  check(!bad.length, "social.js action codes match the real client frames" + (bad.length ? ": " + bad.map((k) => k + " " + S.O[k] + " != " + O[k]).join(", ") : ""));
  { const w = fakeWorld(), p = fakePlayer(w, "fx"), q = fakePlayer(w, "fy");
    for (const f of FIXTURES.slice(0, 2)) S.onJson(w, p, f);
    S.onJson(w, q, { type: 68, o: 60, n: "ProofClan" });
    S.onJson(w, p, FIXTURES[2]);
    check(clan(p, M.INFO).length === 1 && w.logs.some((l) => l.k === "clan_decline" && l.member === q.n) && !w.ext.social.teams.get(clan(p, M.INFO)[0].o.x).reqs.length,
      "browser fixture frames: open, create ProofClan, decline pops the request (clan_decline)"); }
  const w = fakeWorld();
  const a = fakePlayer(w, "alice"), b = fakePlayer(w, "bob", 1200, 1100), c = fakePlayer(w, "carol", 9000, 9000);
  check(clan(a, M.LIST).length === 1 && Array.isArray(clan(a, M.LIST)[0].o), "join gets the clan list (m 61)");
  // Air Blast Gun (invented): item 17 is a level-1 pick after the Hand, next to the stone tools
  { const g = fakePlayer(w, "gunner", 5000, 5000); g.xp = 43;
    S.onOp(w, g, 1, 17);
    check(JSON.stringify(got(g, (q) => q["1"] === ITEMCOUNT).map((q) => q.B)) === "[[4352]]" && g.held === 17 && g.pending["8"] === 17, "Air Blast Gun pick at age 1: B [4352], held 17");
    S.onOp(w, g, 1, 72);
    check(got(g, (q) => q["1"] === ITEMCOUNT).length === 1 && S.canHold(w, g, 17) && !S.canHold(w, g, 0), "Air Blast Gun uses the level-1 pick (Stone Axe refused) and replaces the Hand");
    check(S.SOURCES.blast_gun && /^invented/.test(S.SOURCES.blast_gun), "Air Blast Gun tagged invented in SOURCES"); }
  // picks
  a.xp = 43;
  S.onOp(w, a, 1, 72);
  check(JSON.stringify(got(a, (q) => q["1"] === ITEMCOUNT).map((q) => q.B)) === "[[18432]]", "Stone Axe pick at xp 43 -> item_count B [18432] (capture row 1934)");
  check(a.held === 72 && a.pending["8"] === 72, "tool pick auto-equips: held 72, own field 8 queued (rows 1934, 12904)");
  S.onOp(w, a, 1, 57);
  check(got(a, (q) => q["1"] === ITEMCOUNT).length === 1, "second level-1 pick refused");
  S.onOp(w, a, 1, 167);
  check(got(a, (q) => q["1"] === ITEMCOUNT).length === 1, "Cookie (level 2) refused at age 1");
  a.xp = 133; S.onOp(w, a, 1, 167);
  check(got(a, (q) => q["1"] === ITEMCOUNT).pop().B[0] === 42752, "Cookie pick at xp 133 -> B [42752] (row 4339)");
  a.xp = 300; S.onOp(w, a, 1, 267);
  a.placedG = { 1: 5 }; a.xp = 2102;
  S.onOp(w, a, 1, 95);
  check(a.held === 72, "non-tool picks (Cookie, Stone Spike, Stone Shield) do not change the held item");
  check(got(a, (q) => q["1"] === ITEMCOUNT).pop().B[0] === 68352, "Stone Spike B [68352]; Stone Shield (first of its chain) gets no item_count");
  for (const id of [160, 73, 168, 193]) S.onOp(w, a, 1, id);
  S.onOp(w, a, 1, 268);
  check(got(a, (q) => q["1"] === ITEMCOUNT).pop().B[0] === 68613, "Golden Spike carries the 5 placed stone spikes: B [68613] (row 15514)");
  check(S.canHold(w, a, 268) && !S.canHold(w, a, 267) && !S.canHold(w, a, 74), "canHold: Golden Spike yes, replaced Stone Spike no, unpicked Ruby Axe no");
  S.onRespawn(w, a); a.out = [];
  a.xp = 43; S.onOp(w, a, 1, 57);
  check(got(a, (q) => q["1"] === ITEMCOUNT).length === 1, "picks reset on respawn: level 1 open again (Stone Hammer)");
  // hat shop: buy Knight's Helmet (25) for 10000 gold, equip, wing, respawn
  { const w2 = fakeWorld(), h = fakePlayer(w2, "hat"), g = fakePlayer(w2, "poor");
    const fill = (p) => { w2.ext.social.ps.get(p.n).bJson = 10; };
    h.inv[3] = 14055; S.onOp(w2, h, 12, 0);
    S.onOp(w2, h, 7, 0 + 25 * 256);
    const inv = h.out.filter((q) => q["1"] === 53).pop();
    check(inv && JSON.stringify(inv.i) === '{"3":4055}' && h.inv[3] === 4055, "buy Knight's Helmet: inventory {3: 4055} (row 17290) " + JSON.stringify(inv && inv.i));
    fill(h); S.onOp(w2, h, 6, 0 + 25 * 256); S.onOp(w2, h, 9, 0);
    check(h.cf["9"] === 25 && w2.touched.some((x) => x[0] === h.id && x[1]["9"] === 25), "equip: field 9 = 25 in cf and touched (row 17294)");
    check(h.mods.dmg_taken === 0.6 && h.mods.speed === 0.6, "Knight's Helmet mods: dmg_taken 0.6, speed 0.6");
    fill(h); h.inv[3] = 9000; S.onOp(w2, h, 7, 1 + 22 * 256);
    fill(h); S.onOp(w2, h, 6, 1 + 22 * 256);
    fill(h); h.inv[3] += 3000; S.onOp(w2, h, 7, 0 + 3 * 256); w2.phase = 1; fill(h); S.onOp(w2, h, 6, 0 + 3 * 256);
    const inBiome = h.mods.dmg_taken; w2.phase = 2; S.onBiome(w2, 1, 2);
    check(Math.abs(inBiome - 0.9) < 1e-9 && h.mods.dmg_taken === 1, "Chapka: 10% shield in snow (phase 1) only: " + inBiome + " then " + h.mods.dmg_taken);
    fill(h); S.onOp(w2, h, 6, 0 + 25 * 256);
    check(h.inv[3] === 950 && h.cf["9"] === 25 + 22 * 256, "wing 22 (8050): gold 950, field 9 = hat | wing << 8 = " + h.cf["9"]);
    g.inv[3] = 100; S.onOp(w2, g, 7, 0 + 25 * 256);
    const rs = g.out.filter((q) => q["1"] === 66).pop();
    check(g.inv[3] === 100 && rs && rs.H.length === 0, "buy without gold refused, owned list re-sent (66 H [])");
    fill(g); S.onOp(w2, g, 6, 0 + 25 * 256);
    check(!g.cf["9"], "equip of an unowned hat refused");
    fill(g); S.onOp(w2, g, 7, 0 + 2 * 256);
    check(g.out.filter((q) => q["1"] === 66).length === 2, "unlisted hat (Wizard Hat, flag 0) not sold");
    h.out = []; S.onRespawn(w2, h);
    const ow = h.out.find((q) => q["1"] === 66);
    check(ow && ow.H.join() === "25,3" && ow.W.join() === "22" && h.cf["9"] === 0 && h.mods.dmg_taken === 1, "respawn: 66 {H [25], W [22]} (rows 26679, 38433), field 9 back to 0");
    const prev = process.env.TIO_SOCIAL_TEST;
    delete process.env.TIO_SOCIAL_TEST;
    const off = S.onJson(w2, h, { type: CHAT, msg: "/testgold" });
    process.env.TIO_SOCIAL_TEST = "1";
    const on = S.onJson(w2, h, { type: CHAT, msg: "/testgold" });
    if (prev === undefined) delete process.env.TIO_SOCIAL_TEST; else process.env.TIO_SOCIAL_TEST = prev;
    check(off === false && on === true && h.inv[3] === 950 + S.CFG.test_gold, "/testgold only with TIO_SOCIAL_TEST=1");
    check(S.HAT_PRICE[25][0] === 10000 && S.HAT_PRICE.length === 70 && S.WING_PRICE.length === 38, "client price table: 70 hats, 38 wings, Knight's Helmet 10000"); }
  // clans
  act(w, a, O.OPEN);
  check(clan(a, M.NAMES).length === 1 && clan(a, M.NAMES)[0].o.length === 0, "open with no team -> m 35 names []");
  for (let i = 0; i < 6; i++) act(w, a, O.CREATE, "AI");
  const inf = clan(a, M.INFO);
  check(inf.length === 1 && inf[0].o.l === 1 && inf[0].o.n === "AI", "create -> one INFO {l 1, n AI, x} despite 6 duplicate sends (row 34742)");
  const tid = inf[0].o.x;
  check(clan(a, M.MEMBERS).length === 1 && clan(a, M.MEMBERS)[0].o[0][4] === a.id && clan(c, M.ADD).length === 1, "creator gets m 83 members, everyone gets m 71 add");
  check(a.cf["14"] === tid * 2 + 1, "leader field 14 = id*2+1 (" + a.cf["14"] + ")");
  a.out = []; act(w, a, O.OPEN);
  check(clan(a, M.EMPTY).length === 1, "open alone in team -> m 50 (row 7602)");
  act(w, b, O.OPEN);
  check(clan(b, M.NAMES).pop().o.join() === "AI", "other player sees names [AI]");
  act(w, b, O.ASK, "AI");
  const req = clan(a, M.REQ).pop();
  check(req && req.o === "bob" && req.n === b.id, "join request reaches the leader: m 3 {o bob, n " + b.id + "}");
  act(w, a, O.ACCEPT);
  check(clan(b, M.INFO).pop().o.x === tid && b.cf["14"] === tid * 2, "accept: bob gets INFO and field 14 = id*2");
  a.out = []; b.out = []; c.out = [];
  S.onJson(w, b, { type: CHAT, msg: "hi <team>\u0001", tm: 1 });
  const log = a.out.find((q) => q["1"] === CHAT && q.tm === 62);
  check(log && log.m === "hi team" && log.s === 1 && log.n === "bob" && log.p === b.id, "team chat log to leader {m, tm 62, s 1, n, p} sanitized");
  check(a.out.some((q) => q["1"] === CHAT && q.mt === 1 && q.i === b.id) && !c.out.length, "team bubble mt 1 to members in view, nothing to outsiders");
  { // receiver with a world.js view set: bubble waits until the sender's create was sent
    b.vis = new Set(); a.out = []; b.out = [];
    w.ext.social.ps.get(a.n).lastChat = 0;
    S.onJson(w, a, { type: CHAT, msg: "walk in", tm: 1 });
    const early = b.out.some((q) => q["1"] === CHAT && q.mt === 1);
    S.tick(w, Date.now());
    const still = b.out.some((q) => q["1"] === CHAT && q.mt === 1);
    b.vis.add(a.id); S.tick(w, Date.now());
    const late = b.out.filter((q) => q["1"] === CHAT && q.mt === 1 && q.m === "walk in").length;
    check(!early && !still && late === 1 && b.out.some((q) => q.tm === 62), "just walked into view: log now, bubble only after the receiver has the create (1 bubble)");
    b.vis = new Set([a.id]); b.out = [];
    w.ext.social.ps.get(a.n).lastChat = 0;
    S.onJson(w, a, { type: CHAT, msg: "seen", tm: 1 });
    check(b.out.filter((q) => q.mt === 1 && q.m === "seen").length === 1, "receiver already has the sender: bubble at once");
    b.vis = new Set(); b.alive = false; b.out = [];
    w.ext.social.ps.get(a.n).lastChat = 0;
    S.onJson(w, a, { type: CHAT, msg: "dead", tm: 1 });
    b.alive = true; b.vis.add(a.id); S.tick(w, Date.now());
    check(!b.out.some((q) => q.mt === 1), "receiver dead (respawn screen): log only, no stale bubble later");
    w.ext.social.ps.get(a.n).lastChat = 0;
    S.onJson(w, a, { type: CHAT, msg: "respawned", tm: 1 });
    check(b.out.filter((q) => q.mt === 1 && q.m === "respawned").length === 1, "receiver just respawned with the sender in view: bubble");
    delete b.vis; }
  check(S.onJson(w, c, { type: CHAT, msg: "x", tm: 1 }) === false && S.onJson(w, b, { type: CHAT, msg: "x", tm: 0 }) === false, "non-team and tm 0 chat left to world.js");
  w.ext.social.teams.get(tid).posAt = 0; S.tick(w, Date.now());
  const pos = clan(a, M.POS).pop();
  check(pos && pos.o.length === 6 && pos.o[2] === 0 && pos.o[5] === b.id, "minimap markers m 63 [x,y,0, x,y,bob]: " + JSON.stringify(pos && pos.o));
  a.out = []; b.out = [];
  act(w, a, O.LEADER, b.n);
  check(clan(a, M.MEMBER).length === 1 && clan(a, M.MEMBERS).pop().o[0][4] === b.id && clan(b, M.LEADER).length === 1, "leader transfer: old gets m 16 + members (bob first), new gets m 46 (row 17788)");
  check(a.cf["14"] === tid * 2 && b.cf["14"] === tid * 2 + 1, "field 14 swaps leader bit");
  a.out = []; c.out = [];
  act(w, b, O.LEAVE);
  check(clan(a, M.LEFT).length === 1 && clan(c, M.DEL).pop().o === tid && a.cf["14"] === 0, "leader leaves: team deleted, member gets m 10, everyone m 26 (row 33947)");
  act(w, a, O.CREATE, "<b>xx\u0007yyyyyyyyyyyyy");
  check(clan(a, M.INFO).pop().o.n === "bxxyyyyyyy", "clan name sanitized and cut to 10: " + clan(a, M.INFO).pop().o.n);
  act(w, b, O.ASK, "bxxyyyyyyy"); act(w, a, O.ACCEPT);
  S.onLeave(w, a); w.players.delete(a.n);
  check(clan(b, M.LEADER).length >= 1 && w.ext.social.teams.size === 1, "leader disconnect promotes the remaining member");
  const st1 = S.stats(w);
  check(st1 && st1.ps === w.players.size && st1.stale_ps === 0 && st1.clans === 1 && st1.members === 1 && st1.stale_members === 0 && st1.stale_requests === 0,
    "stats after alice left: " + JSON.stringify(st1));
  // counters
  b.out = [];
  S.onDeath(w, c, b);
  S.onHit(w, b, { kind: "animal", hp: 5 }, 8);
  S.onHit(w, b, { kind: "animal", hp: 50, boss: true }, 8);
  const cn = got(b, (q) => q["1"] === COUNT).map((q) => [q.n, q.o]);
  check(JSON.stringify(cn) === "[[0,1],[1,1]]", "HUD counters: player kill n 0, animal kill n 1 " + JSON.stringify(cn));
  // rate limit
  c.out = [];
  for (let i = 0; i < 300; i++) act(w, c, O.OPEN, undefined, true);
  const replies = clan(c, M.NAMES).length;
  check(replies > 0 && replies <= 12, "300 clan actions in a burst -> " + replies + " served (bucket)");
  let threw = false;
  try { for (const m of [{ type: CLAN }, { type: CLAN, o: "x", n: {} }, { type: CLAN, o: O.CREATE, n: { a: 1 } }, { type: CLAN, o: O.KICK, n: "zz" }, { type: CHAT, tm: 1, msg: 5 }]) S.onJson(w, b, m); S.onOp(w, b, 1, 99999); S.onOp(w, b, 1, -5); }
  catch (e) { threw = e.message; }
  check(!threw, "garbage clan/chat/pick input does not throw " + (threw || ""));
}

// ------------------------------------------------------------ live server
const { TestClient } = require(path.join(__dirname, "..", "mimic", "hosted", "testclient.js"));
const { encodeJoin } = require(path.join(__dirname, "..", "mimic", "hosted", "joincodec.js"));
function client(port) { const h = "127.0.0.1:" + port; return new TestClient(() => net.connect(port, "127.0.0.1"), { host: h, path: "/_h/offline1/offline1?1_2", origin: "http://" + h }); }
const lastClan = (c, m) => c.msgs.filter((q) => q["1"] === CLAN && q.m === m).pop();
const ownId = async (c) => { const m = await c.until((x) => x.msgs.find((q) => q["1"] === 19 && q.s === false), 4000); return m ? Math.floor(m.id / 256) : null; };
const posOf = (c, id) => { let p = null; for (const q of c.msgs) if ((q["1"] === CREATE || q["1"] === MOVE) && q["0"] === id && q["3"] != null) p = [q["3"], q["4"]]; return p; };
const field = (c, id, k) => { let v; for (const q of c.msgs) if ((q["1"] === CREATE || q["1"] === MOVE) && q["0"] === id && q[k] != null) v = q[k]; return v; };
const xpOf = (c) => (c.msgs.filter((q) => q["1"] === 27).pop() || { i: 0 }).i;

async function live(port) {
  const a = client(port), b = client(port), c = client(port);
  for (const x of [a, b, c]) await x.until((y) => y.status, 3000);
  check(a.open && b.open && c.open, "three sockets open on " + port);
  a.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "alice" }), 243) }); await sleep(150);
  b.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "bob" }), 243) }); await sleep(150);
  c.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "carol" }), 243) });
  const ia = await ownId(a), ib = await ownId(b), ic = await ownId(c);
  check(ia && ib && ic, "joined " + [ia, ib, ic]);
  const list = await a.until((x) => lastClan(x, M.LIST) && !lastClan(x, M.LIST).o.some((r) => r[1] === "base" || r[1] === "Tamers") && lastClan(x, M.LIST), 3000);
  check(!!list, "join: social clan list (m 61), not the static atl4 one");
  a.json({ type: CLAN, o: O.OPEN });
  check(!!(await a.until((x) => lastClan(x, M.NAMES), 3000)), "open box -> m 35 names");
  const nm = "T" + (Date.now() % 100000);
  for (let i = 0; i < 4; i++) a.json({ type: CLAN, o: O.CREATE, n: nm });
  const inf = await a.until((x) => lastClan(x, M.INFO), 3000);
  check(inf && inf.o.l === 1 && inf.o.n === nm, "create -> INFO " + JSON.stringify(inf && inf.o));
  const tid = inf ? inf.o.x : 0;
  check(!!(await c.until((x) => x.msgs.find((q) => q["1"] === CLAN && q.m === M.ADD && q.o[0] === tid), 3000)), "carol gets m 71 add for the new clan");
  await sleep(400);
  check(a.msgs.filter((q) => q["1"] === CLAN && q.m === M.INFO).length === 1, "duplicate creates ignored");
  const f14 = await c.until((x) => field(x, ia, "14") === tid * 2 + 1, 3000);
  check(!!f14, "carol sees alice field 14 = " + (tid * 2 + 1));
  b.json({ type: CLAN, o: O.ASK, n: nm });
  const req = await a.until((x) => lastClan(x, M.REQ), 3000);
  check(req && req.o === "bob" && req.n === ib, "leader gets join request " + JSON.stringify(req));
  a.json({ type: CLAN, o: O.ACCEPT });
  const binf = await b.until((x) => lastClan(x, M.INFO), 3000);
  check(binf && binf.o.x === tid && binf.o.l === undefined, "bob joined as member " + JSON.stringify(binf && binf.o));
  check(!!(await c.until((x) => field(x, ib, "14") === tid * 2, 3000)), "carol sees bob field 14 = " + tid * 2);
  // reconnect-free respawn check: field 14 is in the player create
  const d = client(port); await d.until((y) => y.status, 3000);
  d.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "dave" }), 243) }); await ownId(d);
  const cr = await d.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === ia), 4000);
  check(cr && cr["14"] === tid * 2 + 1, "a late joiner sees field 14 in alice's create (" + (cr && cr["14"]) + ")");
  check(!!(await d.until((x) => (lastClan(x, M.LIST) || { o: [] }).o.some((r) => r[0] === tid), 3000)), "late joiner's clan list has the clan");
  d.close();
  await sleep(800);
  b.json({ type: CHAT, msg: "team <hi>", tm: 1 });
  const log = await a.until((x) => x.msgs.find((q) => q["1"] === CHAT && q.tm === 62), 3000);
  check(log && log.m === "team hi" && log.s === 1 && log.n === "bob" && log.p === ib, "clan chat log " + JSON.stringify(log));
  await sleep(500);
  check(!c.msgs.some((q) => q["1"] === CHAT && (q.tm === 62 || q.mt === 1)), "outsider gets no clan chat");
  await sleep(800);
  let okB = 0;
  for (let i = 0; i < 20; i++) {
    const k = i % 4;
    b.ops([[5, k + 256]]); await sleep(150 + (i % 3) * 60); b.ops([[5, k]]); await sleep(150);
    const txt = "loop " + i;
    a.json({ type: CHAT, msg: txt, tm: 1 });
    if (await b.until((x) => x.msgs.find((q) => q["1"] === CHAT && q.mt === 1 && q.m === txt && q.i === ia), 2500)) okB++;
    await sleep(500);
  }
  check(okB === 20, "20 clan chats with bob moving in between: " + okB + "/20 bubbles");
  b.json({ type: CHAT, msg: "public", tm: 0 });
  check(!!(await c.until((x) => x.msgs.find((q) => q["1"] === CHAT && q.m === "public" && q.i === ib), 3000)), "public chat still a world.js bubble for carol");
  const pos = await a.until((x) => x.msgs.find((q) => q["1"] === CLAN && q.m === M.POS && q.o.includes(ib)), 11000);
  check(!!pos, "member minimap markers m 63 " + JSON.stringify(pos && pos.o));
  a.json({ type: CLAN, o: O.OPEN });
  const mem = await a.until((x) => lastClan(x, M.MEMBERS) && lastClan(x, M.MEMBERS).o.length === 2 && lastClan(x, M.MEMBERS), 3000);
  check(!!mem, "open with members -> m 83 " + JSON.stringify(mem && mem.o));
  const ubob = mem ? mem.o.find((r) => r[4] === ib)[1] : 0;
  a.json({ type: CLAN, o: O.LEADER, n: ubob });
  check(!!(await a.until((x) => lastClan(x, M.MEMBER), 3000)) && !!(await b.until((x) => lastClan(x, M.LEADER), 3000)), "leader transfer m 16 / m 46");
  b.json({ type: CLAN, o: O.LEAVE });
  check(!!(await a.until((x) => lastClan(x, M.LEFT), 3000)) && !!(await c.until((x) => x.msgs.find((q) => q["1"] === CLAN && q.m === M.DEL && q.o === tid), 3000)), "new leader leaves: team deleted (m 10, m 26)");
  check(!!(await c.until((x) => field(x, ia, "14") === 0, 3000)), "field 14 back to 0 for alice");
  await locksKickDecline(a, b, c, ia, ib);
  for (let i = 0; i < 100; i++) c.json({ type: CLAN, o: O.OPEN });
  await sleep(1200);
  const n35 = c.msgs.filter((q) => q["1"] === CLAN && q.m === M.NAMES).length;
  check(!c.closed && n35 <= 20, "clan spam rate limited, socket alive: " + n35 + " replies to 100 (harden.js drops sockets above 120 frames/s)");
  // hat shop through the socket (server started with TIO_SOCIAL_TEST=1 for the gold grant)
  await sleep(800);
  a.json({ type: CHAT, msg: "/testgold" });
  const g1 = await a.until((x) => x.msgs.find((q) => q["1"] === 53 && q.i && q.i["3"] >= 20000 && Object.keys(q.i).length === 1), 3000);
  if (!g1) console.log("note: no test gold (server not started with TIO_SOCIAL_TEST=1), shop live checks skipped");
  else {
    const gold0 = g1.i["3"];
    a.ops([[12, 0]]); a.ops([[7, 0 + 25 * 256]]);
    const g2 = await a.until((x) => x.msgs.find((q) => q["1"] === 53 && q.i && q.i["3"] === gold0 - 10000), 3000);
    check(!!g2, "live buy Knight's Helmet: gold " + gold0 + " -> " + (gold0 - 10000));
    a.ops([[6, 0 + 25 * 256], [9, 0]]);
    check(!!(await c.until((x) => field(x, ia, "9") === 25, 3000)), "carol sees alice field 9 = 25 (helm)");
    b.ops([[7, 0 + 25 * 256]]);
    check(!!(await b.until((x) => x.msgs.find((q) => q["1"] === 66 && Array.isArray(q.H) && q.H.length === 0), 3000)), "bob without gold: buy refused (66 H [])");
    b.ops([[6, 0 + 25 * 256]]); await sleep(600);
    check(field(c, ib, "9") !== 25, "bob cannot equip an unowned helm");
  }
  // picks: xp 0 -> refused, then gather to age 1 and pick Stone Axe
  a.ops([[1, 72]]); await sleep(500);
  check(!a.msgs.some((q) => q["1"] === ITEMCOUNT), "pick at xp 0 refused (no item_count)");
  a.ops([[10, 72]]); await sleep(600);
  check(field(a, ia, "8") !== 72, "unpicked Stone Axe cannot be selected (canHold)");
  const ok = await gatherTo(a, ia, 43, 120000);
  check(ok, "alice gathered to xp " + xpOf(a));
  if (ok) {
    a.ops([[1, 72]]);
    const ic1 = await a.until((x) => x.msgs.find((q) => q["1"] === ITEMCOUNT && q.B && q.B[0] === 18432), 3000);
    check(!!ic1, "Stone Axe pick -> item_count B [18432]");
    a.ops([[10, 72]]);
    check(!!(await a.until((x) => field(x, ia, "8") === 72, 3000)), "picked Stone Axe selectable (own field 8 = 72)");
  }
  for (const x of [a, b, c]) x.close();
  await sleep(300);
}
// decline, kick and the three locks; replies are the client clan module's sub-ops, log lines read from --log
const T0 = Date.now() / 1000;
const count = (c, m, f) => c.msgs.filter((q) => q["1"] === CLAN && q.m === m && (!f || f(q))).length;
async function locksKickDecline(a, b, c, ia, ib) {
  const nm = "U" + (Date.now() % 100000);
  a.json({ type: CLAN, o: O.CREATE, n: nm });
  const inf = await a.until((x) => x.msgs.find((q) => q["1"] === CLAN && q.m === M.INFO && q.o.n === nm), 3000);
  const tid = inf ? inf.o.x : 0;
  check(!!inf, "second clan " + nm + " id " + tid);
  // team lock: no request reaches the leader (the client would auto-decline it anyway)
  a.json({ type: CLAN, o: O.LOCK, n: 1 }); await sleep(300);
  const r0 = count(a, M.REQ);
  b.json({ type: CLAN, o: O.ASK, n: nm }); await sleep(1500);
  check(count(a, M.REQ) === r0, "team lock (o 49 n 1): bob's join request is not forwarded");
  a.json({ type: CLAN, o: O.LOCK, n: 0 });
  // join lock only stops automatic joins of friends/clan mates (client tooltip); requests still pass
  a.json({ type: CLAN, o: O.LOCKJOIN, n: 1 }); await sleep(3200);
  b.json({ type: CLAN, o: O.ASK, n: nm });
  const req = await a.until((x) => count(x, M.REQ) > r0, 3000);
  check(!!req, "team unlocked + join lock (o 55 n 1): request reaches the leader as m 3");
  const bi0 = count(b, M.INFO);
  a.json({ type: CLAN, o: O.DECLINE }); await sleep(1200);
  check(count(b, M.INFO) === bi0 && !c.msgs.some((q) => (q["1"] === CREATE || q["1"] === MOVE) && q["0"] === ib && q["14"] === tid * 2), "decline (o 11): bob gets no INFO, no field 14");
  await sleep(2200);
  b.json({ type: CLAN, o: O.ASK, n: nm });
  await a.until((x) => count(x, M.REQ) > r0 + 1, 3000);
  a.json({ type: CLAN, o: O.ACCEPT });
  check(!!(await b.until((x) => count(x, M.INFO, (q) => q.o.x === tid) > 0, 3000)), "ask again + accept: bob joins " + nm);
  // hide leader: members list p = 1 and the leader triple (id 0) leaves the minimap markers
  a.json({ type: CLAN, o: O.HIDE, n: 1 }); await sleep(300);
  const am0 = count(a, M.MEMBERS);
  a.json({ type: CLAN, o: O.OPEN });
  const mem = await a.until((x) => count(x, M.MEMBERS) > am0 && x.msgs.filter((q) => q["1"] === CLAN && q.m === M.MEMBERS).pop(), 3000);
  check(mem && mem.p === 1 && mem.o.length === 2, "hide leader (o 25 n 1): m 83 p = 1 " + JSON.stringify(mem && { p: mem.p }));
  const p0 = count(b, M.POS);
  const pos = await b.until((x) => x.msgs.filter((q) => q["1"] === CLAN && q.m === M.POS).length > p0 && x.msgs.filter((q) => q["1"] === CLAN && q.m === M.POS).pop(), 11000);
  check(pos && pos.o.length === 3 && pos.o[2] === ib, "hidden leader: markers carry only bob " + JSON.stringify(pos && pos.o));
  const ua = mem ? mem.o.find((r) => r[4] === ia)[1] : 0, ub = mem ? mem.o.find((r) => r[4] === ib)[1] : 0;
  // locks travel with the clan: new leader's INFO has lo and jo
  a.json({ type: CLAN, o: O.LOCK, n: 1 }); await sleep(300);
  a.json({ type: CLAN, o: O.LEADER, n: ub });
  const linf = await b.until((x) => x.msgs.find((q) => q["1"] === CLAN && q.m === M.INFO && q.o.x === tid && q.o.l === 1), 3000);
  check(linf && linf.o.lo === 1 && linf.o.jo === 1, "new leader INFO {l 1, lo 1, jo 1} " + JSON.stringify(linf && linf.o));
  // kick: the kicked player gets m 10, the leader a fresh m 83, viewers see field 14 = 0
  const al0 = count(a, M.LEFT), bm0 = count(b, M.MEMBERS);
  b.json({ type: CLAN, o: O.KICK, n: ua });
  check(!!(await a.until((x) => count(x, M.LEFT) > al0, 3000)), "kick (o 38): alice gets m 10");
  check(!!(await b.until((x) => count(x, M.MEMBERS, (q) => q.o.length === 1) > 0 && count(x, M.MEMBERS) > bm0, 3000)), "kick: leader gets m 83 with one member");
  check(!!(await c.until((x) => field(x, ia, "14") === 0, 3000)), "kick: carol sees alice field 14 = 0");
  b.json({ type: CLAN, o: O.LEAVE });
  check(!!(await c.until((x) => x.msgs.find((q) => q["1"] === CLAN && q.m === M.DEL && q.o === tid), 3000)), "clan " + nm + " deleted");
  if (A.log) {
    await sleep(600);
    const fs = require("fs");
    const L = fs.readFileSync(A.log, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } }).filter((o) => o.t >= T0 && o.id === tid);
    const has = (k, f) => L.some((o) => o.k === k && (!f || f(o)));
    check(has("clan_lock", (o) => o.what === "team" && o.v === 1) && has("clan_lock", (o) => o.what === "team" && o.v === 0), "log clan_lock what=team v 1 and v 0");
    check(has("clan_lock", (o) => o.what === "join" && o.v === 1), "log clan_lock what=join v 1");
    check(has("clan_lock", (o) => o.what === "hide_leader" && o.v === 1), "log clan_lock what=hide_leader v 1");
    check(has("clan_decline", (o) => o.member === ub), "log clan_decline member = bob");
    check(has("clan_kick", (o) => o.member === ua), "log clan_kick member = alice");
    check(has("clan_ask") && has("clan_accept", (o) => o.member === ub) && has("clan_leader", (o) => o.n === ub), "log clan_ask, clan_accept, clan_leader");
    check(L.every((o) => !Object.keys(o).some((k) => /ip|addr/i.test(k))), "clan log lines carry no address fields");
  } else console.log("note: pass --log <server.jsonl> to check the log lines");
}
async function gatherTo(c, id, xp, ms) {
  const end = Date.now() + ms, tried = new Set();
  while (Date.now() < end && xpOf(c) < xp) {
    const me = posOf(c, id); if (!me) return false;
    let best = null, bd = 1e9;
    for (const q of c.msgs) if (q["1"] === CREATE && q["2"] === 3 && !tried.has(q["0"])) { const d = Math.hypot(q["3"] - me[0], q["4"] - me[1]); if (d < bd) { bd = d; best = q; } }
    if (!best) return false;
    tried.add(best["0"]);
    for (let s = 0; s < 40; s++) {
      const p = posOf(c, id), dx = best["3"] - p[0], dy = best["4"] - p[1];
      if (Math.hypot(dx, dy) < 190) break;
      const keys = []; if (Math.abs(dx) > 30) keys.push(dx > 0 ? 1 : 0); if (Math.abs(dy) > 30) keys.push(dy > 0 ? 2 : 3);
      c.ops(keys.map((k) => [5, k + 256])); await sleep(120); c.ops(keys.map((k) => [5, k])); await sleep(120);
    }
    const p = posOf(c, id), a = Math.atan2(best["4"] - p[1], best["3"] - p[0]), code = Math.round(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1000);
    const x0 = xpOf(c);
    c.ops([[0, code], [4, (code << 3) + 1]]);
    await sleep(3000);
    if (xpOf(c) === x0) { c.ops([[4, 0]]); continue; }
    let last = xpOf(c), lastAt = Date.now();
    while (Date.now() < end && xpOf(c) < xp && Date.now() - lastAt < 3000) { await sleep(300); if (xpOf(c) !== last) { last = xpOf(c); lastAt = Date.now(); } }
    c.ops([[4, 0]]);
  }
  return xpOf(c) >= xp;
}

(async () => {
  if (A.unit) unit();
  if (A.port) { if (+A.port === 8921) { console.log("refusing port 8921"); process.exit(2); } await live(+A.port); }
  if (!A.unit && !A.port) { console.log("usage: --unit | --port N"); process.exit(2); }
  console.log((fails ? "FAILED " : "OK ") + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})();
