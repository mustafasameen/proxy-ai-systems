#!/usr/bin/env python3
"""Dataset statistics for the EGN 6216 Milestone 3 data section (PROXY).

Every number in Section 6 of the Milestone 3 document that is not a pilot result comes from this script.
It reads the raw Massive-STEPS New York file and the frozen files the project built from it, rebuilds the two
frozen evaluation files with the project's own code as a known-answer check, and writes data_stats.json next to
this file. It prints counts only. The one place that holds venue names is the composite example of Table 1 (public venues
that 20 or more users visited, and no user's own history); no user id appears anywhere.

    cd <proxy project root>
    PYTHONPATH=src python proposal/milestone3/data_stats.py [--skip-sft-rebuild]

Paths come from the environment, with defaults that follow the project layout:
    PROXY_ROOT          project root (default: two folders above this file)
    PROXY_STEPS_NY_CSV  the raw New York check-in file (default: the path proxy.datasets.resolve gives)

Inputs (read only; the paths are the constants DEV_FILE, TEST_FILE, SFT_FILE and GENERIC below):
    raw file        Massive-STEPS New York, new_york_checkins.csv
    dev targets     the frozen evaluation file of the 300 development users
    test targets    the frozen evaluation file of the 300 test users
    training rows   the adapter training instances, one jsonl row per instance
    genericness     the item-genericness table (for the text-similarity check)

Known answers (the script stops if one fails): the rebuilt dev and test target files are byte-identical to the
frozen files; the rebuilt training rows are byte-identical to the training file (unless --skip-sft-rebuild).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("PROXY_ROOT", HERE.parents[1]))
sys.path.insert(0, str(ROOT / "src"))

from proxy.arms import _label, novel_targets, render_prompt_ordered  # noqa: E402
from proxy.datasets import load, resolve  # noqa: E402
from proxy.task import MIN_EVENTS, TEST_FRAC  # noqa: E402

DATASET = "steps_new_york"
DEV_SEED, TEST_SEED, N_USERS = 0, 20260920, 300           # the seeds and sample size used when the two files were built
RAW = Path(os.environ.get("PROXY_STEPS_NY_CSV", "")) if os.environ.get("PROXY_STEPS_NY_CSV") else resolve(DATASET)
DEV_FILE = ROOT / "results/targets/steps_new_york_popmatched.jsonl"
TEST_FILE = ROOT / "results/targets/steps_new_york_popmatched_fresh300.jsonl"
SFT_FILE = ROOT / "sft/sft_train_steps_new_york_popmatched.jsonl"
GENERIC = ROOT / "results/item_genericness_steps_new_york.json"
OUT = HERE / "data_stats.json"
HIST_N = 30


def md5(path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def q(values, qs=(0, 10, 50, 90, 100)):
    """min / p10 / median / p90 / max with numpy's default (linear) percentile."""
    return {f"p{k}": float(np.percentile(values, k)) for k in qs}


def share(a, b):
    return a / b if b else None


# ------------------------------------------------------------------------------------------ raw file
def raw_profile(path):
    df = pd.read_csv(path, dtype=str)
    df["ts"] = pd.to_datetime(df["timestamp"])
    n = len(df)
    out = {"file_md5": md5(path), "rows": n, "users": int(df.user_id.nunique()), "venues": int(df.venue_id.nunique()),
           "trajectories": int(df.trail_id.nunique()),
           "first": str(df.ts.min()), "last": str(df.ts.max()),
           "missing": {c: int(df[c].isna().sum()) for c in ("name", "address", "latitude", "longitude", "venue_category")}}
    out["missing_share"] = {c: share(v, n) for c, v in out["missing"].items()}
    unnamed = df[df["name"].isna()]
    out["unnamed_rows"] = len(unnamed)
    out["unnamed_top_categories"] = {k: int(v) for k, v in unnamed.venue_category.value_counts().head(4).items()}
    out["home_private_rows"] = int((df.venue_category == "Home (private)").sum())
    # two periods: trail_id starts with 2013 (check-ins of 2012-2013) or 2018 (check-ins of 2017-2018)
    per_period = df.trail_id.str[:4].map({"2013": "2012-13", "2018": "2017-18"})
    out["rows_by_period"] = {k: int(v) for k, v in per_period.value_counts().items()}
    sets = df.assign(p=per_period).groupby("user_id").p.agg(lambda s: tuple(sorted(set(s))))
    out["users_by_period"] = {"+".join(k): int(v) for k, v in sets.value_counts().items()}
    # duplicates
    d = df.sort_values(["user_id", "ts", "venue_id"])
    same_user = d.user_id.values[1:] == d.user_id.values[:-1]
    same_venue = d.venue_id.values[1:] == d.venue_id.values[:-1]
    gap = (d.ts.values[1:] - d.ts.values[:-1]).astype("timedelta64[s]").astype(int)
    out["duplicates"] = {"exact_rows": int(df.drop(columns="ts").duplicated().sum()),
                         "same_user_venue_time": int(df.duplicated(["user_id", "venue_id", "timestamp"]).sum()),
                         "consecutive_same_venue": int((same_user & same_venue).sum()),
                         "gap_under_60s": int((same_user & (gap < 60)).sum())}
    out["duplicates"]["consecutive_same_venue_share"] = share(out["duplicates"]["consecutive_same_venue"], n)
    return out


# ------------------------------------------------------------------------------------------ users and splits
def user_tables():
    per = defaultdict(list)
    cats = {}
    for e in load(DATASET):
        per[e.user].append((e.ts, e.item))
        if e.cat or e.name:
            cats[e.item] = {"cat": e.cat, "name": e.name}
    for u in per:
        per[u].sort()
    return per, cats


def funnel(per):
    counts = np.array([len(v) for v in per.values()])
    elig = {u: v for u, v in per.items() if len(v) >= MIN_EVENTS}
    held = novel = users_novel = 0
    for u, evs in elig.items():
        cut = int(len(evs) * (1 - TEST_FRAC))
        pre = {it for _, it in evs[:cut]}
        h = [it for _, it in evs[cut:]]
        n_nov = sum(1 for it in h if it not in pre)
        held += len(h)
        novel += n_nov
        users_novel += n_nov > 0
    ec = np.array([len(v) for v in elig.values()])
    srt = np.sort(counts)[::-1]
    top = srt[: int(0.1 * len(srt))].sum()
    return {"users": len(per), "events": int(counts.sum()), "median_events_all": float(np.median(counts)),
            "eligible_users": len(elig), "eligible_share_of_users": share(len(elig), len(per)),
            "eligible_share_of_events": share(int(ec.sum()), int(counts.sum())),
            "median_events_eligible": float(np.median(ec)),
            "users_under_20": len(per) - len(elig),
            "top_decile_users_share_of_events": share(int(top), int(counts.sum())),
            "heldout_decisions": held, "novel_decisions": novel, "novel_share": share(novel, held),
            "eligible_users_with_a_novel_decision": users_novel}


def rows_of(tg, cats):
    return [{"ds": DATASET, "user": t.user, "k": len(t.candidates), "answer_idx": t.candidates.index(t.true_item),
             "prompt": render_prompt_ordered(t, cats, hist_n=HIST_N, hist_order="recent")} for t in tg]


def bytes_of(rows):
    return "".join(json.dumps(r) + "\n" for r in rows).encode()


def rebuild_and_check():
    dev_t, cats = novel_targets(DATASET, n_users=N_USERS, seed=DEV_SEED, distractors="popmatched")
    dev_users = {t.user for t in dev_t}
    test_t, _ = novel_targets(DATASET, n_users=N_USERS, seed=TEST_SEED, distractors="popmatched", exclude_users=dev_users)
    res = {}
    for name, tg, f in (("dev", dev_t, DEV_FILE), ("test", test_t, TEST_FILE)):
        rebuilt = hashlib.md5(bytes_of(rows_of(tg, cats))).hexdigest()
        res[name] = {"file_md5": md5(f), "rebuilt_md5": rebuilt, "identical": rebuilt == md5(f)}
        assert res[name]["identical"], f"known-answer check failed for the {name} targets"
    assert not (dev_users & {t.user for t in test_t}), "cohorts overlap"
    return dev_t, test_t, cats, res


def venue_period_counts(per):
    """Check-ins per venue in each period ('A' = 2012-13, 'B' = 2017-18), over all users."""
    vc = defaultdict(Counter)
    for evs in per.values():
        for ts, it in evs:
            vc[it]["B" if ts.year >= 2017 else "A"] += 1
    return vc


def period_check(tg, per, vc):
    """Decisions by period; the share of distractor slots whose venue has no check-in in the decision's period; and a
    history-free audit rule: pick uniformly among the candidates with a check-in in the decision's period. The rule
    leaves the decision's own check-in out of the true venue's count, so the answer cannot vouch for itself."""
    by_user = defaultdict(list)
    for t in tg:
        by_user[t.user].append(t)
    dec, slots, off = Counter(), Counter(), Counter()
    rule, rows_off = Counter(), 0
    for u, ts_ in by_user.items():
        evs = per[u]
        cut = int(len(evs) * (1 - TEST_FRAC))
        pre = {it for _, it in evs[:cut]}
        nov = [e for e in evs[cut:] if e[1] not in pre]
        assert len(nov) == len(ts_), "decision order does not match the held-out events"
        for (ts, it), t in zip(nov, ts_):
            assert it == t.true_item
            p = "B" if ts.year >= 2017 else "A"
            dec[p] += 1
            bad = 0
            for c in t.candidates:
                if c != t.true_item:
                    slots[p] += 1
                    off[p] += vc[c][p] == 0
                    bad += vc[c][p] == 0
            rows_off += bad > 0
            active = [c for c in t.candidates if vc[c][p] - (c == t.true_item) >= 1]
            rule[p] += ((t.true_item in active) / len(active)) if active else 1 / len(t.candidates)
    n = sum(dec.values())
    return {"decisions_2012_13": dec["A"], "decisions_2017_18": dec["B"],
            "distractor_slots_off_period_share": share(sum(off.values()), sum(slots.values())),
            "distractor_slots_off_period_share_2012_13_decisions": share(off["A"], slots["A"]),
            "distractor_slots_off_period_share_2017_18_decisions": share(off["B"], slots["B"]),
            "decisions_with_an_off_period_distractor_share": share(rows_off, n),
            "period_rule_expected_accuracy": share(sum(rule.values()), n),
            "period_rule_expected_accuracy_2012_13_decisions": share(rule["A"], dec["A"]),
            "period_rule_expected_accuracy_2017_18_decisions": share(rule["B"], dec["B"])}


def cohort_stats(tg, cats, per, pre_pop, genericness):
    users = sorted({t.user for t in tg})
    n = len(tg)
    per_user = Counter(t.user for t in tg)
    hist_all = np.array([len(t.history) for t in tg])
    shown = np.minimum(hist_all, HIST_N)
    out = {"users": len(users), "decisions": n, "decisions_per_user": q(list(per_user.values())),
           "history_check_ins_before_split_per_decision": q(hist_all), "history_shown": q(shown),
           "share_with_30_shown": share(int((hist_all >= HIST_N).sum()), n)}
    out["answer_position_share"] = {"ABCDE"[i]: share(sum(1 for t in tg if t.candidates.index(t.true_item) == i), n)
                                    for i in range(5)}
    out["answer_position_max_deviation"] = max(abs(v - 0.2) for v in out["answer_position_share"].values())
    # label quality
    lab = {it: _label(cats, it) for t in tg for it in t.candidates + t.history}
    name_of = {it: (cats.get(it) or {}).get("name") for it in lab}
    out["rows_with_two_identical_candidate_labels"] = sum(1 for t in tg if len({lab[c] for c in t.candidates}) < 5)
    out["rows_true_venue_without_name"] = sum(1 for t in tg if not name_of[t.true_item])
    slots = n * 5
    out["candidate_slots_without_name_share"] = share(sum(1 for t in tg for c in t.candidates if not name_of[c]), slots)
    out["rows_true_label_already_in_history"] = sum(1 for t in tg if lab[t.true_item] in {lab[h] for h in t.history})
    out["rows_true_name_already_in_history"] = sum(
        1 for t in tg if name_of[t.true_item] and name_of[t.true_item] in {name_of[h] for h in t.history})
    cat = lambda it: (cats.get(it) or {}).get("cat") or "?"
    out["category_unique_share"] = share(sum(1 for t in tg if [cat(c) for c in t.candidates].count(cat(t.true_item)) == 1), n)
    out["rows_true_category_home_private"] = sum(1 for t in tg if cat(t.true_item) == "Home (private)")
    shown_h = [t.history[-HIST_N:] for t in tg]
    out["histories_with_consecutive_repeat_share"] = share(sum(1 for h in shown_h if any(a == b for a, b in zip(h, h[1:]))), n)
    # history-free baselines (expected accuracy under random tie-breaking)
    for key, sign in (("least_popular", -1), ("most_popular", 1)):
        tot = 0.0
        for t in tg:
            vals = [pre_pop.get(c, 0) * sign for c in t.candidates]
            best = max(vals)
            tied = [c for c, v in zip(t.candidates, vals) if v == best]
            tot += (t.true_item in tied) / len(tied)
        out[f"{key}_expected_accuracy"] = tot / n
    g = genericness
    hits = sum(1 for t in tg if t.candidates[min(range(5), key=lambda i: g[t.candidates[i]])] == t.true_item)
    out["text_similarity_tell_accuracy"] = hits / n
    # time structure
    cut_info = []
    for u in users:
        evs = per[u]
        cut = int(len(evs) * (1 - TEST_FRAC))
        cut_info.append((evs[cut - 1][0], evs[cut][0], {e[0].year >= 2017 for e in evs}))
    out["users_with_check_ins_in_both_periods"] = sum(1 for _, _, ys in cut_info if len(ys) == 2)
    out["users_whose_held_out_window_starts_in_2017_18"] = sum(1 for _, c, _ in cut_info if c.year >= 2017)
    gaps = [(c - p).days for p, c, _ in cut_info]
    out["users_with_split_gap_over_365_days"] = sum(1 for g_ in gaps if g_ > 365)
    out["median_events_per_user"] = float(np.median([len(per[u]) for u in users]))
    return out


# ------------------------------------------------------------------------------------------ privacy
def venue_index(per):
    vu = defaultdict(set)
    for u, evs in per.items():
        for _, it in evs:
            vu[it].add(u)
    return vu


def support(venue_users, venues, exact=False):
    """Number of users in the release whose check-ins include every venue in `venues`. The default stops at one user,
    which is enough when the venues are a subset of that user's own history (the owner is always in the intersection);
    `exact=True` intersects them all, as the composite test needs."""
    sets = sorted((venue_users[v] for v in venues), key=len)
    cand = set(sets[0])
    for s in sets[1:]:
        cand &= s
        if not cand or (not exact and len(cand) <= 1):
            break
    return len(cand)


def unicity(tgs, venue_users, draws=20, seed=0):
    """Share of random k-venue subsets of a user's shown history that only that user's record contains."""
    rng = random.Random(seed)
    hist = {}
    for tg in tgs:
        for t in tg:
            hist[t.user] = sorted(set(t.history[-HIST_N:]))
    out = {}
    for label, min_users in (("all venues", 1), ("venues visited by 20 or more users", 20)):
        row = {}
        for k in (1, 2, 3, 4):
            uniq = tot = skipped = 0
            for u, vs in sorted(hist.items()):
                pool = [v for v in vs if len(venue_users[v]) >= min_users]
                if len(pool) < k:
                    skipped += 1
                    continue
                for _ in range(draws):
                    tot += 1
                    uniq += support(venue_users, rng.sample(pool, k)) == 1
            row[str(k)] = {"unique_share": share(uniq, tot), "draws": tot, "users_skipped": skipped}
        out[label] = row
    return out


def category_unicity(tgs, per, cats, draws=20, seed=0):
    """The same draw for categories: share of random k-category subsets of a user's shown history that only that
    user's check-ins contain (a user's categories cover all of that user's check-ins)."""
    rng = random.Random(seed)
    user_cats = {u: {(cats.get(it) or {}).get("cat") for _, it in evs} for u, evs in per.items()}
    cat_users = defaultdict(set)
    for u, cs in user_cats.items():
        for c in cs:
            cat_users[c].add(u)
    hist = {}
    for tg in tgs:
        for t in tg:
            hist[t.user] = sorted({(cats.get(i) or {}).get("cat") for i in t.history[-HIST_N:]} - {None})
    out = {}
    for k in (3, 6, 10):
        uniq = tot = 0
        for u, cs in sorted(hist.items()):
            for _ in range(draws):
                pick = rng.sample(cs, min(k, len(cs)))
                tot += 1
                uniq += support(cat_users, pick) == 1
        out[str(k)] = share(uniq, tot)
    return out


def composite_ok(venue_users, venues):
    """The rule for any example shown outside the project: no user's check-ins may contain the whole set of shown venues."""
    return support(venue_users, venues, exact=True) == 0


# The composite shown as Table 1 of Section 1. History: one venue per slot, each from a different user's shown history,
# every venue with 20 or more visitors. Candidates and answer: public venues with 20 or more visitors.
TABLE1_SLOTS = ("Gym / Fitness Center", "Pizza Place", "Pub", "Bar", "Bar", "Whisky Bar")
TABLE1_CANDIDATES = (("Deutsche Bank Center", "Building"), ("IFC Center", "Indie Movie Theater"),
                     ("Barclays Center", "Basketball Stadium"), ("The Village Tavern", "Bar"),
                     ("AMC Kips Bay 15", "Movie Theater"))
TABLE1_ANSWER = "C"
MIN_VISITORS = 20


def composite_example(tgs, venue_users, cats, seed=0):
    """Build the example of Table 1. Each slot of the history takes a venue from a different evaluation user's shown
    history (named, with 20 or more visitors); the draw repeats, with the attempts counted, until no user's check-ins
    contain all six history venues or all eleven venues together."""
    meta = lambda v: ((cats.get(v) or {}).get("name"), (cats.get(v) or {}).get("cat"))
    by_label = defaultdict(list)
    for v in cats:
        if meta(v)[0]:
            by_label[meta(v)].append(v)
    cand_ids = []
    for name, cat in TABLE1_CANDIDATES:
        ids = by_label[(name, cat)]
        assert len(ids) == 1, f"candidate {name!r} is ambiguous or missing"
        cand_ids.append(ids[0])
    hist = {}
    for tg in tgs:
        for t in tg:
            hist[t.user] = sorted(set(t.history[-HIST_N:]))
    rng = random.Random(seed)
    for attempt in range(1, 201):
        used_users, used_venues, picks = set(), set(), []
        for cat in TABLE1_SLOTS:
            options = [(u, v) for u, vs in sorted(hist.items()) if u not in used_users for v in vs
                       if v not in used_venues and meta(v)[1] == cat and meta(v)[0] and len(venue_users[v]) >= MIN_VISITORS]
            if not options:
                break
            u, v = rng.choice(options)
            used_users.add(u)
            used_venues.add(v)
            picks.append(v)
        if len(picks) == len(TABLE1_SLOTS) and composite_ok(venue_users, picks) and composite_ok(venue_users, picks + cand_ids):
            counts = Counter(meta(v)[1] for v in picks)
            return {"seed": seed, "attempts": attempt, "history": [list(meta(v)) for v in picks],
                    "frequent_categories": [c for c, _ in counts.most_common(6)],
                    "candidates": [list(x) for x in TABLE1_CANDIDATES], "answer": TABLE1_ANSWER,
                    "history_venues_from_distinct_users": len(used_users),
                    "users_containing_all_six_history_venues": support(venue_users, picks, exact=True),
                    "users_containing_all_eleven_venues": support(venue_users, picks + cand_ids, exact=True),
                    "fewest_visitors_at_any_venue": min(len(venue_users[v]) for v in picks + cand_ids)}
    raise SystemExit("no composite example found in 200 draws")


def composite_check(tgs, venue_users, example):
    """Known answers in both directions. Every real history of six venues fails the rule, because its owner's check-ins
    contain it; the composite of Table 1 passes."""
    hist = {}
    for tg in tgs:
        for t in tg:
            hist[t.user] = t.history[-6:]
    fail = sum(1 for h in hist.values() if not composite_ok(venue_users, h))
    return {"real_histories_tested": len(hist), "real_histories_failing_the_rule": fail,
            "composite_passes": example["users_containing_all_eleven_venues"] == 0}


# ------------------------------------------------------------------------------------------ training rows
def sft_stats(dev_t, test_t, per):
    rows = [json.loads(line) for line in open(SFT_FILE)]
    users = sorted({r["user"] for r in rows})
    per_user = Counter(r["user"] for r in rows)
    dev_u, test_u = {t.user for t in dev_t}, {t.user for t in test_t}
    true_items = defaultdict(set)
    for t in list(dev_t) + list(test_t):
        true_items[t.user].add(t.true_item)
    collisions = sum(1 for r in rows if r["target_item"] in true_items.get(r["user"], ()))
    # the trainer's own user-level validation split (hpc/sft_shared.py, seed 0, 15% of users, evaluation users kept in train)
    pool = [u for u in users if u not in dev_u]
    random.Random(0).shuffle(pool)
    val = set(pool[: max(1, int(len(users) * 0.15))])
    return {"file_md5": md5(SFT_FILE), "rows": len(rows), "users": len(users), "rows_per_user": q(list(per_user.values())),
            "history_len": q([r["history_len"] for r in rows]),
            "dev_users_in_rows": len(dev_u & set(users)), "test_users_in_rows": len(test_u & set(users)),
            "rows_targeting_an_evaluation_true_venue_of_the_same_user": collisions,
            "trainer_split": {"val_users": len(val), "train_users": len(users) - len(val),
                              "val_rows": sum(per_user[u] for u in val),
                              "train_rows": len(rows) - sum(per_user[u] for u in val),
                              "dev_users_in_val": len(dev_u & val), "test_users_in_val": len(test_u & val)},
            "rows_without_the_300_test_users": len(rows) - sum(per_user[u] for u in test_u),
            "users_without_the_300_test_users": len(users) - len(test_u & set(users))}


def sft_rebuild_check():
    import tempfile
    from proxy.sft_data import build_sft_instances
    inst, meta = build_sft_instances(DATASET, distractors="popmatched")
    with tempfile.NamedTemporaryFile("wb", delete=False) as f:
        for r in inst:
            f.write((json.dumps(r) + "\n").encode())
    rebuilt = md5(f.name)
    os.unlink(f.name)
    assert rebuilt == md5(SFT_FILE), "known-answer check failed for the training rows"
    return {"rebuilt_md5": rebuilt, "identical": True, **{k: meta[k] for k in (
        "n_users", "n_instances", "novel_share_of_walk", "mean_history_len", "n_positions_checked_for_ts_leakage",
        "ts_violations", "n_frozen_eval_users", "n_frozen_eval_users_present_in_train", "eval_true_item_collisions")}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-sft-rebuild", action="store_true")
    args = ap.parse_args()
    stats = {"raw": raw_profile(RAW)}
    per, cats0 = user_tables()
    stats["funnel"] = funnel(per)
    dev_t, test_t, cats, stats["known_answers"] = rebuild_and_check()
    pre_pop = Counter()
    for u, evs in per.items():
        if len(evs) >= MIN_EVENTS:
            for _, it in evs[: int(len(evs) * (1 - TEST_FRAC))]:
                pre_pop[it] += 1
    gen = {str(k): float(v) for k, v in json.load(open(GENERIC))["scores"].items()}
    stats["dev"] = cohort_stats(dev_t, cats, per, pre_pop, gen)
    stats["test"] = cohort_stats(test_t, cats, per, pre_pop, gen)
    vc = venue_period_counts(per)
    stats["dev"]["period"] = period_check(dev_t, per, vc)
    stats["test"]["period"] = period_check(test_t, per, vc)
    vu = venue_index(per)
    example = composite_example([dev_t, test_t], vu, cats)
    stats["privacy"] = {"unicity": unicity([dev_t, test_t], vu), "category_unicity": category_unicity([dev_t, test_t], per, cats),
                        "composite_example": example, "composite": composite_check([dev_t, test_t], vu, example)}
    stats["training_rows"] = sft_stats(dev_t, test_t, per)
    if not args.skip_sft_rebuild:
        stats["training_rows"]["rebuild"] = sft_rebuild_check()
    stats["files"] = {"dev_targets_md5": md5(DEV_FILE), "test_targets_md5": md5(TEST_FILE), "training_rows_md5": md5(SFT_FILE),
                      "raw_md5": stats["raw"]["file_md5"]}
    OUT.write_text(json.dumps(stats, indent=1, default=str))
    print(json.dumps(stats, indent=1, default=str))
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
