"""PROXY core: build the prompt for one decision, read the model's option probabilities, decide whether to ask, and
update after an answer. Pure functions except `score_options`, which calls the model gateway."""
import json
import math
import time
import urllib.error
import urllib.request

LETTERS = "ABCDE"
MISSING_LOGPROB = -30.0


class GatewayError(Exception):
    """The model gateway failed. kind is 'timeout', 'busy' or 'unavailable'."""

    def __init__(self, kind, detail=""):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


def option_text(c):
    if not c.get("name"):
        return c.get("category") or ""
    return f"{c['name']} ({c['category']})" if c.get("category") else c["name"]


def build_prompt(decision):
    """The held-out task's own prompt, rebuilt from the decision record (same wording the evaluation used)."""
    hist = ", ".join(option_text(h) for h in decision["history"])
    lines = ["A person's recent places (most recent last):", f"  {hist}"]
    if decision.get("top_categories"):
        lines.append("Their most frequent categories: " + ", ".join(decision["top_categories"]))
    lines += ["", "They are about to go somewhere they have NOT been before. Which of these will they choose?"]
    for L, c in zip(LETTERS, decision["candidates"]):
        lines.append(f"  {L}. {option_text(c)}")
    lines += ["", "Answer with one letter (A/B/C/D/E). Answer:"]
    return "\n".join(lines)


def build_prompt_shopping(decision):
    """The shopping task's prompt, rebuilt from the decision record (same wording the evaluation used)."""
    lines = ["A person's recent purchases (most recent last):"]
    lines += [f"  - {h['name']}" for h in decision["history"]]
    lines += ["", "Which of these will they buy next? (They have not bought any of them before.)"]
    for L, c in zip(LETTERS, decision["candidates"]):
        lines.append(f"  {L}. {c['name']}")
    lines += ["", "Answer with one letter (A/B/C/D/E). Answer:"]
    return "\n".join(lines)


def letter_logprobs(top_logprobs):
    lp = {L: MISSING_LOGPROB for L in LETTERS}
    for x in top_logprobs or []:
        tok = str(x.get("token", "")).strip()
        if tok in lp and x["logprob"] > lp[tok]:
            lp[tok] = float(x["logprob"])
    return [lp[L] for L in LETTERS]


def softmax(lp, temperature):
    m = max(lp)
    e = [math.exp((x - m) / temperature) for x in lp]
    s = sum(e)
    return [x / s for x in e]


def score_options(prompt, *, base_url, api_key, model, timeout_s):
    """One gateway call: temperature 0, one token, top-20 log-probs. Returns the A-E log-probs and the latency."""
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 1,
                       "temperature": 0, "logprobs": True, "top_logprobs": 20}).encode()
    req = urllib.request.Request(base_url.rstrip("/") + "/v1/chat/completions", data=body,
                                 headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        raise GatewayError("busy" if e.code == 429 else "unavailable", f"HTTP {e.code}") from None
    except (TimeoutError, OSError) as e:
        kind = "timeout" if "timed out" in str(e).lower() else "unavailable"
        raise GatewayError(kind, type(e).__name__) from None
    except ValueError:
        raise GatewayError("unavailable", "unreadable response") from None
    try:
        top = d["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
    except (KeyError, IndexError, TypeError):
        raise GatewayError("unavailable", "no log-probs in response") from None
    lp = letter_logprobs(top)
    if all(x == MISSING_LOGPROB for x in lp):
        raise GatewayError("unavailable", "no option letter in response")
    return lp, round(time.time() - t0, 3)


def best_question(probs, candidates):
    """The category question with the largest expected gain in the chance of picking right, assuming a truthful answer.
    Returns (gain, category, yes_indexes) or None when no category splits the options."""
    cats = [c.get("category") or "" for c in candidates]
    base = max(probs)
    best = None
    for c in sorted(set(cats)):
        if not c:
            continue
        S = [i for i in range(len(cats)) if cats[i] == c]
        R = [i for i in range(len(cats)) if i not in S]
        if not R:
            continue
        gain = max(probs[i] for i in S) + max(probs[i] for i in R) - base
        if best is None or gain > best[0]:
            best = (gain, c, S)
    return best


def best_menu_question(probs, menu):
    """Shopping: the brand or category question from the decision's menu with the largest expected gain.
    Returns (gain, menu item, yes_indexes) or None. Ties go to the first item in menu order."""
    base = max(probs)
    best = None
    for item in menu or []:
        S = list(item["yes_idx"])
        R = [i for i in range(len(probs)) if i not in S]
        if not S or not R:
            continue
        gain = max(probs[i] for i in S) + max(probs[i] for i in R) - base
        if best is None or gain > best[0]:
            best = (gain, item, S)
    return best


def history_summary(history, top=5):
    """The most frequent kinds of places (or brands) in the shown history, with counts."""
    counts = {}
    for h in history:
        c = h.get("category")
        if c:
            counts[c] = counts.get(c, 0) + 1
    return [{"category": c, "count": n} for c, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top]]


def should_ask(gain, setting):
    if setting.get("ask_all"):
        return True
    tau = setting.get("tau")
    return tau is not None and gain is not None and gain >= tau


def after_answer(probs, yes_idx, answer):
    """Drop the options the answer rules out and renormalise the rest."""
    keep = set(yes_idx) if answer == "yes" else {i for i in range(len(probs)) if i not in set(yes_idx)}
    s = sum(probs[i] for i in keep)
    if s <= 0:
        return list(probs)
    return [probs[i] / s if i in keep else 0.0 for i in range(len(probs))]


def ranked(probs, excluded=()):
    """Option indexes from most to least likely, skipping excluded ones and any ruled out (probability 0)."""
    ex = set(excluded)
    order = sorted(range(len(probs)), key=lambda i: (-probs[i], i))
    return [i for i in order if i not in ex and probs[i] > 0]


def track_record(conf, bins, min_n=30):
    """How often held-out picks with this confidence matched the real choice: (share, n), or None when the bin is thin."""
    for b in bins:
        if b["lo"] <= conf < b["hi"] or (b["hi"] >= 1.0 and conf >= 1.0):
            if b["n"] >= min_n and b["accuracy"] is not None:
                return b["accuracy"], b["n"]
            return None
    return None


def confidence_label(share):
    if share is None:
        return None
    if share >= 0.6:
        return "Higher confidence"
    if share >= 0.4:
        return "Moderate confidence"
    return "Lower confidence"

PROPER = {"american", "asian", "african", "afghan", "argentinian", "australian", "brazilian", "british", "cajun", "cantonese",
          "caribbean", "chinese", "creole", "cuban", "eastern", "ethiopian", "european", "filipino", "french", "german", "greek",
          "hawaiian", "indian", "indonesian", "irish", "israeli", "italian", "jamaican", "japanese", "korean", "latin", "lebanese",
          "malaysian", "mediterranean", "mexican", "middle", "moroccan", "new", "persian", "peruvian", "polish", "portuguese",
          "russian", "scandinavian", "southern", "spanish", "szechuan", "taiwanese", "tex-mex", "thai", "turkish", "ukrainian",
          "vietnamese", "york", "nyc", "mta"}


def common_noun(category):
    """A category as a phrase inside a sentence: lowercase, except names of cuisines and places."""
    words = category.split()
    return " ".join(w if w.lower() in PROPER else w.lower() for w in words)


def article(noun):
    return "an" if noun[:1].lower() in "aeiou" else "a"


def reason_line(candidate, history):
    """One true sentence from the record: how often this kind of place appears in the person's history."""
    cat = candidate.get("category")
    if not cat:
        return None
    n = sum(1 for h in history if h.get("category") == cat)
    noun = common_noun(cat)
    art = article(noun)
    if n == 0:
        return f"A new kind of place for you: none of your last {len(history)} places was {art} {noun}."
    if n == 1:
        return f"You went to {art} {noun} once in your last {len(history)} places."
    return f"You went to {art} {noun} {n} times in your last {len(history)} places."


def question_text(category):
    noun = common_noun(category)
    return f"Are you up for {article(noun)} {noun}?"
