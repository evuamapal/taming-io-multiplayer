// Response hardening shared by hosted_server.js (same-origin) and mimic_server.js (proxy, *.taming.invalid hosts):
// security headers, off-origin URLs in HTML -> blocked page, manifest kept local, and GUARD, an inline script
// injected first in <head> that maps or blocks every URL the page hands to the network or to navigation
"use strict";

const PERMS = "accelerometer=(), ambient-light-sensor=(), autoplay=(self), battery=(), camera=(), display-capture=(), " +
  "document-domain=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), " +
  "publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=(), interest-cohort=(), browsing-topics=(), " +
  "bluetooth=(), hid=(), serial=(), idle-detection=(), local-fonts=(), otp-credentials=(), picture-in-picture=(), sync-xhr=(self)";

// hosted: {host, proto}; proxy: null
function headers(o) {
  let connect, extra = "";
  if (o) connect = "'self' " + (o.proto === "https" ? "wss://" + o.host : "ws://" + o.host + " wss://" + o.host);
  else { connect = "'self' https://*.taming.invalid wss://*.taming.invalid"; extra = " https://*.taming.invalid"; }
  return {
    "Content-Security-Policy": "default-src 'self'" + extra + "; connect-src " + connect + "; img-src 'self' data: blob:" + extra +
      "; media-src 'self' data: blob:" + extra + "; font-src 'self' data:" + extra + "; style-src 'self' 'unsafe-inline'" + extra +
      "; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:" + extra + "; worker-src 'self' blob:; manifest-src 'self'" +
      "; frame-src 'none'; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-DNS-Prefetch-Control": "off",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": PERMS,
  };
}

const BLOCKED_PAGE = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Offline</title></head>" +
  "<body style=\"font-family:sans-serif;background:#3a322b;color:#eee;text-align:center;padding-top:20vh\">" +
  "<h2>Link disabled offline</h2><p><a style=\"color:#fc6\" href=\"/\">Back to the game</a></p></body></html>";

function isTaming(h) { h = String(h).toLowerCase(); return h === "taming.invalid" || h.endsWith(".taming.invalid"); }
// allowed(url) for server-side HTML: relative, same origin, or (proxy) a taming.invalid host
function allowedFn(origin) {
  return (v) => {
    const s = String(v).trim();
    if (!s || s[0] === "#" || /^(data|blob|javascript|about):/i.test(s)) return true;
    if (/^mailto:|^tel:|^sms:|^intent:/i.test(s)) return false;
    if (!/^([a-z][a-z0-9+.-]*:)?\/\//i.test(s) && !/^\\\/\\\//.test(s)) return !/^[a-z][a-z0-9+.-]*:/i.test(s);
    let u; try { u = new URL(s.replace(/^\/\//, "https://")); } catch (e) { return false; }
    if (origin) return u.origin === origin || (u.protocol.replace(/^ws/, "http") + "//" + u.host) === origin;
    return isTaming(u.hostname);
  };
}
function hardenHtml(html, origin) {
  const ok = allowedFn(origin), BL = "/blocked";
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    // the manifest is fetched without cookies, which a login gate in front of the site bounces; /manifest.json still answers
    if (/\brel\s*=\s*["']?manifest\b/i.test(tag)) return "";
    if (!/\brel\s*=\s*["']?[^"'>]*\b(dns-prefetch|preconnect|prefetch|prerender|modulepreload|preload)\b/i.test(tag)) return tag;
    const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    return m && !ok(m[2] || m[3] || m[4] || "") ? "" : tag;
  });
  html = html.replace(/(\s(?:href|src|action|poster|formaction|data|background)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"']+))/gi, (all, pre, q, a, b, c) => {
    const v = a != null ? a : b != null ? b : c;
    return ok(v) ? all : pre + "\"" + BL + "\"";
  });
  html = html.replace(/(\s(?:srcset|imagesrcset)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (all, pre, q, a, b) => {
    const v = a != null ? a : b;
    return v.split(",").every((part) => ok(part.trim().split(/\s+/)[0] || "")) ? all : pre + "\"\"";
  });
  html = html.replace(/(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*)([^"'>;]+)/gi,
    (all, pre, u) => ok(u) ? all : pre + BL);
  return html;
}
// hosted, after hardenHtml: third-party loads that can only fail cost a round trip each; script, link and iframe
// tags pointing at /_dead/ or /blocked go, img keeps its element (the client reads it by id) with an inline pixel
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
function stripDead(html, origin) {
  const dead = "[\"']?(?:" + String(origin || "").replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + ")?/(?:_dead/|blocked\\b)";
  html = html.replace(new RegExp("<script\\b[^>]*\\ssrc\\s*=\\s*" + dead + "[^>]*>[\\s\\S]*?</script\\s*>", "gi"), "");
  html = html.replace(new RegExp("<iframe\\b[^>]*\\ssrc\\s*=\\s*" + dead + "[^>]*>[\\s\\S]*?</iframe\\s*>", "gi"), "");
  html = html.replace(new RegExp("<link\\b[^>]*\\shref\\s*=\\s*" + dead + "[^>]*>", "gi"), "");
  return html.replace(new RegExp("(<img\\b[^>]*\\ssrc\\s*=\\s*)(\"[^\"]*\"|'[^']*'|[^\\s>]+)", "gi"),
    (all, pre, v) => new RegExp("^" + dead).test(v) ? pre + "\"" + PIXEL + "\"" : all);
}
function hardenManifest(text, origin) {
  const ok = allowedFn(origin);
  let m; try { m = JSON.parse(text); } catch (e) { return JSON.stringify({ name: "Offline", start_url: "/", scope: "/", display: "standalone" }); }
  m.start_url = "/"; m.scope = "/";
  for (const k of ["related_applications", "serviceworker", "protocol_handlers", "share_target", "launch_handler", "file_handlers", "url_handlers", "scope_extensions"]) delete m[k];
  for (const k of ["icons", "screenshots", "shortcuts"]) if (Array.isArray(m[k])) m[k] = m[k].filter((e) => e && ok(e.src || e.url || ""));
  return JSON.stringify(m, null, 1);
}

// Image/Script/Media src setters are left native: the bundle breaks (keyboard init) when they are wrapped; CSP
// still refuses every off-origin load from them
// hosted: map *.taming.invalid to this origin (/_h/<sub>), anything else off-origin -> /_dead/<host>
// proxy: *.taming.invalid untouched, anything else -> https://taming.invalid/_dead/<host>
function guard(hosted) {
  return "<script>(function(){\n" +
"var HOSTED=" + (hosted ? "true" : "false") + ",O=location.origin,W=(location.protocol===\"https:\"?\"wss:\":\"ws:\")+\"//\"+location.host;\n" +
"var DEAD=HOSTED?O+\"/_dead/\":\"https://taming.invalid/_dead/\",BL=HOSTED?O+\"/blocked\":\"https://taming.invalid/blocked\";\n" +
"function tam(h){return h===\"taming.invalid\"||/\\.taming\\.invalid$/.test(h);}\n" +
"function map(u){try{if(u==null)return u;var s=String(u).trim();if(s===\"\"||s.charAt(0)===\"#\"||/^(data|blob|javascript|about):/i.test(s))return u;\n" +
"var p=new URL(s,location.href);if(/^(mailto|tel|sms|intent|ftp|file):$/i.test(p.protocol))return BL;if(!/^(https?|wss?):$/.test(p.protocol))return u;var h=p.hostname.toLowerCase();\n" +
"if(HOSTED){if(tam(h)){var sub=h===\"taming.invalid\"?\"\":h.slice(0,-15);return(/^wss?:$/.test(p.protocol)?W:O)+(sub?\"/_h/\"+sub:\"\")+p.pathname+p.search+p.hash;}if(p.host===location.host)return u;return DEAD+h+p.pathname;}\n" +
"if(tam(h))return u;return DEAD+h+p.pathname;}catch(e){return BL;}}\n" +
"function off(u){try{var p=new URL(String(u),location.href);if(!/^(https?|wss?):$/.test(p.protocol))return/^(mailto|tel|sms|intent|ftp|file):$/i.test(p.protocol);return HOSTED?p.host!==location.host:!tam(p.hostname.toLowerCase());}catch(e){return true;}}\n" +
"window.__tioMap=map;\n" +
"// the client listens for touchend only: a cancelled touch (system gesture, finger off screen) left the joystick held\n" +
"if(window.TouchEvent&&!window.__tioTc){window.__tioTc=1;window.addEventListener(\"touchcancel\",function(e){try{var t=new TouchEvent(\"touchend\",{bubbles:true,cancelable:true,touches:Array.prototype.slice.call(e.touches),targetTouches:Array.prototype.slice.call(e.targetTouches),changedTouches:Array.prototype.slice.call(e.changedTouches)});(e.target||window).dispatchEvent(t);}catch(x){}},true);}\n" +
"var CID=window.__tioCid||(window.__tioCid=Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(8)),function(b){return(b<16?'0':'')+b.toString(16);}).join(''));\n" +
"function cidu(u){u=map(u);try{var q=new URL(u,location.href);if(/^\\/_h\\//.test(q.pathname)){q.search=(q.search?q.search+'&':'?')+'cid='+CID;setTimeout(function(){if(window.__tioChat)window.__tioChat();},800);return q.toString();}}catch(e){}return u;}\n" +
"var NW=window.WebSocket;if(NW){var WS=function(u,p){return p===undefined?new NW(cidu(u)):new NW(cidu(u),p);};WS.prototype=NW.prototype;[\"CONNECTING\",\"OPEN\",\"CLOSING\",\"CLOSED\"].forEach(function(k){WS[k]=NW[k];});window.WebSocket=WS;}\n" +
"var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=Array.prototype.slice.call(arguments);a[1]=map(u);return xo.apply(this,a);};\n" +
"if(window.fetch){var fo=window.fetch;window.fetch=function(i,o){if(typeof i===\"string\"||(window.URL&&i instanceof URL))i=map(String(i));else if(i&&i.url)i=new Request(map(i.url),i);return fo.call(this,i,o);};}\n" +
"if(navigator.sendBeacon){var sb=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){var m=map(u);return off(m)?false:sb(m,d);};}\n" +
"if(window.EventSource){var NE=window.EventSource;window.EventSource=function(u,c){return new NE(map(u),c);};window.EventSource.prototype=NE.prototype;}\n" +
"var wo=window.open;window.open=function(u){var a=Array.prototype.slice.call(arguments);a[0]=map(u);if(off(a[0]))a[0]=BL;return wo.apply(this,a);};\n" +
"try{var L=window.Location&&Location.prototype;if(L){var la=L.assign,lr=L.replace;L.assign=function(u){return la.call(this,off(map(u))?BL:map(u));};L.replace=function(u){return lr.call(this,off(map(u))?BL:map(u));};}}catch(e){}\n" +
"function hook(C,prop,f){try{var d=Object.getOwnPropertyDescriptor(C.prototype,prop);if(!d||!d.set)return;Object.defineProperty(C.prototype,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,f(v));}});}catch(e){}}\n" +
"function srcset(v){return String(v).split(\",\").every(function(x){var u=x.trim().split(/\\s+/)[0];return!u||!off(map(u));})?v:\"\";}\n" +
"[[\"HTMLSourceElement\",\"src\"],[\"HTMLIFrameElement\",\"src\"],[\"HTMLEmbedElement\",\"src\"],[\"HTMLTrackElement\",\"src\"],[\"HTMLInputElement\",\"src\"],[\"HTMLLinkElement\",\"href\"],[\"HTMLAnchorElement\",\"href\"],[\"HTMLAreaElement\",\"href\"],[\"HTMLBaseElement\",\"href\"],[\"HTMLFormElement\",\"action\"],[\"HTMLVideoElement\",\"poster\"],[\"HTMLObjectElement\",\"data\"]].forEach(function(x){if(window[x[0]])hook(window[x[0]],x[1],map);});\n" +
"[\"HTMLImageElement\",\"HTMLSourceElement\"].forEach(function(n){if(window[n])hook(window[n],\"srcset\",srcset);});\n" +
"var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){var k=String(n).toLowerCase();if(/^(src|href|action|formaction|poster|data|xlink:href)$/.test(k))v=map(v);else if(k===\"srcset\"||k===\"imagesrcset\")v=srcset(v);return sa.call(this,n,v);};\n" +
"document.addEventListener(\"click\",function(e){var a=e.target&&e.target.closest&&e.target.closest(\"a[href],area[href]\");if(!a)return;var h=a.getAttribute(\"href\");if(h&&off(map(h))){e.preventDefault();e.stopImmediatePropagation();location.href=BL;}},true);\n" +
"document.addEventListener(\"submit\",function(e){var f=e.target;if(f&&f.action&&off(map(f.action))){e.preventDefault();e.stopImmediatePropagation();}},true);\n" +
"try{if(navigator.serviceWorker){var nr={unregister:function(){return Promise.resolve(true);},update:function(){return Promise.resolve();}};Object.defineProperty(navigator.serviceWorker,\"register\",{configurable:true,value:function(){return Promise.resolve(nr);}});Object.defineProperty(navigator.serviceWorker,\"getRegistrations\",{configurable:true,value:function(){return Promise.resolve([]);}});}}catch(e){}\n" +
"})();</script>" + "<script>" + require("./debug_overlay").SRC + "</script>";   // owner: debug mode on O
}
function injectGuard(html, hosted) {
  const g = guard(hosted), i = html.search(/<head[^>]*>/i);
  if (i < 0) return g + html;
  const j = html.indexOf(">", i) + 1;
  return html.slice(0, j) + g + html.slice(j);
}

module.exports = { headers, hardenHtml, stripDead, hardenManifest, injectGuard, BLOCKED_PAGE, PERMS, isTaming };
