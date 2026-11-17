"""HTTP checks against a running PROXY API (and the app in a headless browser).
Usage: python3 deployed_checks.py --api-log <uvicorn log file>
Writes evidence/deployed_checks_<date>.json and .md. Live gateway calls made here: 3 (checks a, c, e)."""
import argparse, json, os, time
from opslib import *

ap = argparse.ArgumentParser()
ap.add_argument("--api-log", default=None)
ap.add_argument("--skip-rate-limit", action="store_true")
args = ap.parse_args()
D = today()
res = {"started": now(), "base": BASE, "app": APP, "checks": {}}


def brief(r):
    j = r.get("json") or {}
    keep = {k: j.get(k) for k in ("stage", "cached", "model_latency_s", "n_decisions", "model", "live", "request_id") if k in j}
    if "detail" in j:
        d = j["detail"]
        keep["detail"] = [{"loc": x.get("loc"), "msg": x.get("msg")} for x in d] if isinstance(d, list) else d
    for k in ("error", "message"):
        if k in j:
            keep[k] = j[k]
    return {"status": r["status"], "client_ms": r["ms"], "request_id": r["request_id"], **keep}


# a. valid Places pick (Person 3, decision index 1)
r = call("/api/pick", {"domain": "places", "person": "3", "decision": 1, "setting": "When unsure"})
res["checks"]["a_valid_places"] = {"request": "places person 3 decision 1", "expect": 200, "pass": r["status"] == 200 and r["json"].get("cached") is False, **brief(r)}

# b. valid Shopping pick
r = call("/api/pick", {"domain": "shopping", "person": "1", "decision": 0, "setting": "When unsure"})
res["checks"]["b_valid_shopping"] = {"request": "shopping person 1 decision 0", "expect": "200, model_latency_s null (replay)", "pass": r["status"] == 200 and r["json"].get("model_latency_s") is None, **brief(r)}

# c. edge case. Neither data file has a person with an empty history; the shortest is below.
people = {}
for dom in ("places", "shopping"):
    p = json.load(open(os.path.join(HERE, "..", "app", "public", "data", dom + ".json")))["people"]
    h = min((len(d["history"]), i, k) for i, pp in enumerate(p, 1) for k, d in enumerate(pp["decisions"]))
    people[dom] = {"min_history_len": h[0], "person": h[1], "decision": h[2]}
res["data_shortest_history"] = people
r = call("/api/pick", {"domain": "places", "person": str(people["places"]["person"]), "decision": people["places"]["decision"]})
res["checks"]["c1_shortest_history_places"] = {"request": f"places person {people['places']['person']} decision {people['places']['decision']} (history length {people['places']['min_history_len']})", "note": "no person has an empty history in either file", "pass": r["status"] == 200, **brief(r)}
r = call("/api/pick", {"domain": "shopping", "person": str(people["shopping"]["person"]), "decision": people["shopping"]["decision"]})
res["checks"]["c2_shortest_history_shopping"] = {"request": f"shopping person {people['shopping']['person']} decision {people['shopping']['decision']} (history length {people['shopping']['min_history_len']})", "pass": r["status"] == 200, **brief(r)}
r = call("/api/pick", {"domain": "places", "person": "3", "decision": 99})
res["checks"]["c3_decision_past_end"] = {"request": "places person 3 decision 99", "expect": 404, "pass": r["status"] == 404, **brief(r)}
r = call("/api/pick", {"domain": "places", "person": "9999", "decision": 0})
res["checks"]["c4_unknown_person_4digit"] = {"request": "places person 9999 decision 0", "expect": 404, "pass": r["status"] == 404, **brief(r)}

# d. malformed input
ok = {"domain": "places", "person": "3", "decision": 1}
cases = {
    "d1_person_abc": dict(ok, person="abc"),
    "d2_person_5_digits": dict(ok, person="12345"),
    "d3_missing_person": {"domain": "places", "decision": 1},
    "d4_missing_decision": {"domain": "places", "person": "3"},
    "d5_bad_setting": dict(ok, setting="Sometimes"),
}
for k, b in cases.items():
    r = call("/api/pick", b)
    res["checks"][k] = {"request": json.dumps(b), "expect": 422, "pass": r["status"] == 422, **brief(r)}
r = call("/api/pick", raw=json.dumps(dict(ok, pad="x" * 3000)).encode())
res["checks"]["d6_oversized_body"] = {"request": "valid fields plus a 3000-byte pad (body > 2048)", "expect": 413, "pass": r["status"] == 413, **brief(r)}
r = call("/api/pick", raw=b"{not json")
res["checks"]["d7_invalid_json"] = {"request": "{not json", "expect": 422, "pass": r["status"] == 422, **brief(r)}

# e. app -> API -> gateway, in a headless browser (Places, Person 1, decision 1 on screen)
png = os.path.join(EVID, f"integration_places_{D}.png")
b = run_browser(png)
if b.get("skipped_or_failed"):
    res["checks"]["e_integration_browser"] = {"pass": False, "skipped": True, "reason": b["stderr"]}
else:
    rids = {p["request_id_header"] for p in b["picks"] if p["request_id_header"]}
    logs = log_lines_for(args.api_log, rids)
    res["checks"]["e_integration_browser"] = {"pass": bool(b["picks"]) and b["picks"][0]["status"] == 200 and b["picks"][0]["cached"] is False,
        "screenshot": os.path.basename(png), "picks": b["picks"], "api_log_lines": list(logs.values()),
        "click_to_settled_s": b["click_to_settled_s"], "visible_text": b["visible_text"]}

# f. rate limit: wait out the 60 s window, then 31 Shopping picks (no model call)
if not args.skip_rate_limit:
    time.sleep(62)
    codes, first429 = [], None
    t0 = time.time()
    for i in range(31):
        r = call("/api/pick", {"domain": "shopping", "person": "1", "decision": 0})
        codes.append(r["status"])
        if r["status"] == 429 and first429 is None:
            first429 = {"index": i + 1, **brief(r)}
    png2 = os.path.join(EVID, f"ratelimit_app_{D}.png")
    b = run_browser(png2)
    res["checks"]["f_rate_limit"] = {"request": "31 POST /api/pick shopping person 1 decision 0", "seconds": round(time.time() - t0, 2),
        "status_counts": {str(c): codes.count(c) for c in sorted(set(codes))}, "first_429": first429,
        "pass": codes[:30] == [200] * 30 and codes[30] == 429,
        "app_view_screenshot": os.path.basename(png2),
        "app_view_alerts": b.get("alerts"), "app_view_text": b.get("visible_text"), "app_view_picks": b.get("picks")}
res["finished"] = now()
base = os.path.join(EVID, f"deployed_checks_{D}")
json.dump(res, open(base + ".json", "w"), indent=2)
L = [f"# Deployed checks {res['started']}", "", f"API {BASE}, app {APP}.", "", "| check | request | status | pass | detail |", "|---|---|---|---|---|"]
for k, v in res["checks"].items():
    det = v.get("detail") or v.get("message") or v.get("stage") or v.get("reason") or ""
    if k.startswith("f_"):
        det = f"counts {v['status_counts']}; 429 message: {(v['first_429'] or {}).get('message')}"
    L.append(f"| {k} | {v.get('request','')} | {v.get('status','')} | {v['pass']} | {str(det)[:160].replace('|','/')} |")
open(base + ".md", "w").write("\n".join(L) + "\n")
print("\n".join(L))
