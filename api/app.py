"""PROXY API: serves one pick at a time for the demo people, calling the hosted model live on each new decision.

Run:  uvicorn app:app --port 8787   (from this folder, with PROXY_GATEWAY_URL and PROXY_GATEWAY_KEY set; see .env.example)
"""
import json
import logging
import os
import time
import uuid
from collections import OrderedDict, defaultdict, deque
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, Field

import proxy_core as core

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env(path):
    """KEY=VALUE lines from a local .env (never committed); real environment variables win."""
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


if not os.environ.get("PROXY_SKIP_DOTENV"):
    _load_env(os.path.join(HERE, ".env"))
DATA = os.environ.get("PROXY_DATA", os.path.join(HERE, "..", "app", "public", "data", "places.json"))
CARD = os.environ.get("PROXY_MODEL_CARD", os.path.join(HERE, "model_card_places.json"))
GATEWAY_URL = os.environ.get("PROXY_GATEWAY_URL", "")
GATEWAY_KEY = os.environ.get("PROXY_GATEWAY_KEY", "")
MODEL = os.environ.get("PROXY_MODEL", "llama-3.3-70b-instruct")
TIMEOUT_S = float(os.environ.get("PROXY_TIMEOUT_S", "12"))
ORIGINS = [o for o in os.environ.get("PROXY_ALLOWED_ORIGINS", "http://localhost:5174,http://127.0.0.1:5174").split(",") if o]
RATE_PER_MIN = int(os.environ.get("PROXY_RATE_PER_MIN", "30"))
MAX_BODY = 2048

log = logging.getLogger("proxy")
logging.basicConfig(level=logging.INFO, format="%(message)s")

REQS = Counter("proxy_requests_total", "API requests", ["endpoint", "status"])
LAT = Histogram("proxy_request_seconds", "End-to-end API latency", ["endpoint"], buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16))
MODEL_LAT = Histogram("proxy_model_seconds", "Gateway call latency", buckets=(0.1, 0.25, 0.5, 1, 2, 4, 8, 16))
GW_ERR = Counter("proxy_gateway_errors_total", "Gateway failures", ["kind"])
ASKED = Counter("proxy_questions_total", "Decisions where PROXY asked", ["setting"])

PEOPLE = {}   # person id -> list of decisions
CARD_DATA = {}


def load():
    d = json.load(open(DATA))
    for i, p in enumerate(d["people"], 1):
        PEOPLE[str(i)] = p["decisions"]
    CARD_DATA.update(json.load(open(CARD)))


load()
SETTINGS = {s["label"]: s for s in CARD_DATA["settings"]}
DEFAULT_SETTING = "When unsure"

app = FastAPI(title="PROXY API", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

_hits = defaultdict(deque)
_cache = OrderedDict()   # (person, decision) -> (time, probs, model latency)
CACHE_S, CACHE_MAX = 900, 256


@app.middleware("http")
async def guard(request: Request, call_next):
    rid = uuid.uuid4().hex[:12]
    t0 = time.time()
    endpoint = request.url.path
    if request.method == "POST":
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            REQS.labels(endpoint, "413").inc()
            return JSONResponse({"error": "too_large", "message": "Request too large."}, status_code=413)
        ip = request.client.host if request.client else "?"
        q = _hits[ip]
        while q and q[0] < t0 - 60:
            q.popleft()
        if len(q) >= RATE_PER_MIN:
            REQS.labels(endpoint, "429").inc()
            return JSONResponse({"error": "rate_limited", "message": "Too many requests. Wait a minute and try again."},
                                status_code=429)
        q.append(t0)
    request.state.rid = rid
    response = await call_next(request)
    dt = time.time() - t0
    if endpoint.startswith("/api/"):
        REQS.labels(endpoint, str(response.status_code)).inc()
        LAT.labels(endpoint).observe(dt)
        # one line per request: ids and timings only, never the person's history or the prompt
        log.info(json.dumps({"rid": rid, "path": endpoint, "status": response.status_code, "ms": round(dt * 1000)}))
    response.headers["X-Request-Id"] = rid
    return response


class PickIn(BaseModel):
    person: str = Field(min_length=1, max_length=4, pattern=r"^[0-9]+$")
    decision: int = Field(ge=0, le=999)
    setting: Literal["Never ask", "Rarely", "When unsure", "Often", "Always ask"] = DEFAULT_SETTING
    answer: Optional[Literal["yes", "no", "skip"]] = None


class RevealIn(BaseModel):
    person: str = Field(min_length=1, max_length=4, pattern=r"^[0-9]+$")
    decision: int = Field(ge=0, le=999)


def get_decision(person, idx):
    ds = PEOPLE.get(person)
    if ds is None:
        raise HTTPException(404, {"error": "unknown_person", "message": "There is no such demo person."})
    if idx >= len(ds):
        raise HTTPException(404, {"error": "no_more_decisions", "message": "That's all the decisions for this person."})
    return ds[idx]


def model_probs(person, idx, decision):
    key = (person, idx)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1], hit[2], True
    if not GATEWAY_URL or not GATEWAY_KEY:
        GW_ERR.labels("not_configured").inc()
        raise HTTPException(503, {"error": "model_unavailable", "message": "Couldn't reach the model."})
    try:
        lp, lat = core.score_options(core.build_prompt(decision), base_url=GATEWAY_URL, api_key=GATEWAY_KEY,
                                     model=MODEL, timeout_s=TIMEOUT_S)
    except core.GatewayError as e:
        GW_ERR.labels(e.kind).inc()
        if e.kind == "timeout":
            raise HTTPException(504, {"error": "timeout", "message": "PROXY couldn't finish this request."})
        if e.kind == "busy":
            raise HTTPException(503, {"error": "busy", "message": "The model is busy. Try again in a moment."})
        raise HTTPException(503, {"error": "model_unavailable", "message": "Couldn't reach the model."})
    MODEL_LAT.observe(lat)
    probs = core.softmax(lp, CARD_DATA["temperature"])
    _cache[key] = (time.time(), probs, lat)
    while len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)
    return probs, lat, False


def option(decision, i, probs):
    c = decision["candidates"][i]
    return {"index": i, "name": c["name"], "category": c.get("category") or None,
            "reason": core.reason_line(c, decision["history"])}


@app.get("/api/health")
def health():
    return {"ok": True, "model": MODEL, "gateway_configured": bool(GATEWAY_URL and GATEWAY_KEY), "people": len(PEOPLE)}


@app.get("/api/config")
def config():
    c = CARD_DATA
    return {
        "model": c["model"], "gateway": c["gateway"],
        "people": [{"id": k, "decisions": len(v)} for k, v in PEOPLE.items()],
        "settings": [{"label": s["label"], "ask_rate": s["ask_rate"], "accuracy": s["accuracy"],
                      "accuracy_ci": s["accuracy_ci"]} for s in c["settings"]],
        "default_setting": DEFAULT_SETTING,
        "evaluation": {"act_now_accuracy": c["act_now_accuracy"], "act_now_ci": c["act_now_ci"],
                       "always_ask_accuracy": c["always_ask_accuracy"], "always_ask_ci": c["always_ask_ci"],
                       "report_rows": c["split"]["report_rows"], "report_users": c["split"]["report_users"],
                       "options_per_decision": 5, "ece": c["ece_report"], "latency_s": c["latency_s"]},
    }


@app.post("/api/pick")
def pick(body: PickIn, request: Request):
    d = get_decision(body.person, body.decision)
    probs, lat, cached = model_probs(body.person, body.decision, d)
    setting = SETTINGS[body.setting]
    q = core.best_question(probs, d["candidates"])
    ask = q is not None and core.should_ask(q[0], setting)
    out = {"request_id": request.state.rid, "person": body.person, "decision": body.decision,
           "n_decisions": len(PEOPLE[body.person]), "model": MODEL, "model_latency_s": lat, "cached": cached,
           "history": [{"name": h["name"], "category": h.get("category") or None} for h in d["history"][-8:][::-1]],
           "history_total": len(d["history"])}
    if ask and body.answer is None:
        ASKED.labels(body.setting).inc()
        out.update(stage="question", question={"text": core.question_text(q[1]), "category": q[1]})
        return out
    answered = ask and body.answer in ("yes", "no")
    now = core.after_answer(probs, q[2], body.answer) if answered else probs
    order = core.ranked(now)
    if not order:
        raise HTTPException(422, {"error": "no_options", "message": "There are no places to choose from in this set."})
    conf = now[order[0]]
    bins = CARD_DATA["reliability_after_answer"] if answered else CARD_DATA["reliability"]
    # after an answer that leaves one option, the held-out record is 100% only because simulated answers are truthful;
    # that says nothing about a real person's answer, so no track record is shown
    tr = None if answered and len(order) == 1 else core.track_record(conf, bins)
    out.update(
        stage="pick",
        question={"text": core.question_text(q[1]), "category": q[1]} if ask else None,
        answer=body.answer if ask else None,
        ranking=[option(d, i, now) for i in order],
        ruled_out=[option(d, i, now) for i in range(len(now)) if now[i] == 0],
        confidence=None if tr is None else {"label": core.confidence_label(tr[0]), "matched_out_of_10": round(tr[0] * 10),
                                            "similar_picks": tr[1]},
        without_answer=option(d, core.ranked(probs)[0], probs) if answered else None,
    )
    return out


@app.post("/api/reveal")
def reveal(body: RevealIn):
    """Developer view only: the place the person actually chose."""
    d = get_decision(body.person, body.decision)
    return {"answer_index": d["answer_idx"], "name": d["candidates"][d["answer_idx"]]["name"]}


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
