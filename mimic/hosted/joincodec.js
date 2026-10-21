// Join request "c" field (client side: encodeURI(json), each code ^ key, written base 91 with an optional
// "0"/"1" prefix digit for codes 91..272). The alphabet comes from the client for setup b=4883 (the Atlanta#4
// setup the mimic replays); the key is derived from replayed values too, so it is fixed: it is found once by trying
// every key and kept.
"use strict";
const ALPHABET = ["v", "{", "/", "+", "A", ";", "}", "[", "\"", "2", "g", "P", ":", "p", "-", "G", "W", "d", "j", "k", "4", "I", "|", "q", "m", "O", ".", "$", "y", "b", "F", "`", "Z", "X", "5", "9", "e", "r", "s", "V", "i", "h", "*", "8", "Q", "w", "!", "z", "a", "n", "%", "<", ",", "@", "7", "(", "B", "S", "_", "l", "T", "E", "U", "Y", "N", "L", "D", "'", "u", "]", "t", ")", "6", "J", "?", " ", "H", "c", "^", "f", "K", "C", "~", "R", ">", "M", "&", "3", "#", "o", "x"];
const INV = new Map(ALPHABET.map((c, i) => [c, i]));

function codes(c) {
  const out = [];
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if ((ch === "0" || ch === "1") && i + 1 < c.length && INV.has(c[i + 1])) { out.push((+ch + 1) * 91 + INV.get(c[i + 1])); i++; }
    else if (INV.has(ch)) out.push(INV.get(ch));
    else return null;
  }
  return out;
}
function withKey(v, key) {
  let s = "";
  for (const x of v) { const ch = x ^ key; if (ch > 127) return null; s += String.fromCharCode(ch); }
  try { const t = decodeURIComponent(s); JSON.parse(t); return t; } catch (e) { return null; }
}
// state: { key } shared per server; returns the JSON text or null
function decodeJoin(c, state) {
  const v = codes(c); if (!v || !v.length) return null;
  if (state.key != null) { const t = withKey(v, state.key); if (t) return t; }
  for (let k = 0; k < 512; k++) { const t = withKey(v, k); if (t && /^\{/.test(t)) { state.key = k; return t; } }
  return null;
}
function encodeJoin(json, key) {
  const s = encodeURI(json); let out = "";
  for (let i = 0; i < s.length; i++) { const v = s.charCodeAt(i) ^ key, q = Math.floor(v / 91); if (q > 0) out += q - 1; out += ALPHABET[v % 91]; }
  return out;
}
module.exports = { decodeJoin, encodeJoin };
