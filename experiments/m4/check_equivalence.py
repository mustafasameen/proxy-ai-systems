"""Check that the scripts in this folder reproduce the numbers of the original analysis.

This is for the authors; using the other scripts does not need it. It takes the folder that holds
the original inputs and outputs, runs compare_candidates.py and export_interface_data.py on those
inputs, and compares every number with the saved original outputs:

  candidates.json          candidate comparison on the test split, temperature fitted on the
                           design split, with the paired bootstrap contrasts
  candidates_design.json   candidate comparison on the design split, cross-fitted temperature,
                           and the selection rule
  e3_design.json           ask-trigger comparison for the selected arm on the design split
  selected_numbers.json    headline numbers of the exported arm on the test split

Numbers must agree to within 1e-9. Bootstrap intervals must be identical, because the seed and
the order of draws are the same. With --interface-reference the interface data file written by
export_interface_data.py is also compared, field by field, with a saved original of that file
(floats within the same tolerance, everything else equal).

The saved outputs were written under Python 3.12, where the built-in sum of floats is compensated.
Under 3.12 every number is identical. Under 3.11 a sum of floats can differ in the last bit, so
numbers agree to about 1e-15; the bootstrap intervals are still identical.

Usage:
    python check_equivalence.py RESULTS_DIR --scores-root DIR [--interface-reference FILE]

The decision files and the four saved outputs are found by name under RESULTS_DIR, and each must
exist once; --test-decisions, --design-decisions and --saved-dir name them when it is not so.
--scores-root is the folder of scored runs, laid out <arm>/<world>/s<seed>/. The exit status is 0
when everything matches and 1 otherwise.
"""
import argparse
import contextlib
import io
import json
import re
import sys
import tempfile
from pathlib import Path

import compare_candidates
import export_interface_data

TEST_DECISIONS = "steps_new_york_popmatched_fresh300.jsonl"
DESIGN_DECISIONS = "steps_new_york_popmatched.jsonl"
SAVED = ("candidates.json", "candidates_design.json", "e3_design.json", "selected_numbers.json")
WORLD, FILE_PREFIX = "steps_new_york", "steps_ny"
INTERVAL_KEYS = {"voi_minus_confidence", "confidence_minus_random"}

# Saved paired comparisons: key in the saved file -> (contrast written for --contrasts, metric).
PAIRED = {
    "paired": {
        "sft_minus_dpo_acc": ("um_sft:um_dpo", "acc"),
        "sft_minus_dpo_voi050": ("um_sft:um_dpo", "voi_050"),
        "sft_minus_prompted_zs_acc": ("um_sft:prompted_zs", "acc"),
        "sft_minus_prompted_zs_voi050": ("um_sft:prompted_zs", "voi_050"),
    },
    "paired_calibrated": {
        "sft_minus_dpo_voi050": ("um_sft+cal:um_dpo+cal", "voi_050"),
        "dpo_cal_minus_dpo_raw_voi050": ("um_dpo+cal:um_dpo", "voi_050"),
    },
}


class Ledger:
    """Counts the comparisons made against one saved file and keeps the failures."""

    def __init__(self, tol):
        self.tol = tol
        self.numbers = self.intervals = self.intervals_identical = 0
        self.max_diff = 0.0
        self.failures = []

    def number(self, name, ref, got):
        """A number that must agree within the tolerance (None must match None)."""
        if ref is None or got is None:
            if ref is not got:
                self.failures.append(f"{name}: saved {ref!r}, port {got!r}")
            return
        diff = abs(ref - got)
        self.numbers += 1
        self.max_diff = max(self.max_diff, diff)
        if not diff <= self.tol:
            self.failures.append(f"{name}: saved {ref!r}, port {got!r}, difference {diff:.3g}")

    def interval(self, name, ref, got):
        """A bootstrap interval [mean, low, high] that must be identical."""
        self.intervals += 1
        if list(ref) == list(got):
            self.intervals_identical += 1
        else:
            self.failures.append(f"{name}: saved {list(ref)!r}, port {list(got)!r}")

    def exact(self, name, ref, got):
        """A value (text, integer) that must be equal."""
        if ref != got:
            self.failures.append(f"{name}: saved {ref!r}, port {got!r}")

    def walk(self, name, ref, got, skip=()):
        """Compare a saved structure with the port's, key by key and element by element."""
        if isinstance(ref, dict):
            for k, v in ref.items():
                if k in skip:
                    continue
                if not isinstance(got, dict) or k not in got:
                    self.failures.append(f"{name}.{k}: missing from the port's output")
                elif k in INTERVAL_KEYS:
                    self.interval(f"{name}.{k}", v, got[k])
                else:
                    self.walk(f"{name}.{k}", v, got[k])
        elif isinstance(ref, list):
            if not isinstance(got, list) or len(ref) != len(got):
                self.failures.append(f"{name}: lists of different length")
            else:
                for i, (a, b) in enumerate(zip(ref, got)):
                    self.walk(f"{name}[{i}]", a, b)
        elif isinstance(ref, float) or ref is None:
            self.number(name, ref, got)
        else:
            self.exact(name, ref, got)


def find_one(root, name, flag):
    """The one file called name under root, or a SystemExit that says which flag to use."""
    hits = sorted(Path(root).rglob(name))
    if len(hits) != 1:
        raise SystemExit(f"found {len(hits)} files named {name} under {root}; use {flag}")
    return hits[0]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def run_quietly(main, argv):
    """Run a script's main() with its printed table suppressed; stop if it reports a failure."""
    with contextlib.redirect_stdout(io.StringIO()):
        code = main(argv)
    if code != 0:
        raise SystemExit(f"{main.__module__} exited with status {code}")


def arm_arguments(seeds_by_arm):
    """--arms values NAME:SEED,SEED from a mapping of arm to its seeds."""
    return [f"{a}:{','.join(str(s) for s in seeds)}" for a, seeds in seeds_by_arm.items()]


def diff_json(a, b, tol, path="", out=None):
    """Paths at which two json values differ. Numbers that are floats must agree within tol;
    everything else (text, integers, null, keys, list lengths) must be equal."""
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}/{k}")
            else:
                diff_json(a[k], b[k], tol, f"{path}/{k}", out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            diff_json(x, y, tol, f"{path}[{i}]", out)
    elif isinstance(a, float) or isinstance(b, float):
        numeric = all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (a, b))
        if not (numeric and abs(a - b) <= tol):
            out.append(path)
    elif a != b or type(a) is not type(b):
        out.append(path)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check the port against the original outputs.")
    ap.add_argument("results_dir", help="folder with the original inputs and saved outputs")
    ap.add_argument("--scores-root", required=True, help="folder of scored runs")
    ap.add_argument("--test-decisions", help=f"decision file of the test split ({TEST_DECISIONS})")
    ap.add_argument("--design-decisions",
                    help=f"decision file of the design split ({DESIGN_DECISIONS})")
    ap.add_argument("--saved-dir", help="folder holding the saved outputs")
    ap.add_argument("--interface-reference", help="saved original of the interface data file")
    ap.add_argument("--simpler", help="arm preferred in a tie (default: read from the saved rule)")
    ap.add_argument("--work-dir", help="where to write the port's outputs (default: a new folder)")
    ap.add_argument("--tol", type=float, default=1e-9, help="tolerance for numbers (default 1e-9)")
    args = ap.parse_args(argv)

    root = Path(args.results_dir)
    test_dec = args.test_decisions or find_one(root, TEST_DECISIONS, "--test-decisions")
    design_dec = args.design_decisions or find_one(root, DESIGN_DECISIONS, "--design-decisions")
    if args.saved_dir:
        saved_paths = {n: Path(args.saved_dir) / n for n in SAVED}
    else:
        saved_paths = {n: find_one(root, n, "--saved-dir") for n in SAVED}
    saved = {n: load(p) for n, p in saved_paths.items()}
    work = Path(args.work_dir) if args.work_dir else Path(tempfile.mkdtemp(prefix="equivalence_"))
    work.mkdir(parents=True, exist_ok=True)
    layout = ["--scores-root", args.scores_root, "--world", WORLD, "--file-prefix", FILE_PREFIX]

    # The saved files say which arms, seeds and tie-break arm the original run used.
    test_saved, design_saved = saved["candidates.json"], saved["candidates_design.json"]
    test_arms = [k for k, v in test_saved.items() if isinstance(v, dict) and "seeds" in v]
    design_arms = [k for k in design_saved if k != "selection"]
    test_seeds = {a: test_saved[a]["seeds"] for a in test_arms}
    design_seeds = {a: design_saved[a]["raw"]["seeds"] for a in design_arms}
    simpler = args.simpler
    if simpler is None:
        found = re.search(r"->\s*(\S+)\s*$", design_saved["selection"]["rule"])
        if not found:
            raise SystemExit("cannot read the tie-break arm from the saved rule; use --simpler")
        simpler = found.group(1)
    contrasts = sorted({c for table in PAIRED.values() for c, _ in table.values()})
    chosen = saved["selected_numbers.json"]

    print(f"outputs of the port go to {work}")
    run_quietly(compare_candidates.main, [
        "--decisions", str(test_dec), "--design-decisions", str(design_dec), *layout,
        "--split", "fresh", "--calibrate", "design", "--simpler", simpler,
        "--arms", *arm_arguments(test_seeds), "--contrasts", *contrasts,
        "--out", str(work / "candidates.json")])
    run_quietly(compare_candidates.main, [
        "--decisions", str(design_dec), *layout, "--split", "pilot", "--calibrate", "crossfit",
        "--simpler", simpler, "--arms", *arm_arguments(design_seeds), "--triggers",
        "--out", str(work / "candidates_design.json")])
    export_args = ["--decisions", str(test_dec), "--design-decisions", str(design_dec), *layout,
                   "--arm", chosen["arm"], "--seed", str(chosen["seed"]), "--split", "fresh",
                   "--out", str(work / "interface_data.json"),
                   "--numbers-out", str(work / "selected_numbers.json")]
    reference = None
    if args.interface_reference:
        reference = load(args.interface_reference)
        about = {k: reference["about"][k] for k in export_interface_data.ABOUT_KEYS}
        (work / "about.json").write_text(json.dumps(about), encoding="utf-8")
        (work / "reference.json").write_text(json.dumps(reference["reference"]), encoding="utf-8")
        export_args += ["--about", str(work / "about.json"),
                        "--reference", str(work / "reference.json")]
    run_quietly(export_interface_data.main, export_args)

    port_test = load(work / "candidates.json")
    port_design = load(work / "candidates_design.json")
    port_numbers = load(work / "selected_numbers.json")
    ledgers = {}

    # Test split: every arm, raw and calibrated, then the paired contrasts.
    led = ledgers["candidates.json"] = Ledger(args.tol)
    for arm in test_arms:
        got = port_test["arms"][arm]
        led.exact(f"{arm}.seeds", test_seeds[arm], got["seeds"])
        led.walk(f"{arm}.raw", test_saved[arm], got["raw"], skip=("seeds",))
        led.walk(f"{arm}.calibrated", test_saved["calibrated"][arm], got["calibrated"])
    for table, entries in PAIRED.items():
        for key, (contrast, metric) in entries.items():
            led.interval(f"{table}.{key}", test_saved[table][key],
                         port_test["paired"][contrast][metric])

    # Design split: every arm raw and calibrated, then the selection.
    led = ledgers["candidates_design.json"] = Ledger(args.tol)
    for arm in design_arms:
        led.exact(f"{arm}.seeds", design_seeds[arm], port_design["arms"][arm]["seeds"])
        for mode in ("raw", "calibrated"):
            led.walk(f"{arm}.{mode}", design_saved[arm][mode], port_design["arms"][arm][mode],
                     skip=("seeds",))
    led.walk("selection", design_saved["selection"], port_design["selection"], skip=("rule",))
    led.exact("selection.order", list(design_saved["selection"]["eligible"]),
              list(port_design["selection"]["eligible"]))
    led.exact("selected arm", chosen["arm"], port_design["selection"]["chosen"])

    # Ask triggers for the selected arm.
    led = ledgers["e3_design.json"] = Ledger(args.tol)
    led.exact("trigger arm", chosen["arm"], port_design["triggers"]["arm"])
    for key, entry in saved["e3_design.json"].items():
        rate = f"{int(key[1:]) / 100:.2f}"
        led.walk(key, entry, port_design["triggers"]["rates"][rate])

    # Headline numbers of the exported arm.
    led = ledgers["selected_numbers.json"] = Ledger(args.tol)
    led.walk("numbers", chosen, port_numbers)

    interface_diffs = None
    if reference is not None:
        interface_diffs = diff_json(reference, load(work / "interface_data.json"), args.tol)

    failures = [f"{n}: {m}" for n, lg in ledgers.items() for m in lg.failures]
    for name, lg in ledgers.items():
        print(f"{name:24s} {lg.numbers:4d} numbers, max abs difference {lg.max_diff:.3e}; "
              f"{lg.intervals_identical} of {lg.intervals} bootstrap intervals identical")
    if interface_diffs is not None:
        print(f"interface data file      {len(interface_diffs)} fields differ from the saved "
              f"original")
        failures += [f"interface data: {p}" for p in interface_diffs[:10]]
    total = sum(lg.numbers for lg in ledgers.values())
    boots = sum(lg.intervals for lg in ledgers.values())
    ident = sum(lg.intervals_identical for lg in ledgers.values())
    worst = max(lg.max_diff for lg in ledgers.values())
    print(f"{total} numbers compared with 4 saved files, tolerance {args.tol:g}, "
          f"max abs difference {worst:.3e}; {ident} of {boots} bootstrap intervals identical")
    for line in failures[:20]:
        print("MISMATCH", line)
    print("EQUIVALENCE PASS" if not failures else f"EQUIVALENCE FAIL ({len(failures)} mismatches)")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
