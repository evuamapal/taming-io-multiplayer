// Encryptions matching the client's decrypts (read from the bundle):
//  /list: JSON.parse(dec(JSON.parse(body), 0x99)), dec = mulberry32 keystream ^ previous cipher word, 16 bit
//  type 64 "o" (leaderboard): JSON.parse(dec(o, k)), dec = c ^ previous cipher (k first); k is 88 for the
//    Atlanta#4 setup values the mimic replays
"use strict";
const LIST_KEY = 0x99, BOARD_KEY = 88;

function mulberry(key) {
  let s = key | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 65535;
  };
}
function encList(obj, key = LIST_KEY) {
  const s = JSON.stringify(obj), k = mulberry(key), out = [];
  let prev = key & 65535;
  for (let i = 0; i < s.length; i++) { const c = (s.charCodeAt(i) ^ k() ^ prev) & 65535; out.push(c); prev = c; }
  return out;
}
function decList(arr, key = LIST_KEY) {
  const k = mulberry(key); let prev = key & 65535, o = "";
  for (const c of arr) { o += String.fromCharCode((c ^ k() ^ prev) & 65535); prev = c; }
  return o;
}
function encBoard(obj, key = BOARD_KEY) {
  const s = JSON.stringify(obj), out = [];
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i) ^ key; out.push(c); key = c; }
  return out;
}
function decBoard(arr, key = BOARD_KEY) {
  let o = ""; for (const c of arr) { o += String.fromCharCode(c ^ key); key = c; } return o;
}
module.exports = { encList, decList, encBoard, decBoard, LIST_KEY, BOARD_KEY };
