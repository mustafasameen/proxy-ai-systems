"""Ranking metrics, the non-model baselines, and a per-user bootstrap for the first model exploration.

Every score is computed on the same decisions, so runs are paired. The model scores each question as five letter
log-probabilities (index 0 is option A). Ranks are counted as 1 + the number of options with a strictly higher log-probability.
"""
from __future__ import annotations

import math
import random
from collections import Counter, defaultdict

import numpy as np

from proxy.config import CANONICAL
from proxy.datasets import load
from proxy.task import MIN_EVENTS, TEST_FRAC

# The 300 users of the held-out test sample come from this seed. Development code never draws with it.
TEST_SEED = 20260920


def probs(logprobs):
    """Softmax over the five letter log-probabilities."""
    x = np.asarray(logprobs, dtype=float)
    e = np.exp(x - x.max())
    return e / e.sum()


def rank_of(logprobs, answer_idx):
    """Rank of the right option, 1 is best."""
    lp = list(logprobs)
    return 1 + sum(1 for v in lp if v > lp[answer_idx])


def top1(rows):
    """Share of rows whose predicted index is the answer. Rows are dicts with `pick` and `answer_idx`."""
    return sum(1 for r in rows if r["pick"] == r["answer_idx"]) / len(rows)


def acc_at(rows, k):
    return sum(1 for r in rows if rank_of(r["logprobs"], r["answer_idx"]) <= k) / len(rows)


def mrr(rows):
    return sum(1.0 / rank_of(r["logprobs"], r["answer_idx"]) for r in rows) / len(rows)


def per_user_accuracy(rows):
    """{user: share of that user's rows answered correctly}."""
    hits, n = Counter(), Counter()
    for r in rows:
        n[r["user"]] += 1
        hits[r["user"]] += r["pick"] == r["answer_idx"]
    return {u: hits[u] / n[u] for u in n}


def pooled_accuracy_ci(rows, n_boot=4000, seed=0):
    """Pooled accuracy and a 95% interval from resampling users (all of a user's rows move together), the same 4,000 draws
    and seed 0 as src/proxy/paired_stats.py. Returns (accuracy, low, high)."""
    hits, n = defaultdict(int), defaultdict(int)
    for r in rows:
        n[r["user"]] += 1
        hits[r["user"]] += r["pick"] == r["answer_idx"]
    users = sorted(n)
    h = np.array([hits[u] for u in users], dtype=float)
    m = np.array([n[u] for u in users], dtype=float)
    rng = np.random.default_rng(seed)
    boots = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, len(users), len(users))
        boots[i] = h[idx].sum() / m[idx].sum()
    return float(h.sum() / m.sum()), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))


def sign_test_p(b, c):
    """Two-sided exact sign test on b and c discordant questions (right only in run A, right only in run B)."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


# ---- rules that use no model ----

def nearest_rule_pick(dists):
    """Index of the option closest to the history. An option without a distance ranks last. Ties go to the earlier letter."""
    key = [math.inf if d is None else d for d in dists]
    return key.index(min(key))


def popularity_pick(counts):
    """Index of the option with the most earlier check-ins (ties go to the earlier letter)."""
    return counts.index(max(counts))


def random_picks(n, k=CANONICAL["k"], seed=0):
    rng = random.Random(seed)
    return [rng.randrange(k) for _ in range(n)]


def pre_cut_popularity(name=CANONICAL["dataset"], min_events=MIN_EVENTS, test_frac=TEST_FRAC):
    """Check-ins per venue made before each kept user's split. This is the popularity that sorts venues into the bands used
    to draw decoys (src/proxy/task.py), so it is the popularity a decoy was matched on."""
    per = defaultdict(list)
    for e in load(name):
        per[e.user].append((e.ts, e.item))
    pop = Counter()
    for evs in per.values():
        if len(evs) < min_events:
            continue
        evs = sorted(evs)
        for _, it in evs[:int(len(evs) * (1 - test_frac))]:
            pop[it] += 1
    return pop
