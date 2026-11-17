"""Deliberate failure drill. Restarts the API on port 8791 three times, each time with an env override only (api/.env is not touched):
  A  PROXY_GATEWAY_URL points at an unroutable address
  B  PROXY_GATEWAY_KEY is a dummy string (the real gateway rejects it)
  C  normal configuration restored
The monitor runs through all three. Requires that nothing listens on 8791 (stop the normal server first).
Usage: python3 failure_drill.py   (writes evidence/failure_drill_<date>.json, monitor_run_<date>.log, screenshots, metrics snapshots)"""
import json, os, signal, subprocess, sys, threading, time, urllib.request
from opslib import *

D = today()
API_DIR = os.path.join(HERE, "..", "api")
PY = sys.executable
PORT = BASE.rsplit(":", 1)[1]
out = {"started": now(), "phases": {}}


def start_api(extra, logname):
    env = dict(os.environ, PROXY_ALLOWED_ORIGINS=APP, **extra)
    f = open(logname, "w")
    p = subprocess.Popen([PY, "-m", "uvicorn", "app:app", "--port", PORT], cwd=API_DIR, env=env, stdout=f, stderr=subprocess.STDOUT)
    for _ in range(40):
        time.sleep(0.5)
        try:
            return p, call("/api/health", timeout=2)["json"]
        except Exception:
            pass
    raise SystemExit("API did not start")


def stop_api(p, logname):
    p.send_signal(signal.SIGINT)
    try:
        p.wait(10)
    except subprocess.TimeoutExpired:
        p.kill()
    with open(logname) as f, open(os.path.join(EVID, os.path.basename(logname)), "w") as g:
        for line in f:
            if line.startswith('{"rid"'):
                g.write(line)


def snap(name):
    txt = urllib.request.urlopen(BASE + "/metrics").read().decode()
    open(os.path.join(EVID, name), "w").write("".join(l + "\n" for l in txt.splitlines() if l.startswith("proxy_") and "_created" not in l))


def pick(domain, person, dec, **kw):
    r = call("/api/pick", {"domain": domain, "person": str(person), "decision": dec, "setting": "When unsure"}, timeout=40, **kw)
    j = r.get("json") or {}
    return {"pair": f"{domain}:{person}:{dec}", "status": r["status"], "client_s": round(r["ms"] / 1000, 2), "body": j.get("detail", j) if r["status"] != 200 else {"stage": j.get("stage"), "cached": j.get("cached")}}


tmp = os.environ.get("TMPDIR", "/tmp")
monlog = os.path.join(EVID, f"monitor_run_{D}.log")
mon = None
try:
    # A. unreachable gateway
    la = os.path.join(tmp, "api_unreachable.log")
    p, h = start_api({"PROXY_GATEWAY_URL": "http://10.255.255.1:9"}, la)
    mon = subprocess.Popen([PY, os.path.join(HERE, "monitor.py"), "--url", BASE, "--interval", "3", "--window", "10", "--max-error-share", "0.3", "--max-p95", "2.0"],
                           stdout=open(monlog, "w"), stderr=subprocess.STDOUT)
    time.sleep(7)
    A = {"health": h, "shopping_ok": [pick("shopping", i, 0) for i in (1, 2, 3, 4)]}
    time.sleep(6)
    A["api_direct_places"] = pick("places", 4, 2)
    br = run_browser(os.path.join(EVID, f"failure_unreachable_app_{D}.png"))
    A["browser"] = {k: br.get(k) for k in ("picks", "alerts", "click_to_settled_s", "skipped_or_failed", "stderr")}
    A["browser"]["visible_error_text"] = [l for l in (br.get("visible_text") or "").splitlines() if "model" in l.lower() or "again" in l.lower() or "couldn" in l.lower()]
    res = []
    ts = [threading.Thread(target=lambda a=a: res.append(pick("places", *a))) for a in [(5, 2), (6, 2), (7, 2), (8, 2), (9, 3), (10, 2)]]
    [t.start() for t in ts]; [t.join() for t in ts]
    A["parallel_places_failures"] = res
    A["shopping_after"] = [pick("shopping", i, 0) for i in (5, 6)]
    time.sleep(9)
    snap(f"metrics_after_unreachable_{D}.txt")
    stop_api(p, la)
    out["phases"]["A_unreachable_gateway"] = A

    # B. bad key
    lb = os.path.join(tmp, "api_badkey.log")
    p, h = start_api({"PROXY_GATEWAY_KEY": "not-a-real-key-drill"}, lb)
    time.sleep(4)
    B = {"health": h, "api_direct_places": pick("places", 5, 3)}
    br = run_browser(os.path.join(EVID, f"failure_badkey_app_{D}.png"))
    B["browser"] = {k: br.get(k) for k in ("picks", "alerts", "click_to_settled_s", "skipped_or_failed", "stderr")}
    B["browser"]["visible_error_text"] = [l for l in (br.get("visible_text") or "").splitlines() if "model" in l.lower() or "again" in l.lower() or "couldn" in l.lower()]
    time.sleep(6)
    snap(f"metrics_after_badkey_{D}.txt")
    stop_api(p, lb)
    out["phases"]["B_bad_key"] = B

    # C. restored
    lc = os.path.join(tmp, "api_restored.log")
    p, h = start_api({}, lc)
    time.sleep(4)
    C = {"health": h, "api_direct_places": pick("places", 9, 2), "shopping": pick("shopping", 1, 0)}
    time.sleep(10)
    snap(f"metrics_after_restore_{D}.txt")
    stop_api(p, lc)
    out["phases"]["C_restored"] = C
finally:
    if mon:
        mon.terminate()
        mon.wait(10)
out["finished"] = now()
json.dump(out, open(os.path.join(EVID, f"failure_drill_{D}.json"), "w"), indent=2)
print(json.dumps(out, indent=1)[:6000])
