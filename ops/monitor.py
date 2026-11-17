"""Scrape /metrics every few seconds and print a timestamped OK or ALERT line.
ALERT only once the window holds at least --min-sample requests (default 10), so one or two requests cannot raise an alert.
ALERT when, over the last N requests, the share with status >= 500 exceeds --max-error-share, or p95 request latency
(from proxy_request_seconds buckets, linear interpolation) exceeds --max-p95 seconds. Counter resets (server restart) are noted.
Requests older than --max-age seconds leave the window, so an alert clears once an outage is over and traffic stops.
Usage: python3 monitor.py [--url http://localhost:8791] [--interval 3] [--window 10] [--min-sample 10] [--max-error-share 0.3] [--max-p95 2.0] [--max-age 60] [--duration 0]"""
import argparse, re, sys, time, urllib.request, subprocess
from collections import deque

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8791")
ap.add_argument("--interval", type=float, default=3)
ap.add_argument("--window", type=int, default=10)
ap.add_argument("--min-sample", type=int, default=10, help="requests the window must hold before an ALERT can be raised")
ap.add_argument("--max-error-share", type=float, default=0.3)
ap.add_argument("--max-p95", type=float, default=2.0)
ap.add_argument("--max-age", type=float, default=60, help="seconds a request stays in the window")
ap.add_argument("--duration", type=float, default=0, help="seconds to run; 0 = until interrupted")
a = ap.parse_args()

REQ = re.compile(r'^proxy_requests_total\{endpoint="([^"]+)",status="(\d+)"\} ([0-9.e+]+)$')
BKT = re.compile(r'^proxy_request_seconds_bucket\{endpoint="([^"]+)",le="([^"]+)"\} ([0-9.e+]+)$')


def stamp():
    return subprocess.check_output(["date", "+%Y-%m-%d %H:%M:%S"], text=True).strip()


def scrape():
    txt = urllib.request.urlopen(a.url + "/metrics", timeout=5).read().decode()
    reqs, bk = {}, {}
    for line in txt.splitlines():
        m = REQ.match(line)
        if m:
            reqs[(m[1], m[2])] = float(m[3])
        m = BKT.match(line)
        if m:
            le = float("inf") if m[2] == "+Inf" else float(m[2])
            bk[le] = bk.get(le, 0) + float(m[3])      # sum over endpoints
    return reqs, bk


def p95(delta_bk):
    """delta_bk: cumulative bucket counts {le: count}. Linear interpolation inside the bucket holding the 95th percentile."""
    les = sorted(delta_bk)
    total = delta_bk[les[-1]]
    if total <= 0:
        return None
    target, prev_le, prev_c = 0.95 * total, 0.0, 0.0
    for le in les:
        c = delta_bk[le]
        if c >= target:
            if le == float("inf"):
                return prev_le
            return prev_le + (le - prev_le) * ((target - prev_c) / max(c - prev_c, 1e-9))
        prev_le, prev_c = le, c
    return prev_le


prev_r, prev_b = None, None
win = deque()     # per-scrape (time, n_requests, n_errors, bucket_delta), last N requests no older than --max-age
seen_traffic = False
t_end = time.time() + a.duration if a.duration else None
print(f"{stamp()} START monitor url={a.url} window={a.window} min_sample={a.min_sample} max_error_share={a.max_error_share} max_p95={a.max_p95}s max_age={a.max_age}s interval={a.interval}s", flush=True)
while t_end is None or time.time() < t_end:
    try:
        r, b = scrape()
    except Exception as e:
        print(f"{stamp()} ALERT scrape_failed {type(e).__name__}: server not answering on /metrics", flush=True)
        time.sleep(a.interval)
        continue
    if prev_r is not None:
        if sum(r.values()) < sum(prev_r.values()):
            print(f"{stamp()} NOTE counters reset (server restarted); window cleared", flush=True)
            win.clear()
        else:
            n = int(sum(v - prev_r.get(k, 0) for k, v in r.items()))
            err = int(sum(v - prev_r.get(k, 0) for k, v in r.items() if int(k[1]) >= 500))
            db = {le: b[le] - prev_b.get(le, 0) for le in b}
            now = time.time()
            if n > 0:
                win.append((now, n, err, db))
                seen_traffic = True
                while len(win) > 1 and sum(w[1] for w in list(win)[1:]) >= a.window:
                    win.popleft()
            while win and now - win[0][0] > a.max_age:
                win.popleft()
        N = sum(w[1] for w in win)
        E = sum(w[2] for w in win)
        if N == 0:
            quiet = f"no requests in the last {a.max_age:g}s" if seen_traffic else "no traffic yet"
            print(f"{stamp()} OK {quiet}", flush=True)
        else:
            share = E / N
            agg = {}
            for w in win:
                for le, c in w[3].items():
                    agg[le] = agg.get(le, 0) + c
            lat = p95(agg)
            problems = []
            if share > a.max_error_share:
                problems.append(f"error_share={share:.2f}>{a.max_error_share}")
            if lat is not None and lat > a.max_p95:
                problems.append(f"p95={lat:.2f}s>{a.max_p95}s")
            if problems and N < a.min_sample:
                # too few requests to judge: report it, but do not alert
                problems_seen = " ".join(problems)
                problems = []
                note = f" below_min_sample={N}<{a.min_sample} ({problems_seen} not alerted)"
            else:
                note = ""
            tag = "ALERT" if problems else "OK"
            print(f"{stamp()} {tag} last_{N}_requests errors={E} error_share={share:.2f} p95={lat if lat is None else round(lat,2)}s"
                  + (" " + " ".join(problems) if problems else "") + note, flush=True)
    prev_r, prev_b = r, b
    time.sleep(a.interval)
