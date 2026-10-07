"""Build the delegation-fidelity task and score the trivial baselines.

The task. For each user, sort their decisions chronologically, hold out the last TEST_FRAC as
targets, and present each target as a K-way multiple choice: the venue they actually chose plus
K-1 distractors. A system's delegation fidelity is the fraction of targets it gets right.

The distractor policy is the experiment's most load-bearing choice, so it is explicit and
swappable. `popmatched` is the canonical policy (src/proxy/config.py) and the default: each
distractor is drawn from the true venue's own popularity band, so popularity does not identify the
answer. `textmatched` is the harder policy; it also matches the true venue's genericness.
`popmatched_period` is an optional variant of `popmatched` that also gives every distractor the true
venue's pre-cut period profile (src/proxy/period.py); it is off unless named. `popular` samples
distractors from the city's most-visited venues and `random` from all venues. A purely random draw
from thousands of venues makes the task trivially easy (the true venue is the only plausible one),
and `popular` leaks the answer (the true venue of a new-venue decision is usually obscure, the
distractors are popular by construction); both are kept only as named reference conditions.
Reported numbers are meaningless without naming the policy.

Order. A user's check-ins are ordered by (timestamp, venue id). Two check-ins of one user with the
same timestamp are therefore ordered by venue id, compared as text.

Why the trivial baselines come first. If "the venue this user visited most in their history"
already scores high, the task measures habit lookup, not delegation, and no LLM result on it would
mean anything. These numbers are the floor every later arm must clear.
"""
from __future__ import annotations

import random
from collections import Counter, defaultdict
from dataclasses import dataclass

from proxy.config import CANONICAL
from proxy.datasets import load
from proxy.period import PeriodTables, draw, period_of, row_rng
from proxy.textmatch import load_genericness, matched_pool

TEST_FRAC = 0.2
MIN_EVENTS = 20
K = CANONICAL["k"]


@dataclass
class Target:
    user: str
    true_item: str
    candidates: list[str]
    history: list[str]          # the user's items before this decision, chronological


def build(name, k=K, min_events=MIN_EVENTS, test_frac=TEST_FRAC, seed=CANONICAL["seed"], limit=None,
          distractors=CANONICAL["distractors"], genericness_path=None, fallback_stats=None):
    """All held-out decisions of every eligible user, each with k options. Returns (targets, n_eligible_users).

    distractors: popmatched (the default, canonical), textmatched, popmatched_period, popular or random.
    `genericness_path` is required by `textmatched` and ignored by every other condition.
    `fallback_stats` is a dict that `textmatched` and `popmatched_period` fill in place: "n_rows" decisions
    drawn, "n_fallback" of them that needed a wider window than their own bin, and for `popmatched_period`
    also "n_dropped", the decisions for which no window offers k - 1 distinct options (not returned).
    """
    per = defaultdict(list)
    for e in load(name, limit=limit):
        per[e.user].append((e.ts, e.item))
    # `pop` counts all events, post-cut included. The original `popular` sampler uses it, so
    # changing it would change the targets that mode produces.
    pop = Counter(it for v in per.values() for _, it in v)
    top = [it for it, _ in pop.most_common(2000)]
    # Popularity for the matched sampler is computed over pre-cut events only. Binning by all-events
    # popularity counts the answer's own post-cut visits, so within a bin the true item was
    # systematically less popular pre-cut than its distractors (a "pick the least popular candidate"
    # tell).
    pre_pop = Counter()
    for _u, _evs in per.items():
        if len(_evs) < min_events:
            continue
        _sorted = sorted(_evs)
        for _, _it in _sorted[:int(len(_sorted) * (1 - test_frac))]:
            pre_pop[_it] += 1
    # `popular` distractors leak the answer: a novel true item is typically obscure while the
    # distractors are, by construction, popular, so "pick the least popular candidate" scores far
    # above chance with no person information. `popmatched` draws distractors from the true item's
    # own popularity bin (quantile bins over items) and never from the user's history, so neither
    # popularity nor familiarity identifies the answer.
    NB = 20
    _ranked = sorted(pop, key=lambda it: (pre_pop.get(it, 0), it))      # items never seen pre-cut sit in bin 0
    bin_of = {it: min(NB - 1, i * NB // len(_ranked)) for i, it in enumerate(_ranked)}
    members = defaultdict(list)
    for it, b in bin_of.items():
        members[b].append(it)
    # `textmatched` layers a genericness-bin match on top of the popmatched popularity pool above
    # (never instead of it; the popmatched branch below is unchanged). The bin-intersection and
    # widening logic lives in one shared module (src/proxy/textmatch.py, imported by both this file
    # and sft_data.py) instead of being duplicated, so the two mirrored call sites cannot drift
    # apart. See the module docstring of src/proxy/textmatch.py for the rationale and its
    # self-test (`python3 -m proxy.textmatch`).
    if distractors == "textmatched":
        if not genericness_path:
            raise ValueError("distractors='textmatched' requires genericness_path="
                             "<a JSON table of genericness scores per venue>")
        gen_scores, gen_edges = load_genericness(genericness_path)
        _missing = [it for it in pop if it not in gen_scores]
        if _missing:
            raise ValueError(
                f"genericness table {genericness_path!r} is missing {len(_missing)}/{len(pop)} "
                f"vocabulary items (e.g. {_missing[:3]!r}) -- it must cover this dataset's full "
                f"all-events vocabulary")
        if fallback_stats is None:
            fallback_stats = {}
    if distractors == "popmatched_period":
        period_tables = PeriodTables(name, limit, per, min_events, test_frac)
        if fallback_stats is None:
            fallback_stats = {}
    rng = random.Random(seed)
    targets, n_users = [], 0
    for u, evs in per.items():
        if len(evs) < min_events:
            continue
        evs.sort()
        cut = int(len(evs) * (1 - test_frac))
        hist = [it for _, it in evs[:cut]]
        n_users += 1
        if distractors == "popmatched_period":
            hist_set, n_seen = set(hist), {True: 0, False: 0}      # held-out decisions so far: new venue, revisit
        for ts, true_it in evs[cut:]:
            if distractors == "popmatched":
                hset = set(hist); b = bin_of[true_it]; pool = []; width = 0
                while len(pool) < k - 1 and width <= NB:        # widen to neighbouring bins only if needed
                    lo, hi = max(0, b - width), min(NB - 1, b + width)
                    pool = [x for bb in range(lo, hi + 1) for x in members[bb] if x != true_it and x not in hset]
                    width += 1
                # true items are drawn from events (size-biased toward popular venues); draw distractors the same
                # way, weighted by pre-cut popularity, so the most-popular candidate is not a tell either.
                w = [pre_pop.get(x, 0) + 1 for x in pool]; picked = []
                while len(picked) < k - 1:
                    x = rng.choices(pool, weights=w, k=1)[0]
                    if x not in picked: picked.append(x)
                cands = picked + [true_it]
                rng.shuffle(cands)
                targets.append(Target(u, true_it, cands, hist))
                continue
            elif distractors == "textmatched":
                # Same popularity-bin pool construction as the popmatched branch above, copied
                # verbatim (not refactored into a shared call, so this block can never change what
                # `popmatched` itself does).
                hset = set(hist); b = bin_of[true_it]; pop_pool = []; width = 0
                while len(pop_pool) < k - 1 and width <= NB:
                    lo, hi = max(0, b - width), min(NB - 1, b + width)
                    pop_pool = [x for bb in range(lo, hi + 1) for x in members[bb] if x != true_it and x not in hset]
                    width += 1
                # ... additionally intersected with the true item's genericness bin (widened
                # independently of the popularity pool above; see textmatch.matched_pool).
                pool = matched_pool(pop_pool, true_it, gen_scores, gen_edges, fallback_stats)
                w = [pre_pop.get(x, 0) + 1 for x in pool]; picked = []
                while len(picked) < k - 1:
                    x = rng.choices(pool, weights=w, k=1)[0]
                    if x not in picked: picked.append(x)
                cands = picked + [true_it]
                rng.shuffle(cands)
                targets.append(Target(u, true_it, cands, hist))
                continue
            elif distractors == "popmatched_period":
                # One generator per decision (src/proxy/period.py); the pool is the popmatched pool restricted
                # to venues with the true venue's pre-cut period profile that are active in the decision's period.
                novel = true_it not in hist_set
                cands, width = draw(period_tables, true_it, hist_set, period_of(ts), bin_of, members, pre_pop, NB, k,
                                    row_rng(name, seed, u, n_seen[novel], novel))
                n_seen[novel] += 1
                fallback_stats["n_rows"] = fallback_stats.get("n_rows", 0) + 1
                if cands is None:
                    fallback_stats["n_dropped"] = fallback_stats.get("n_dropped", 0) + 1
                    continue
                if width:
                    fallback_stats["n_fallback"] = fallback_stats.get("n_fallback", 0) + 1
                targets.append(Target(u, true_it, cands, hist))
                continue
            else:
                pool = [x for x in (top if distractors == "popular" else list(pop))
                        if x != true_it]
            if len(pool) < k - 1:
                continue
            cands = rng.sample(pool, k - 1) + [true_it]
            rng.shuffle(cands)
            targets.append(Target(u, true_it, cands, hist))
    return targets, n_users


def baselines(targets, pop_rank):
    """random | population-popularity | personal-history-frequency | personal-most-recent."""
    hit = Counter(); n = len(targets)
    for t in targets:
        # population: the candidate most popular overall
        pick = max(t.candidates, key=lambda c: pop_rank.get(c, 0))
        hit["population"] += (pick == t.true_item)
        # personal frequency: the candidate this user visited most
        hc = Counter(t.history)
        best = max(t.candidates, key=lambda c: hc.get(c, 0))
        hit["personal_freq"] += (best == t.true_item and hc.get(best, 0) > 0)
        # personal recency: the most recently visited candidate
        last = {it: i for i, it in enumerate(t.history)}
        rec = max(t.candidates, key=lambda c: last.get(c, -1))
        hit["personal_recent"] += (rec == t.true_item and last.get(rec, -1) >= 0)
        # coverage: is the true item even in the user's history?
        hit["true_in_history"] += (t.true_item in last)
    out = {kk: v / n for kk, v in hit.items()}
    out["random"] = 1.0 / len(targets[0].candidates)
    out["n_targets"] = n
    return out


if __name__ == "__main__":
    import sys
    name = sys.argv[1] if len(sys.argv) > 1 else CANONICAL["dataset"]
    lim = int(sys.argv[2]) if len(sys.argv) > 2 else None
    policy = CANONICAL["distractors"]
    tg, nu = build(name, limit=lim, distractors=policy)
    pop = Counter()
    for t in tg:
        pop[t.true_item] += 1
    b = baselines(tg, pop)
    print(f"\n{name}: {nu:,} eligible users, {b['n_targets']:,} held-out decisions, K={K}, "
          f"distractors={policy}")
    print(f"  {'random':22} {b['random']:.3f}")
    for kk in ("population", "personal_freq", "personal_recent"):
        print(f"  {kk:22} {b[kk]:.3f}")
    print(f"  {'true item in history':22} {b['true_in_history']:.3f}   <- ceiling for any "
          f"history-lookup method; targets above this need generalisation, not recall")
