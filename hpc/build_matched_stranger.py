#!/usr/bin/env python3
"""Build the matched-stranger control: every decision keeps its own five options and answer, but the history shown is
that of a different user who looks like the row's own user.

This replaces the uniformly random donor of build_stranger_targets.py. A user's donor is chosen once, so every row of that
user gets the same stranger, and the choice uses no random draw. The donor pool is every user the task keeps (at least 20
check-ins), not only the users in the target files, minus the user. A user is described by L, the length of the pre-cut
history, and by the number of check-ins in each venue category over that whole history ('?' when the category is unknown).

The rule:
  1. Keep the donors whose history length is within a band of the user's, |log(L_donor / L_user)| <= log(1.25). If no donor
     is left, widen the band to 1.5, then 2, then 4, then drop the band. The band used is recorded for each user.
  2. Among the donors left, take the one whose category counts have the largest cosine similarity to the user's.
  3. Ties go to the smaller |log(L_donor / L_user)|, then to the smaller user id (string order).
A user is never their own donor, and a donor whose rendered history is identical to the user's own is skipped.

The donor's history is rendered with the same function as the target files (proxy.arms.render_prompt, 30 most recent
check-ins). Everything from "They are about to go somewhere" onward is copied unchanged from the original row.

Check before anything is written: rendering each row with its own user as the donor must reproduce the original history
text exactly, on every row of every file. If it does not, the script stops and writes nothing. It also refuses to
overwrite an existing output.

Usage (from the repository root): PYTHONPATH=src python hpc/build_matched_stranger.py [file ...]
Reads each named target file from PROXY_TARGETS_DIR (default results/targets, or --targets-dir) and writes
<name>_matched_stranger.jsonl beside it. With no file named it reads steps_new_york_popmatched.jsonl, the canonical file.
Each output comes with a .donors.json file that lists, for every row, the user, the donor, the cosine of the match and the
length ratio L_donor / L_user.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import numpy as np

P = str(Path(__file__).resolve().parents[1])
sys.path.insert(0, os.path.join(P, "src"))

from proxy.arms import render_prompt          # noqa: E402
from proxy.config import CANONICAL            # noqa: E402
from proxy.datasets import load as ds_load    # noqa: E402
from proxy.seqrec import _eligible_sequences  # noqa: E402

MIN_EVENTS = 20                  # as in task.py
TEST_FRAC = 0.2                  # as in task.py
HIST_N = CANONICAL["hist_n"]     # as in arms.render_prompt
MARKER = "They are about to go somewhere"
BANDS = (1.25, 1.5, 2.0, 4.0, math.inf)
SUFFIX = "_matched_stranger"
DEFAULT_FILES = ["steps_new_york_popmatched.jsonl"]


def load_rows(path):
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def build_cats(dataset):
    """The venue -> {"cat", "name"} table, built exactly as proxy.arms.novel_targets builds it."""
    cats = {}
    for e in ds_load(dataset):
        if e.cat or e.name:
            cats[e.item] = {"cat": e.cat, "name": e.name}
    return cats


def split_marker(prompt):
    """(history_segment, candidate_block). The candidate block starts at the marker line and runs to the end
    (question, lettered candidates, answer cue). The marker must occur exactly once."""
    if prompt.count(MARKER) != 1:
        raise ValueError(f"marker occurs {prompt.count(MARKER)} times in a prompt")
    idx = prompt.index(MARKER)
    return prompt[:idx], prompt[idx:]


def render_history_segment(hist, cats, k):
    """The history part of arms.render_prompt for this history. The placeholder candidates never reach the returned text,
    because the history lines are built from the history and the venue table alone."""
    dummy = [f"\x00matched_stranger_dummy_{i}" for i in range(k)]
    full = render_prompt(SimpleNamespace(history=hist, candidates=dummy), cats, hist_n=HIST_N)
    return split_marker(full)[0]


def md5sum(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def category_vectors(eligible, cats):
    """Category counts over the whole pre-cut history of every eligible user.
    Returns (users in string order, count matrix users x categories, row norms, history lengths)."""
    users = sorted(eligible)
    cat_ix = {}
    counts = []
    for u in users:
        c = Counter(((cats.get(it) or {}).get("cat") or "?") for it in eligible[u])
        counts.append(c)
        for name in c:
            cat_ix.setdefault(name, len(cat_ix))
    M = np.zeros((len(users), len(cat_ix)))
    for i, c in enumerate(counts):
        for name, v in c.items():
            M[i, cat_ix[name]] = v
    norms = np.sqrt((M * M).sum(axis=1))
    lens = np.array([len(eligible[u]) for u in users], dtype=float)
    return users, M, norms, lens


def match_stranger(u, users, M, norms, lens, idx, skip=None):
    """The rule above for user u. skip(donor) returns True to reject a donor, in rank order."""
    i = idx[u]
    denom = norms * norms[i]
    cos = np.where(denom > 0, (M @ M[i]) / np.where(denom > 0, denom, 1.0), 0.0)
    ratio = np.abs(np.log(lens / lens[i]))
    ok = np.ones(len(users), dtype=bool)
    ok[i] = False
    for band in BANDS:
        sel = ok & (ratio <= (math.log(band) if band != math.inf else math.inf) + 1e-12)
        cand = np.nonzero(sel)[0]
        if len(cand) == 0:
            continue
        # Cosine high to low, then length ratio low to high, then user id (users is sorted, so index order is id order).
        # Rounding keeps floating point noise from deciding a tie.
        order = sorted(cand.tolist(), key=lambda j: (-round(float(cos[j]), 12), round(float(ratio[j]), 12), j))
        for j in order:
            if skip is not None and skip(users[j]):
                continue
            return {"donor": users[j], "cosine": float(cos[j]), "len_user": int(lens[i]), "len_donor": int(lens[j]),
                    "band": ("none" if band == math.inf else band), "pool_mean_cosine": float(cos[ok].mean())}
    raise RuntimeError(f"no admissible stranger for user {u!r}")


def identity_gate(name, rows, dataset, eligible, cats):
    """With the row's own user as donor, the rendered history must equal the original history text on every row.
    Otherwise print up to 20 failing rows and exit with status 3."""
    fails = []
    seg_cache = {}
    for i, row in enumerate(rows):
        u = row["user"]
        if row["ds"] != dataset:
            fails.append(f"row {i} user={u!r}: ds is {row['ds']!r}, expected {dataset!r}")
        elif u not in eligible:
            fails.append(f"row {i} user={u!r}: user not present in the eligible pre-cut histories")
        elif row["prompt"].count(MARKER) != 1:
            fails.append(f"row {i} user={u!r}: marker occurs {row['prompt'].count(MARKER)} times in the prompt")
        else:
            if u not in seg_cache:
                seg_cache[u] = render_history_segment(eligible[u], cats, row["k"])
            original_seg, _ = split_marker(row["prompt"])
            if seg_cache[u] != original_seg:
                fails.append(f"row {i} user={u!r}: rendered history differs from the original\n"
                             f"    rendered={seg_cache[u]!r}\n    original={original_seg!r}")
        if len(fails) >= 20:
            break
    if fails:
        print(f"check failed on {name}: {len(fails)} mismatching row(s) (showing up to 20):")
        for msg in fails:
            print(f"  {msg}")
        print("Stopping. Nothing was written.")
        sys.exit(3)
    print(f"  check passed: own-user history reproduces the original on all {len(rows)} rows of {name}")


def main():
    ap = argparse.ArgumentParser(description="Build the matched-stranger control files.")
    ap.add_argument("files", nargs="*", default=DEFAULT_FILES,
                    help="target files inside the targets directory (default: the canonical question file)")
    ap.add_argument("--targets-dir", default=os.environ.get("PROXY_TARGETS_DIR", os.path.join(P, "results", "targets")))
    ap.add_argument("--dataset", default=CANONICAL["dataset"])
    a = ap.parse_args()

    specs = []
    for name in a.files:
        src = os.path.join(a.targets_dir, name)
        base = src[:-len(".jsonl")] if src.endswith(".jsonl") else src
        specs.append({"name": os.path.basename(base), "in": base + ".jsonl", "out": base + SUFFIX + ".jsonl"})
    for spec in specs:
        if not os.path.isfile(spec["in"]):
            sys.exit(f"input not found: {spec['in']}")
        for path in (spec["out"], spec["out"] + ".donors.json"):
            if os.path.exists(path):
                sys.exit(f"refusing to overwrite {path}")

    print(f"=== loading eligible pre-cut histories: dataset={a.dataset} min_events={MIN_EVENTS} test_frac={TEST_FRAC} ===")
    eligible = _eligible_sequences(a.dataset, min_events=MIN_EVENTS, test_frac=TEST_FRAC)
    cats = build_cats(a.dataset)
    users, M, norms, lens = category_vectors(eligible, cats)
    idx = {u: i for i, u in enumerate(users)}
    print(f"  {len(users)} eligible users (the donor pool, before the user is removed)")
    print(f"  {len(cats)} venue items carry cat/name metadata, {M.shape[1]} categories")

    # check every file before anything is written
    all_rows = {}
    for spec in specs:
        print(f"\n=== {spec['name']}: {spec['in']} ===")
        rows = load_rows(spec["in"])
        all_rows[spec["name"]] = rows
        identity_gate(spec["name"], rows, a.dataset, eligible, cats)

    print("\n=== check passed on every file, matching ===")
    needed = sorted({r["user"] for rows in all_rows.values() for r in rows})
    seg_of = {}

    def segment(v):
        if v not in seg_of:
            seg_of[v] = render_history_segment(eligible[v], cats, 5)
        return seg_of[v]

    donors = {}
    for u in needed:
        donors[u] = match_stranger(u, users, M, norms, lens, idx, skip=lambda v, u=u: segment(v) == segment(u))
        assert donors[u]["donor"] != u, f"donor == own user {u!r}"
    print(f"  matched {len(donors)} users")

    # build every output in memory, then write
    built = []
    for spec in specs:
        rows = all_rows[spec["name"]]
        out_rows, per_row = [], {}
        for i, row in enumerate(rows):
            m = donors[row["user"]]
            own_seg, cand_block = split_marker(row["prompt"])
            donor_seg = segment(m["donor"])
            assert donor_seg != own_seg, f"row {i}: donor history identical to the row's own history"
            new_row = dict(row)
            new_row["prompt"] = donor_seg + cand_block
            assert new_row["prompt"][new_row["prompt"].index(MARKER):] == cand_block, (
                f"row {i}: candidate block not byte-identical to the original row")
            out_rows.append(new_row)
            per_row[i] = {"user": row["user"], "donor": m["donor"], "cosine": m["cosine"],
                          "length_ratio": m["len_donor"] / m["len_user"], "len_user": m["len_user"],
                          "len_donor": m["len_donor"], "band": m["band"]}
        assert [(r["user"], r["answer_idx"], r["k"]) for r in out_rows] == \
               [(r["user"], r["answer_idx"], r["k"]) for r in rows], "output is not row-aligned with the input"
        built.append((spec, out_rows, per_row))

    for spec, out_rows, per_row in built:
        with open(spec["out"], "x", encoding="utf-8") as f:
            for r in out_rows:
                f.write(json.dumps(r) + "\n")
        donors_path = spec["out"] + ".donors.json"
        with open(donors_path, "x", encoding="utf-8") as f:
            json.dump(per_row, f, indent=1)
        users_in_file = {r["user"] for r in out_rows}
        distinct = len({donors[u]["donor"] for u in users_in_file})
        print(f"\n  wrote {spec['out']}  ({len(out_rows)} rows, {len(users_in_file)} users)  md5={md5sum(spec['out'])}")
        print(f"  wrote {donors_path}")
        print(f"  distinct donors used: {distinct} of {len(users)} eligible users")

    cos = [m["cosine"] for m in donors.values()]
    print(f"\n  matched cosine: median {statistics.median(cos):.3f}, mean {statistics.fmean(cos):.3f}, "
          f"min {min(cos):.3f}. A random donor would have averaged "
          f"{statistics.fmean(m['pool_mean_cosine'] for m in donors.values()):.3f}.")
    print(f"  length band used: {dict(Counter(str(m['band']) for m in donors.values()))}")
    print("\n=== DONE ===")


if __name__ == "__main__":
    main()
