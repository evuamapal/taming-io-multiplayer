// Dump the client's creature table (index -> sprite/name + raw numeric props) via the inert vm harness.
const H = require(process.env.HOME + "/tio/tio_dev/direct_scan/node/harness.js");
const env = H.load();
H.settle().then(() => {
  const t = env.G("_3134"), out = [];
  const inv = {}; for (const k in H.RMAP) inv[H.RMAP[k]] = k;
  for (const k in t) {
    const a = t[k]; if (!a || typeof a !== "object") continue;
    const o = { key: k, index: a[inv["_index"]] !== undefined ? a[inv["_index"]] : a.index, sprite: a[inv["_400"] || "_400"], name: a[inv["_300"] || "_300"], props: {} };
    for (const p in a) { const v = a[p]; if (typeof v === "number" || typeof v === "string") o.props[H.RMAP[p] || p] = v; }
    out.push(o);
  }
  process.stdout.write(JSON.stringify(out) + "\n"); process.exit(0);
});
