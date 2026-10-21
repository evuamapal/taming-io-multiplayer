// taming.invalid wire codec (server side), derived from the client bundle:
//  server->client: every even byte XOR an LCG state s (s0=5 per socket, s=(s*109+181)%241), then a
//    sequence of items [hdr][len][payload]; hdr&3==3: hdr 3/7 = JSON (1/2-byte len), 11/19 = msgpack (1/2-byte len LE)
//  client->server: every byte XOR (1+s%254), s0=0 per socket, s=(s*8121+28411)%134456; payload is
//    [n][n LE bytes] numbers, or a JSON text when the array holds objects/strings
const fs = require("fs"), vm = require("vm");
const sb = { Uint8Array, ArrayBuffer, DataView, console }; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(__dirname + "/codec_mmgsa.js", "utf8"), sb);
const mm = sb.mmgsa;

class ServerEnc {
  constructor() { this.s = 5; }
  crypt(buf) { for (let i = 0; i < buf.length; i += 2) { buf[i] ^= this.s; this.s = (this.s * 109 + 181) % 241; } return buf; }
}
function item(obj) {
  const p = Buffer.from(mm.encode(obj));
  if (p.length < 256) return Buffer.concat([Buffer.from([11, p.length]), p]);
  return Buffer.concat([Buffer.from([19, p.length & 255, p.length >> 8]), p]);
}
function jitem(obj) {
  const p = Buffer.from(JSON.stringify(obj), "utf8");
  if (p.length < 256) return Buffer.concat([Buffer.from([3, p.length]), p]);
  return Buffer.concat([Buffer.from([7, p.length & 255, p.length >> 8]), p]);
}
function frame(enc, msgs) { return enc.crypt(Buffer.concat(msgs.map(item))); }

class ClientDec {
  constructor() { this.s = 0; }
  crypt(buf) { buf = Buffer.from(buf); for (let i = 0; i < buf.length; i++) { buf[i] ^= (1 + (this.s % 254)); this.s = (this.s * 8121 + 28411) % 134456; } return buf; }
  decode(buf, text) {
    if (text) { try { return { json: JSON.parse(Buffer.from(buf).toString("utf8")) }; } catch (e) { return { text: Buffer.from(buf).toString("utf8") }; } }
    const b = this.crypt(buf);
    if (b[0] === 0x5b || b[0] === 0x7b) { try { return { json: JSON.parse(b.toString("utf8")) }; } catch (e) { } }
    const out = []; let i = 0;
    while (i < b.length) { const n = b[i++]; let v = 0; for (let k = 0; k < n; k++) v += b[i + k] * Math.pow(256, k); i += n; out.push(v); }
    return { nums: out, raw: b };
  }
}
// plain (already decrypted) server frame -> items, for checking captures
function parsePlain(b) {
  const out = []; let i = 0;
  while (i < b.length) {
    const h = b[i++], kind = h & 3; let len = (h & 252) >> 2;
    if (kind === 3) {
      if (h === 7 || h === 19) { len = b[i] + (b[i + 1] << 8); i += 2; } else { len = b[i++]; }
      const p = b.subarray(i, i + len);
      out.push(h >= 11 ? { mp: mm.decode(new Uint8Array(p)) } : { js: JSON.parse(Buffer.from(p).toString("utf8")) });
      i += len;
    } else if (kind === 2) {
      if (h === 2 + 4 * 1) { } // placeholder, see bundle: (_14342===hdr)? 2-byte : 1-byte
      out.push({ kind, h, at: i - 1 }); return out;
    } else { out.push({ kind, h, len, bytes: Buffer.from(b.subarray(i, i + len)).toString("hex") }); i += len; }
  }
  return out;
}
module.exports = { mm, ServerEnc, ClientDec, item, jitem, frame, parsePlain };
