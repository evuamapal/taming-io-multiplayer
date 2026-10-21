// Required first by the servers: every API that can open an outbound connection or start a process throws
// Error("OUTBOUND BLOCKED") and is logged. Listening and accepted sockets are untouched. dns.lookup of an IP
// literal (no I/O, used by server.listen) still answers.
"use strict";
const net = require("net"), tls = require("tls"), http = require("http"), https = require("https"),
  dns = require("dns"), cp = require("child_process"), dgram = require("dgram");

let LOG = (o) => { try { process.stderr.write(JSON.stringify(o) + "\n"); } catch (e) { } };
function summary(args) {
  try {
    return Array.prototype.slice.call(args, 0, 3).map((a) => typeof a === "function" ? "fn" : typeof a === "object" && a ? JSON.stringify(a, (k, v) => typeof v === "function" ? "fn" : v).slice(0, 120) : String(a).slice(0, 120));
  } catch (e) { return ["?"]; }
}
function blocker(fn) {
  return function () {
    LOG({ k: "outbound_blocked", fn, args: summary(arguments), t: Date.now() / 1000 });
    throw new Error("OUTBOUND BLOCKED");
  };
}
const BLOCKED = [];
function block(obj, key, name) {
  if (!obj || typeof obj[key] !== "function") return;
  try { Object.defineProperty(obj, key, { value: blocker(name), writable: false, configurable: false }); BLOCKED.push(name); } catch (e) { }
}

block(net, "connect", "net.connect");
block(net, "createConnection", "net.createConnection");
block(net.Socket.prototype, "connect", "net.Socket.prototype.connect");
block(tls, "connect", "tls.connect");
for (const [m, n] of [[http, "http"], [https, "https"]]) { block(m, "request", n + ".request"); block(m, "get", n + ".get"); }
const origLookup = dns.lookup;
Object.defineProperty(dns, "lookup", {
  configurable: false, writable: false, value: function (host) {
    if (typeof host === "string" && net.isIP(host)) return origLookup.apply(dns, arguments);
    return blocker("dns.lookup").apply(null, arguments);
  },
});
BLOCKED.push("dns.lookup");
for (const k of Object.keys(dns)) if (/^(resolve|reverse|lookupService)/.test(k)) block(dns, k, "dns." + k);
if (dns.Resolver) for (const k of Object.getOwnPropertyNames(dns.Resolver.prototype)) if (/^(resolve|reverse)/.test(k)) block(dns.Resolver.prototype, k, "dns.Resolver." + k);
if (dns.promises) {
  for (const k of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(k)) block(dns.promises, k, "dns.promises." + k);
  if (dns.promises.Resolver) for (const k of Object.getOwnPropertyNames(dns.promises.Resolver.prototype)) if (/^(resolve|reverse)/.test(k)) block(dns.promises.Resolver.prototype, k, "dns.promises.Resolver." + k);
}
for (const k of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) block(cp, k, "child_process." + k);
block(dgram, "createSocket", "dgram.createSocket");
for (const k of ["fetch", "WebSocket", "EventSource"]) {
  if (globalThis[k] === undefined) { globalThis[k] = blocker("globalThis." + k); BLOCKED.push("globalThis." + k); }
  else { try { Object.defineProperty(globalThis, k, { value: blocker("globalThis." + k), writable: false, configurable: false }); BLOCKED.push("globalThis." + k); } catch (e) { } }
}

function selftest() {
  const T = "1.1.1.1", H = "example.invalid";
  const tries = [
    ["net.connect", () => net.connect(443, T)],
    ["net.createConnection", () => net.createConnection({ host: T, port: 443 })],
    ["net.Socket.prototype.connect", () => new net.Socket().connect(443, T)],
    ["tls.connect", () => tls.connect(443, T)],
    ["http.request", () => http.request("http://" + T + "/")],
    ["http.get", () => http.get("http://" + T + "/")],
    ["https.request", () => https.request("https://" + T + "/")],
    ["https.get", () => https.get("https://" + T + "/")],
    ["dns.lookup", () => dns.lookup(H, () => { })],
    ["dns.resolve", () => dns.resolve(H, () => { })],
    ["dns.resolve4", () => dns.resolve4(H, () => { })],
    ["dns.resolveAny", () => dns.resolveAny(H, () => { })],
    ["dns.reverse", () => dns.reverse(T, () => { })],
    ["dns.Resolver.resolve", () => new dns.Resolver().resolve(H, () => { })],
    ["dns.promises.lookup", () => dns.promises.lookup(H)],
    ["dns.promises.resolve", () => dns.promises.resolve(H)],
    ["dns.promises.Resolver.resolve", () => new dns.promises.Resolver().resolve(H)],
    ["globalThis.fetch", () => globalThis.fetch("https://" + T + "/")],
    ["globalThis.WebSocket", () => new globalThis.WebSocket("wss://" + T + "/")],
    ["child_process.spawn", () => cp.spawn("/usr/bin/true")],
    ["child_process.exec", () => cp.exec("true")],
    ["child_process.execFile", () => cp.execFile("/usr/bin/true")],
    ["child_process.fork", () => cp.fork(__filename)],
    ["child_process.spawnSync", () => cp.spawnSync("/usr/bin/true")],
    ["child_process.execSync", () => cp.execSync("true")],
    ["dgram.createSocket", () => dgram.createSocket("udp4")],
  ];
  let bad = 0;
  const quiet = LOG; LOG = () => { };
  for (const [name, f] of tries) {
    let ok = false, msg = "returned";
    try { const r = f(); if (r && typeof r.destroy === "function") try { r.destroy(); } catch (e) { } } catch (e) { ok = e && e.message === "OUTBOUND BLOCKED"; msg = e && e.message; }
    if (!ok) bad++;
    console.log((ok ? "BLOCKED " : "OPEN    ") + name + (ok ? "" : " (" + msg + ")"));
  }
  LOG = quiet;
  console.log(bad ? "FAIL: " + bad + " function(s) not blocked" : "OK: all " + tries.length + " outbound functions blocked");
  return bad ? 1 : 0;
}

module.exports = { setLogger: (f) => { LOG = f; }, selftest, BLOCKED };
if (process.argv.includes("--selftest-outbound")) process.exit(selftest());
