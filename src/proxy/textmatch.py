"""Genericness-bin distractor-pool logic for the `textmatched` distractor mode (task.py's build()
and sft_data.py's build_sft_instances()).

Why this exists. `popmatched` matches distractors to the true item's pre-cut popularity bin only.
That closes the popularity tell but leaves a text one: true novel items read as more specific or
unusual than their popularity-matched distractors, so "pick the candidate whose text is least
similar to a neutral query" beats chance (0.20 for K=5) with no person information. `textmatched`
additionally requires each candidate to come from the true item's own genericness bin, on top of
(never instead of) the popularity bin. An item's genericness is the BLaIR CLS-cosine between the
item's label and the fixed neutral query "a place someone visits". It is computed once per item
and read here from a table (see load_genericness).

One shared helper, not a copy per call site. A distractor-mode argument that is silently dropped
at one of two mirrored call sites makes one result set use the wrong policy without any error. The
genericness-bin pool logic below is therefore defined once here and imported, unchanged, by both
task.py's `textmatched` branch and sft_data.py's `textmatched` branch. This module's own self-test
(`python3 -m proxy.textmatch`) catches a regression in that one definition, instead of relying on
two call sites to stay in sync by hand.

`matched_pool` takes the popularity-bin pool as an argument (`pop_pool`) instead of recomputing
it. The popularity widening loop is copied verbatim at each call site (task.py's `popmatched`
branch is never touched), so a bug in this module can never change popmatched's popularity
semantics, and a bug in the popularity loop can never hide inside this module.
"""
from __future__ import annotations

import json
import statistics
from bisect import bisect_right

N_BINS = 5     # quintiles of the genericness-score distribution over the full item vocabulary


def load_genericness(path):
    """Load the {item_id: genericness_score} table (a JSON object: either the bare mapping or
    {"scores": {...}, ...other metadata}) and compute its N_BINS quantile bin edges.
    Returns (scores, edges):
      scores: {item_id: float}, every item in the table, coerced to float.
      edges:  list of N_BINS - 1 cut points from statistics.quantiles(sorted scores, n=N_BINS,
              method="inclusive"). Like task.py's popularity binning, the bins are quantiles of
              the full distribution, not fixed score thresholds, and they are computed over every
              item in the table (the full vocabulary), not just items that happen to appear as
              candidates somewhere.
    Raises if the table has fewer than N_BINS items; quantiles are meaningless below that."""
    with open(path) as f:
        raw = json.load(f)
    table = raw["scores"] if isinstance(raw, dict) and "scores" in raw else raw
    scores = {str(k): float(v) for k, v in table.items()}
    if len(scores) < N_BINS:
        raise ValueError(f"genericness table at {path!r} has only {len(scores)} items, need >= "
                         f"{N_BINS} to form {N_BINS} quantile bins")
    edges = statistics.quantiles(sorted(scores.values()), n=N_BINS, method="inclusive")
    return scores, edges


def bin_of(score, edges):
    """Quantile bin index in [0, N_BINS - 1]. bisect_right(edges, score) already returns a value in
    [0, len(edges)] = [0, N_BINS - 1] for well-formed edges (N_BINS - 1 cut points); the min() is a
    defensive clamp only, mirroring task.py's own bin_of dict-builder's `min(NB - 1, ...)` style."""
    return min(bisect_right(edges, score), N_BINS - 1)


def matched_pool(pop_pool, true_item, scores, edges, fallback_stats):
    """Intersect `pop_pool` (the caller's already-computed, popularity-bin-widened candidate pool,
    never recomputed here) with the true item's genericness bin, widening the genericness window
    by +-1 per pass (clipped to [0, N_BINS - 1]) until at least 4 candidates remain (k - 1 for this
    project's fixed K=5). Order is preserved from `pop_pool` at every pass (a plain list
    comprehension over `pop_pool`, never a set-to-list conversion) so the result is reproducible
    regardless of string hash randomisation. A downstream `rng.choices(pool, ...)` over this
    return value is therefore deterministic across processes for the same seed, which a set-based
    pool would not guarantee (Python randomises str hashing per process by default).

    `fallback_stats` is a dict mutated in place (never replaced): every call increments
    "n_rows"; a call that needed more than the exact bin alone (width 0, the first pass) also
    increments "n_fallback". The caller reads the same dict object back; this function has no return value
    for these counts, matching the project's "counts accumulate in a dict handed to you" idiom
    (for example the `meta` of sft_data.build_sft_instances).

    Guaranteed to terminate with len(pool) == len(pop_pool) by the final pass at the latest: at
    passes == N_BINS - 1 the window [b - passes, b + passes] clipped to [0, N_BINS - 1] already
    covers the entire bin range for any b, so the intersection becomes all of `pop_pool`. The
    caller's own popularity-widening loop already guarantees that has >= 4 members (mirroring
    task.py's popmatched invariant), so this never loops forever or returns a too-small pool."""
    fallback_stats["n_rows"] = fallback_stats.get("n_rows", 0) + 1
    b = bin_of(scores[true_item], edges)
    pool, passes = [], 0
    while len(pool) < 4 and passes <= N_BINS - 1:
        lo, hi = max(0, b - passes), min(N_BINS - 1, b + passes)
        pool = [x for x in pop_pool if lo <= bin_of(scores[x], edges) <= hi]
        passes += 1
    if passes > 1:                 # the exact bin (width 0, the first pass) alone was not enough
        fallback_stats["n_fallback"] = fallback_stats.get("n_fallback", 0) + 1
    return pool


# ============================================================================ self-test
# `python3 -m proxy.textmatch` (PYTHONPATH=src), or `python3 src/proxy/textmatch.py` from the repo
# root. Synthetic vocabulary only; it never touches the real dataset or a real genericness table.
if __name__ == "__main__":
    import os
    import random
    import sys
    import tempfile

    failures = []

    def check(name, cond, detail=""):
        status = "PASS" if cond else "FAIL"
        print(f"  [{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name)

    print("=== proxy.textmatch self-test ===")

    # ---- 1) bin edges + bin_of, against a synthetic vocabulary with a known quantile split ----
    # 25 items, scores 0..24 (uniform): statistics.quantiles(n=5, method="inclusive") on a uniform
    # integer run splits it into 5 equal-ish groups of 5. The expectation is taken from the stdlib
    # directly, not from a hand-derived value, so this test cannot silently drift from what
    # load_genericness actually calls.
    synth_scores = {f"item{i}": float(i) for i in range(25)}
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "synthetic_genericness.json")
        with open(p, "w") as f:
            json.dump({"scores": synth_scores}, f)
        scores, edges = load_genericness(p)

    expected_edges = statistics.quantiles(sorted(synth_scores.values()), n=N_BINS, method="inclusive")
    check("load_genericness reproduces statistics.quantiles(n=5, method='inclusive')",
          edges == expected_edges, f"edges={edges} expected={expected_edges}")
    check("load_genericness recovers every score", scores == synth_scores)
    check("edges has N_BINS - 1 = 4 cut points", len(edges) == N_BINS - 1, f"got {len(edges)}")

    bins = [bin_of(s, edges) for s in range(25)]
    check("bin_of is non-decreasing over sorted scores", bins == sorted(bins), f"bins={bins}")
    check("bin_of stays within [0, N_BINS - 1]", all(0 <= b <= N_BINS - 1 for b in bins),
          f"bins={bins}")
    check("all N_BINS bins are populated on a 25-item uniform run",
          len(set(bins)) == N_BINS, f"bins={bins}")

    # ---- 2) the intersection: exact bin alone is already enough ----
    fb = {}
    # item10..item14 all share bin_of(10..14); pop_pool restricted to that bin plus noise from
    # elsewhere. matched_pool at width 0 should recover exactly the in-bin members, in pop_pool's
    # own order (never resorted).
    true_item = "item12"
    true_bin = bin_of(synth_scores[true_item], edges)
    same_bin_items = [it for it in synth_scores if bin_of(synth_scores[it], edges) == true_bin
                      and it != true_item]
    check("synthetic setup has >= 4 same-bin decoys to test the no-widen path",
          len(same_bin_items) >= 4, f"same_bin_items={same_bin_items}")
    pop_pool = same_bin_items + ["item0", "item24"]     # + two far-away decoys from other bins
    pool = matched_pool(pop_pool, true_item, synth_scores, edges, fb)
    check("exact-bin intersection excludes items from other genericness bins",
          set(pool) == set(same_bin_items), f"pool={pool} expected(unordered)={same_bin_items}")
    check("exact-bin intersection preserves pop_pool's original order",
          pool == [x for x in pop_pool if x in same_bin_items], f"pool={pool}")
    check("no widening needed -> not counted as fallback", fb.get("n_fallback", 0) == 0, str(fb))
    check("n_rows incremented exactly once", fb.get("n_rows") == 1, str(fb))

    # ---- 3) the widening: an exact bin with only 2 items must widen to +-1 and count as fallback ----
    # Build a pool where the true item's own bin contributes only 2 members of pop_pool (< 4), so
    # matched_pool must widen by one pass (+-1 bin) to clear the >= 4 threshold, and that widened
    # pass must be marked as a fallback row. The bin must be a middle bin (not 0 or N_BINS - 1): at
    # an edge bin, "+-1" clips back onto the same bin (e.g. max(0, 0 - 1) == 0), which would
    # silently fold the "adjacent" decoys into the exact bin instead of genuinely testing the widen
    # path.
    sparse_bin = N_BINS // 2
    sparse_true = next(it for it in synth_scores if bin_of(synth_scores[it], edges) == sparse_bin)
    in_bin = [it for it in synth_scores if bin_of(synth_scores[it], edges) == sparse_bin
              and it != sparse_true]
    pop_pool_sparse = in_bin[:2] + [it for it in synth_scores
                                     if bin_of(synth_scores[it], edges) in
                                     (max(0, sparse_bin - 1), min(N_BINS - 1, sparse_bin + 1))
                                     and it not in in_bin[:2] and it != sparse_true][:3]
    fb2 = {}
    pool2 = matched_pool(pop_pool_sparse, sparse_true, synth_scores, edges, fb2)
    check("sparse setup starts with exactly 2 exact-bin candidates in pop_pool",
          len(in_bin[:2]) == 2)
    check("widened pool has >= 4 candidates", len(pool2) >= 4, f"pool2={pool2}")
    check("widening to +-1 is counted as a fallback row", fb2.get("n_fallback", 0) == 1, str(fb2))
    check("n_rows still incremented exactly once for this one call", fb2.get("n_rows") == 1, str(fb2))
    lo_w, hi_w = max(0, sparse_bin - 1), min(N_BINS - 1, sparse_bin + 1)
    check("widened pool only contains items within +-1 of the true item's bin",
          all(lo_w <= bin_of(synth_scores[x], edges) <= hi_w for x in pool2), f"pool2={pool2}")

    # ---- 4) fallback_stats accumulates across multiple calls (one dict, sequential use) ----
    fb3 = {}
    matched_pool(pop_pool, true_item, synth_scores, edges, fb3)          # no widen
    matched_pool(pop_pool_sparse, sparse_true, synth_scores, edges, fb3)  # widens
    check("fallback_stats accumulates over sequential calls (n_rows=2, n_fallback=1)",
          fb3.get("n_rows") == 2 and fb3.get("n_fallback") == 1, str(fb3))

    # ---- 5) determinism: same inputs -> byte-identical outputs, across repeated calls and across
    # a downstream seeded rng.choices sampler (the actual consumer in task.py / sft_data.py) ----
    fb_a, fb_b = {}, {}
    pool_a = matched_pool(pop_pool_sparse, sparse_true, synth_scores, edges, fb_a)
    pool_b = matched_pool(pop_pool_sparse, sparse_true, synth_scores, edges, fb_b)
    check("matched_pool is deterministic across repeated calls with identical inputs",
          pool_a == pool_b and fb_a == fb_b, f"{pool_a} vs {pool_b}; {fb_a} vs {fb_b}")

    def _sample_like_task_build(pool, weights, seed):
        rng = random.Random(seed)
        picked = []
        while len(picked) < 4:
            x = rng.choices(pool, weights=weights, k=1)[0]
            if x not in picked:
                picked.append(x)
        return picked

    weights = [1] * len(pool_a)
    picks_1 = _sample_like_task_build(pool_a, weights, seed=0)
    picks_2 = _sample_like_task_build(pool_b, weights, seed=0)
    check("a downstream random.Random(seed) sampler over matched_pool's output is reproducible "
          "across two independent pool-construction + sampling runs",
          picks_1 == picks_2, f"{picks_1} vs {picks_2}")

    print(f"\n{len(failures)} failure(s)." if failures else "\nALL CHECKS PASSED.")
    sys.exit(1 if failures else 0)
