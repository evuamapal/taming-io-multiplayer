// Minimal game client for self-tests: raw WebSocket over a loopback TCP socket, the client side of codec.js.
// Only for 127.0.0.1 / ::1 targets.
"use strict";
const crypto = require("crypto");
const C = require("../codec");

class TestClient {
  constructor(sockFactory, opts) {
    this.opts = opts; this.msgs = []; this.enc = new C.ServerEnc(); this.cenc = new C.ClientDec(); this.r = 0;
    this.buf = Buffer.alloc(0); this.open = false; this.closed = false; this.waiters = [];
    const key = crypto.randomBytes(16).toString("base64");
    this.sock = sockFactory();
    this.sock.on("error", (e) => { this.err = e.message; });
    this.sock.on("close", () => { this.closed = true; this.wake(); });
    this.sock.write("GET " + opts.path + " HTTP/1.1\r\nHost: " + opts.host + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n" + (opts.origin ? "Origin: " + opts.origin + "\r\n" : "") +
      (opts.xff ? "X-Forwarded-For: " + opts.xff + "\r\n" : "") + "\r\n");
    this.sock.on("data", (d) => this.onData(d));
  }
  wake() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.open) {
      const i = this.buf.indexOf("\r\n\r\n"); if (i < 0) return;
      this.status = this.buf.subarray(0, i).toString().split("\r\n")[0];
      this.open = / 101 /.test(this.status); this.buf = this.buf.subarray(i + 4); this.wake();
    }
    for (;;) {
      if (this.buf.length < 2) return;
      let n = this.buf[1] & 127, o = 2;
      if (n === 126) { if (this.buf.length < 4) return; n = this.buf.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (this.buf.length < 10) return; n = Number(this.buf.readBigUInt64BE(2)); o = 10; }
      if (this.buf.length < o + n) return;
      const op = this.buf[0] & 15, p = Buffer.from(this.buf.subarray(o, o + n));
      this.buf = this.buf.subarray(o + n);
      if (op === 2) {
        try { for (const it of C.parsePlain(this.enc.crypt(p))) if (it.mp) this.msgs.push(it.mp); } catch (e) { this.parseErr = e.message; }
        this.wake();
      }
    }
  }
  frame(op, payload) {
    const mask = crypto.randomBytes(4), n = payload.length;
    const h = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255]);
    const p = Buffer.from(payload); for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([h, mask, p]));
  }
  json(o) { this.frame(1, Buffer.from(JSON.stringify(o))); }
  raw(buf, op) { this.frame(op || 2, buf); }
  ops(list) {   // [[baseOp, value], ...]
    const parts = [];
    for (const [op, v] of list) {
      let x = (op ^ this.r) + v * 256; const bytes = [];
      do { bytes.push(x % 256); x = Math.floor(x / 256); } while (x > 0);
      parts.push(Buffer.from([bytes.length].concat(bytes)));
      if (op === 16) this.r ^= v & 255;
    }
    this.frame(2, this.cenc.crypt(Buffer.concat(parts)));
  }
  until(pred, ms) {
    return new Promise((res) => {
      const end = Date.now() + (ms || 3000);
      let done = false, timer = null;
      const chk = () => {
        if (done) return;
        const m = pred(this);
        if (m || this.closed || Date.now() > end) { done = true; clearInterval(timer); return res(m); }
        this.waiters.push(chk);
      };
      timer = setInterval(chk, 50);
      chk();
    });
  }
  close() { try { this.frame(8, Buffer.alloc(0)); this.sock.end(); } catch (e) { } }
}
module.exports = { TestClient };
