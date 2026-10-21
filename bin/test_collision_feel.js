// Scripted movement feel test: real World.collide/blocked/solidsNear and Player.physics on a fake world.
// usage: node feel.js [path to mimic/hosted]
const dir = process.argv[2] || require("path").join(__dirname, "..", "mimic", "hosted");
const { World, Player } = require(dir + "/world.js");
const P = Object.assign({}, require(dir + "/game_config.js").DEFAULTS);
const GRID = 512;
function mkWorld(solids) {
  const w = Object.create(World.prototype);
  w.P = P; w.grid = new Map(); w.lgrid = new Map(); w.ents = new Map(); w.ctx = { ITEMS: {} };
  for (const s of solids) {
    const k = Math.floor(s.x / GRID) + Math.floor(s.y / GRID) * 4096;
    if (!w.grid.has(k)) w.grid.set(k, new Set()); w.grid.get(k).add(s); w.ents.set(s.id, s);
  }
  return w;
}
const fam = { wall: Math.round((P.player_radius + P.build_r.wall) * P.collide_k.wall), spike: Math.round((P.player_radius + P.build_r.spike) * P.collide_k.spike) };
let nid = 1;
const O = 5000;   // map clamp is 350..17250: test geometry sits around (O, O)
const solid = (f, x, y) => ({ id: nid++, kind: "placed", name: f === "wall" ? "wooden-wall" : "wooden-spike", x: x + O, y: y + O, cd: fam[f], cd0: fam[f] });
function run(solids, x, y, keys, secs) {
  const w = mkWorld(solids), p = Object.create(Player.prototype);
  Object.assign(p, { P, w, ent: { id: 999, kind: "player", x: x + O, y: y + O }, keys: new Set(keys), alive: true, held: 0, wasMoving: true, glide: 0 });
  p.ent.p = p;
  const dt = P.send_ms / 1000 / P.substeps, n = Math.round(secs * 1000 / P.send_ms) * P.substeps;
  let minD = 1e9, minFrac = 1e9, path = [];
  for (let i = 0; i < n; i++) {
    p.physics(dt, i % P.substeps);
    for (const s of solids) { const d = Math.hypot(p.ent.x - s.x, p.ent.y - s.y); minD = Math.min(minD, d); minFrac = Math.min(minFrac, d / s.cd); }
    if (i % P.substeps === P.substeps - 1) path.push([p.ent.x - O, p.ent.y - O]);
  }
  return { x: p.ent.x - O, y: p.ent.y - O, minD, minFrac, path };
}
const out = {};
// 1. diagonal into a wall row (walls along y=0 every 114, player above, keys d + s = right + down)
for (const f of ["wall", "spike"]) {
  const row = []; for (let x = 0; x <= 4000; x += f === "wall" ? 114 : 125) row.push(solid(f, x, 0));
  const r = run(row, 200, -150, [1, 2], 3);
  out["diag_" + f + "_row"] = { speed_along: Math.round((r.x - 200) / 3), ideal_tangent: Math.round(P.walk_speed * Math.SQRT1_2), full: P.walk_speed, min_center: Math.round(r.minD * 10) / 10, crossed: r.y > 0 };
}
// 2. straight through a gap (two solids side by side, player walks down through the middle, slightly off center)
const gaps = [["wall", "wall", 140], ["wall", "wall", 153], ["wall", "wall", 156], ["wall", "wall", 170], ["wall", "wall", 178], ["wall", "spike", 165], ["wall", "spike", 175], ["spike", "spike", 160], ["spike", "spike", 175], ["spike", "spike", 185], ["spike", "spike", 200]];
for (const [a, b, g] of gaps) for (const off of [0, 12]) {
  const S = [solid(a, -g / 2, 0), solid(b, g / 2, 0)];
  const r = run(S, off, -200, [2], 2);
  const tpass = r.path.findIndex((q) => q[1] > 120);
  out["gap_" + a + "_" + b + "_" + g + "_off" + off] = { passed: r.y > 100, t_s: tpass < 0 ? null : Math.round((tpass + 1) * P.send_ms) / 1000, full_speed_t: Math.round(320 / P.walk_speed * 1000) / 1000, min_center: Math.round(r.minD * 10) / 10 };
}
// 3. head-on into a single wall: must stop, never through
for (const f of ["wall", "spike"]) { const r = run([solid(f, 0, 0)], 0, -200, [2], 3); out["headon_" + f] = { y: Math.round(r.y * 10) / 10, crossed: r.y > 0, min_center: Math.round(r.minD * 10) / 10 }; }
// 4. edge cases
{ const S = [solid("wall", -77.5, 0), solid("wall", 77.5, 0)]; const r = run(S, -150, -150, [1, 2], 2); out.gap_wall_155_diag45 = { passed: r.y > 60, min_center: Math.round(r.minD * 10) / 10 }; }
{ const S = []; for (let x = 0; x <= 456; x += 114) S.push(solid("wall", x, 0)); for (let y = 114; y <= 456; y += 114) S.push(solid("wall", 0, y));
  const r = run(S, 150, 150, [0, 3], 1.5); const r2 = run(S, 150, 150, [1], 1); out.L_corner = { pushed_in_y: Math.round(r.y * 10) / 10, min_center: Math.round(r.minD * 10) / 10, crossed: r.x < 0 || r.y < 0, escape_speed: Math.round((r2.x - 150) / 1) }; }
{ const S = [solid("spike", 0, 0), solid("spike", 125, 0), solid("spike", 62.5, 108)]; let any = false, md = 1e9;
  for (let a = 0; a < 360; a += 30) { const c = [62.5, 36], ax = Math.cos(a * Math.PI / 180), ay = Math.sin(a * Math.PI / 180); const r = run(S, c[0] - ax * 300, c[1] - ay * 300, [ax > 0.3 ? 1 : ax < -0.3 ? 0 : null, ay > 0.3 ? 2 : ay < -0.3 ? 3 : null].filter((k) => k != null), 2.5);
    md = Math.min(md, r.minD); if (Math.hypot(r.x - c[0], r.y - c[1]) < 40) any = true; }
  out.spike_triangle_125 = { entered: any, min_center: Math.round(md * 10) / 10 }; }
{ const r = run([solid("wall", 0, 0)], 0, -84, [3], 0.5); out.leave_wall = { speed: Math.round((-84 - r.y) / 0.5) }; }
console.log(JSON.stringify({ cd: fam, squeeze_max: P.squeeze_max, out }, null, 1));
