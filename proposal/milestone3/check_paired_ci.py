#!/usr/bin/env python3
"""Independent check of the paired comparison behind criterion C2 (Milestone 3, Section 2.2, requirement R8).

C2 compares the fine-tuned model (A) with the strongest history-free baseline (H) and with the same model given
another user's history (S). It holds when the lower bound of the paired 95% interval is above zero in both
comparisons. The unit of the interval is the user: decisions of one user are repeated measures, not independent users.

This script takes a hand-built example of six users with 2 to 30 decisions each and computes the comparison twice.
  1. By hand, with no project code and no random numbers: per-user accuracy differences, then the exact bootstrap
     over users (all 6**6 = 46,656 equally likely resamples), then the decision rule.
  2. With the project's own functions, paired_user_deltas and bootstrap_delta_ci, loaded from
     src/proxy/paired_stats.py (see PROXY_CHECKER below).
It also runs the wrong calculation (resampling decisions as if each were a user) to show what the check guards
against, and two fixtures with known answers (identical approaches, and a planted effect).
The script stops with exit status 1 if the hand calculation and the project's function disagree.

    cd <proxy project root>
    python proposal/milestone3/check_paired_ci.py

PROXY_ROOT and PROXY_CHECKER override the project root and the path of the module with those two functions.
"""
from __future__ import annotations

import importlib.util
import itertools
import math
import os
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("PROXY_ROOT", HERE.parents[1]))
CHECKER = Path(os.environ.get("PROXY_CHECKER", ROOT / "src" / "proxy" / "paired_stats.py"))

# One string per user and approach, one character per decision: 1 = the approach picked the recorded venue.
# A = fine-tuned model, H = strongest history-free baseline, S = fine-tuned model with another user's history.
EXAMPLE = {
    "u1": {"A": "01", "H": "01", "S": "11"},
    "u2": {"A": "111", "H": "000", "S": "010"},
    "u3": {"A": "111", "H": "010", "S": "110"},
    "u4": {"A": "0111", "H": "0000", "S": "1001"},
    "u5": {"A": "00000", "H": "00000", "S": "00000"},
    "u6": {"A": "110111111100110101100000011011", "H": "000010000000001000010000000000",
           "S": "100000110000000000111000000000"},
}
HITS = {"A": [1, 3, 3, 3, 0, 18], "H": [1, 0, 1, 0, 0, 3], "S": [2, 1, 2, 2, 0, 6]}   # written out to catch typos
LEVEL = 0.95


# ---------------------------------------------------------------------------------- by hand
def acc(s):
    return s.count("1") / len(s)


def user_deltas(data, x, y):
    """Per-user accuracy of x minus per-user accuracy of y, one number per user."""
    return {u: acc(v[x]) - acc(v[y]) for u, v in data.items()}


def pooled_diff(data, x, y):
    """Decision-weighted difference: what pooled accuracy shows, and what a heavy user dominates."""
    n = sum(len(v[x]) for v in data.values())
    return (sum(v[x].count("1") for v in data.values()) - sum(v[y].count("1") for v in data.values())) / n


def exact_user_bootstrap(deltas, level=LEVEL):
    """Exact percentile interval of the mean of resampled users: every one of the n**n resamples has the same
    probability, so the interval needs no random numbers. Bounds are the values at ranks ceil(a*N) and ceil((1-a)*N)."""
    n = len(deltas)
    means = sorted(sum(c) / n for c in itertools.product(deltas, repeat=n))
    a = (1 - level) / 2
    return means[math.ceil(a * len(means)) - 1], means[math.ceil((1 - a) * len(means)) - 1]


def decision_bootstrap(data, x, y, draws=20000, seed=0, level=LEVEL):
    """The wrong unit: every decision is resampled as if it were a user. Shown only to expose the difference."""
    d = [int(a) - int(b) for v in data.values() for a, b in zip(v[x], v[y])]
    rng = random.Random(seed)
    m = sorted(sum(d[rng.randrange(len(d))] for _ in d) / len(d) for _ in range(draws))
    a = (1 - level) / 2
    return m[int(a * draws)], m[int((1 - a) * draws) - 1]


# ---------------------------------------------------------------------------------- the project's function
def load_project():
    spec = importlib.util.spec_from_file_location("proxy_checker", CHECKER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def picks(data, x):
    """The project's record format. The recorded venue is option 0, so a hit is a pick of 0."""
    return [{"user": u, "pick": 0 if c == "1" else 1, "answer_idx": 0} for u, v in data.items() for c in v[x]]


def project_ci(mod, data, x, y, n_boot):
    deltas, users = mod.paired_user_deltas(picks(data, x), picks(data, y))
    return dict(zip(users, deltas.tolist())), mod.bootstrap_delta_ci(deltas, seed=0, n_boot=n_boot)


# ---------------------------------------------------------------------------------- the check
def compare(mod, data, x, y):
    hand = user_deltas(data, x, y)
    lo, hi = exact_user_bootstrap(list(hand.values()))
    proj_d, (plo, phi) = project_ci(mod, data, x, y, n_boot=200_000)    # many draws: the algorithm must match the exact one
    _, (dlo, dhi) = project_ci(mod, data, x, y, n_boot=4000)            # the checker's own setting: the decision must match
    wlo, whi = decision_bootstrap(data, x, y)
    return {"pair": f"{x} minus {y}", "per_user": hand, "user_mean": sum(hand.values()) / len(hand),
            "pooled": pooled_diff(data, x, y), "exact": (lo, hi), "project_200k": (plo, phi), "project_4000": (dlo, dhi),
            "decision_level": (wlo, whi), "deltas_agree": all(abs(hand[u] - proj_d[u]) < 1e-12 for u in hand),
            "bounds_agree": abs(lo - plo) <= 0.005 and abs(hi - phi) <= 0.005,
            "decision_exact": lo > 0, "decision_project": dlo > 0, "decision_decisions_as_users": wlo > 0}


def run():
    for k in "AHS":
        assert [v[k].count("1") for v in EXAMPLE.values()] == HITS[k], f"hits of {k} do not match the table"
    mod = load_project()
    res = {"AH": compare(mod, EXAMPLE, "A", "H"), "AS": compare(mod, EXAMPLE, "A", "S"),
           "decisions": {u: len(v["A"]) for u, v in EXAMPLE.items()}, "hits": HITS}
    res["C2_met"] = res["AH"]["decision_exact"] and res["AS"]["decision_exact"]
    # fixtures with known answers, in both directions
    same = {u: {"A": v["A"], "H": v["A"]} for u, v in EXAMPLE.items()}
    planted = {u: {"A": "1" * len(v["A"]), "H": "0" * len(v["A"])} for u, v in EXAMPLE.items()}
    res["fixture_identical"] = compare(mod, same, "A", "H")
    res["fixture_planted"] = compare(mod, planted, "A", "H")
    res["fixtures_ok"] = (res["fixture_identical"]["exact"] == (0.0, 0.0) and not res["fixture_identical"]["decision_exact"]
                          and res["fixture_planted"]["exact"] == (1.0, 1.0) and res["fixture_planted"]["decision_exact"]
                          and res["fixture_identical"]["bounds_agree"] and res["fixture_planted"]["bounds_agree"])
    res["agree"] = all(res[k][f] for k in ("AH", "AS") for f in ("deltas_agree", "bounds_agree")) \
        and all(res[k]["decision_exact"] == res[k]["decision_project"] for k in ("AH", "AS")) and res["fixtures_ok"]
    # the wrong unit must disagree with the right one for A minus S (that is the mistake the check exposes)
    res["wrong_unit_exposed"] = res["AS"]["decision_decisions_as_users"] != res["AS"]["decision_exact"]
    return res


def main():
    r = run()
    print("user  decisions   hits A/H/S   accuracy A / H / S        A-H     A-S")
    for i, (u, n) in enumerate(r["decisions"].items()):
        print(f"{u}  {n:9d}   {r['hits']['A'][i]:2d}/{r['hits']['H'][i]:2d}/{r['hits']['S'][i]:2d}      "
              f"{acc(EXAMPLE[u]['A']):.3f} / {acc(EXAMPLE[u]['H']):.3f} / {acc(EXAMPLE[u]['S']):.3f}   "
              f"{r['AH']['per_user'][u]:+.3f}  {r['AS']['per_user'][u]:+.3f}")
    for k in ("AH", "AS"):
        c = r[k]
        print(f"\n{c['pair']}: mean of per-user differences {c['user_mean']:+.4f}; pooled over decisions {c['pooled']:+.4f}")
        print(f"  exact user bootstrap       [{c['exact'][0]:+.4f}, {c['exact'][1]:+.4f}]   lower bound above 0: {c['decision_exact']}")
        print(f"  project, 200,000 draws     [{c['project_200k'][0]:+.4f}, {c['project_200k'][1]:+.4f}]   per-user deltas equal: {c['deltas_agree']}, bounds within 0.005: {c['bounds_agree']}")
        print(f"  project, 4,000 draws       [{c['project_4000'][0]:+.4f}, {c['project_4000'][1]:+.4f}]   lower bound above 0: {c['decision_project']}")
        print(f"  decisions as users (wrong) [{c['decision_level'][0]:+.4f}, {c['decision_level'][1]:+.4f}]   lower bound above 0: {c['decision_decisions_as_users']}")
    print(f"\nfixtures (identical approaches, planted effect) behave as known: {r['fixtures_ok']}")
    print(f"hand calculation and project function agree: {r['agree']}")
    print(f"resampling decisions changes the A minus S decision (the mistake this check exposes): {r['wrong_unit_exposed']}")
    print(f"C2 met on this example: {r['C2_met']}")
    return 0 if r["agree"] and r["wrong_unit_exposed"] else 1


if __name__ == "__main__":
    sys.exit(main())
