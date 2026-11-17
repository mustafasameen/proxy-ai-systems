"""Small helpers shared by the ops scripts: HTTP calls with timing, dates, evidence paths."""
import json, os, subprocess, time, urllib.request, urllib.error

BASE = os.environ.get("PROXY_BASE", "http://localhost:8791")
APP = os.environ.get("PROXY_APP", "http://localhost:5176")
EVID = os.environ.get("PROXY_EVID", os.path.join(os.path.dirname(os.path.abspath(__file__)), "evidence"))  # set PROXY_EVID to write elsewhere
os.makedirs(EVID, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))


def today():
    return subprocess.check_output(["date", "+%Y%m%d"], text=True).strip()


def now():
    return subprocess.check_output(["date", "+%Y-%m-%d %H:%M:%S %Z"], text=True).strip()


def call(path, body=None, raw=None, method=None, timeout=60, base=None):
    """One HTTP call. Returns dict(status, ms, headers, json|text)."""
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request((base or BASE) + path, data=data, method=method or ("POST" if data is not None else "GET"),
                                 headers={"Content-Type": "application/json"} if data is not None else {})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, hdr, txt = r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        status, hdr, txt = e.code, dict(e.headers), e.read().decode()
    ms = round((time.time() - t0) * 1000)
    out = {"status": status, "ms": ms, "request_id": hdr.get("X-Request-Id")}
    try:
        out["json"] = json.loads(txt)
    except ValueError:
        out["text"] = txt[:300]
    return out


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def run_browser(out_png, answer=None, app=None):
    cmd = ["node", os.path.join(HERE, "browser_flow.js"), app or APP, out_png] + ([answer] if answer else [])
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        return {"skipped_or_failed": True, "stderr": p.stderr[-400:]}
    return json.loads(p.stdout.strip().splitlines()[-1])


def log_lines_for(logfile, rids):
    out = {}
    if not logfile or not os.path.exists(logfile):
        return out
    for line in open(logfile):
        line = line.strip()
        if line.startswith("{") and '"rid"' in line:
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get("rid") in rids:
                out[j["rid"]] = line
    return out
