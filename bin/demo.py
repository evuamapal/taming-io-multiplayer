#!/usr/bin/env python3
# Scripted check run over Chrome's local DevTools port (127.0.0.1 only): opens the game, runs a JSON
# step list (menu, Play, walk, gather), saves screenshots and page events, then closes Chrome.
# Usage: demo.py --port DEVTOOLS_PORT --url URL --steps steps.json --out DIR
import argparse, base64, json, os, threading, time, urllib.request
import websocket

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--url", required=True)
ap.add_argument("--steps", required=True)
ap.add_argument("--out", required=True)
A = ap.parse_args()
os.makedirs(A.out, exist_ok=True)
T0 = time.time()
LOG = open(os.path.join(A.out, "demo.jsonl"), "w")
NOPROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def mark(k, **kw):
    kw.update({"k": k, "t": round(time.time() - T0, 2)})
    LOG.write(json.dumps(kw, ensure_ascii=False) + "\n"); LOG.flush()
    print("[%6.1f]" % kw["t"], k, json.dumps(kw, ensure_ascii=False)[:300], flush=True)

class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, suppress_origin=True, timeout=None)
        self.id, self.lock, self.wait = 0, threading.Lock(), {}
        self.f = open(os.path.join(A.out, "page.jsonl"), "w")
        threading.Thread(target=self.loop, daemon=True).start()
    def call(self, m, p=None):
        with self.lock:
            self.id += 1; i = self.id
            ev = self.wait[i] = [threading.Event(), None]
            self.ws.send(json.dumps({"id": i, "method": m, "params": p or {}}))
        ev[0].wait(20)
        return ev[1]
    def loop(self):
        while True:
            try: m = json.loads(self.ws.recv())
            except Exception: break
            if "id" in m and m["id"] in self.wait:
                w = self.wait.pop(m["id"]); w[1] = m.get("result", m.get("error")); w[0].set(); continue
            meth, p = m.get("method"), m.get("params", {})
            if meth == "Network.requestWillBeSent":
                self.f.write(json.dumps({"k": "req", "url": p.get("request", {}).get("url", "")[:300]}) + "\n")
            elif meth == "Network.loadingFailed":
                self.f.write(json.dumps({"k": "req_fail", "err": p.get("errorText")}) + "\n")
            elif meth == "Network.webSocketCreated":
                self.f.write(json.dumps({"k": "ws_created", "url": p.get("url")}) + "\n")
            elif meth == "Runtime.exceptionThrown":
                d = p.get("exceptionDetails", {})
                self.f.write(json.dumps({"k": "js_exception", "text": str((d.get("exception") or {}).get("description", d.get("text")))[:400]}) + "\n")
            else:
                continue
            self.f.flush()
    def js(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}) or {}
        return (r.get("result") or {}).get("value")

def page_ws():
    for _ in range(100):
        try:
            for t in json.load(NOPROXY.open("http://127.0.0.1:%d/json" % A.port, timeout=2)):
                if t.get("type") == "page":
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.2)
    raise SystemExit("no DevTools page on 127.0.0.1:%d" % A.port)

KEYS = {"w": ("KeyW", 87), "a": ("KeyA", 65), "s": ("KeyS", 83), "d": ("KeyD", 68), " ": ("Space", 32), "e": ("KeyE", 69), "q": ("KeyQ", 81)}
KEYS.update({str(i): ("Digit%d" % i, 48 + i) for i in range(10)})
def key(c, typ, k):
    code, vk = KEYS.get(k, ("Key" + k.upper(), ord(k.upper()[0])))
    p = {"type": typ, "key": k, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
    if typ == "keyDown" and len(k) == 1: p["text"] = k
    c.call("Input.dispatchKeyEvent", p)
def click(c, x, y):
    for t in ("mousePressed", "mouseReleased"):
        c.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})
CENTER = "(function(s){var e=document.querySelector(s);if(!e||e.offsetParent===null)return null;var b=e.getBoundingClientRect();if(!b.width)return null;return [b.x+b.width/2,b.y+b.height/2];})(%s)"

def main():
    steps = json.load(open(A.steps))
    c = CDP(page_ws())
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        c.call(m)
    if steps.get("hook"):
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source": steps["hook"]})
    # fixed 1280x713 viewport: the step coordinates were recorded at that size
    c.call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 713, "deviceScaleFactor": 1, "mobile": False})
    mark("open", url=A.url)
    c.call("Page.navigate", {"url": A.url})
    for st in steps["steps"]:
        op = st[0]
        try:
            if op == "sleep": time.sleep(st[1])
            elif op == "shot":
                r = c.call("Page.captureScreenshot", {"format": "jpeg", "quality": 70}) or {}
                if r.get("data"):
                    open(os.path.join(A.out, st[1] + ".jpg"), "wb").write(base64.b64decode(r["data"]))
                mark("shot", name=st[1], ok=bool(r.get("data")))
            elif op == "type":
                c.js("(function(){var e=document.querySelector(%s);if(e){e.value=%s;e.dispatchEvent(new Event('input',{bubbles:true}));}})()" % (json.dumps(st[1]), json.dumps(st[2])))
                mark("type", sel=st[1])
            elif op == "play":
                ok = False
                for _ in range(st[1] if len(st) > 1 else 8):
                    r = c.js(CENTER % json.dumps("#play-box"))
                    if not r: ok = True; break
                    click(c, r[0], r[1])
                    for _ in range(10):
                        time.sleep(0.5)
                        if not c.js(CENTER % json.dumps("#play-box")): ok = True; break
                    if ok: break
                mark("play", joined=ok)
            elif op == "cdpclick":
                r = c.js(CENTER % json.dumps(st[1]))
                if r: click(c, r[0], r[1])
                mark("cdpclick", sel=st[1], at=r)
            elif op == "mouse": c.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": st[1], "y": st[2]})
            elif op == "mousedown": c.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": st[1], "y": st[2], "button": "left", "clickCount": 1})
            elif op == "mouseup": c.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": st[1], "y": st[2], "button": "left", "clickCount": 1})
            elif op == "hold":
                for k in st[1]: key(c, "keyDown", k)
                time.sleep(st[2])
                for k in st[1]: key(c, "keyUp", k)
                mark("hold", keys=st[1], secs=st[2])
            elif op == "key":
                key(c, "keyDown", st[1]); key(c, "keyUp", st[1]); mark("key", key=st[1])
            elif op == "eval":
                mark("eval", name=st[2] if len(st) > 2 else st[1][:40], value=c.js(st[1]))
        except Exception as e:
            mark("step_err", step=st[:2], err=str(e)[:200])
    mark("done")
    try: c.call("Browser.close")
    except Exception: pass

if __name__ == "__main__":
    main()
