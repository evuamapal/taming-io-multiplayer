// Chat log panel injected into the served page: session chat (all-chat, own clan, private command replies) from
// /_chat/stream (same-origin SSE keyed by the page's game-socket cid). Text is inserted with textContent only.
// Lines carry an optional kind k (sys, reply, help, err, event, vs, ok, warn, admin) and hl (names to highlight); lines
// without k are classed from their text. Inside a line: /commands, <args> [opts], numbers, RED / BLUE and hl names get
// their own color. Player chat keeps the plain [All] / [Team] style.
"use strict";
const CSS = "#tio-chat{position:fixed;left:8px;bottom:200px;width:380px;max-height:240px;overflow-y:auto;z-index:50;pointer-events:none;" +
  "font:13px/1.4 Arial,sans-serif;color:#fff;text-shadow:0 1px 2px #000;background:rgba(0,0,0,.34);border-radius:6px;padding:4px 7px;" +
  "transition:opacity .6s;scrollbar-width:none}#tio-chat::-webkit-scrollbar{display:none}#tio-chat .n{font-weight:bold}" +
  "#tio-chat .tm{opacity:.5;margin-right:4px;font-size:11px}#tio-chat .cl{color:#8fff9b}#tio-chat .ag{color:#9fd3ff;margin-right:3px}#tio-chat .tg{color:#8fff9b;margin-right:3px}#tio-chat.off{display:none}#tio-chat:empty,#tio-chat:empty+#tio-chat-btn{display:none}" +
  "#tio-chat .k-reply{color:#f3ead0}#tio-chat .k-sys{color:#7fd4ff}#tio-chat .k-help{color:#d8d8d8}#tio-chat .k-err{color:#ff7b7b}" +
  "#tio-chat .k-event{color:#d6a8ff;font-weight:bold}#tio-chat .k-vs{color:#f0f0f0}#tio-chat .k-ok{color:#74e889}#tio-chat .k-warn{color:#ffb35c;font-weight:bold}" +
  "#tio-chat .k-admin{color:#ff8bd0}#tio-chat .hh{color:#ffd166;font-weight:bold;margin-top:3px;border-bottom:1px solid rgba(255,209,102,.3)}" +
  "#tio-chat .k-help.c{padding-left:6px}#tio-chat .cm{color:#ffb84d;font-weight:bold}#tio-chat .ar{color:#ffdca0;font-weight:normal}#tio-chat .ds{color:#c9c9c9}" +
  "#tio-chat .nu{color:#ffe45c;font-weight:bold}#tio-chat .nm{color:#8fe9ff;font-weight:bold}#tio-chat .tr{color:#ff5a5a;font-weight:bold}" +
  "#tio-chat .tb{color:#5aaeff;font-weight:bold}#tio-chat .tag{color:#ffd166;font-weight:bold}" +
  "#tio-chat-btn{position:fixed;left:8px;bottom:446px;z-index:51;font:11px Arial,sans-serif;color:#fff;background:rgba(0,0,0,.45);" +
  "border:0;border-radius:4px;padding:2px 7px;cursor:pointer;opacity:.7}";
function client() {
  var box, btn, es, idle, seen = 0;
  function ui() {
    if (box) return;
    box = document.createElement("div"); box.id = "tio-chat"; btn = document.createElement("button"); btn.id = "tio-chat-btn";
    var off = false; try { off = localStorage.getItem("tioChatOff") === "1"; } catch (e) { }
    if (off) box.className = "off"; btn.textContent = off ? "Chat +" : "Chat -";
    btn.onclick = function (e) { e.stopPropagation(); var o = box.className !== "off"; box.className = o ? "off" : ""; btn.textContent = o ? "Chat +" : "Chat -"; try { localStorage.setItem("tioChatOff", o ? "1" : "0"); } catch (e) { } };
    document.body.appendChild(box); document.body.appendChild(btn);
    function inBox(e) { var r = box.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }
    window.addEventListener("mousemove", function (e) { if (inBox(e)) wake(); }, true);
    window.addEventListener("wheel", function (e) { if (inBox(e)) { box.scrollTop += e.deltaY; wake(); } }, { capture: true, passive: true });
  }
  function wake() { box.style.opacity = "1"; clearTimeout(idle); idle = setTimeout(function () { box.style.opacity = ".35"; }, 8000); }
  function span(cls, t) { var s = document.createElement("span"); if (cls) s.className = cls; s.textContent = t; return s; }
  // kind from the text for lines sent without one
  function kind(l) {
    if (l.k) return l.k;
    var t = l.text;
    if (l.to == null) return "event";
    if (/^\[Server\]|^Welcome/.test(t)) return "sys";
    if (/^Admin (on|off)/.test(t)) return "admin";
    if (/^(Usage|Unknown|No |Not |Nothing)|cooldown|recharging|^Wait |needs level|already|can't|cannot|no free spot|^Stand next/i.test(t)) return "err";
    if (/restart/i.test(t)) return "warn";
    if (/^\+\d|You found|joins you|tamed|caught|bought|spawned|KNOCKOUT/i.test(t)) return "ok";
    return "reply";
  }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // text with /commands, <args> [opts], numbers, RED / BLUE and hl names colored
  function rich(d, t, hl) {
    var lead = /^\[[^\]]{1,24}\]\s?/.exec(t);
    if (lead) { d.appendChild(span("tag", lead[0])); t = t.slice(lead[0].length); }
    var names = (hl || []).filter(function (s) { return s && s.length > 1; }).sort(function (a, b) { return b.length - a.length; }).map(esc);
    var re = new RegExp((names.length ? "(" + names.join("|") + ")|" : "()") + "(\\/[a-z]+\\b)|(<[^>]{1,60}>|\\[[^\\]]{1,60}\\])|\\b(RED)\\b|\\b(BLUE)\\b|((?:^|(?<=[\\s(+x]))-?\\d+(?:[.,]\\d+)?\\s?(?:%|s\\b|k\\b)?)", "g");
    var i = 0, m;
    while ((m = re.exec(t))) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (m.index > i) d.appendChild(document.createTextNode(t.slice(i, m.index)));
      d.appendChild(span(m[1] ? "nm" : m[2] ? "cm" : m[3] ? "ar" : m[4] ? "tr" : m[5] ? "tb" : "nu", m[0]));
      i = m.index + m[0].length;
    }
    if (i < t.length) d.appendChild(document.createTextNode(t.slice(i)));
  }
  function body(d, l) {
    if (l.name) {
      d.appendChild(span(l.team != null ? "tg" : "ag", l.team != null ? "[Team] " : "[All] "));
      d.appendChild(span("n", l.name + ": ")); d.appendChild(document.createTextNode(l.text));
      if (l.team != null) d.className = "cl";
      return;
    }
    var k = kind(l), t = l.text; d.className = "k-" + k;
    if (k === "help") {
      if (/^# /.test(t)) { d.className = "hh"; d.appendChild(document.createTextNode(t.slice(2))); return; }
      var c = /^(\/\S[^:]*?):\s(.*)$/.exec(t);
      d.className += " c";
      if (c) { var s = span("cm", ""); rich(s, c[1]); d.appendChild(s); d.appendChild(span("ds", "  " + c[2])); }
      else if (t[0] === "/") { var s2 = span("cm", ""); rich(s2, t); d.appendChild(s2); }
      else { var s3 = span("ds", ""); rich(s3, t); d.appendChild(s3); }
      return;
    }
    rich(d, t, l.hl);
  }
  function add(l) {
    if (l.seq <= seen) return; seen = l.seq;
    var d = document.createElement("div");
    if (!(l.k === "help" && !/^# /.test(l.text))) { var t = new Date(l.t); d.appendChild(span("tm", ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2))); }
    try { body(d, l); } catch (e) { d.appendChild(document.createTextNode(l.text)); }   // plain fallback
    var end = box.scrollTop + box.clientHeight >= box.scrollHeight - 8; box.appendChild(d);
    while (box.childNodes.length > 500) box.removeChild(box.firstChild);
    if (end) box.scrollTop = box.scrollHeight; wake();
  }
  function open() {
    if (!window.__tioCid || !window.EventSource) return; ui(); if (es) es.close();
    es = new EventSource("/_chat/stream?cid=" + window.__tioCid);
    es.onmessage = function (e) { try { add(JSON.parse(e.data)); } catch (x) { } };
    es.onerror = function () { es.close(); es = null; setTimeout(open, 3000); };
  }
  window.__tioChat = function () { if (document.body) open(); else document.addEventListener("DOMContentLoaded", open); };
}
module.exports = { HTML: "<style>" + CSS + "</style><script>(" + client.toString() + ")();</script>" };
