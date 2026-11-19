"""Build app/public/data/stories.json: the guided replays shown on the demo's landing page.

Each story is one saved decision, replayed under three question policies (Never ask, When unsure, Always ask).
Every number comes from the saved scores already shipped with the app (places.json, shopping.json) and the
API's own decision functions (api/proxy_core.py), so a story shows exactly what the deployed rule does on
that decision. No model is called. The person's answer is simulated from what they really chose.

Run from proxy_public/:  python3 app/scripts/build_stories.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "api"))
import proxy_core as core  # noqa: E402

DATA = os.path.join(ROOT, "app", "public", "data")
POLICIES = ["Never ask", "When unsure", "Always ask"]

# (story id, domain, person, decision id, tab label, title, one-line pitch)
STORIES = [
    ("question-helps", "places", "Person 1", "1-9", "Question helps",
     "One question changes the pick",
     "A ferry rider who likes parks and theaters. PROXY is torn between a park and a bar, so it asks."),
    ("no-question", "places", "Person 2", "2-4", "No question",
     "Sure enough not to ask",
     "A regular at neighbourhood bars. PROXY is fairly sure, so it picks without bothering them."),
    ("honest-miss", "places", "Person 7", "7-7", "Honest miss",
     "Confident, and still wrong",
     "A coffee-shop and gym regular. PROXY is sure enough not to ask, and picks wrong."),
    ("shopping", "shopping", "Person 12", "s12-4", "Shopping",
     "Two gaming mice, one brand question",
     "A gamer who buys headsets and keyboards. PROXY asks about the brand before choosing a mouse."),
]


def short(name, limit=34):
    """Shopping titles are long listings; keep the product name before the first separator."""
    s = re.split(r" - | -- |, |\(|\|", name or "")[0].strip()
    if len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s or (name or "")


def third_person(s):
    """The workspace's reason lines address the person ("your last 30 places"); in a story PROXY talks about them."""
    if not s:
        return s
    s = re.sub(r"\bfor you\b", "for them", s)
    s = re.sub(r"\byour\b", "their", s)
    s = re.sub(r"^You\b", "They", s)
    s = re.sub(r"^1 of\b", "One of", s)
    return s


def places_settings(summary):
    """The fine-tuned 8B's settings from places.json; the interface calls the 50%-ask setting 'When unsure'."""
    by = {s["label"]: s for s in summary["settings"]}
    return {"Never ask": by["Never ask"], "When unsure": by["Sometimes"], "Always ask": by["Always ask"]}


def replay(domain, d, probs, setting, bins_before, bins_after):
    """What the deployed rule does on one decision under one setting, with the answer taken from the record."""
    truth = d["answer_idx"]
    if domain == "shopping":
        q = core.best_menu_question(probs, d.get("menu"))
        qd = None if q is None else {"text": q[1]["text"], "category": q[1]["label"].split(":", 1)[1], "yes_idx": q[2]}
    else:
        q = core.best_question(probs, d["candidates"])
        qd = None if q is None else {"text": core.question_text(q[1]), "category": q[1], "yes_idx": q[2]}
    gain = None if q is None else q[0]
    lean = core.ranked(probs)[0]
    asked = q is not None and core.should_ask(gain, setting)
    out = {"lean": lean, "gain": gain, "tau": setting.get("tau"), "ask_all": bool(setting.get("ask_all")),
           "asked": asked, "question": qd if asked else None, "answer": None, "after": list(probs)}
    if asked:
        ans = "yes" if truth in qd["yes_idx"] else "no"
        now = core.after_answer(probs, qd["yes_idx"], ans)
        out.update(answer=ans, after=now)
    order = core.ranked(out["after"])
    pick = order[0]
    conf = out["after"][pick]
    bins = bins_after if asked else bins_before
    tr = None
    if bins is not None and not (asked and len(order) == 1):
        tr = core.track_record(conf, bins)
    out.update(pick=pick, left=len(order), ruled_out=[i for i, p in enumerate(out["after"]) if p == 0],
               track=None if tr is None else {"out_of_10": round(tr[0] * 10), "n": tr[1], "label": core.confidence_label(tr[0])},
               correct=pick == truth)
    return out, q


def main():
    places = json.load(open(os.path.join(DATA, "places.json")))
    shopping = json.load(open(os.path.join(DATA, "shopping.json")))
    card_s = json.load(open(os.path.join(ROOT, "api", "model_card_shopping.json")))
    dec = {"places": {x["id"]: (p["id"], x) for p in places["people"] for x in p["decisions"]},
           "shopping": {x["id"]: (p["id"], x) for p in shopping["people"] for x in p["decisions"]}}
    set_p = places_settings(places["summary"])
    set_s = {s["label"]: s for s in card_s["settings"]}
    stories = []
    for sid, domain, person, did, tab, title, pitch in STORIES:
        pid, d = dec[domain][did]
        assert pid == person, (sid, pid, person)
        if domain == "places":
            probs = [c["prob"] for c in d["candidates"]]
            settings, before, after = set_p, places["summary"]["reliability"], None
        else:
            probs = list(d["probs"])
            settings, before, after = set_s, card_s["reliability"], card_s["reliability_after_answer"]
        pol = {}
        for name in POLICIES:
            r, q = replay(domain, d, probs, settings[name], before, after)
            pol[name] = r
        # Known answers: the saved export (places) recorded its own question, ask value and both answers.
        if domain == "places":
            # The API breaks ties between equally useful questions alphabetically; the export kept the category of
            # its leaning option. Gains are equal by construction, and so is the outcome under a truthful answer.
            r = pol["Always ask"]
            assert abs(r["gain"] - d["ask_value"]) < 1e-4, (sid, r["gain"], d["ask_value"])
            saved_ans = "yes" if d["answer_idx"] in d["question"]["yes_idx"] else "no"
            saved = d["after_yes"] if saved_ans == "yes" else d["after_no"]
            assert (saved["pick"] == d["answer_idx"]) == r["correct"], sid
            if r["question"]["category"] == d["question"]["category"]:
                assert all(abs(a - b) < 1e-3 for a, b in zip(r["after"], saved["probs"])), sid
            assert pol["Never ask"]["pick"] == d["pick"], sid
        hist = d["history"]
        summary = core.history_summary(hist, top=4)
        recent = [{"name": short(h["name"]) if domain == "shopping" else (h["name"] or h.get("category") or ""),
                   "category": h.get("category")} for h in hist[::-1][:6]]
        options = []
        for i, c in enumerate(d["candidates"]):
            reason = c.get("reason") if domain == "shopping" else core.reason_line(c, hist)
            options.append({"name": short(c["name"]) if domain == "shopping" else (c["name"] or c.get("category") or ""),
                            "category": c.get("category"), "prob": probs[i], "reason": third_person(reason)})
        stories.append({
            "id": sid, "domain": domain, "person": person, "decision": did, "tab": tab, "title": title, "pitch": pitch,
            "history_total": len(hist), "history_kinds": summary, "recent": recent,
            "options": options, "truth": d["answer_idx"], "policies": pol,
        })
        p = pol["When unsure"]
        print(f"{sid:15} {did:6} asked={p['asked']!s:5} answer={p['answer']!s:4} lean={options[p['lean']]['name'][:24]:24} "
              f"pick={options[p['pick']]['name'][:24]:24} truth={options[d['answer_idx']]['name'][:24]:24} correct={p['correct']} "
              f"track={p['track']} | never={pol['Never ask']['correct']} always={pol['Always ask']['correct']}")
    s = places["summary"]
    out = {
        "about": "Guided replays of saved decisions. Scores are the fine-tuned Llama 3.1 8B's saved scores; no model is called. "
                 "The person's answer to the question is simulated from what they really chose.",
        "evaluation": {
            "places": {"rows": places["about"]["n_decisions"], "people": places["about"]["n_people"], "chance": s["chance"],
                       "policies": {"Never ask": set_p["Never ask"]["accuracy"], "When unsure": set_p["When unsure"]["accuracy"],
                                    "Always ask": set_p["Always ask"]["accuracy"]},
                       "ask_rate": {k: set_p[k]["ask_rate"] for k in POLICIES}},
            "shopping": {"policies": {k: set_s[k]["accuracy"] for k in POLICIES},
                         "ask_rate": {k: set_s[k]["ask_rate"] for k in POLICIES}},
        },
        "policies": POLICIES,
        "stories": stories,
    }
    path = os.path.join(DATA, "stories.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print("wrote", path)


if __name__ == "__main__":
    main()
