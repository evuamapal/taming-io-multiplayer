// Same-origin rewriting for the hosted client.
//  static: every http(s)/ws(s) URL on *.taming.invalid in served text -> the request's own origin
//    (taming.invalid/x -> /x, <sub>.taming.invalid/x -> /_h/<sub>/x); third-party *.invalid -> /_dead/<host>/...
//  dynamic: the bundle builds hosts at runtime ("wss://" + region + id + "." + base); harden.js GUARD maps those
//  keepTaming (proxy mode, mimic_server.js): taming hosts stay, third-party -> https://taming.invalid/_dead/<host>
"use strict";

const URL_RE = /(https?:|wss?:)?(\/\/|\\\/\\\/)((?:[a-z0-9-]+\.)*[a-z0-9-]+)\.invalid(?![a-z0-9-])/gi;

function rewriteText(s, origin, wsOrigin, keepTaming) {
  return s.replace(URL_RE, (m, scheme, slashes, host) => {
    const esc = slashes !== "//";
    const fix = (u) => esc ? u.replace(/\//g, "\\/") : u;
    const h = host.toLowerCase();
    if (h === "taming" || h.endsWith(".taming")) {
      if (keepTaming) return m;
      const sub = h === "taming" ? "" : h.slice(0, -7);
      const base = /^wss?:$/i.test(scheme || "") ? wsOrigin : origin;
      return fix(base + (sub ? "/_h/" + sub : ""));
    }
    return fix(origin + "/_dead/" + h);
  });
}

// the bundle keeps its base-domain strings (the shim maps them at runtime); only absolute third-party URLs go dead
function rewriteBundle(s) {
  return s.replace(/(["'`])https?:\/\/((?:[a-z0-9-]+\.)+)invalid\//gi, (m, q, host) => {
    const h = host.slice(0, -1).toLowerCase();
    if (h === "taming" || h.endsWith(".taming")) return m;
    return q + "/_dead/" + h + "/";
  });
}

module.exports = { rewriteText, rewriteBundle };
