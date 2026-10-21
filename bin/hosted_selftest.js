#!/usr/bin/env node
// Self-test against a running hosted server on loopback (no browser).
// Usage: node bin/hosted_selftest.js [--port 8920] [--test slots|multi|world|garbage|load|biome|resource|chest|structures|events|ocean|all]
//        [--bots 40] [--hconfig mimic/hosted_config.json (the config the server runs with)] [--wait 70000 (longest wait, ms)]
//  slots: 20 sequential open/close from one local peer, then the per-IP caps (3 per X-Forwarded-For client,
//         16 per local peer) fill and release; ends with 16 parallel local sockets to prove every slot came back
//  multi: two players join one room (--mode multi), see each other, move, one hits the other until he dies, respawn
//  world: an animal is chased and killed (kill XP), a placed spike hurts another player, chat reaches a neighbour
//  garbage: malformed frames, junk payloads, oversize and flood; the server must stay up and drop only the offender
//  load:  --bots players join one room, walk and swing for 30 s; reports frame rate and gaps per client
//  biome: live timer at connect/join; waits for a phase switch (if due within --wait) and checks the switch frame
//  resource: a tree/stone is hit until it depletes (hp byte 7, {7:0,10:1}, remove), then the same-spot respawn
//  chest: walk to the nearest gift, 5 hits 196 137 78 20 0, type 75 + loot, remove
//  structures: door pop-in/placed_list/open/close/stays after leave; wall broken by hits, item_count back, decay
//  churn: --minutes 30 of sockets joining, walking and leaving (clean and abrupt); a fresh join is probed every minute
//  admin: /admin hits take half the max hp: two hits kill a player
//  blast: Air Blast Gun (invented): picked at age 1, one shot at a bot player and one at a creature: poke 8, pushed away > 150, 3 waves
//  events: board ob/pa, announcement (announce_on_join), map markers 80 / 65 when due within --wait
"use strict";
const net = require("net"), path = require("path");
const { TestClient } = require(path.join(__dirname, "..", "mimic", "hosted", "testclient.js"));
const { encodeJoin } = require(path.join(__dirname, "..", "mimic", "hosted", "joincodec.js"));
const A = {}; for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const PORT = +(A.port || 8920), HOST = "127.0.0.1:" + PORT, TEST = A.test || "slots";
const ROOM2 = A.room2 || "offline1";   // a second listed room for --test oneworld (default: the single room)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails++; };

function client(room, xff) {
  return new TestClient(() => net.connect(PORT, "127.0.0.1"), { host: HOST, path: "/_h/offline1/" + (room || "offline1") + "?1_2", origin: "http://" + HOST, xff });
}
async function opened(c) { await c.until((x) => x.status, 3000); return c.open; }
async function closeAndWait(c) { c.close(); await c.until((x) => x.closed, 3000); return c.closed; }

async function slots() {
  let ok = 0;
  for (let i = 0; i < 20; i++) {
    const c = client();
    if (await opened(c)) { await c.until((x) => x.msgs.length > 5, 2000); if (await closeAndWait(c)) ok++; }
    else console.log("  socket " + i + ": " + c.status);
  }
  check(ok === 20, "20 sequential open/close from one local peer: " + ok + "/20");
  const xs = [];
  for (let i = 0; i < 3; i++) { const c = client(null, "203.0.113.7"); xs.push(c); await opened(c); }
  check(xs.every((c) => c.open), "3 sockets for one forwarded client accepted");
  const fourth = client(null, "203.0.113.7"); await opened(fourth);
  check(!fourth.open && /429/.test(fourth.status || ""), "4th socket for that client rejected (" + fourth.status + ")");
  await closeAndWait(xs[0]); await sleep(200);
  const again = client(null, "203.0.113.7"); await opened(again);
  check(again.open, "slot reused after a close");
  for (const c of [again, xs[1], xs[2]]) await closeAndWait(c);
  const raw = net.connect(PORT, "127.0.0.1");   // half-open: client sends the upgrade then FIN without a close frame
  raw.write("GET /_h/offline1/offline1?1_2 HTTP/1.1\r\nHost: " + HOST + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
  raw.on("error", () => { }); await sleep(300); raw.end(); await sleep(300); raw.destroy();
  const par = [];
  for (let i = 0; i < 16; i++) par.push(client());
  await Promise.all(par.map(opened));
  const n = par.filter((c) => c.open).length;
  check(n === 16, "16 parallel local sockets after the churn (all slots released): " + n + "/16");
  const extra = client(); await opened(extra);
  check(!extra.open, "17th local socket rejected (" + extra.status + ")");
  for (const c of par) await closeAndWait(c);
}


const MOVE = 84, CREATE = 79, REMOVE = 87;
const join = (c, name) => c.json({ type: 1, c: encodeJoin(JSON.stringify({ name }), 243) });
const ownId = async (c) => { const m = await c.until((x) => x.msgs.find((q) => q["1"] === 19 && q.s === false), 3000); return m ? Math.floor(m.id / 256) : null; };
const posOf = (c, id) => { let p = null; for (const q of c.msgs) if ((q["1"] === CREATE || q["1"] === MOVE) && q["0"] === id && q["3"] != null) p = [q["3"], q["4"]]; return p; };

async function oneWorld() {   // one_world: players in different listed rooms share one world
  const a = client("offline1"), b = client(ROOM2);
  await opened(a); await opened(b);
  join(a, "roomone"); join(b, "roomtwo");
  const ia = await ownId(a), ib = await ownId(b);
  const seen = await a.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === ib), 4000);
  check(!!ia && !!ib && !!seen, "offline1 player sees the " + ROOM2 + " player (" + ia + ", " + ib + ")");
  await closeAndWait(a); await closeAndWait(b);
}
const xpOf = (c) => (c.msgs.filter((q) => q["1"] === 27).pop() || { i: 0 }).i;
const aimCode = (from, to) => { const a = Math.atan2(to[1] - from[1], to[0] - from[0]); return Math.round(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1000); };
// walk c (entity id) toward the point given by target() until within dist
async function walkTo(c, id, target, dist, maxSteps) {
  for (let step = 0; step < (maxSteps || 60); step++) {
    const p = posOf(c, id), t = target(); if (!p || !t) return false;
    const dx = t[0] - p[0], dy = t[1] - p[1];
    if (Math.hypot(dx, dy) < dist) return true;
    const keys = [];
    if (Math.abs(dx) > 25) keys.push(dx > 0 ? 1 : 0);
    if (Math.abs(dy) > 25) keys.push(dy > 0 ? 2 : 3);
    c.ops(keys.map((k) => [5, k + 256])); await sleep(110); c.ops(keys.map((k) => [5, k])); await sleep(140);
  }
  return false;
}
async function multi() {
  const a = framed(client("offline1")), b = framed(client("offline1"));
  check(await opened(a) && await opened(b), "two sockets open in offline1");
  await sleep(300);
  a.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "alice" }), 243) });
  await sleep(200);
  b.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "bob" }), 243) });
  const own = async (c) => { const m = await c.until((x) => x.msgs.find((q) => q["1"] === 19 && q.s === false), 3000); return m ? Math.floor(m.id / 256) : null; };
  const ida = await own(a), idb = await own(b);
  check(ida && idb && ida !== idb, "both joined with own ids " + ida + ", " + idb);
  const seen = async (c, id) => c.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === id), 4000);
  const ca = await seen(a, idb), cb = await seen(b, ida);
  check(!!ca && !!cb, "each sees the other's player create (names " + (ca && ca["18"]) + ", " + (cb && cb["18"]) + ")");
  // put bob next to alice: alice walks toward bob's position
  const pos = (c, id) => { let p = null; for (const q of c.msgs) if ((q["1"] === CREATE || q["1"] === MOVE) && q["0"] === id && q["3"] != null) p = [q["3"], q["4"]]; return p; };
  const startB = pos(a, idb);
  b.ops([[5, 1 + 256]]); await sleep(700); b.ops([[5, 1]]); await sleep(500);
  const movedB = pos(a, idb);
  check(startB && movedB && movedB[0] > startB[0], "alice sees bob walk right: x " + (startB && startB[0]) + " -> " + (movedB && movedB[0]));
  // wait out the spawn shield, then walk alice to bob and swing at him
  await sleep(4300);
  for (let step = 0; step < 40; step++) {
    const pa = pos(a, ida), pb = pos(a, idb); if (!pa || !pb) break;
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], d = Math.hypot(dx, dy);
    if (d < 85) break;   // hand reach: 30 from the body edge (client table)
    const keys = [];
    if (Math.abs(dx) > 40) keys.push(dx > 0 ? 1 : 0);
    if (Math.abs(dy) > 40) keys.push(dy > 0 ? 2 : 3);
    a.ops(keys.map((k) => [5, k + 256])); await sleep(120); a.ops(keys.map((k) => [5, k])); await sleep(150);
  }
  const pa = pos(a, ida), pb = pos(a, idb);
  const ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]), code = Math.round(((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1000);
  console.log("  alice at " + pa + ", bob at " + pb + ", distance " + Math.round(Math.hypot(pb[0] - pa[0], pb[1] - pa[1])));
  a.ops([[0, code], [4, (code << 3) + 1]]);
  const hit = await b.until((x) => x.msgs.find((q) => q["1"] === MOVE && q["0"] === idb && q["12"] != null && q["12"] < 100), 4000);
  a.ops([[4, 0]]);
  check(!!hit, "bob's HP drops after alice's swing: hp " + (hit && hit["12"]) + ", damage " + (hit && hit["10"]));
  const seenByA = a.msgs.find((q) => q["1"] === MOVE && q["0"] === idb && q["12"] != null && q["12"] < 100);
  check(!!seenByA, "alice sees bob's HP drop too");
  // keep swinging until bob dies: death screen for bob, his entity removed for alice, kill XP for alice
  const xpA0 = (a.msgs.filter((q) => q["1"] === 27).pop() || { i: 0 }).i;
  // alice chases and re-aims between swings
  const t0 = Date.now(); let dead = null;
  while (!dead && Date.now() - t0 < 120000) {
    await walk(a, ida, () => pos(a, idb), 90, 3000);
    const p1 = pos(a, ida), p2 = pos(a, idb); if (!p1 || !p2) break;
    const c2 = aimCode(p1, p2);
    a.ops([[0, c2], [4, (c2 << 3) + 1]]); await sleep(700); a.ops([[4, 0]]);
    dead = b.msgs.find((q) => q["1"] === 6) || await b.until((x) => x.msgs.find((q) => q["1"] === 6), 200);
  }
  console.log("  death after " + ((Date.now() - t0) / 1000).toFixed(1) + " s of swinging");
  a.ops([[4, 0]]);
  check(!!dead, "bob dies and gets the death screen (kills " + (dead && dead.o.k) + ", score " + (dead && dead.o.s) + ")");
  const SBK = ["k", "ga", "t", "s", "p", "re", "it", "sbk", "sba", "sbi", "sbb", "sbp", "sbf", "sbw", "sbs", "sbt", "sbu"];
  check(!!dead && SBK.every((k) => k in dead.o) && Object.keys(dead.o).length === 17 && dead.o.sbk[0] === 1 && dead.o.sbk[1] === "alice", "scoreboard has the 17 fields, killed by " + JSON.stringify(dead && dead.o.sbk));
  await sleep(300);
  const di = dead ? b.msgs.indexOf(dead) : -1, cam = di >= 0 && b.msgs[di + 1], rmo = di >= 0 && b.msgs[di + 2];
  check(cam && cam["1"] === 19 && cam.s === true && Math.floor(cam.id / 256) === idb && rmo && rmo["1"] === REMOVE && rmo["0"] === idb, "death frame order: scoreboard, camera on own id, remove own");
  // owner death: the pet gets {7: 18} in the owner's death frame, its remove comes one frame after the own remove
  const petB = b.msgs.find((q) => q["1"] === CREATE && q["2"] === 0 && q["13"] === idb);
  const petGone = petB && b.msgs.slice(0, b.msgs.indexOf(dead)).some((q) => q["1"] === REMOVE && q["0"] === petB["0"]);
  if (!petB || petGone) skip("pet at the owner's death (no live pet when bob died)");
  else {
    const d16 = b.msgs.find((q) => q["1"] === MOVE && q["0"] === idb && q["7"] === 16), p18 = b.msgs.find((q) => q["1"] === MOVE && q["0"] === petB["0"] && q["7"] === 18);
    const rmO = b.msgs.find((q) => q["1"] === REMOVE && q["0"] === idb), rmP = await b.until((x) => x.msgs.find((q) => q["1"] === REMOVE && q["0"] === petB["0"]), 1500);
    check(!!d16 && !!p18 && d16._f === p18._f, "pet " + petB["0"] + " {7: 18} in the owner's death frame (frames " + (d16 && d16._f) + ", " + (p18 && p18._f) + ")");
    check(!!rmO && !!rmP && rmP._f > rmO._f && rmP._t - rmO._t <= 300, "pet removed one frame after the owner (" + (rmO && rmP ? rmP._t - rmO._t : "?") + " ms)");
  }
  await sleep(300);
  check(!!a.msgs.find((q) => q["1"] === REMOVE && q["0"] === idb), "bob's body removed for alice");
  const xpA1 = (a.msgs.filter((q) => q["1"] === 27).pop() || { i: 0 }).i;
  check(xpA1 > xpA0, "alice gets kill XP: " + xpA0 + " -> " + xpA1);
  // dead: one spectate camera per client re-key (op 16) about 0.27 s later, none without one
  const camsB = () => b.msgs.slice(b.msgs.indexOf(dead) + 2).filter((q) => q["1"] === 19 && q.s === true && Math.floor(q.id / 256) === idb);
  await sleep(1500);
  const cams0 = camsB().length, lags = [];
  for (let i = 0; i < 3; i++) {
    const n0 = camsB().length, t0 = Date.now();
    b.ops([[16, 37 + i]]);
    const got = await b.until(() => camsB().length > n0, 1500);
    lags.push(got ? Date.now() - t0 : null);
    await sleep(900);
  }
  check(cams0 === 0 && camsB().length === 3 && lags.every((l) => l != null && l >= 150 && l <= 500), "spectate camera only per re-key: " + cams0 + " before, " + camsB().length + " for 3 re-keys, lag ms " + lags.join(" "));
  const deadB = b.msgs.slice(b.msgs.indexOf(dead) + 1), deadS = ((Date.now() - dead._t) / 1000).toFixed(1);
  check(!deadB.some((q) => q["1"] === BOARD) && a.msgs.some((q) => q["1"] === BOARD && q._t >= dead._t), "no leaderboard to bob while dead (" + deadS + " s), alice still gets it");
  const nb = b.msgs.length;
  b.json({ type: 1, c: encodeJoin(JSON.stringify({ name: "bob" }), 243) });
  const re = await b.until((x) => x.msgs.slice(nb).find((q) => q["1"] === 19 && q.s === false), 3000);
  const idb2 = re ? Math.floor(re.id / 256) : null;
  const rtypes = new Set(b.msgs.slice(nb).map((q) => q["1"]));
  check([31, 58, 11, 86, 32, 53, 27].every((x) => rtypes.has(x)), "respawn replays join values 31 58 11 86 + timer, inventory, xp (66: " + rtypes.has(66) + ")");
  check(!!re && idb2 !== idb, "bob respawns with a new entity " + idb2);
  const bd2 = await b.until((x) => x.msgs.slice(nb).find((q) => q["1"] === BOARD), G.board_ticks * G.send_ms + 1000);
  check(!!bd2, "leaderboard back after the respawn");
  // the respawned entity must reach alice within 1 s when it is inside her create box, else once she walks there
  const nb2 = await b.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === idb2), 2000);
  const pa2 = posOf(a, ida), inBox = (p) => p && pa2 && Math.abs(p[0] - pa2[0]) < 1370 && Math.abs(p[1] - pa2[1]) < 933;
  const bp = nb2 ? [nb2["3"], nb2["4"]] : null;
  let back = await a.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === idb2), inBox(bp) ? 1000 : 300);
  if (!back && !inBox(bp) && bp) { await walk(a, ida, () => bp, 700, 15000); back = await a.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === idb2), 1000); }
  check(!!back, "alice gets the respawned bob's create" + (inBox(bp) ? " within 1 s" : " after walking into view") + " (bob at " + bp + ", alice at " + pa2 + ")");
  const board = a.msgs.filter((q) => q["1"] === 64).length;
  check(board > 0, "leaderboard frames received: " + board);
  // decode the board the way the client does: key = 29 + o of the join value 86 (88 for o 59), JSON.parse(dec(o, key))
  const j86 = a.msgs.find((q) => q["1"] === 86), bkey = 29 + (j86 ? j86.o : 59);
  const { decBoard } = require(path.join(__dirname, "..", "mimic", "hosted", "crypto.js"));
  let rowsB = null; try { rowsB = JSON.parse(decBoard(a.msgs.filter((q) => q["1"] === 64 && q.o).pop().o, bkey)); } catch (e) { rowsB = String(e.message); }
  const names = Array.isArray(rowsB) ? rowsB.filter(Array.isArray).map((r) => r[1]) : [];
  check(names.includes("alice") && names.includes("bob"), "leaderboard decodes with key " + bkey + " (join 86 o " + (j86 && j86.o) + "): " + JSON.stringify(names));
  await closeAndWait(b); await sleep(400);
  check(!back || !!a.msgs.find((q) => q["1"] === REMOVE && q["0"] === idb2), "bob removed from alice's view after he leaves");
  await closeAndWait(a);
}


async function worldTest() {
  // animal: chase the nearest creature and swing until it is removed
  const h = client("offline1"); await opened(h); join(h, "hunter");
  let idh = await ownId(h);
  check(!!idh, "hunter joined " + idh);
  await sleep(500);
  const alive = () => {   // visible animals, nearest first
    const me = posOf(h, idh), gone = new Set(h.msgs.filter((q) => q["1"] === REMOVE).map((q) => q["0"]));
    return h.msgs.filter((q) => q["1"] === CREATE && q["2"] === 0 && !q["13"] && !gone.has(q["0"])).map((q) => [q["0"], posOf(h, q["0"])])
      .filter((x) => x[1]).map((x) => [x[0], Math.hypot(x[1][0] - me[0], x[1][1] - me[1])]).sort((a, b) => a[1] - b[1]);
  };
  const first = alive();
  if (!first.length) { await sleep(3000); first.push(...alive()); }
  if (!first.length) skip("animal hunt: no wild creature in view at the spawn in this phase");
  else check(first.length > 0, "animals in view: " + first.length + ", nearest at " + Math.round(first.length ? first[0][1] : 0));
  if (first.length) {
  const xp0 = xpOf(h), t0 = Date.now(), kills0 = h.msgs.filter((q) => q["1"] === REMOVE).length;
  let killed = false, prey = null;
  for (let i = 0; i < 80; i++) {
    if (i > 20 && h.msgs.find((q) => q["1"] === MOVE && q["9"] != null && q["9"] < 255 && q["10"] > 0 && q["0"] !== idh)) break;
    const list = alive(); if (!list.length) { await sleep(500); continue; }
    if (prey && !list.find((x) => x[0] === prey)) {
      const p0 = posOf(h, prey), me = posOf(h, idh);
      if (p0 && Math.hypot(p0[0] - me[0], p0[1] - me[1]) < 300) { killed = true; break; }   // removed next to us: our kill
    }
    prey = list[0][0];
    await walkTo(h, idh, () => posOf(h, prey), 90, 4);
    const p = posOf(h, idh), t = posOf(h, prey); if (!p || !t) continue;
    const code = aimCode(p, t);
    h.ops([[0, code], [4, (code << 3) + 1]]); await sleep(800); h.ops([[4, 0]]);
  }
  const wild = new Set(h.msgs.filter((q) => q["1"] === CREATE && q["2"] === 0 && !q["13"]).map((q) => q["0"]));
  const bar = h.msgs.find((q) => q["1"] === MOVE && wild.has(q["0"]) && q["9"] != null && q["9"] < 255 && q["10"] > 0);
  check(killed || !!bar, (killed ? "animal killed after " : "animal hit (hp bar " + (bar && bar["9"]) + "), not killed in ") + ((Date.now() - t0) / 1000).toFixed(1) + " s, XP " + xp0 + " -> " + xpOf(h));
  }
  if (h.msgs.find((q) => q["1"] === 6)) {   // the hunt can kill the hunter (aggressive creatures): respawn him
    const nh = h.msgs.length; join(h, "hunter");
    const m = await h.until((x) => x.msgs.slice(nh).find((q) => q["1"] === 19 && q.s === false), 3000);
    if (m) idh = Math.floor(m.id / 256);
    console.log("  hunter died during the hunt, respawned as " + idh);
  }
  // spike: the hunter places a wooden spike east of himself, a second player walks into it
  const v = client("offline1"); await opened(v); join(v, "victim");
  const idv = await ownId(v);
  await sleep(5200);   // spawn shield
  let spike = null;
  for (const aim of [0, 1571, 3142, 4712, 785, 2356, 3927, 5498]) {   // first free direction
    h.ops([[10, 266], [0, aim]]); await sleep(250);
    h.ops([[4, (aim << 3) + 1]]); await sleep(250); h.ops([[4, 0]]);
    spike = await h.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["2"] === 3 && q["16"] === idh), 700);
    if (spike) break;
  }
  check(!!spike, "spike placed at " + (spike && [spike["3"], spike["4"]]));
  if (spike) {
    await walk(v, idv, () => [spike["3"], spike["4"]], 70, 25000);
    const hit = await v.until((x) => x.msgs.find((q) => q["1"] === MOVE && q["0"] === idv && q["12"] != null && q["12"] < 100), 3000);
    check(!!hit, "victim hurt by the spike: hp " + (hit && hit["12"]));
  }
  // chat: the victim says something, the hunter (in view) gets the bubble
  v.json([{ type: 39, msg: "hello <b>there</b>", tm: 0 }, 1365]);
  const bubble = await h.until((x) => x.msgs.find((q) => q["1"] === 39 && q.i === idv), 2000);
  check(!!bubble, "chat bubble delivered: " + JSON.stringify(bubble && bubble.m));
  // a binary op inside a JSON frame (the client's key release-all after chat) must be applied
  v.ops([[5, 1 + 256]]); await sleep(500);
  v.json([{ type: 39, msg: "stop", tm: 0 }, 5 + 5 * 256]); await sleep(900);
  const s1 = posOf(h, idv) || posOf(v, idv); await sleep(800); const s2 = posOf(h, idv) || posOf(v, idv);
  check(s1 && s2 && Math.hypot(s2[0] - s1[0], s2[1] - s1[1]) < 5, "release-all op inside a JSON chat frame stops the walk (" + s1 + " -> " + s2 + ")");
  await closeAndWait(v); await closeAndWait(h);
}

async function load() {
  const n = +(A.bots || 40), cs = [];
  for (let i = 0; i < n; i++) { const c = client("offline1", "198.51.100." + (1 + Math.floor(i / 3))); cs.push(c); }   // 3 per forwarded address
  await Promise.all(cs.map(opened));
  const ok = cs.filter((c) => c.open);
  check(ok.length === n, n + " sockets open in offline1: " + ok.length);
  ok.forEach((c, i) => join(c, "bot" + i));
  await sleep(1500);
  const gaps = ok.map(() => ({ last: 0, max: 0, frames: 0 }));
  ok.forEach((c, i) => { const g = gaps[i], on = c.onData.bind(c); c.onData = (d) => { const t = Date.now(); if (g.last) g.max = Math.max(g.max, t - g.last); g.last = t; g.frames++; on(d); }; });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    ok.forEach((c, i) => { const k = (i + Math.floor((Date.now() - t0) / 1000)) % 4; c.ops([[5, k + 256], [0, (i * 700) % 6283], [4, (((i * 700) % 6283) << 3) + 1]]); });
    await sleep(500);
    ok.forEach((c, i) => { const k = (i + Math.floor((Date.now() - t0) / 1000)) % 4; c.ops([[5, k], [4, 0]]); });
    await sleep(500);
  }
  const secs = (Date.now() - t0) / 1000, fps = gaps.map((g) => g.frames / secs).sort((a, b) => a - b), mx = Math.max(...gaps.map((g) => g.max));
  const seen = ok.map((c) => new Set(c.msgs.filter((q) => q["1"] === CREATE && q["2"] === 1).map((q) => q["0"])).size).sort((a, b) => a - b);
  console.log("  frames/s per client min " + fps[0].toFixed(1) + " median " + fps[fps.length >> 1].toFixed(1) + ", worst gap " + mx + " ms, players seen per client min " + seen[0] + " max " + seen[seen.length - 1]);
  check(fps[0] > 8 && mx < 1500, "every client keeps getting frames under load");
  for (const c of ok) c.close();
  await sleep(1000);
}

async function garbage() {
  const crypto = require("crypto");
  const cases = [
    ["random binary payloads", (c) => { for (let i = 0; i < 30; i++) c.raw(crypto.randomBytes(1 + (i * 37) % 900)); }],
    ["junk text frames", (c) => { for (const t of ["{", "[1,2", "null", "{\"type\":1,\"c\":123}", "{\"type\":39,\"msg\":{}}", "[{\"type\":1,\"c\":null}]", "\u0000\u0001"]) c.frame(1, Buffer.from(t)); }],
    ["bad opcode", (c) => c.frame(3, Buffer.from("x"))],
    ["oversize frame header", (c) => { const h = Buffer.alloc(10); h[0] = 0x82; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(1e12), 2); c.sock.write(h); }],
    ["flood 400 frames", (c) => { for (let i = 0; i < 400; i++) c.ops([[8, 0]]); }],
    ["huge ops values", (c) => c.ops([[5, 2 ** 40], [0, 2 ** 45], [10, 2 ** 30], [4, 2 ** 44]])],
    ["raw non-websocket bytes", (c) => c.sock.write(crypto.randomBytes(3000))],
  ];
  for (const [name, f] of cases) {
    const c = client("offline1"); await opened(c); join(c, "junk");
    await sleep(200);
    try { f(c); } catch (e) { }
    await sleep(1500);
    const probe = client("offline1"); await opened(probe);
    const ok = probe.open && !!(await probe.until((x) => x.msgs.length > 10, 2000));
    check(ok, "server up after " + name + (c.closed ? " (offender dropped)" : " (offender kept)"));
    await closeAndWait(probe); if (!c.closed) await closeAndWait(c);
  }
}


// ---------------------------------------------------------------- v0.3 world features
// game numbers: --hconfig (the config the server was started with), defaults from hosted/game_config.js
const PKG = path.join(__dirname, "..");
const HCF = A.hconfig ? path.resolve(A.hconfig) : path.join(PKG, "mimic", "hosted_config.json");
let HC = {}; try { HC = JSON.parse(require("fs").readFileSync(HCF, "utf8")); } catch (e) { }
const G = require(path.join(PKG, "mimic", "hosted", "game_config.js")).gameConfig(HC.game);
let NAMES = []; try { NAMES = JSON.parse(require("fs").readFileSync(path.join(PKG, "decoder", "names.json"), "utf8")); } catch (e) { }
const nameOf = (q) => NAMES[q["13"]] || "";
const WAIT_MAX = +(A.wait || 70000);   // longer waits are skipped (start the server with a short test config to cover them)
const skip = (what) => console.log("SKIP " + what);
const TIMER = 32, GIFT = 75, PLACED = 81, ITEMCOUNT = 36, BOARD = 64, M80 = 80, M65 = 65, ANN = 52, INV = 53;
// tag every message with the chunk it arrived in (one chunk is one server frame on loopback)
function framed(c) { c.fr = 0; const on = c.onData.bind(c); c.onData = (d) => { const n = c.msgs.length, t = Date.now(); on(d); c.fr++; for (let i = n; i < c.msgs.length; i++) { c.msgs[i]._f = c.fr; c.msgs[i]._t = t; } }; return c; }
const fresh = (c, from) => c.msgs.slice(from);
const lastInv = (c) => Object.assign({}, ...c.msgs.filter((q) => q["1"] === INV).map((q) => q.i));   // join: full, then changed slots
const live = (c) => { const gone = new Set(c.msgs.filter((q) => q["1"] === REMOVE).map((q) => q["0"])); const m = new Map(); for (const q of c.msgs) if (q["1"] === CREATE && !gone.has(q["0"])) m.set(q["0"], q); return m; };
// walk with sidesteps when stuck
async function walk(c, id, target, dist, ms) {
  const end = Date.now() + (ms || 30000); let last = null, stuck = 0;
  while (Date.now() < end) {
    const p = posOf(c, id), t = target(); if (!p || !t) return false;
    const dx = t[0] - p[0], dy = t[1] - p[1];
    if (Math.hypot(dx, dy) < dist) return true;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 12) stuck++; else stuck = 0;
    last = p;
    let keys = [];
    if (stuck >= 2) { keys = Math.abs(dx) > Math.abs(dy) ? [Math.random() < 0.5 ? 2 : 3] : [Math.random() < 0.5 ? 0 : 1]; stuck = 0; }
    else { if (Math.abs(dx) > 25) keys.push(dx > 0 ? 1 : 0); if (Math.abs(dy) > 25) keys.push(dy > 0 ? 2 : 3); }
    c.ops(keys.map((k) => [5, k + 256])); await sleep(stuck ? 400 : 180); c.ops(keys.map((k) => [5, k])); await sleep(120);
  }
  return false;
}
async function swingAt(c, id, tx, ty, ms) {
  const p = posOf(c, id); if (!p) return;
  const code = aimCode(p, [tx, ty]);
  c.ops([[0, code], [4, (code << 3) + 1]]); await sleep(ms || 900); c.ops([[4, 0]]);
}
async function joined(name) {
  const c = framed(client("offline1")); await opened(c); join(c, name);
  const id = await ownId(c); await sleep(400); return [c, id];
}

// ocean (bbotot recordings 20261019): /next to phase 4, the octopus world boss is stage 3 type 21 at the board marker
// 5 spot, the three bmb statues stand at their spots (solid; breaking one wakes its statue BMB, Plant 88 / Water 90 / Fire 89,
// so none is pre-spawned), and /spawn octopus boss makes one more
async function ocean() {
  const [c, id] = await joined("diver");
  for (let i = 0; i < 6; i++) {
    const t = c.msgs.filter((q) => q["1"] === TIMER).pop(); if (t && t.b === 4) break;
    c.json([{ type: 39, msg: "/next", tm: 0 }]); await sleep(1200);
  }
  const tb = c.msgs.filter((q) => q["1"] === TIMER).pop();
  check(tb && tb.b === 4, "in the ocean phase (b " + (tb && tb.b) + ")");
  const n0 = c.msgs.length;
  const bd = await c.until((x) => x.msgs.slice(n0).find((q) => q["1"] === BOARD && q.ob), G.board_ticks * G.send_ms + 2000);
  check(bd && bd.ob[2] === 5, "board marker is the octopus (5): " + JSON.stringify(bd && bd.ob));
  if (bd) {
    const n1 = c.msgs.length; c.json([{ type: 39, msg: "/tp " + Math.round(bd.ob[0] * G.minimap_div) + " " + Math.round(bd.ob[1] * G.minimap_div), tm: 0 }]); await sleep(2500);
    const oc = c.msgs.slice(n1).find((q) => q["1"] === CREATE && q["21"] === 85);
    check(oc && oc["23"] === 3 && oc["22"] === 21, "octopus at the marker is stage 3 type 21: " + JSON.stringify(oc && [oc["21"], oc["22"], oc["23"], oc["3"], oc["4"]]));
  }
  const n2 = c.msgs.length; c.json([{ type: 39, msg: "/tp 1650 5900", tm: 0 }]); await sleep(2500);
  const fr = c.msgs.slice(n2), st = fr.filter((q) => q["1"] === CREATE && q["2"] === 3 && [402, 403, 404].includes(q["13"])).map((q) => [NAMES[q["13"]], q["3"], q["4"]]);
  check(st.length === 3, "three bmb statues: " + JSON.stringify(st));
  const sc = fr.filter((q) => q["1"] === CREATE && [88, 89, 90].includes(q["21"])).map((q) => [q["21"], q["22"], q["23"]]);
  check(sc.length === 0, "no statue BMB before its statue breaks: " + JSON.stringify(sc));
  c.json([{ type: 39, msg: "/tp 1897 5808", tm: 0 }]); await sleep(1500);
  const p = posOf(c, id);
  check(p && Math.hypot(p[0] - 1897, p[1] - 5808) > 60, "a statue blocks: standing " + (p && Math.round(Math.hypot(p[0] - 1897, p[1] - 5808))) + " from the bmb-statue center after /tp onto it");
  const n4 = c.msgs.length; c.json([{ type: 39, msg: "/spawn octopus boss", tm: 0 }]); await sleep(1500);
  const sp = c.msgs.slice(n4).find((q) => q["1"] === CREATE && q["21"] === 85);
  check(!!sp, "/spawn octopus boss: " + JSON.stringify(sp && [sp["21"], sp["22"], sp["23"]]));
  await closeAndWait(c);
}

// /admin: one admin swing takes half the target's max hp (bob 100 -> 50), the second kills
async function admin() {
  const [a, ida] = await joined("adm"), [b, idb] = await joined("victim");
  a.json([{ type: 39, msg: "/admin", tm: 0 }]); await sleep(5500);   // past the victim spawn shield
  const ok = await walk(a, ida, () => posOf(a, idb), 90, 30000);
  check(ok, "admin walked next to the victim");
  const hp = () => { let v = null; for (const q of b.msgs) if (q["1"] === MOVE && q["0"] === idb && q["12"] != null) v = q["12"]; return v; };
  const drops = () => a.msgs.filter((q) => q["1"] === MOVE && q["0"] === idb && q["10"] != null).map((q) => [q["10"], q["12"]]);
  for (let i = 0; i < 4 && !b.msgs.some((q) => q["1"] === 6); i++) { const t = posOf(a, idb); if (!t) break; await swingAt(a, ida, t[0], t[1], 600); await sleep(500); }
  const d = drops();
  check(d.length >= 1 && d.every((x) => x[0] === 50), "every admin hit (swing or his pets) takes 50 of 100: " + JSON.stringify(d));
  check(b.msgs.some((q) => q["1"] === 6) && d.length <= 2, "two admin hits kill (hits in one tick merge)");
  await closeAndWait(a); await closeAndWait(b);
}
// Air Blast Gun (invented, world.js blast): the level-1 pick 17 equips it; one shot pokes the target for 8 and the waves push it
// more than 150 away from the shooter; every shot shows 3 waves of effect 434 (3 along the cone each) about 150 ms apart
async function blastTest() {
  const B = require(path.join(__dirname, "..", "mimic", "hosted", "game_config.js")).DEFAULTS.blast;
  const [a, ida] = await joined("blaster"), [b, idb] = await joined("target");
  a.json([{ type: 39, msg: "/age 1", tm: 0 }]); await sleep(400);
  a.ops([[1, B.item]]);
  const held = await a.until((x) => x.msgs.find((q) => q["1"] === MOVE && q["0"] === ida && q["8"] === B.item), 3000);
  check(!!held, "age 1: pick op 1 value " + B.item + " equips the Air Blast Gun (own field 8 = " + B.item + ")");
  check(a.msgs.some((q) => q["1"] === 36 && q.B && q.B[0] === B.item * 256), "the pick replaces the Hand like a stone tool: item_count B [" + B.item * 256 + "]");
  a.json([{ type: 39, msg: "/age 1", tm: 0 }]); a.ops([[1, 72]]); await sleep(500);
  check(!a.msgs.some((q) => q["1"] === MOVE && q["0"] === ida && q["8"] === 72), "a second level-1 pick (Stone Axe) is refused");
  // shoot: aim at the target, hold attack for one shot, follow its position and hp from the shooter's view
  const fire = async (tid) => {
    const p0 = posOf(a, ida), t0 = posOf(a, tid); if (!p0 || !t0) return null;
    const code = aimCode(p0, t0), from = a.msgs.length, ux = Math.cos(code / 1000), uy = Math.sin(code / 1000), at = Date.now();
    a.ops([[0, code], [4, (code << 3) + 1]]); await sleep(150); a.ops([[4, 0]]); await sleep(1600);
    const after = a.msgs.slice(from);
    let far = 0; for (const q of after) if ((q["1"] === MOVE || q["1"] === CREATE) && q["0"] === tid && q["3"] != null) far = Math.max(far, (q["3"] - t0[0]) * ux + (q["4"] - t0[1]) * uy);
    const dmg = after.filter((q) => q["1"] === MOVE && q["0"] === tid && q["10"] != null).map((q) => q["10"]);
    const fx = after.filter((q) => q["1"] === CREATE && q["2"] === 4 && q["7"] === B.fx), frames = [...new Set(fx.map((q) => q._t))];
    return { dist: Math.round(Math.hypot(t0[0] - p0[0], t0[1] - p0[1])), far: Math.round(far), dmg, fx: fx.length, waves: frames.length, gaps: frames.slice(1).map((t, i) => t - frames[i]), at };
  };
  b.json([{ type: 39, msg: "/tp blaster", tm: 0 }]); await sleep(5600);   // next to the shooter, past the spawn shield
  const rp = await fire(idb);
  check(!!rp && rp.dmg.length === 1 && Math.abs(rp.dmg[0] - B.dmg.player) <= 1, "bot player poked once for about " + B.dmg.player + ": " + JSON.stringify(rp && rp.dmg) + " (at " + (rp && rp.dist) + ")");
  check(!!rp && rp.far > 150, "bot player pushed away from the shooter by more than 150: " + (rp && rp.far));
  check(!!rp && rp.waves === B.waves && rp.fx === B.waves * B.fx_fan.length, B.waves + " waves of effect " + B.fx + " (" + B.fx_fan.length + " each): " + (rp && rp.fx) + " in " + (rp && rp.waves) + " frames, gaps " + JSON.stringify(rp && rp.gaps) + " ms");
  check(!!rp && rp.gaps.every((g) => g >= 90 && g <= 300), "waves about " + B.gap_ms + " ms apart (frame aligned): " + JSON.stringify(rp && rp.gaps));
  // creature: spawn one, wait out its spawn pose, shoot it
  const wild = () => [...live(a).values()].filter((q) => q["2"] === 0 && !q["13"] && q["21"] === 0).map((q) => q["0"]);
  const before = new Set(wild());
  a.json([{ type: 39, msg: "/spawn wolf 1 adult", tm: 0 }]); await sleep(1500);
  const cid = wild().find((id) => !before.has(id));
  check(!!cid, "a wolf spawned next to the shooter (" + cid + ")");
  const near = cid ? await walk(a, ida, () => posOf(a, cid), 260, 20000) : false;
  check(near, "shooter within 260 of the wolf");
  const rc = cid ? await fire(cid) : null;
  check(!!rc && rc.dmg.length >= 1 && Math.abs(rc.dmg[0] - B.dmg.creature) <= 1, "creature poked for about " + B.dmg.creature + ": " + JSON.stringify(rc && rc.dmg) + " (at " + (rc && rc.dist) + ")");
  check(!!rc && rc.far > 150, "creature pushed away from the shooter by more than 150: " + (rc && rc.far));
  check(!!rc && rc.waves === B.waves, B.waves + " waves at the creature: " + (rc && rc.waves) + " frames, gaps " + JSON.stringify(rc && rc.gaps));
  await closeAndWait(a); await closeAndWait(b);
}
// long churn: sockets join, walk, die by leaving or dropping; a fresh join must still work every minute
async function churn() {
  const mins = +(A.minutes || 30), end = Date.now() + mins * 60000, live = [];
  let n = 0, nextProbe = Date.now() + 60000, probes = 0, okProbes = 0;
  while (Date.now() < end) {
    if (live.length < 8) {
      const c = client("offline1"); live.push(c); n++;
      opened(c).then((ok) => { if (ok) join(c, "churn" + n); });
    }
    for (const c of live) if (c.open && Math.random() < 0.3) { const k = Math.floor(Math.random() * 4); c.ops([[5, k + 256], [0, Math.floor(Math.random() * 6283)], [4, 1]]); }
    if (Math.random() < 0.25 && live.length) {
      const c = live.splice(Math.floor(Math.random() * live.length), 1)[0];
      if (Math.random() < 0.5) c.close(); else { try { c.sock.destroy(); } catch (e) { } }
    }
    if (Date.now() >= nextProbe) {
      nextProbe = Date.now() + 60000; probes++;
      const pc = client("offline1"); const ok = await opened(pc); if (ok) join(pc, "probe");
      const id = ok ? await ownId(pc) : null; if (id) okProbes++;
      console.log("  probe " + probes + " at " + Math.round((mins * 60000 - (end - Date.now())) / 1000) + " s: " + (id ? "joined " + id : "FAILED " + pc.status) + ", sockets opened " + n);
      await closeAndWait(pc);
    }
    await sleep(2000);
  }
  for (const c of live) c.close();
  await sleep(1500);
  const last = client("offline1"); const ok = await opened(last); if (ok) join(last, "final");
  const id = ok ? await ownId(last) : null;
  check(okProbes === probes && !!id, "fresh joins keep working through " + mins + " min of churn: " + okProbes + "/" + probes + " probes, final " + id);
  await closeAndWait(last);
}

// chat "/next": every player gets the next phase's timer, no chat bubble, a second /next within 0.5 s is ignored
async function nextCmd() {
  const [a, ia] = await joined("nexter"), [b, ib] = await joined("watcher2");
  const t0 = a.msgs.filter((q) => q["1"] === TIMER).pop(), order = G.biome_order || [0, 1, 2, 3, 4, 5];
  const na = a.msgs.length, nb = b.msgs.length;
  a.json([{ type: 39, msg: "/next", tm: 0 }]);
  const ta = await a.until((x) => fresh(x, na).find((q) => q["1"] === TIMER), 3000), tb = await b.until((x) => fresh(x, nb).find((q) => q["1"] === TIMER), 3000);
  const want = order[(order.indexOf(t0.b) + 1) % order.length];
  check(ta && tb && ta.b === want && tb.b === want, "/next switches every player to phase " + want + " (" + (ta && ta.b) + ", " + (tb && tb.b) + ", d " + (ta && ta.d) + ")");
  check(!fresh(b, nb).find((q) => q["1"] === 39), "/next is not broadcast as chat");
  const n2 = a.msgs.length; a.json([{ type: 39, msg: "/next", tm: 0 }]); await sleep(1500);
  check(!fresh(a, n2).find((q) => q["1"] === TIMER), "a second /next within the cooldown is ignored");
  await closeAndWait(a); await closeAndWait(b);
}

async function biome() {
  const c = framed(client("offline1")); await opened(c);
  const t0 = await c.until((x) => x.msgs.find((q) => q["1"] === TIMER), 3000);
  const order = (G.biome_order || [1, 2, 3, 4, 5, 0]);
  check(!!t0 && t0.d > 0 && order.includes(t0.b), "live biome timer at connect: b " + (t0 && t0.b) + ", d " + (t0 && t0.d) + " ms");
  join(c, "biome"); const id = await ownId(c);
  const tj = await c.until((x) => x.msgs.filter((q) => q["1"] === TIMER).length >= 2 && x.msgs.filter((q) => q["1"] === TIMER)[1], 3000);
  check(!!tj && tj.b === t0.b && tj.d <= t0.d, "timer again at join: b " + (tj && tj.b) + ", d " + (tj && tj.d));
  if (!t0 || t0.d > WAIT_MAX) { skip("biome switch: " + Math.round((t0 ? t0.d : 0) / 1000) + " s left in the phase (> " + WAIT_MAX / 1000 + " s)"); await closeAndWait(c); return; }
  const before = live(c);
  const oldObjs = [...before.values()].filter((q) => q["2"] === 3 && q["16"] == null).map((q) => q["0"]);
  const n0 = c.msgs.length;
  const sw = await c.until((x) => fresh(x, n0).find((q) => q["1"] === TIMER), t0.d + 5000);
  check(!!sw && sw.b === order[(order.indexOf(t0.b) + 1) % order.length], "biome switch " + t0.b + " -> " + (sw && sw.b) + ", next d " + (sw && sw.d));
  if (!sw) { await closeAndWait(c); return; }
  await sleep(1500);
  const same = c.msgs.filter((q) => q._f === sw._f);
  const newC = same.filter((q) => q["1"] === CREATE && q["2"] === 3 && !before.has(q["0"]));
  const pop = newC.filter((q) => same.find((m) => m["1"] === MOVE && m["0"] === q["0"] && m["7"] === 255));
  const dest = same.filter((q) => q["1"] === MOVE && oldObjs.includes(q["0"]) && q["7"] === 0 && q["10"] === 1);
  const after = fresh(c, n0);
  const removed = oldObjs.filter((id) => after.find((q) => q["1"] === REMOVE && q["0"] === id));
  console.log("  in view before " + oldObjs.length + " objects; switch frame: " + newC.length + " creates (" + pop.length + " with 7=255), " + dest.length + " {7:0,10:1}; removed within 1.5 s: " + removed.length);
  check(newC.length > 0 && pop.length === newC.length, "new-phase objects created in the switch frame with pop-in 7=255");
  check(oldObjs.length === 0 || (dest.length === oldObjs.length && removed.length === oldObjs.length), "every old object in view gets {7:0,10:1} then a remove");
  const names = new Set(newC.map(nameOf)); console.log("  new defs: " + [...names].slice(0, 8).join(", "));
  const dying = same.filter((q) => q["1"] === MOVE && q["7"] === 18 && q["9"] === 0 && q["10"] > 0);
  console.log("  old creatures killed in the switch frame: " + dying.length);
  await closeAndWait(c);
}

async function resource() {
  const [c, id] = await joined("lumber");
  const me = posOf(c, id);
  const cands = [...live(c).values()].filter((q) => q["2"] === 3 && q["16"] == null && /tree|stone/.test(nameOf(q)) && !/gold/.test(nameOf(q)))
    .sort((a, b) => Math.hypot(a["3"] - me[0], a["4"] - me[1]) - Math.hypot(b["3"] - me[0], b["4"] - me[1]));
  check(cands.length > 0, "trees/stones in view: " + cands.length);
  if (!cands.length) { await closeAndWait(c); return; }
  const o = cands[0], nm = nameOf(o);
  await walk(c, id, () => [o["3"], o["4"]], (G.collide_by_def[nm] || 120) + 22, 20000);   // hand reach 30 from the edge
  const hps = [], inv0 = Object.assign({}, lastInv(c)), n0 = c.msgs.length, t0 = Date.now();
  let gone = null;
  while (Date.now() - t0 < 170000) {   // hand: 2 hp bytes per hit (sp5), ~128 hits
    await swingAt(c, id, o["3"], o["4"], 800);
    hps.length = 0; for (const q of fresh(c, n0)) if (q["1"] === MOVE && q["0"] === o["0"] && q["7"] != null && hps[hps.length - 1] !== q["7"]) hps.push(q["7"]);
    gone = fresh(c, n0).find((q) => q["1"] === MOVE && q["0"] === o["0"] && q["7"] === 0 && q["10"] === 1);
    if (gone) break;
    if (!hps.length && Date.now() - t0 > 8000) break;
  }
  console.log("  " + nm + " hp bytes " + hps.join(" ") + " in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  const inv1 = lastInv(c);
  check(hps.length > 1 && hps.every((v, i) => !i || v < hps[i - 1]), "hp byte 7 drops per hit");
  check(!!gone, "depleted: {7:0,10:1}");
  const rm = await c.until((x) => fresh(x, n0).find((q) => q["1"] === REMOVE && q["0"] === o["0"]), 2000);
  check(!!rm, "depleted object removed");
  check(Object.keys(inv1).some((k) => (inv1[k] || 0) > (inv0[k] || 0)), "yield kept while depleting: " + JSON.stringify(inv0) + " -> " + JSON.stringify(inv1));
  const invs = fresh(c, n0).filter((q) => q["1"] === INV);
  check(invs.length > 0 && invs.every((q) => Object.keys(q.i).length < 6 && !(q.i["4"] > 0)), "inventory updates carry only the changed slots and never slot 4: " + JSON.stringify(invs.slice(0, 3).map((q) => q.i)));
  if (G.resource_respawn_ms > WAIT_MAX) skip("respawn after " + G.resource_respawn_ms / 1000 + " s");
  else {
    const n1 = c.msgs.length, t1 = Date.now();
    const back = await c.until((x) => fresh(x, n1).find((q) => q["1"] === CREATE && q["13"] === o["13"] && Math.hypot(q["3"] - o["3"], q["4"] - o["4"]) < 30), G.resource_respawn_ms + 5000);
    check(!!back && back["0"] !== o["0"], "respawned at the same spot with a new id after " + ((Date.now() - t1) / 1000).toFixed(1) + " s");
  }
  await closeAndWait(c);
}

async function chest(again) {
  const [c, id] = await joined("chester");
  const tm = c.msgs.find((q) => q["1"] === TIMER);
  let W = null; try { W = JSON.parse(require("fs").readFileSync(path.join(PKG, "mimic", HC.world || "world_sp5.json"), "utf8")); } catch (e) { }
  const me = posOf(c, id);
  let gifts = [...live(c).values()].filter((q) => q["2"] === 3 && /^gift/.test(nameOf(q))).map((q) => ({ id: q["0"], x: q["3"], y: q["4"], name: nameOf(q) }));
  if (!gifts.length && W && W.phases && tm) gifts = (W.phases[tm.b] ? W.phases[tm.b].objects : []).filter((o) => /^gift/.test(o.name)).map((o) => ({ id: null, x: o["3"], y: o["4"], name: o.name }));
  gifts.sort((a, b) => Math.hypot(a.x - me[0], a.y - me[1]) - Math.hypot(b.x - me[0], b.y - me[1]));
  if (!gifts.length && tm && tm.d < WAIT_MAX) {
    console.log("  no gift in this phase, waiting for the next one (" + Math.round(tm.d / 1000) + " s)");
    await closeAndWait(c); await sleep(tm.d + 1500); return chest(true);
  }
  if (!gifts.length) { skip("chest: no gift in phase " + (tm && tm.b) + " and the next phase is " + Math.round((tm ? tm.d : 0) / 1000) + " s away"); await closeAndWait(c); return; }
  check(gifts.length > 0, "gifts known: " + gifts.length + ", nearest " + (gifts[0] && gifts[0].name) + " at " + (gifts[0] && Math.round(Math.hypot(gifts[0].x - me[0], gifts[0].y - me[1]))));
  if (!gifts.length) { await closeAndWait(c); return; }
  const g = gifts[0], cd = G.collide_by_def[g.name] || 110;
  if (Math.hypot(g.x - me[0], g.y - me[1]) > +(A.giftwalk || 2500)) { skip("chest: nearest gift " + Math.round(Math.hypot(g.x - me[0], g.y - me[1])) + " units away (> --giftwalk 2500)"); await closeAndWait(c); return; }
  const there = await walk(c, id, () => [g.x, g.y], cd + 22, 45000);
  const q = [...live(c).values()].find((m) => m["2"] === 3 && /^gift/.test(nameOf(m)) && Math.hypot(m["3"] - g.x, m["4"] - g.y) < 10);
  check(there && !!q, "walked to the " + g.name + (there ? "" : " (did not arrive)"));
  if (!q) { await closeAndWait(c); return; }
  const n0 = c.msgs.length, inv0 = Object.assign({}, lastInv(c)), hps = [];
  let info = null;
  for (let i = 0; i < 12 && !info; i++) {
    await swingAt(c, id, g.x, g.y, 700);
    hps.length = 0; for (const m of fresh(c, n0)) if (m["1"] === MOVE && m["0"] === q["0"] && m["7"] != null && hps[hps.length - 1] !== m["7"]) hps.push(m["7"]);
    info = fresh(c, n0).find((m) => m["1"] === GIFT);
  }
  await sleep(500);
  const inv1 = lastInv(c);
  console.log("  hp bytes " + hps.join(" ") + "; type 75 " + JSON.stringify(info) + "; inventory " + JSON.stringify(inv0) + " -> " + JSON.stringify(inv1));
  check(hps.slice(0, 5).join(",") === "196,137,78,20,0", "five hits: 196 137 78 20 0");
  check(!!info && info.gi === +g.name.slice(4), "type 75 gift info gi " + (info && info.gi));
  const fr = info ? c.msgs.filter((m) => m._f === info._f) : [];
  check(!!fr.find((m) => m["1"] === INV) && !!fr.find((m) => m["1"] === MOVE && m["0"] === q["0"] && m["7"] === 0 && m["10"] === 1), "open frame: {7:0,10:1} + inventory with the loot");
  const rm = await c.until((x) => fresh(x, n0).find((m) => m["1"] === REMOVE && m["0"] === q["0"]), 2000);
  check(!!rm, "opened gift removed");
  // golden apples (slot 4) pop "+n" in the client whenever the key is present: only the open frame may carry it
  for (let i = 0; i < 4; i++) { await swingAt(c, id, g.x + 200, g.y, 600); }
  const g4 = fresh(c, n0).filter((m) => m["1"] === INV && m.i["4"] > 0);
  check(g4.length <= 1 && (!g4.length || g4[0]._f === (info && info._f)), "slot 4 (golden apples) only in the open frame: " + g4.length + " message(s)");
  await closeAndWait(c);
}

async function structures() {
  // a wall hit until it breaks, the placed list both ways, then decay on a second wall; a door opens for its owner
  const [c, id] = await joined("builder");
  const place = async (item, aimDeg) => {
    for (const aim of [aimDeg, 0, 1571, 3142, 4712, 785, 2356, 3927, 5498]) {
      const n = c.msgs.length;
      c.ops([[10, item], [0, aim]]); await sleep(250); c.ops([[4, (aim << 3) + 1]]); await sleep(300); c.ops([[4, 0]]);
      const cr = await c.until((x) => fresh(x, n).find((q) => q["1"] === CREATE && q["2"] === 3 && q["16"] === id), 700);
      if (cr) return [cr, n];
    }
    return [null, 0];
  };
  const [door, nd] = await place(249, 0);
  check(!!door && door["11"] === 1, "door placed (create 11:1)" + (door ? " at " + door["3"] + "," + door["4"] : ""));
  if (door) {
    const pop = c.msgs.find((q) => q["1"] === MOVE && q["0"] === door["0"] && q["7"] === 255);
    check(!!pop && pop["9"] === G.door_closed, "door pop-in {7:255, 9:" + (pop && pop["9"]) + "}");
    const me = posOf(c, id), pd = Math.hypot(door["3"] - me[0], door["4"] - me[1]);
    check(Math.abs(pd - 62) <= 8, "door placed " + Math.round(pd) + " from the player (items.json place 62)");
    const pl = fresh(c, nd).find((q) => q["1"] === PLACED);
    check(!!pl && pl.o[0][0] === door["0"] && pl.o[0][3] === "wooden-door" && Math.abs(pl.o[0][1] - door["3"] / 57.9) <= 1 && pl.p === 1, "placed_list " + JSON.stringify(pl && pl.o));
    const op = await c.until((x) => fresh(x, nd).find((q) => q["1"] === MOVE && q["0"] === door["0"] && q["9"] === G.door_open), 2000);
    check(!!op, "door opens (9:" + G.door_open + ") with its owner next to it");
    const n2 = c.msgs.length, dx = posOf(c, id)[0] - door["3"], dy = posOf(c, id)[1] - door["4"];
    await walk(c, id, () => [door["3"] + Math.sign(dx || 1) * 600, door["4"] + Math.sign(dy || 1) * 300], 120, 8000);
    const cl = await c.until((x) => fresh(x, n2).find((q) => q["1"] === MOVE && q["0"] === door["0"] && q["9"] === G.door_closed), 3000);
    check(!!cl, "door closes (9:" + G.door_closed + ") when the owner walks away");
    if (G.placed_persist) {   // the structure stays when its owner leaves
      const v = framed(client("offline1")); await opened(v); join(v, "watcher"); const iv = await ownId(v);
      await walk(v, iv, () => [door["3"], door["4"]], 400, 15000);
      const seen = await v.until((x) => x.msgs.find((q) => q["1"] === CREATE && q["0"] === door["0"]), 3000);
      await closeAndWait(c); await sleep(2000);
      const rmd = v.msgs.find((q) => q["1"] === REMOVE && q["0"] === door["0"]), broke = v.msgs.find((q) => q["1"] === MOVE && q["0"] === door["0"] && q["10"] === 1);
      check(!!seen && (!rmd || !!broke), "door stays after its owner leaves" + (rmd ? " (later gone by decay)" : ""));
      await closeAndWait(v);
    }
  }
  if (!c.closed) await closeAndWait(c);
  const [b, ib] = await joined("breaker");
  const placeB = async (item) => {
    for (const aim of [0, 1571, 3142, 4712, 785, 2356, 3927, 5498]) {
      const n = b.msgs.length;
      b.ops([[10, item], [0, aim]]); await sleep(250); b.ops([[4, (aim << 3) + 1]]); await sleep(300); b.ops([[4, 0]]);
      const cr = await b.until((x) => fresh(x, n).find((q) => q["1"] === CREATE && q["2"] === 3 && q["16"] === ib), 700);
      if (cr) return [cr, n];
    }
    return [null, 0];
  };
  const [wall, nw] = await placeB(206);
  check(!!wall, "wall placed");
  if (wall) {
    const ic = fresh(b, nw).find((q) => q["1"] === ITEMCOUNT);
    check(!!ic && ic.B[0] === 206 * 256 + 1, "item_count " + JSON.stringify(ic && ic.B));
    b.ops([[10, 0]]); await sleep(200);
    const hps = []; let gone = null; const t0 = Date.now();
    while (Date.now() - t0 < 170000 && !gone) {   // hand: 255 * 3 / 400 = 2 hp bytes per hit (client table)
      await swingAt(b, ib, wall["3"], wall["4"], 900);
      hps.length = 0; for (const q of fresh(b, nw)) if (q["1"] === MOVE && q["0"] === wall["0"] && q["7"] != null && q["9"] === 1 && hps[hps.length - 1] !== q["7"]) hps.push(q["7"]);
      gone = fresh(b, nw).find((q) => q["1"] === MOVE && q["0"] === wall["0"] && q["10"] === 1);
    }
    console.log("  wall hp bytes by hits " + hps.join(" ") + " (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
    check(hps.length > 2 && !!gone, "wall destroyed by hits");
    const rl = await b.until((x) => fresh(x, nw).find((q) => q["1"] === PLACED && q.o[0].length === 1 && q.o[0][0] === wall["0"]), 2000);
    const ic2 = fresh(b, nw).filter((q) => q["1"] === ITEMCOUNT).pop();
    check(!!rl && !!ic2 && ic2.B[0] === 206 * 256, "placed_list remove + item_count back to 0");
    const [w2] = await placeB(206);
    if (w2) {
      const n3 = b.msgs.length, t1 = Date.now();
      const hpw = () => { let h = 255; const out = []; for (const q of b.msgs) if (q["1"] === MOVE && q["0"] === w2["0"] && q["7"] != null) { out.push([h, q]); h = q["7"]; } return out; };
      const dec = await b.until(() => (hpw().find(([h, q]) => q["9"] == null && q["7"] === Math.max(0, h - G.decay_step) && q["7"] !== 255) || [])[1], G.decay_ms + 4000);
      check(!!dec, "decay record {7:" + (dec && dec["7"]) + "} (-" + G.decay_step + ", no hit) after " + ((Date.now() - t1) / 1000).toFixed(1) + " s (decay_ms " + G.decay_ms + ")");
      const full = Math.ceil(255 / G.decay_step) * G.decay_ms;
      if (full > WAIT_MAX) skip("full decay (" + full / 1000 + " s)");
      else {
        const gone2 = await b.until((x) => fresh(x, n3).find((q) => q["1"] === REMOVE && q["0"] === w2["0"]), full + 5000);
        check(!!gone2, "decayed wall removed after " + ((Date.now() - t1) / 1000).toFixed(1) + " s");
      }
    }
  }
  await closeAndWait(b);
}

async function events() {
  const [c, id] = await joined("watcher");
  const [g] = await joined("ghost");
  g.json({ type: 39, msg: "/die" });
  const gd = await g.until((x) => x.msgs.find((q) => q["1"] === 6), 3000);
  check(!!gd, "ghost dead by /die");
  const bd = await c.until((x) => x.msgs.find((q) => q["1"] === BOARD && q.ob), G.board_ticks * G.send_ms + 1000);
  check(!!bd && bd.ob.length === 3 && Array.isArray(bd.pa), "board carries ob " + JSON.stringify(bd && bd.ob) + " pa " + JSON.stringify(bd && bd.pa));
  // the client indexes its boss marker table (15 entries) with ob[2]; any other value throws in its update loop
  const obs = c.msgs.filter((q) => q["1"] === BOARD && q.ob);
  check(obs.every((q) => Number.isInteger(q.ob[2]) && q.ob[2] >= 0 && q.ob[2] <= 14), "every ob kind is a client boss-marker index 0..14: " + JSON.stringify([...new Set(obs.map((q) => q.ob[2]))]));
  // board every board_ticks frames (sp5: 32, about 3.0 s)
  const bper = G.board_ticks * G.send_ms, bds = await c.until((x) => { const l = x.msgs.filter((q) => q["1"] === BOARD); return l.length >= 4 && l; }, 5 * bper + 1000);
  const bgaps = bds ? bds.slice(1).map((q, i) => q._t - bds[i]._t) : [];
  check(bgaps.length >= 3 && bgaps.every((g) => Math.abs(g - bper) <= 300), "leaderboard every " + G.board_ticks + " frames (" + bper + " ms): gaps ms " + bgaps.join(" "));
  // own minimap position every minimap_ticks frames (sp5: 127, about 12 s)
  const mper = G.minimap_ticks * G.send_ms, mp = await c.until((x) => { const l = x.msgs.filter((q) => q["1"] === 59 && q.p); return l.length >= 2 && l; }, 2 * mper + 3000);
  const mgap = mp ? mp[1]._t - mp[0]._t : null;
  check(!!mp && Math.abs(mgap - mper) <= 400 && mp[1].p.length === 2, "own minimap {p} every " + G.minimap_ticks + " frames (" + mper + " ms): gap " + mgap + " ms, p " + JSON.stringify(mp && mp[1].p));
  if (G.announce_on_join) {
    const an = c.msgs.find((q) => q["1"] === ANN);
    check(!!an && an.m === G.announce_on_join && an.o === G.announce_ms && an.i === G.announce_color, "announcement banner " + JSON.stringify(an));
  } else skip("announcement (announce_on_join off)");
  if (G.marker80_first_ms > WAIT_MAX) skip("marker 80 (first after " + G.marker80_first_ms / 1000 + " s)");
  else {
    const m = await c.until((x) => x.msgs.find((q) => q["1"] === M80), G.marker80_first_ms + G.marker80_ms + 3000);
    check(!!m && m.o >= 0 && m.o <= 100 && m.j >= 0 && m.j <= 100, "map marker 80 " + JSON.stringify(m));
  }
  const tm = c.msgs.filter((q) => q["1"] === TIMER).pop();
  if (tm && tm.b === 5) {
    const m = await c.until((x) => x.msgs.find((q) => q["1"] === M65), G.marker65_ms + 3000);
    check(!!m, "volcanic marker 65 " + JSON.stringify(m));
  } else skip("marker 65 (not in the volcanic phase)");
  const gm = gd ? g.msgs.slice(g.msgs.indexOf(gd) + 1) : [], gs = gd ? ((Date.now() - gd._t) / 1000).toFixed(1) : "?";
  check(!!gd && !gm.some((q) => (q["1"] === 59 && q.p) || q["1"] === BOARD), "dead ghost gets no own minimap position and no leaderboard (" + gs + " s dead)");
  const gotM = c.msgs.filter((q) => q["1"] === M80 || q["1"] === M65).length;
  if (gotM) check(!gm.some((q) => q["1"] === M80 || q["1"] === M65), "dead ghost gets no map marker 80 / 65 (watcher got " + gotM + ")");
  else skip("markers to a dead player (no marker within the wait)");
  await closeAndWait(g);
  await closeAndWait(c);
}

(async () => {
  if (TEST === "slots" || TEST === "all") await slots();
  if (TEST === "multi" || TEST === "all") await multi();
  if (TEST === "world" || TEST === "all") await worldTest();
  if (TEST === "oneworld" || TEST === "all") await oneWorld();
  if (TEST === "biome" || TEST === "all") await biome();
  if (TEST === "next" || TEST === "all") await nextCmd();
  if (TEST === "resource" || TEST === "all") await resource();
  if (TEST === "chest" || TEST === "all") await chest();
  if (TEST === "structures" || TEST === "all") await structures();
  if (TEST === "events" || TEST === "all") await events();
  if (TEST === "ocean") await ocean();
  if (TEST === "garbage" || TEST === "all") await garbage();
  if (TEST === "load") await load();
  if (TEST === "churn") await churn();
  if (TEST === "admin") await admin();
  if (TEST === "blast" || TEST === "all") await blastTest();
  console.log(fails ? "FAIL: " + fails + " check(s)" : "OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL: " + (e && e.stack || e)); process.exit(1); });
