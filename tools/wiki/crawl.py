#!/usr/bin/env python3
# Community wiki crawler (research only). Talks to exactly one host over HTTPS GET, never follows redirects,
# 1 request per second max, logs every request to work/wiki_requests.log. Raw wikitext lands in mimic/data/wiki/raw/.
# Usage: crawl.py [--refresh] [--list-only] | crawl.py --search TERM... | crawl.py --titles TITLE...
import datetime, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(REPO, "mimic", "data", "wiki", "raw")
LOG = os.path.join(REPO, "work", "wiki_requests.log")
HOST = "tamingio.fandom.com"
API = "https://" + HOST + "/api.php"
UA = "tio-offline-research/1.0 (wiki reader)"
GAP = 1.1
_last = [0.0]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused: " + newurl, headers, fp)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def log(url, status, n):
    with open(LOG, "a") as o:
        o.write("%s\t%s\t%s\t%d\n" % (datetime.datetime.now().isoformat(timespec="seconds"), url, status, n))


def api(params):
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    assert urllib.parse.urlsplit(url).hostname == HOST
    wait = _last[0] + GAP - time.time()
    if wait > 0: time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with OPENER.open(req, timeout=30) as r:
            if urllib.parse.urlsplit(r.geturl()).hostname != HOST:
                log(url, "OFFHOST", 0); sys.exit("response came from another host: " + r.geturl())
            body = r.read(); log(url, r.status, len(body))
    except urllib.error.HTTPError as e:
        log(url, e.code, 0)
        sys.exit("HTTP %s for %s (%s); stopping" % (e.code, url, e.msg))
    return json.loads(body)


def listing(base, key):
    out, cont = [], {}
    while True:
        d = api(dict(base, **cont))
        out += d["query"][key]
        if "continue" not in d: return out
        cont = d["continue"]


def safe(title):
    return re.sub(r"[^A-Za-z0-9._-]", "_", title)


def fetch(titles):
    idx_path = os.path.join(RAW, "_index.json")
    idx = json.load(open(idx_path))
    for i in range(0, len(titles), 50):
        d = api({"action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp", "rvslots": "main",
                 "titles": "|".join(titles[i:i + 50])})
        for p in d["query"]["pages"]:
            revs = p.get("revisions")
            if not revs: print("missing", p["title"]); continue
            rv = revs[0]; f = safe(p["title"]) + ".wiki"
            open(os.path.join(RAW, f), "w").write(rv["slots"]["main"].get("content", ""))
            idx["pages"][p["title"]] = {"file": f, "rev": rv["revid"], "ts": rv["timestamp"], "cats": [], "extra": True}
            print("stored", p["title"])
    json.dump(idx, open(idx_path, "w"), indent=1, sort_keys=True)


def search(terms):
    idx_path = os.path.join(RAW, "_index.json")
    idx = json.load(open(idx_path))
    out = idx.setdefault("searches", {})
    for t in terms:
        d = api({"action": "query", "list": "search", "srsearch": t, "srlimit": "20", "srwhat": "text"})
        out[t] = [{"title": h["title"], "snippet": re.sub(r"<[^>]+>", "", h.get("snippet", ""))} for h in d["query"]["search"]]
        print(t, "->", [h["title"] for h in out[t]][:10])
    json.dump(idx, open(idx_path, "w"), indent=1, sort_keys=True)


def main():
    if "--search" in sys.argv:
        return search(sys.argv[sys.argv.index("--search") + 1:])
    if "--titles" in sys.argv:
        return fetch(sys.argv[sys.argv.index("--titles") + 1:])
    refresh = "--refresh" in sys.argv
    os.makedirs(RAW, exist_ok=True)
    idx_path = os.path.join(RAW, "_index.json")
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else {"pages": {}}
    pages = listing({"action": "query", "list": "allpages", "aplimit": "500", "apfilterredir": "nonredirects"}, "allpages")
    redirs = listing({"action": "query", "list": "allpages", "aplimit": "500", "apfilterredir": "redirects"}, "allpages")
    cats = listing({"action": "query", "list": "allcategories", "aclimit": "500"}, "allcategories")
    titles = [p["title"] for p in pages]
    idx["listed"] = len(titles); idx["categories"] = sorted(c["category"] for c in cats)
    print("pages", len(titles), "redirects", len(redirs), "categories", len(cats))
    rtitles = [p["title"] for p in redirs]
    rmap = idx.get("redirects", {})
    todo_r = [t for t in rtitles if refresh or t not in rmap]
    for i in range(0, len(todo_r), 50):
        d = api({"action": "query", "titles": "|".join(todo_r[i:i + 50]), "redirects": "1"})
        for r in d["query"].get("redirects", []): rmap[r["from"]] = r["to"]
    idx["redirects"] = rmap
    if "--list-only" in sys.argv:
        json.dump(idx, open(idx_path, "w"), indent=1, sort_keys=True); return
    todo = [t for t in titles if refresh or t not in idx["pages"] or not os.path.exists(os.path.join(RAW, idx["pages"][t]["file"]))]
    print("to fetch", len(todo))
    for i in range(0, len(todo), 50):
        d = api({"action": "query", "prop": "revisions|categories", "rvprop": "content|ids|timestamp", "rvslots": "main",
                 "cllimit": "max", "titles": "|".join(todo[i:i + 50])})
        for p in d["query"]["pages"]:
            revs = p.get("revisions")
            if not revs: continue
            rv = revs[0]; text = rv["slots"]["main"].get("content", "")
            f = safe(p["title"]) + ".wiki"
            open(os.path.join(RAW, f), "w").write(text)
            idx["pages"][p["title"]] = {"file": f, "rev": rv["revid"], "ts": rv["timestamp"],
                                        "cats": [c["title"].split(":", 1)[-1] for c in p.get("categories", [])]}
        json.dump(idx, open(idx_path, "w"), indent=1, sort_keys=True)
        print("fetched", min(i + 50, len(todo)), "/", len(todo))
    idx["crawled"] = datetime.date.today().isoformat()
    json.dump(idx, open(idx_path, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
