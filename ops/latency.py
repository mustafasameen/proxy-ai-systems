"""Latency run: 20 live Places picks on distinct (person, decision) pairs, then the same 20 again (cached).
Skips pairs the other checks already requested. Live gateway calls made here: 20.
Usage: python3 latency.py   (writes evidence/latency_<date>.json and .md)"""
import json, os, time
from opslib import *

USED = {(1, 0), (3, 1), (2, 0)}          # requested by deployed_checks.py in this server process
places = json.load(open(os.path.join(HERE, "..", "app", "public", "data", "places.json")))["people"]
pairs = [(i, k) for i, p in enumerate(places, 1) for k in range(len(p["decisions"])) if (i, k) not in USED]
# round-robin over people so no one person dominates
by = {}
for i, k in pairs:
    by.setdefault(i, []).append(k)
sel = []
while len(sel) < 20:
    for i in sorted(by):
        if by[i] and len(sel) < 20:
            sel.append((i, by[i].pop(0)))
assert len(set(sel)) == 20


def run(tag):
    rows = []
    for i, k in sel:
        r = call("/api/pick", {"domain": "places", "person": str(i), "decision": k, "setting": "When unsure"})
        j = r.get("json") or {}
        rows.append({"pair": f"{i}:{k}", "status": r["status"], "client_ms": r["ms"], "cached": j.get("cached"),
                     "model_latency_s": j.get("model_latency_s"), "request_id": r["request_id"]})
    return rows


t_start = now()
live = run("live")
time.sleep(62)                            # keep the 30 POST/min limit from interfering with the cached pass
cached = run("cached")


def stats(rows, key, scale=1.0):
    xs = [r[key] * scale for r in rows if r[key] is not None and r["status"] == 200]
    return {"n": len(xs), "p50": round(pct(xs, .5), 3), "p95": round(pct(xs, .95), 3), "max": round(max(xs), 3)}


out = {"started": t_start, "finished": now(), "pairs": [f"{i}:{k}" for i, k in sel],
       "live_all_cached_false": all(r["cached"] is False for r in live) and all(r["status"] == 200 for r in live),
       "cached_all_cached_true": all(r["cached"] is True for r in cached) and all(r["status"] == 200 for r in cached),
       "live": {"client_s": stats(live, "client_ms", .001), "model_latency_s": stats(live, "model_latency_s")},
       "cached": {"client_s": stats(cached, "client_ms", .001), "model_latency_s": stats(cached, "model_latency_s")},
       "note": "model_latency_s on a cached response is the stored latency of the original gateway call, not a new call",
       "rows_live": live, "rows_cached": cached}
base = os.path.join(EVID, f"latency_{today()}")
json.dump(out, open(base + ".json", "w"), indent=2)
L = ["# Latency, 20 Places picks (Llama 3.3 70B via gateway)", "", f"{out['started']} to {out['finished']}",
     f"All 20 live responses 200 and cached:false: {out['live_all_cached_false']}; repeat all cached:true: {out['cached_all_cached_true']}", "",
     "| pass | measure | n | p50 s | p95 s | max s |", "|---|---|---|---|---|---|"]
for ph in ("live", "cached"):
    for m in ("client_s", "model_latency_s"):
        s = out[ph][m]
        L.append(f"| {ph} | {m} | {s['n']} | {s['p50']} | {s['p95']} | {s['max']} |")
open(base + ".md", "w").write("\n".join(L) + "\n")
print("\n".join(L))
