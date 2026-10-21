// 3 spikes placed one by one around the player (as in the bbotot recording 450..470 s): each at 62 from him along his aim,
// then he presses every direction. Real: he never gets out (stays 62..69 inside the third, ~86..95 from the other two).
// usage: node ring.js [--two] [mimic/hosted dir]   (--two: only the first two spikes, the open side must let him out)
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) || require("path").join(__dirname, "..", "mimic", "hosted");
const { World, Player } = require(dir + "/world.js");
const HC = JSON.parse(require("fs").readFileSync(dir + "/../hosted_config.json", "utf8"));
const P = require(dir + "/game_config.js").gameConfig(HC.game);
const O = 5000, cd = Math.round((P.player_radius + P.build_r.spike) * P.collide_k.spike);
const w = Object.create(World.prototype); w.P = P; w.grid = new Map(); w.lgrid = new Map(); w.ents = new Map(); w.ctx = { ITEMS: {} };
const add = (s) => { const k = Math.floor(s.x / 512) + Math.floor(s.y / 512) * 4096; if (!w.grid.has(k)) w.grid.set(k, new Set()); w.grid.get(k).add(s); w.ents.set(s.id, s); };
const p = Object.create(Player.prototype);
Object.assign(p, { P, w, ent: { id: 999, kind: "player", x: O, y: O }, keys: new Set(), alive: true, held: 0, wasMoving: false, glide: 0 }); p.ent.p = p;
const dt = P.send_ms / 1000 / P.substeps; let nid = 1;
const run = (secs, keys) => { p.keys = new Set(keys || []); const n = Math.round(secs * 1000 / P.send_ms) * P.substeps; for (let i = 0; i < n; i++) p.physics(dt, i % P.substeps); };
const S = [];
// recorded (bbotot 450..453 s): spike and player spot at each placement
const TWO = process.argv.includes("--two");
const REAL = [[14567, 667, 14573, 605], [14631, 546, 14575, 572], [14482, 557, 14542, 576]];
const place = (q) => {   // world.js place: ghost for the placer when on top of him, easeOut for walls / spikes
  const s = { id: nid++, kind: "placed", name: "stone-spike", x: q[0] - 14500 + O, y: q[1] - 600 + O, cd, cd0: cd }; add(s); S.push(s);
  if (Math.hypot(p.ent.x - s.x, p.ent.y - s.y) < cd) { s.ghostFor = p.ent; p.easeOut = s; }
};
const ds = () => S.map((s) => Math.round(Math.hypot(p.ent.x - s.x, p.ent.y - s.y) * 10) / 10);
p.ent.x = REAL[0][2] - 14500 + O; p.ent.y = REAL[0][3] - 600 + O;
place(REAL[0]); run(1.1); const a1 = ds();
place(REAL[1]); run(1.1); const a2 = ds();
if (!TWO) place(REAL[2]); run(1.2); const a3 = ds();
const cx = S.reduce((q, s) => q + s.x, 0) / S.length, cy = S.reduce((q, s) => q + s.y, 0) / S.length;
const pair = (TWO ? [[0, 1]] : [[0, 1], [0, 2], [1, 2]]).map(([i, j]) => Math.round(Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y)));
const res = [];
for (const k of [[0], [1], [2], [3], [0, 2], [0, 3], [1, 2], [1, 3]]) {
  run(2.5, k);
  res.push({ keys: k.map((q) => "adsw"[q]).join(""), d: ds(), from_center: Math.round(Math.hypot(p.ent.x - cx, p.ent.y - cy)), ghost3: !!(S[2] && S[2].ghostFor), sq: +(p.squeeze || 0).toFixed(2) });
}
const out = res.some((r) => r.from_center > 120);
console.log(JSON.stringify({ cd, spike_pairs: pair, after1: a1, after2: a2, after3: a3, presses: res, escaped: out }, null, 0));
process.exit(out === TWO ? 0 : 1);   // 3 spikes: never out; 2 spikes (open side): he walks out
