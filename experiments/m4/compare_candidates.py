"""Compare candidate rankers by what the delegate needs, from saved per-decision scores.

No model is run. A candidate is called an arm. Each arm is a folder of scored runs, one per
training seed, laid out as

    <scores-root>/<arm>/s<seed>/scores_<split>.jsonl    one line per decision
    <scores-root>/<arm>/s<seed>/summary.json            the stored accuracy of that run

A score line is {"user": ..., "answer_idx": ..., "scores": [one number per option]} and the lines
follow the order of the decision file given by --decisions (a jsonl file whose lines hold the
prompt, the user and answer_idx). summary.json holds {"files": {"<split>": {"Hit@1": {"mean":
...}}}}. Two optional flags change the names: --world adds a folder level between the arm and
the seed, and --file-prefix puts a prefix before the split in the score file name and in the
summary key.

Per arm, with the seeds averaged, the script reports

  acc                 pooled top-1 accuracy over all decisions
  acc_user_mean       mean over people of each person's top-1 accuracy; it must match the Hit@1
                      stored in summary.json to within 0.0005, otherwise the exit status is 1
  ece                 expected calibration error over 7 fixed confidence bins
  confidently_wrong   share of decisions with top probability >= 0.7 that are wrong
  always_ask          accuracy when the delegate asks one question on every decision
  voi_050             accuracy when it asks on the half of decisions where the question is
                      worth most (value of information at an ask rate of 0.5)

--calibrate chooses the temperature applied to the scores before the metrics are computed:
none (temperature 1), design (one temperature per run, fitted on the scores of --design-split
for --design-decisions) or crossfit (two folds of people, each scored with the temperature
fitted on the other fold, all within --split). With design or crossfit the report holds both
the raw and the calibrated numbers.

The selection rule picks the arm with the highest calibrated VOI@0.5 among arms whose calibrated
ECE is at most 0.06. If the best two arms are closer than 0.01 and --simpler names one of them,
that arm is chosen. With --calibrate none the rule is applied to the raw numbers. Make the
selection on the development split only.

An input that is missing, does not line up with the decision file or fails the Hit@1 check ends
the run with a message and exit status 1.

--contrasts A:B gives the paired per-person bootstrap of A minus B for accuracy and VOI@0.5;
write ARM+cal for the calibrated run of ARM. --triggers compares three ways to choose where to
ask (largest value of information, lowest confidence, random) at several ask rates, for the
selected arm or the arm named by --trigger-arm.

Example:
    python compare_candidates.py --decisions dev_decisions.jsonl --scores-root scores \\
        --split pilot --calibrate crossfit --arms zero_shot tuned tuned_pref --seeds 0 1 2 \\
        --simpler tuned --triggers --out candidates_dev.json
"""
import argparse
import json
import statistics as st
import sys
from pathlib import Path

import delegate_math as dm

KNOWN_ANSWER_TOL = 0.0005   # allowed gap between our per-person accuracy and summary.json
CONFIDENT = 0.7             # a pick is confidently wrong when its probability is at least this
CAL_LIMIT = 0.06            # an arm is eligible when its calibrated ECE is at most this
TIE = 0.01                  # best two arms closer than this: prefer the simpler arm
RANDOM_MASK_SEED = 0        # seed of the random choice of where to ask
TRIGGERS = ("voi", "confidence", "random")
METRICS = ["acc", "acc_user_mean", "ece", "confidently_wrong", "mean_confidence", "always_ask",
           "voi_050", "realised_ask_rate"]


class InputError(Exception):
    """An input is missing or fails a check. The command line reports it and exits with 1."""


# ---------------------------------------------------------------------------- reading inputs

def read_jsonl(path):
    """The lines of a jsonl file as a list of objects."""
    try:
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except OSError as e:
        raise InputError(f"cannot read {path}: {e.strerror}") from None
    except ValueError as e:
        raise InputError(f"{path} is not valid jsonl: {e}") from None


def vocabulary_from_files(paths):
    """Known category names over the prompts of every decision file in paths."""
    prompts = []
    for path in paths:
        if path:
            prompts.extend(r["prompt"] for r in read_jsonl(path))
    return dm.category_vocabulary(prompts)


def load_decisions(path, vocabulary=None):
    """One dict per decision: user, answer (index of the true option), history, top, cands and
    cats (the category of each option), all read from the prompt."""
    out = []
    for i, r in enumerate(read_jsonl(path)):
        try:
            history, top, cands = dm.parse_prompt(r["prompt"], vocabulary)
            user, answer = str(r["user"]), r["answer_idx"]
        except (KeyError, ValueError) as e:
            raise InputError(f"{path}: decision {i + 1} cannot be read ({e!r})") from None
        if len(cands) < 2:
            raise InputError(f"{path}: decision {i + 1} has {len(cands)} options in its prompt")
        if "k" in r and r["k"] != len(cands):
            raise InputError(f"{path}: decision {i + 1} lists {len(cands)} options but k is "
                             f"{r['k']}")
        out.append(dict(user=user, answer=answer, history=history, top=top, cands=cands,
                        cats=[c for _, c in cands]))
    return out


class Layout:
    """Where the score files live: <root>/<arm>[/<world>]/s<seed>/scores_[<prefix>_]<split>.jsonl"""

    def __init__(self, root, world=None, prefix=None):
        self.root, self.world, self.prefix = Path(root), world, prefix

    def run_dir(self, arm, seed):
        base = self.root / arm
        if self.world:
            base = base / self.world
        return base / f"s{seed}"

    def split_key(self, split):
        return f"{self.prefix}_{split}" if self.prefix else split

    def scores_path(self, arm, seed, split):
        return self.run_dir(arm, seed) / f"scores_{self.split_key(split)}.jsonl"


def load_logits(path, decisions):
    """The scores of one run as one list per decision, cut to that decision's number of options.
    The lines must follow the decision file: same count, same user and answer on every line."""
    lines = read_jsonl(path)
    if len(lines) != len(decisions):
        raise InputError(f"{path}: {len(lines)} lines for {len(decisions)} decisions")
    logits = []
    for i, (s, d) in enumerate(zip(lines, decisions)):
        try:
            same = str(s["user"]) == d["user"] and s["answer_idx"] == d["answer"]
            xs = s["scores"]
        except (KeyError, TypeError) as e:
            raise InputError(f"{path}: line {i + 1} lacks the field {e}") from None
        if not same:
            raise InputError(f"{path}: line {i + 1} does not match decision {i + 1}")
        if len(xs) < len(d["cats"]):
            raise InputError(f"{path}: line {i + 1} has fewer scores than options")
        logits.append(xs[:len(d["cats"])])
    return logits


def stored_hit1(layout, arm, seed, split):
    """The Hit@1 that the scoring run stored in summary.json for this split."""
    path = layout.run_dir(arm, seed) / "summary.json"
    key = layout.split_key(split)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)["files"][key]["Hit@1"]["mean"]
    except OSError as e:
        raise InputError(f"cannot read {path}: {e.strerror}") from None
    except (ValueError, KeyError, TypeError):
        raise InputError(f"{path} has no entry files/{key}/Hit@1/mean") from None


# ---------------------------------------------------------------------------- one run

def row_temperatures(mode, logits, decisions, design_logits=None, design=None):
    """The temperature for every decision and the value to report (None, one number, or the two
    fold temperatures), for the calibration mode none, design or crossfit."""
    n = len(decisions)
    if mode == "none":
        return [1.0] * n, None
    if mode == "design":
        t = dm.fit_temperature(design_logits, [d["answer"] for d in design])
        return [t] * n, t
    users = [d["user"] for d in decisions]
    if len({dm.fold_of(u) for u in users}) < 2:
        raise InputError("crossfit needs people in both folds")
    temps = dm.crossfit_temperatures(logits, [d["answer"] for d in decisions], users)
    return [temps[dm.fold_of(u)] for u in users], [temps[0], temps[1]]


def make_records(logits, decisions, temperatures):
    """Decision records (see delegate_math.decision_record) with user and answer added."""
    recs = []
    for xs, d, t in zip(logits, decisions, temperatures):
        p = dm.softmax([v / t for v in xs])
        x = dm.decision_record(p, d["cats"], d["answer"])
        x.update(user=d["user"], answer=d["answer"])
        recs.append(x)
    return recs


def evaluate(recs, known, label):
    """The metrics of one run, after checking its per-person accuracy against the stored Hit@1."""
    n = len(recs)
    correct = [x["pick"] == x["answer"] for x in recs]
    per_user_acc = dm.per_user_accuracy(recs)
    acc_users = st.mean(per_user_acc.values())
    if not abs(acc_users - known) < KNOWN_ANSWER_TOL:
        raise InputError(f"{label}: per-person accuracy {acc_users:.6f} differs from the stored "
                         f"Hit@1 {known:.6f} by more than {KNOWN_ANSWER_TOL}")
    maxps = [x["maxp"] for x in recs]
    gains = [x["gain"] for x in recs]
    tau = dm.quantile(sorted(gains), 0.5)
    flags = [g >= tau for g in gains]
    return dict(
        acc=sum(correct) / n, acc_user_mean=acc_users, known_answer=known,
        ece=dm.expected_calibration_error(maxps, correct),
        confidently_wrong=sum(x["maxp"] >= CONFIDENT and not c for x, c in zip(recs, correct)) / n,
        mean_confidence=sum(maxps) / n,
        always_ask=sum(x["pick_ask"] == x["answer"] for x in recs) / n,
        voi_050=dm.accuracy_with_questions(recs, flags), realised_ask_rate=sum(flags) / n,
        per_user_acc=per_user_acc, per_user_voi=dm.per_user_accuracy(recs, flags))


def average(runs):
    """Mean of each metric over the seeds of an arm, with the spread across seeds."""
    res = {k: st.mean(r[k] for r in runs) for k in METRICS}
    res["acc_sd"] = st.stdev([r["acc"] for r in runs]) if len(runs) > 1 else None
    res["ece_sd"] = st.stdev([r["ece"] for r in runs]) if len(runs) > 1 else None
    res["known_answers"] = [r["known_answer"] for r in runs]
    return res


def average_users(runs, key):
    """Per-person values averaged over the seeds of an arm."""
    return {u: st.mean(r[key][u] for r in runs) for u in runs[0][key]}


# ---------------------------------------------------------------------------- comparisons

def select_arm(arms_out, mode, simpler, cal_limit=CAL_LIMIT, tie=TIE):
    """The selection rule on the numbers of mode ("calibrated" or "raw")."""
    eligible = {a: v[mode]["voi_050"] for a, v in arms_out.items() if v[mode]["ece"] <= cal_limit}
    ranked = sorted(eligible.items(), key=lambda kv: -kv[1])
    chosen = ranked[0][0] if ranked else None
    if (simpler and len(ranked) > 1 and ranked[0][1] - ranked[1][1] < tie
            and simpler in (ranked[0][0], ranked[1][0])):
        chosen = simpler
    rule = f"highest {mode} VOI@0.5 among {mode} ECE <= {cal_limit}"
    if simpler:
        rule += f"; within {tie} -> {simpler}"
    return dict(rule=rule, on=mode, eligible=eligible, ranked=[list(kv) for kv in ranked],
                chosen=chosen)


def trigger_comparison(recs_by_seed, rates, n_boot, boot_seed):
    """Accuracy when asking on a share `rate` of decisions chosen by value of information, by
    lowest confidence or at random, averaged over seeds, with paired per-person bootstrap
    contrasts voi minus confidence and confidence minus random."""
    out = {}
    for rate in rates:
        accs = {name: [] for name in TRIGGERS}
        users = {name: [] for name in TRIGGERS}
        for recs in recs_by_seed:
            tg = dm.value_threshold([x["gain"] for x in recs], rate)
            tc = dm.confidence_threshold([x["maxp"] for x in recs], rate)
            masks = dict(voi=[x["gain"] >= tg for x in recs],
                         confidence=[x["maxp"] <= tc for x in recs],
                         random=dm.mask_random(len(recs), rate, RANDOM_MASK_SEED))
            for name, mask in masks.items():
                accs[name].append(dm.accuracy_with_questions(recs, mask))
                users[name].append(dm.per_user_accuracy(recs, mask))
        res = {name: st.mean(accs[name]) for name in TRIGGERS}
        per_user = {name: {u: st.mean(r[u] for r in users[name]) for u in users[name][0]}
                    for name in TRIGGERS}
        res["voi_minus_confidence"] = dm.paired_bootstrap(
            per_user["voi"], per_user["confidence"], n_boot, boot_seed)
        res["confidence_minus_random"] = dm.paired_bootstrap(
            per_user["confidence"], per_user["random"], n_boot, boot_seed)
        out[f"{rate:.2f}"] = res
    return out


# ---------------------------------------------------------------------------- the report

def parse_arms(items, default_seeds):
    """{arm: seeds} from items written NAME or NAME:SEED,SEED,..."""
    arms = {}
    for item in items:
        name, _, seeds = item.partition(":")
        if not name:
            raise InputError(f"empty arm name in --arms {item}")
        if name in arms:
            raise InputError(f"arm {name} is named twice in --arms")
        try:
            arms[name] = [int(s) for s in seeds.split(",")] if seeds else list(default_seeds)
        except ValueError:
            raise InputError(f"cannot read the seeds in --arms {item}") from None
    return arms


def build_report(args):
    """Compute every table asked for by args and return it as a dict."""
    layout = Layout(args.scores_root, args.world, args.file_prefix)
    arms = parse_arms(args.arms, args.seeds)
    vocab = vocabulary_from_files([args.decisions, args.design_decisions,
                                   *args.vocabulary_decisions])
    decisions = load_decisions(args.decisions, vocab)
    design = (load_decisions(args.design_decisions, vocab) if args.calibrate == "design"
              else None)
    logits_cache, run_cache = {}, {}

    def logits_of(arm, seed):
        if (arm, seed) not in logits_cache:
            path = layout.scores_path(arm, seed, args.split)
            logits_cache[(arm, seed)] = load_logits(path, decisions)
        return logits_cache[(arm, seed)]

    def run(arm, seed, calibrated):
        key = (arm, seed, calibrated)
        if key not in run_cache:
            logits = logits_of(arm, seed)
            design_logits = None
            if calibrated and args.calibrate == "design":
                path = layout.scores_path(arm, seed, args.design_split)
                design_logits = load_logits(path, design)
            temps, shown = row_temperatures(args.calibrate if calibrated else "none", logits,
                                            decisions, design_logits, design)
            recs = make_records(logits, decisions, temps)
            label = f"{arm} seed {seed}" + (" calibrated" if calibrated else "")
            res = evaluate(recs, stored_hit1(layout, arm, seed, args.split), label)
            res.update(recs=recs, temperature=shown)
            run_cache[key] = res
        return run_cache[key]

    calibrated = args.calibrate != "none"
    arms_out = {}
    for arm, seeds in arms.items():
        entry = dict(seeds=seeds, raw=average([run(arm, s, False) for s in seeds]))
        if calibrated:
            cal_runs = [run(arm, s, True) for s in seeds]
            entry["calibrated"] = average(cal_runs)
            entry["calibrated"]["temperatures"] = [r["temperature"] for r in cal_runs]
        arms_out[arm] = entry

    def users_of(variant):
        arm, _, tag = variant.partition("+")
        runs = [run(arm, s, tag == "cal") for s in arms[arm]]
        return average_users(runs, "per_user_acc"), average_users(runs, "per_user_voi")

    paired = {}
    for spec in args.contrasts:
        (a_acc, a_voi), (b_acc, b_voi) = (users_of(v) for v in spec.split(":"))
        paired[spec] = dict(
            acc=dm.paired_bootstrap(a_acc, b_acc, args.n_boot, args.boot_seed),
            voi_050=dm.paired_bootstrap(a_voi, b_voi, args.n_boot, args.boot_seed))

    report = dict(split=args.split, calibrate=args.calibrate, n_decisions=len(decisions),
                  n_people=len({d["user"] for d in decisions}), arms=arms_out, paired=paired,
                  selection=select_arm(arms_out, "calibrated" if calibrated else "raw",
                                       args.simpler))
    if args.triggers:
        arm = args.trigger_arm or report["selection"]["chosen"]
        if arm is None:
            raise InputError("no arm was selected; name one with --trigger-arm")
        recs_by_seed = [run(arm, s, calibrated)["recs"] for s in arms[arm]]
        report["triggers"] = dict(arm=arm, seeds=arms[arm],
                                  rates=trigger_comparison(recs_by_seed, args.rates, args.n_boot,
                                                           args.boot_seed))
    return report


def print_report(rep):
    """A short text table of the report."""
    print(f"split {rep['split']}: {rep['n_decisions']} decisions, {rep['n_people']} people, "
          f"calibrate {rep['calibrate']}")
    print(f"{'arm':18s}{'mode':12s}{'acc':>8s}{'ece':>8s}{'conf-wrong':>12s}{'one-q':>8s}"
          f"{'voi@0.5':>9s}")
    for arm, entry in rep["arms"].items():
        for mode in ("raw", "calibrated"):
            if mode in entry:
                r = entry[mode]
                print(f"{arm:18s}{mode:12s}{r['acc']:8.4f}{r['ece']:8.4f}"
                      f"{r['confidently_wrong']:12.4f}{r['always_ask']:8.4f}{r['voi_050']:9.4f}")
    for spec, v in rep["paired"].items():
        for metric, (m, lo, hi) in v.items():
            print(f"{spec} {metric}: {m:+.4f} [{lo:+.4f}, {hi:+.4f}]")
    sel = rep["selection"]
    print(f"selection ({sel['rule']}): {sel['chosen']}")
    if "triggers" in rep:
        t = rep["triggers"]
        print(f"ask triggers for {t['arm']} (accuracy at each ask rate)")
        for rate, r in t["rates"].items():
            vc, cr = r["voi_minus_confidence"], r["confidence_minus_random"]
            print(f"  rate {rate}: voi {r['voi']:.4f}  confidence {r['confidence']:.4f}  "
                  f"random {r['random']:.4f}  voi-conf {vc[0]:+.4f} [{vc[1]:+.4f}, {vc[2]:+.4f}]  "
                  f"conf-random {cr[0]:+.4f} [{cr[1]:+.4f}, {cr[2]:+.4f}]")


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Compare candidate rankers by what the delegate needs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See the top of this file for the input layout and the definitions.")
    ap.add_argument("--decisions", required=True,
                    help="decision file (jsonl with a prompt per line) for --split")
    ap.add_argument("--scores-root", required=True,
                    help="folder laid out as <arm>/s<seed>/scores_<split>.jsonl + summary.json")
    ap.add_argument("--split", required=True,
                    help="split to evaluate: the score files are scores_<split>.jsonl")
    ap.add_argument("--arms", nargs="+", required=True, metavar="ARM[:SEEDS]",
                    help="arm folders; an arm may carry its own seeds as NAME:0,1,2")
    ap.add_argument("--seeds", nargs="+", type=int, default=[0],
                    help="seeds of the arms that name none (default: 0)")
    ap.add_argument("--calibrate", choices=["none", "design", "crossfit"], default="none",
                    help="temperature: none, fitted on the design split, or cross-fitted in "
                         "--split by person")
    ap.add_argument("--design-decisions",
                    help="decision file of the design split (needed by --calibrate design)")
    ap.add_argument("--design-split", default="pilot",
                    help="split whose scores fit the temperature (default: pilot)")
    ap.add_argument("--vocabulary-decisions", nargs="*", default=[],
                    help="further decision files whose category names help read the histories")
    ap.add_argument("--world", help="folder level between the arm and the seed, if there is one")
    ap.add_argument("--file-prefix",
                    help="score files are scores_<prefix>_<split>.jsonl and the summary key is "
                         "<prefix>_<split>")
    ap.add_argument("--simpler", help="arm to prefer when the best two are within 0.01")
    ap.add_argument("--contrasts", nargs="*", default=[], metavar="A:B",
                    help="paired bootstrap of A minus B; ARM+cal is the calibrated run of ARM")
    ap.add_argument("--triggers", action="store_true",
                    help="compare ways to choose where to ask, for the selected arm")
    ap.add_argument("--trigger-arm", help="arm for --triggers instead of the selected one")
    ap.add_argument("--rates", nargs="+", type=float, default=[0.3, 0.5, 0.7],
                    help="ask rates for --triggers (default: 0.3 0.5 0.7)")
    ap.add_argument("--n-boot", type=int, default=4000, help="bootstrap draws (default: 4000)")
    ap.add_argument("--boot-seed", type=int, default=0, help="bootstrap seed (default: 0)")
    ap.add_argument("--out", required=True, help="where to write the report (json)")
    args = ap.parse_args(argv)
    if args.calibrate == "design" and not args.design_decisions:
        ap.error("--calibrate design needs --design-decisions")
    try:
        arms = parse_arms(args.arms, args.seeds)
    except InputError as e:
        ap.error(str(e))
    for name, what in [(args.simpler, "--simpler"), (args.trigger_arm, "--trigger-arm")]:
        if name and name not in arms:
            ap.error(f"{what} {name} is not in --arms")
    for spec in args.contrasts:
        variants = spec.split(":")
        if len(variants) != 2:
            ap.error(f"cannot read --contrasts {spec}: write two arms as A:B")
        for variant in variants:
            arm, _, tag = variant.partition("+")
            if arm not in arms or tag not in ("", "cal"):
                ap.error(f"cannot read --contrasts {spec}: {variant} is not an arm or ARM+cal")
            if tag == "cal" and args.calibrate == "none":
                ap.error(f"--contrasts {spec} needs --calibrate design or crossfit")
    return args


def main(argv=None):
    args = parse_args(argv)
    if args.calibrate == "design" and args.split == args.design_split:
        print("note: the temperature is fitted on the split it is applied to", file=sys.stderr)
    try:
        report = build_report(args)
    except InputError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print_report(report)
    print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
