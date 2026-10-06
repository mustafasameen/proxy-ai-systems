#!/usr/bin/env python3
"""Build the "other person's history" control: every decision keeps its own five options and answer, but the history shown
is a different user's.

For row i of a target file with user u, the donor is
    random.Random(f"stranger_v2:{i}").choice(sorted(eligible users) without u)
so each row's draw depends only on its index. Eligible users are those the task keeps (at least 20 check-ins), and a donor's
history is their own pre-cut history, rendered with the same function as the target files (proxy.arms.render_prompt,
30 most recent check-ins). Everything from "They are about to go somewhere" onward is copied unchanged from the original row.

Check before anything is written: rendering each row with its own user as the donor must reproduce the original history text
exactly, on every row of both files. If it does not, the script stops and writes nothing.

Usage (from the repository root): PYTHONPATH=src python hpc/build_stranger_targets.py
Reads the two target files from PROXY_TARGETS_DIR (default results/targets) and writes
steps_new_york_popmatched_stranger_v2.jsonl and steps_new_york_popmatched_fresh300_stranger_v2.jsonl beside them, each with a
.donors.json file listing the donor of every row.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import sys
from types import SimpleNamespace

from pathlib import Path

P = str(Path(__file__).resolve().parents[1])
sys.path.insert(0, os.path.join(P, "src"))

from proxy.arms import render_prompt          # noqa: E402
from proxy.datasets import load as ds_load    # noqa: E402
from proxy.seqrec import _eligible_sequences  # noqa: E402

VENUE = "steps_new_york"
MIN_EVENTS = 20       # as in task.py
TEST_FRAC = 0.2       # as in task.py
HIST_N = 30           # as in arms.render_prompt
MARKER = "They are about to go somewhere"

TARGETS_DIR = os.environ.get("PROXY_TARGETS_DIR", os.path.join(P, "results", "targets"))
SAMPLES = {
    "pilot": {
        "in": os.path.join(TARGETS_DIR, "steps_new_york_popmatched.jsonl"),
        "out": os.path.join(TARGETS_DIR, "steps_new_york_popmatched_stranger_v2.jsonl"),
        "expected_rows": 2291,
        "expected_users": 300,
    },
    "fresh300": {
        "in": os.path.join(TARGETS_DIR, "steps_new_york_popmatched_fresh300.jsonl"),
        "out": os.path.join(TARGETS_DIR, "steps_new_york_popmatched_fresh300_stranger_v2.jsonl"),
        "expected_rows": 2502,
        "expected_users": 300,
    },
}


def load_rows(path):
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(l) for l in f]


def build_cats():
    """The venue -> {"cat", "name"} table, built exactly as proxy.arms.novel_targets builds it."""
    cats = {}
    for e in ds_load(VENUE):
        if e.cat or e.name:
            cats[e.item] = {"cat": e.cat, "name": e.name}
    return cats


def split_marker(prompt):
    """(history_segment, candidate_block) -- candidate_block STARTS AT the marker line and runs to
    the end (question + lettered candidates + answer cue)."""
    idx = prompt.index(MARKER)
    return prompt[:idx], prompt[idx:]


def render_history_segment(hist, cats, k):
    """The history part of arms.render_prompt for this history. The placeholder candidates never reach the returned text,
    because the history lines are built from the history and the venue table alone."""
    dummy = [f"\x00stranger_v2_dummy_{i}" for i in range(k)]
    full = render_prompt(SimpleNamespace(history=hist, candidates=dummy), cats, hist_n=HIST_N)
    seg, _ = split_marker(full)
    return seg


def md5sum(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def identity_gate(sample, rows, eligible, cats):
    """With the row's own user as donor, the rendered history must equal the original history text on every row;
    otherwise print up to 20 failing rows and exit with status 3."""
    fails = []
    for i, row in enumerate(rows):
        u = row["user"]
        if u not in eligible:
            fails.append(f"row {i} user={u!r}: user not present in eligible pre-cut histories "
                         f"(_eligible_sequences({VENUE!r}, min_events={MIN_EVENTS}, "
                         f"test_frac={TEST_FRAC}))")
        else:
            rendered_seg = render_history_segment(eligible[u], cats, row["k"])
            frozen_seg, _ = split_marker(row["prompt"])
            if rendered_seg != frozen_seg:
                fails.append(f"row {i} user={u!r}: rendered history segment != frozen history "
                             f"segment\n    rendered={rendered_seg!r}\n    frozen  ={frozen_seg!r}")
        if len(fails) >= 20:
            break
    if fails:
        print(f"check failed on {sample}: {len(fails)} mismatching row(s) (showing up to 20):")
        for msg in fails:
            print(f"  {msg}")
        print("Stopping; nothing was written.")
        sys.exit(3)
    print(f"  check passed: own-user history reproduces the original on all {len(rows)} rows of {sample}")


def main():
    print(f"=== loading eligible pre-cut histories: venue={VENUE} min_events={MIN_EVENTS} "
          f"test_frac={TEST_FRAC} ===")
    eligible = _eligible_sequences(VENUE, min_events=MIN_EVENTS, test_frac=TEST_FRAC)
    sorted_users = sorted(eligible)
    print(f"  {len(sorted_users)} eligible users (the donor pool, before per-row exclusion of u)")
    cats = build_cats()
    print(f"  {len(cats)} venue items carry cat/name metadata")

    # check both files before anything is written
    all_rows = {}
    for sample, spec in SAMPLES.items():
        print(f"\n=== {sample}: {spec['in']} ===")
        rows = load_rows(spec["in"])
        assert len(rows) == spec["expected_rows"], (
            f"{sample}: expected {spec['expected_rows']} rows, got {len(rows)}")
        n_users = len({r["user"] for r in rows})
        assert n_users == spec["expected_users"], (
            f"{sample}: expected {spec['expected_users']} users, got {n_users}")
        all_rows[sample] = rows
        identity_gate(sample, rows, eligible, cats)

    print("\n=== check passed on both files; building ===")

    # build and write
    for sample, spec in SAMPLES.items():
        rows = all_rows[sample]
        print(f"\n=== building {sample} stranger_v2 ({len(rows)} rows) ===")
        out_rows = []
        donors = {}
        for i, row in enumerate(rows):
            u = row["user"]
            rng = random.Random(f"stranger_v2:{i}")
            pool = [x for x in sorted_users if x != u]
            donor = rng.choice(pool)
            donors[i] = donor

            own_seg, cand_block = split_marker(row["prompt"])
            donor_seg = render_history_segment(eligible[donor], cats, row["k"])
            new_prompt = donor_seg + cand_block

            assert donor != u, f"row {i}: donor == own user {u!r}"
            assert cand_block == row["prompt"][row["prompt"].index(MARKER):], (
                f"row {i}: candidate block not byte-identical to the frozen row")
            assert donor_seg != own_seg, (
                f"row {i}: donor history segment identical to the row's own-history segment "
                f"(donor={donor!r}, user={u!r})")

            out_rows.append({"ds": row["ds"], "user": row["user"], "k": row["k"],
                              "answer_idx": row["answer_idx"], "prompt": new_prompt})

        assert len(out_rows) == len(rows)
        assert [(r["user"], r["answer_idx"]) for r in out_rows] == \
               [(r["user"], r["answer_idx"]) for r in rows], (
            f"{sample}: output is not row-aligned with the input (user/answer_idx sequence differs)")

        with open(spec["out"], "w", encoding="utf-8") as f:
            for r in out_rows:
                f.write(json.dumps(r) + "\n")
        donors_path = spec["out"] + ".donors.json"
        with open(donors_path, "w", encoding="utf-8") as f:
            json.dump(donors, f, indent=1)

        distinct_donors = len(set(donors.values()))
        print(f"  asserts OK: donor != u (all rows); candidate block byte-identical (all rows); "
              f"history segment differs from own (all rows); row-aligned with input")
        print(f"  wrote {spec['out']}  ({len(out_rows)} rows)  md5={md5sum(spec['out'])}")
        print(f"  wrote {donors_path}")
        print(f"  distinct donors used: {distinct_donors} / donor pool size {len(sorted_users)}")

    print("\n=== DONE ===")


if __name__ == "__main__":
    main()
