"""Period-matched distractors: the `popmatched_period` condition of task.build().

Massive-STEPS New York holds two collection periods, 2012-13 and 2017-18, of very different size. A venue visited in only one
period gives itself away on a question from the other, so a distractor drawn from the whole release can be ruled out by its
period alone. `popmatched` matches the popularity of the options, not their periods, so a rule that prefers venues active in
the question's period beats chance on 2017-18 questions with no information about the person.

`popmatched_period` removes that cue for every decision. Its pool is the popmatched pool (the true venue's own popularity band,
widened to neighbouring bands only when too few venues qualify, never the user's history, never the true venue) restricted to
venues that
  1. have the same pre-cut period profile as the true venue, and
  2. have at least one check-in in the period of the decision, anywhere in the release.
The pre-cut period profile of a venue is the set of periods in which an eligible user (one the task keeps) checked in there
before their cut: 2012-13 only, 2017-18 only, both, or neither. The restriction is never relaxed. A decision for which no
popularity window offers k - 1 venues with distinct labels is dropped and counted in `fallback_stats`, never filled from
another profile.

Draws are weighted by pre-cut popularity + 1, as in popmatched. Every decision has its own generator, seeded by (dataset, seed,
user, position of the decision among that user's held-out decisions of the same kind, new venue or revisit), so a row does not
depend on any other row. A draw whose rendered label equals the true venue's, or one already drawn, is skipped, so a question
never shows two identical options.
"""
from __future__ import annotations

import random
from collections import defaultdict

from proxy.datasets import load

SPLIT_YEAR = 2017      # check-ins before this year belong to 2012-13, the others to 2017-18


def period_of(ts):
    """0 for a check-in of 2012-13, 1 for one of 2017-18."""
    return int(ts.year >= SPLIT_YEAR)


class PeriodTables:
    """Per venue: the pre-cut period profile, whether it has a check-in in each period, and its rendered label.

    `per` is task.build's {user: [(ts, item), ...]} over the same events (and the same `limit`) as `name`."""

    def __init__(self, name, limit, per, min_events, test_frac):
        from proxy.arms import _label      # imported here: arms imports task, and task imports this module
        meta = {}
        for e in load(name, limit=limit):
            if e.cat or e.name:
                meta[e.item] = {"cat": e.cat, "name": e.name}
        seen, pre = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
        for evs in per.values():
            for ts, it in evs:
                seen[it][period_of(ts)] += 1
            if len(evs) < min_events:
                continue
            ordered = sorted(evs)
            for ts, it in ordered[:int(len(ordered) * (1 - test_frac))]:
                pre[it][period_of(ts)] += 1
        self.profile = {it: (pre[it][0] > 0, pre[it][1] > 0) for it in seen}
        self.active = {it: (c[0] > 0, c[1] > 0) for it, c in seen.items()}
        self.label = {it: _label(meta, it) for it in seen}


def row_rng(name, seed, user, j, novel=True):
    """The generator of one decision: `j` is its position among the user's held-out decisions of the same kind."""
    return random.Random(f"popmatched_period|{name}|{seed}|{user}|{j}" + ("" if novel else "|revisit"))


def draw(tables, true_item, hist_set, period, bin_of, members, pre_pop, n_bins, k, rng):
    """The k options (the true venue and k - 1 distractors) in random order, and the half-width of the popularity window used
    (0 is the true venue's own band). Returns (None, None) when no window offers k - 1 distinct labels."""
    profile, label = tables.profile[true_item], tables.label
    true_label = label[true_item]
    b, width = bin_of[true_item], 0
    while True:
        lo, hi = max(0, b - width), min(n_bins - 1, b + width)
        pool = [x for bb in range(lo, hi + 1) for x in members[bb]
                if x != true_item and x not in hist_set and tables.profile[x] == profile and tables.active[x][period]]
        if len({label[x] for x in pool} - {true_label}) >= k - 1:
            break
        if width >= n_bins:
            return None, None
        width += 1
    weights = [pre_pop.get(x, 0) + 1 for x in pool]
    picked, seen = [], {true_label}
    while len(picked) < k - 1:
        x = rng.choices(pool, weights=weights, k=1)[0]
        if x not in picked and label[x] not in seen:
            picked.append(x)
            seen.add(label[x])
    options = picked + [true_item]
    rng.shuffle(options)
    return options, width
