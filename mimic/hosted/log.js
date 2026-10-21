// JSON-lines log rotated by size (server.jsonl -> server.jsonl.1 ... .N); client IPs only as salted short hashes
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

function makeLog(dir, opts) {
  const maxBytes = (opts && opts.maxBytes) || 20 * 1024 * 1024, keep = (opts && opts.keep) || 5;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "server.jsonl");
  let fd = fs.openSync(file, "a"), size = 0;
  try { size = fs.fstatSync(fd).size; } catch (e) { }
  function rotate() {
    try { fs.closeSync(fd); } catch (e) { }
    for (let i = keep - 1; i >= 1; i--) { try { fs.renameSync(file + "." + i, file + "." + (i + 1)); } catch (e) { } }
    try { fs.renameSync(file, file + ".1"); } catch (e) { }
    fd = fs.openSync(file, "a"); size = 0;
  }
  return function L(o) {
    if (o.t == null) o.t = Date.now() / 1000;
    let s; try { s = JSON.stringify(o) + "\n"; } catch (e) { s = JSON.stringify({ k: "log_err", t: o.t }) + "\n"; }
    try { fs.writeSync(fd, s); size += s.length; if (size > maxBytes) rotate(); } catch (e) { }
  };
}

const SALT = process.env.IP_HASH_SALT || crypto.randomBytes(16).toString("hex");
function ipHash(ip) { return crypto.createHash("sha256").update(SALT + "|" + String(ip)).digest("hex").slice(0, 10); }

module.exports = { makeLog, ipHash };
