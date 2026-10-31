"""Write the data file the delegate interface reads, for one scored arm on one split.

For every decision the script turns the saved option scores into probabilities (after an optional
temperature), finds the yes/no category question with the most information, and computes the
probabilities after each answer and the expected accuracy gain from asking. It then writes

  about      what the data and the model are, and how many decisions and people there are
  summary    accuracy when never asking and when always asking, accuracy at five ask settings and
             along an ask-rate curve for three ways of choosing where to ask, reliability bins,
             expected calibration error, confidently wrong counts and a breakdown of wrong picks
  reference  optional numbers from elsewhere that the interface shows next to the replay
  people     every decision (up to a cap) of a seeded random sample of people

The input layout is the one described in compare_candidates.py: --decisions is the decision file
of the split, and the scores are <scores-root>/<arm>[/<world>]/s<seed>/scores_[<prefix>_]<split>
.jsonl next to a summary.json. The per-person accuracy of the picks must match the stored Hit@1,
otherwise the exit status is 1.

The temperature is one number applied to every score. Give it with --temperature, or give
--design-decisions to fit it on the scores of --design-split for that decision file. With
neither, no temperature is applied.

--reference is an optional json list of objects such as {"key": ..., "value": ..., "label": ...,
"split": ..., "ci": [lo, hi]} that the interface shows beside the replay. --about is an optional
json object that replaces any of the texts data, split, model and ask_rule. --numbers-out writes
a compact file of the headline numbers.

The output holds venue names and recent places of the sampled people. Replace places that
reveal sensitive details by a generic label before the file is shared.

Example:
    python export_interface_data.py --decisions test_decisions.jsonl --scores-root scores \\
        --arm tuned_pref --seed 0 --split fresh --design-decisions dev_decisions.jsonl \\
        --out interface_data.json --numbers-out headline_numbers.json
"""
import argparse
import json
import math
import random
import statistics as st
import sys
from collections import Counter
from pathlib import Path

import compare_candidates as cc
import delegate_math as dm

CURVE_RATES = [round(0.1 * i, 1) for i in range(11)]
SETTINGS = [("Never ask", 0.0), ("Rarely", 0.3), ("Sometimes", 0.5), ("Often", 0.7),
            ("Always ask", 1.0)]
CONFIDENT_LEVELS = (0.5, 0.6, 0.7, 0.8)
ABOUT_KEYS = ("data", "split", "model", "ask_rule")
DEFAULT_DATA = ("Massive-STEPS New York check-ins (Apache 2.0), venue names from Foursquare "
                "Open Source Places")
DEFAULT_ASK_RULE = ("asks the one yes/no category question with the most information, when the "
                    "expected gain from asking is high")


def error_patterns(recs):
    """Counts that describe the wrong picks. A wrong pick is either another venue of the same
    kind as the answer, or a different kind; a different kind is then split by whether the picked
    and the true category appear in the person's recent places."""
    def in_hist(x, idx):
        return x["cands"][idx][1] in {h["category"] for h in x["history"]}

    wrong = [x for x in recs if x["pick"] != x["answer"]]
    same = [x for x in wrong if x["cands"][x["pick"]][1] == x["cands"][x["answer"]][1]]
    diff = [x for x in wrong if x["cands"][x["pick"]][1] != x["cands"][x["answer"]][1]]
    patterns = dict(
        n_wrong=len(wrong), same_kind_other_venue=len(same),
        habit_pull=sum(in_hist(x, x["pick"]) and not in_hist(x, x["answer"]) for x in diff),
        both_familiar=sum(in_hist(x, x["pick"]) and in_hist(x, x["answer"]) for x in diff),
        missed_familiar=sum(not in_hist(x, x["pick"]) and in_hist(x, x["answer"]) for x in diff),
        both_new=sum(not in_hist(x, x["pick"]) and not in_hist(x, x["answer"]) for x in diff))
    assert sum(v for k, v in patterns.items() if k != "n_wrong") == len(wrong)
    return patterns


def sample_people(recs, n_people, max_decisions, min_decisions, seed):
    """Every decision (up to max_decisions) of a seeded random sample of people who have at least
    min_decisions decisions. Returns the people and the number of people in recs."""
    idx_by_user = {}
    for i, x in enumerate(recs):
        idx_by_user.setdefault(x["user"], []).append(i)
    eligible = sorted(u for u, ix in idx_by_user.items() if len(ix) >= min_decisions)
    chosen = random.Random(seed).sample(eligible, min(n_people, len(eligible)))
    people = []
    for num, u in enumerate(chosen, 1):
        decs = []
        for j, i in enumerate(idx_by_user[u][:max_decisions], 1):
            x = recs[i]
            counts = Counter(h["category"] for h in x["history"])
            question = None
            if x["question"] is not None:
                question = dict(category=x["question"], yes_idx=sorted(x["yes"]))
            decs.append(dict(
                id=f"{num}-{j}", history=x["history"], top_categories=x["top"],
                candidates=[dict(name=nm, category=c, prob=round(x["p"][ci], 4),
                                 history_count=counts.get(c, 0))
                            for ci, (nm, c) in enumerate(x["cands"])],
                answer_idx=x["answer"], pick=x["pick"], confidence=round(x["maxp"], 4),
                question=question, ask_value=round(x["gain"], 6),
                after_yes=dict(probs=[round(v, 4) for v in x["post_yes"]],
                               pick=dm.argmax(x["post_yes"])),
                after_no=dict(probs=[round(v, 4) for v in x["post_no"]],
                              pick=dm.argmax(x["post_no"]))))
        people.append(dict(id=f"Person {num}", decisions=decs))
    return people, len(idx_by_user)


def build(args):
    """Compute the interface data and the headline numbers. Returns (data, numbers)."""
    layout = cc.Layout(args.scores_root, args.world, args.file_prefix)
    vocab = cc.vocabulary_from_files([args.decisions, args.design_decisions,
                                      *args.vocabulary_decisions])
    decisions = cc.load_decisions(args.decisions, vocab)
    n = len(decisions)
    logits = cc.load_logits(layout.scores_path(args.arm, args.seed, args.split), decisions)

    temp = 1.0
    if args.temperature is not None:
        temp = args.temperature
    elif args.design_decisions:
        design = cc.load_decisions(args.design_decisions, vocab)
        design_logits = cc.load_logits(
            layout.scores_path(args.arm, args.seed, args.design_split), design)
        temp = dm.fit_temperature(design_logits, [d["answer"] for d in design])

    recs = cc.make_records(logits, decisions, [temp] * n)
    for x, d in zip(recs, decisions):
        x.update(history=d["history"], top=d["top"], cands=d["cands"])
    base = cc.evaluate(recs, cc.stored_hit1(layout, args.arm, args.seed, args.split),
                       f"{args.arm} seed {args.seed}")
    act_now, always = base["acc"], base["always_ask"]

    gains = [x["gain"] for x in recs]
    maxps = [x["maxp"] for x in recs]

    def voi_point(rate):
        tau = dm.value_threshold(gains, rate)
        return dm.accuracy_with_questions(recs, [g >= tau for g in gains]), tau

    def confidence_point(rate):
        tau = dm.confidence_threshold(maxps, rate)
        return dm.accuracy_with_questions(recs, [m <= tau for m in maxps])

    def random_point(rate):
        return dm.accuracy_with_questions(recs, dm.mask_random(n, rate, cc.RANDOM_MASK_SEED))

    curves = dict(
        voi=[dict(ask_rate=r, accuracy=round(voi_point(r)[0], 4)) for r in CURVE_RATES],
        confidence=[dict(ask_rate=r, accuracy=round(confidence_point(r), 4)) for r in CURVE_RATES],
        random=[dict(ask_rate=r, accuracy=round(random_point(r), 4)) for r in CURVE_RATES])
    settings = []
    for label, rate in SETTINGS:
        a, tau = voi_point(rate)
        settings.append(dict(label=label, ask_rate=rate, accuracy=round(a, 4),
                             tau=None if math.isinf(tau) else tau, ask_all=rate >= 1))

    correct = [x["pick"] == x["answer"] for x in recs]
    reliability = [dict(lo=b["lo"], hi=min(b["hi"], 1.0), n=b["n"],
                        confidence=round(b["confidence"], 4), accuracy=round(b["accuracy"], 4))
                   for b in dm.calibration_bins(maxps, correct)]
    ece = dm.expected_calibration_error(maxps, correct)
    confidently_wrong = {f"{t:.1f}": sum(x["maxp"] >= t and not c for x, c in zip(recs, correct))
                         for t in CONFIDENT_LEVELS}
    patterns = error_patterns(recs)
    people, n_people = sample_people(recs, args.n_people, args.max_decisions,
                                     args.min_decisions, args.sample_seed)

    about = dict(
        data=DEFAULT_DATA,
        split=f"held-out test: {n_people} people, none used to choose the model or its settings",
        n_decisions=n, n_people=n_people,
        model=(f"{args.arm} (seed {args.seed})"
               + ("" if temp == 1.0 else f", with one confidence temperature of {temp:.2f}")),
        ask_rule=DEFAULT_ASK_RULE)
    about.update(args.about)
    reference = args.reference
    data = dict(
        about=about,
        summary=dict(act_now_accuracy=round(act_now, 4), always_ask_accuracy=round(always, 4),
                     chance=round(st.mean(1 / len(x["cands"]) for x in recs), 4),
                     settings=settings, curves=curves, reliability=reliability,
                     ece=round(ece, 4), confidently_wrong=confidently_wrong,
                     error_patterns=patterns),
        reference=reference, people=people)

    def share(count):
        return count / patterns["n_wrong"] if patterns["n_wrong"] else None

    numbers = dict(
        arm=args.arm, seed=args.seed, temperature=temp, n_decisions=n, act_now=act_now,
        act_now_user_mean=base["acc_user_mean"], always_ask=always, ece_7bins=ece,
        confidently_wrong_07_share=confidently_wrong["0.7"] / n,
        voi_030=voi_point(0.3)[0], voi_050=voi_point(0.5)[0], voi_070=voi_point(0.7)[0],
        confidence_050=confidence_point(0.5), random_050=random_point(0.5),
        miss_share_both_new=share(patterns["both_new"]),
        miss_share_habit_pull=share(patterns["habit_pull"]))
    return data, numbers


def read_json(path, kind):
    """A json file of the given type (list or dict), or an InputError."""
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
    except (OSError, ValueError) as e:
        raise cc.InputError(f"cannot read {path}: {e}") from None
    if not isinstance(value, kind):
        raise cc.InputError(f"{path} must hold a json {kind.__name__}")
    return value


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Write the interface data file for one scored arm.",
        epilog="See the top of this file for the input layout and the output fields.")
    ap.add_argument("--decisions", required=True, help="decision file (jsonl) of the split")
    ap.add_argument("--scores-root", required=True,
                    help="folder laid out as <arm>/s<seed>/scores_<split>.jsonl + summary.json")
    ap.add_argument("--arm", required=True, help="arm folder to export")
    ap.add_argument("--seed", type=int, default=0, help="seed folder to export (default: 0)")
    ap.add_argument("--split", default="fresh", help="split to export (default: fresh)")
    ap.add_argument("--world", help="folder level between the arm and the seed, if there is one")
    ap.add_argument("--file-prefix",
                    help="score files are scores_<prefix>_<split>.jsonl and the summary key is "
                         "<prefix>_<split>")
    ap.add_argument("--temperature", type=float, help="temperature to divide the scores by")
    ap.add_argument("--design-decisions",
                    help="decision file of the design split; fits the temperature on its scores")
    ap.add_argument("--design-split", default="pilot",
                    help="split whose scores fit the temperature (default: pilot)")
    ap.add_argument("--vocabulary-decisions", nargs="*", default=[],
                    help="further decision files whose category names help read the histories")
    ap.add_argument("--reference", help="json list of reference numbers for the interface")
    ap.add_argument("--about", help="json object replacing about.data, split, model or ask_rule")
    ap.add_argument("--n-people", type=int, default=12, help="people in the sample (default: 12)")
    ap.add_argument("--max-decisions", type=int, default=10,
                    help="decisions per sampled person (default: 10)")
    ap.add_argument("--min-decisions", type=int, default=6,
                    help="decisions a person needs to be sampled (default: 6)")
    ap.add_argument("--sample-seed", type=int, default=20261027,
                    help="seed of the sample of people (default: 20261027)")
    ap.add_argument("--out", required=True, help="where to write the interface data (json)")
    ap.add_argument("--numbers-out", help="where to write the headline numbers (json)")
    args = ap.parse_args(argv)
    if args.temperature is not None and args.design_decisions:
        ap.error("give --temperature or --design-decisions, not both")
    if args.temperature is not None and args.temperature <= 0:
        ap.error("--temperature must be positive")
    try:
        args.reference = read_json(args.reference, list) if args.reference else []
        args.about = read_json(args.about, dict) if args.about else {}
    except cc.InputError as e:
        ap.error(str(e))
    unknown = sorted(set(args.about) - set(ABOUT_KEYS))
    if unknown:
        ap.error(f"--about may only hold {', '.join(ABOUT_KEYS)}; found {', '.join(unknown)}")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        data, numbers = build(args)
    except cc.InputError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    if args.numbers_out:
        Path(args.numbers_out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.numbers_out, "w", encoding="utf-8") as f:
            json.dump(numbers, f, indent=1)
    s = data["summary"]
    print(f"{args.arm} seed {args.seed} on {args.split}: {numbers['n_decisions']} decisions, "
          f"temperature {numbers['temperature']:.3f}")
    print(f"act-now {s['act_now_accuracy']:.4f}, always-ask {s['always_ask_accuracy']:.4f}, "
          f"VOI@0.5 {numbers['voi_050']:.4f}, ece {s['ece']:.4f}")
    print("settings: " + ", ".join(f"{t['label']} {t['accuracy']:.3f}" for t in s["settings"]))
    print(f"confidently wrong {s['confidently_wrong']}; patterns {s['error_patterns']}")
    n_dec = sum(len(p["decisions"]) for p in data["people"])
    print(f"people {len(data['people'])}, decisions {n_dec} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
