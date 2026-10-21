// A sea-hollow-log (rotation field 876, as the bbotot recording 560..569 s): the player walks into its side at every
// spot along it and around the ends. Real: 67.5 from the axis along the side (u -102..85), around the end at ~184.
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) || require("path").join(__dirname, "..", "mimic", "hosted");
const { World, Player } = require(dir + "/world.js");
const HC = JSON.parse(require("fs").readFileSync(dir + "/../hosted_config.json", "utf8"));
const P = require(dir + "/game_config.js").gameConfig(HC.game);
const O = 5000, w = Object.create(World.prototype); w.P = P; w.grid = new Map(); w.lgrid = new Map(); w.ents = new Map(); w.ctx = { ITEMS: {} };
const log = { id: 1, kind: "static", name: "sea-hollow-log", x: O, y: O, f: { "5": 876 }, cd: w.collideDist("sea-hollow-log") };
const k = Math.floor(log.x / 512) + Math.floor(log.y / 512) * 4096; w.grid.set(k, new Set([log])); w.ents.set(1, log);
const a = 8.76, ax = Math.cos(a), ay = Math.sin(a), nx = -ay, ny = ax;   // log axis and its normal
const KEYS = (dx, dy) => [dx > 0.3 ? 1 : dx < -0.3 ? 0 : null, dy > 0.3 ? 2 : dy < -0.3 ? 3 : null].filter((q) => q != null);
const go = (u, v, dirx, diry, secs) => {
  const p = Object.create(Player.prototype);
  Object.assign(p, { P, w, ent: { id: 999, kind: "player", x: O + ax * u + nx * v, y: O + ay * u + ny * v }, keys: new Set(KEYS(dirx, diry)), alive: true, held: 0, wasMoving: true, glide: 0, cruise: P.walk_speed }); p.ent.p = p;
  let minV = 1e9, minC = 1e9; const dt = P.send_ms / 1000 / P.substeps;
  for (let i = 0; i < Math.round(secs * 1000 / P.send_ms) * P.substeps; i++) {
    p.physics(dt, i % P.substeps); const du = (p.ent.x - O) * ax + (p.ent.y - O) * ay, dv = (p.ent.x - O) * nx + (p.ent.y - O) * ny;
    const tu = Math.max(-P.log_half_len, Math.min(P.log_half_len, du)); minV = Math.min(minV, Math.hypot(du - tu, dv)); minC = Math.min(minC, Math.hypot(p.ent.x - O, p.ent.y - O));
  }
  const du = (p.ent.x - O) * ax + (p.ent.y - O) * ay, dv = (p.ent.x - O) * nx + (p.ent.y - O) * ny;
  return { end_u: Math.round(du), end_v: Math.round(dv * 10) / 10, min_from_segment: Math.round(minV * 10) / 10, min_center: Math.round(minC * 10) / 10 };
};
const out = { cd: log.cd, half_len: P.log_half_len };
for (const u of [-110, -60, 0, 60, 110]) out["side_u" + u] = go(u, 200, -nx, -ny, 1.2);   // straight into the side
out.end_on_axis = go(400, 0, -ax, -ay, 1.5);   // head-on into the end
out.slide_along = go(-150, 150, (ax - nx) / Math.SQRT2, (ay - ny) / Math.SQRT2, 2);   // diagonal along the side (as recorded: ds)
const bad = Object.entries(out).filter(([k, r]) => typeof r === "object" && r.min_from_segment < 66);
console.log(JSON.stringify(out)); process.exit(bad.length ? 1 : 0);
