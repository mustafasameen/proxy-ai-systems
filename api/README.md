# PROXY API

A small FastAPI service behind the PROXY app. It serves two kinds of decisions. For Places, every new decision is live: the
service rebuilds the evaluated prompt from the person's record and asks a hosted language model for its preference over the five
options. For Shopping, it replays the saved scores of the fine-tuned model that was evaluated, so no model call is made. In both
cases it decides whether one yes/no question is worth asking and returns the pick with a reason drawn from the person's own
history, along with the five options and the history the screen shows as context.

## How a request flows

```
browser (React app, port 5174)
   │  POST /api/pick {person, decision, setting, answer}
   ▼
PROXY API (FastAPI, port 8787)
   ├─ validate input (ids and fixed choices only; 2 KB body limit; 30 requests per minute per client)
   ├─ look up the decision in the demo records (app/public/data/places.json or shopping.json)
   ├─ Places: build the prompt (same wording the held-out evaluation used)
   ├─ Places: call the model gateway ──────► UF NaviGator, Llama 3.3 70B (HiPerGator-hosted)
   ├─ Shopping: read the saved option scores (no model call)
   │     one token, temperature 0, top-20 log-probs; 12 s timeout
   ├─ option probabilities = softmax(letter log-probs / T), T fitted on held-out people
   ├─ question rule: ask about the kind of place (Places) or the brand or category (Shopping) whose answer most raises the
   │  chance of a right pick, if the gain passes the setting's threshold
   ├─ after a yes or no: drop the options the answer rules out
   └─ response: question, or ranked options + reason + measured track record
   ▼
logs (one line per request: id, path, status, time) and Prometheus metrics at /metrics
```

The model's output for a decision is cached for 15 minutes, so answering the question, changing the answer, or asking for the
next option does not call the model again.

## Run it

```bash
cd api
cp .env.example .env        # then put your NaviGator key in PROXY_GATEWAY_KEY
python3 -m pip install -r requirements.txt
python3 -m uvicorn app:app --port 8787
```

Then start the app (`cd app && npm run dev`) and open http://localhost:5174.

| Variable | Meaning | Default |
|---|---|---|
| `PROXY_GATEWAY_URL` | Gateway base URL | none |
| `PROXY_GATEWAY_KEY` | Gateway key, read on the server only | none |
| `PROXY_MODEL` | Model name at the gateway | `llama-3.3-70b-instruct` |
| `PROXY_TIMEOUT_S` | Gateway timeout in seconds | `12` |
| `PROXY_ALLOWED_ORIGINS` | Browser origins allowed by CORS | `http://localhost:5174,http://127.0.0.1:5174` |
| `PROXY_RATE_PER_MIN` | Requests per minute per client | `30` |

## Endpoints

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Liveness, model name, whether the gateway is configured |
| `GET /api/config?domain=places` | Demo people, the five ask settings with their measured match rates, evaluation summary, map bounds |
| `POST /api/context` | The five options and the person's shown history for one decision, without calling the model |
| `POST /api/pick` | One step of a decision: returns `stage: "question"` or `stage: "pick"`, with the same context fields |
| `POST /api/reveal` | The option the person really chose, shown after a choice is made |
| `GET /metrics` | Prometheus metrics: requests, latency, gateway errors, questions asked |

Errors come back as `{"detail": {"error": code, "message": text}}` with these codes: `unknown_person` and
`no_more_decisions` (404), validation errors and `no_options` (422), `rate_limited` (429), `busy` and `model_unavailable` (503),
and `timeout` (504). The app shows `message` to the user.

## Where the numbers come from

`model_card_places.json` is written by the evaluation script from a run of the same model over all 2,502 held-out decisions
(300 people never used for training). `model_card_shopping.json` comes from the fine-tuned model's saved scores on all 8,000
held-out Amazon Video Games decisions (3,615 people). In both, half of the people fit the temperature and the ask thresholds;
the other half give the reported match rates, their 95% intervals (person-level bootstrap) and the confidence track record.
The app shows only these numbers.

## Security and privacy controls

- **The key stays on the server.** It is read from `.env` (never committed) or the environment. No endpoint returns it, and a
  test checks this. Environment variables keep the key out of the code and the repository; they do not protect it from anyone
  who can read the server's environment.
- **No free text reaches the model.** Requests carry only ids and fixed choices, checked by type and pattern, so a user cannot
  inject instructions into the prompt.
- **Limits.** Bodies over 2 KB are refused, each client gets 30 requests a minute, and only the app's origin passes CORS.
- **Logs hold ids and timings only,** never a person's places or the prompt (a test checks this).
- **Public records are generalized.** Places that reveal health, religion, sexual orientation, adult venues or a home appear
  as a generic label without a name and never get a map point. Other map points are rounded to about 500 m, and the map is
  drawn in the browser from a local outline file, so no map service sees them.
- **Not production grade.** There is no user login (the demo people are anonymized records), the rate limit is in memory, and the
  service is meant for a local demo. A real deployment would add authentication, TLS, a shared rate limiter and secret storage.

## Tests

```bash
cd api
python3 -m pytest -q test_api.py
```

The tests stub the gateway and cover valid, edge and malformed input, every gateway failure, the rate limit, the body limit, the
logs and the key, that Shopping and the context endpoint never call the model, and that every Shopping prompt rebuilds
byte-identical to its evaluated row. `PROXY_TARGET_ROWS=<held-out rows file>` adds a known-answer check that the rebuilt prompt matches the
evaluated prompt. `PROXY_LIVE_TEST=1` adds one real end-to-end call through the gateway.
