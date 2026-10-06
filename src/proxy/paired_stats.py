"""Paired per-user accuracy differences and their bootstrap interval.

Every comparison in the project pairs two systems on the same users: each user's accuracy under system A minus their accuracy
under system B, averaged over users, with a 95% interval from resampling users (4,000 draws, seed 0). Resampling users rather
than decisions keeps each person's decisions together, so the interval reflects the number of people, not the number of rows.
"""
from collections import defaultdict

import numpy as np


def per_user_correct(picks, pick_field="pick", answer_field="answer_idx"):
    by_user = defaultdict(list)
    for r in picks:
        by_user[r["user"]].append(1.0 if r[pick_field] == r[answer_field] else 0.0)
    return by_user


def paired_user_deltas(picks_a, picks_b, pick_field="pick", answer_field="answer_idx"):
    by_a = per_user_correct(picks_a, pick_field, answer_field)
    by_b = per_user_correct(picks_b, pick_field, answer_field)
    users = sorted(set(by_a) & set(by_b))
    if not users:
        raise ValueError("no overlapping users between file_a and file_b")
    deltas = np.array([np.mean(by_a[u]) - np.mean(by_b[u]) for u in users])
    return deltas, users


def bootstrap_delta_ci(deltas, seed=0, n_boot=4000):
    rng = np.random.default_rng(seed)
    n = len(deltas)
    boots = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, n, n)
        boots[i] = deltas[idx].mean()
    return float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))
