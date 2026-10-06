"""SFT training instances for the shared-LoRA arm (delegation fidelity, novel-venue subset).

Hypothesis this arm tests: "supervised adaptation on the person's own past choices suffices". One
LoRA is trained on every eligible user's pre-cut decisions (not one per user; that is a separate
arm) and scored against the frozen novel-venue targets.

Nothing here loads or calls an LLM. This module is plain Python on CPU, and its output is a jsonl
of (prompt, completion) rows for a separate training step (hpc/sft_shared.py).

What an instance is. For each eligible user (task.py's own rule: >= MIN_EVENTS events), walk their
pre-cut sequence (the same chronological prefix task.build holds out from, never their held-out
test suffix) and, at each position i, treat item i as a candidate SFT target with history = the
items strictly before it in that same pre-cut prefix. An instance is kept only when that target is
novel relative to its own history (true_item not in history), which is the definition
arms.novel_targets uses for the frozen evaluation set, so the training distribution matches what
is scored. Distractors are drawn from `top`, the same list of the 2000 most popular items over all
events that task.build computes. Popularity there is computed over the full timeline, including
other users' events and this user's own post-cut events. That look-ahead is shared by every arm
(prompted, seqrec, this one) for format parity; changing it here would make this arm's distractor
difficulty incomparable to the others, so it is kept as is.

Prompt format parity. Instances are rendered with arms.render_prompt / arms._label, the helper the
frozen evaluation prompts are rendered with, via a task.Target built from (user, target item,
candidates, history). The completion is " " + the answer letter, matching the convention of
arms.sft_examples (the per-user SFT arm), so both SFT arms share one completion format.

Leakage guards (asserted, not just documented):
  1. This module's own eligibility and pre-cut slicing is cross-checked, per user, against
     seqrec._eligible_sequences (the reference mirror of task.py's split). A divergence means this
     module's slicing logic disagrees with the trusted one.
  2. Every kept instance's target timestamp, and every timestamp in its history, is asserted to be
     strictly before that user's cut timestamp (the ts of their first held-out/test event).
  3. For the 300 frozen evaluation users, every kept training instance's target item is asserted
     not to be that user's frozen evaluation true_item. It structurally cannot be (the evaluation
     true_item is by definition absent from the user's pre-cut history), but the assert catches a
     slicing bug that would otherwise silently reuse evaluation signal.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent          # .../src/proxy
SRC = HERE.parent                                 # .../src
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from proxy.arms import LETTERS, render_prompt
from proxy.datasets import load
from proxy.task import K, MIN_EVENTS, TEST_FRAC, Target
from proxy import seqrec
from proxy.textmatch import load_genericness, matched_pool

HIST_N = int(os.environ.get("PROXY_HIST_N", "30"))    # matches arms.render_prompt's own default,
# so the history budget equals every other arm's. The environment variable widens or narrows the
# history window of the training prompts. hpc/build_targets.py's --hist-n flag (also default 30)
# is the matching setting for the frozen evaluation prompts, so a wider window is set as
# PROXY_HIST_N=100 here and --hist-n 100 there, while arms.py's own hist_n=30 default is left
# alone.


def _raw_per_user_and_cats(name):
    """One pass over all events (every user, full timeline, which is also what task.build's own
    popularity counter is computed over): {user: [(ts, item), ...]} unsorted, and the
    item -> {"cat","name"} map (identical construction to arms.novel_targets)."""
    per = defaultdict(list)
    cats = {}
    for e in load(name):
        per[e.user].append((e.ts, e.item))
        if e.cat or e.name:
            cats[e.item] = {"cat": e.cat, "name": e.name}
    return per, cats


def _load_excluded_users(path):
    """Load a frozen set of user ids to exclude from training, from a json file holding a dict
    with a "users" list of string ids (a bare list is also accepted). Returns a set of str ids,
    matching this module's own `u` type (str, as yielded by datasets.load()'s event.user)."""
    with open(path) as f:
        d = json.load(f)
    users = d["users"] if isinstance(d, dict) else d
    return set(str(u) for u in users)


def build_sft_instances(name, n_per_user_max=20, seed=0, min_events=MIN_EVENTS,
                        test_frac=TEST_FRAC, k=K, distractors="popular", genericness_path=None,
                        exclude_users_from=None):
    """Return (instances, meta). instances: list of dicts {ds, user, prompt, completion,
    target_item, history_len}. meta carries the counts to print and the leakage-check tallies.

    exclude_users_from (PROXY_SFT_EXCLUDE_USERS_FROM): None or "" (the default) means no
    exclusion. Otherwise a path to a users json (see _load_excluded_users); every row belonging to
    one of those users is dropped from the returned instances, as the last step below. See the
    comment at the drop site for why a post-filter of the fully built list, rather than an early
    skip inside the per-user loop, keeps every retained row identical to a default (unfiltered)
    build."""
    per, cats = _raw_per_user_and_cats(name)
    pop = Counter(it for evs in per.values() for _, it in evs)   # same input as task.build's `pop`
    top = [it for it, _ in pop.most_common(2000)]                 # same as task.build's `top`
    # Mirror of task.build's `popmatched`: pre-cut popularity bins, size-biased draw, never from history.
    pre_pop = Counter()
    for _u, _evs in per.items():
        if len(_evs) < min_events: continue
        _srt = sorted(_evs)
        for _, _it in _srt[:int(len(_srt) * (1 - test_frac))]: pre_pop[_it] += 1
    NB = 20; _ranked = sorted(pop, key=lambda it: (pre_pop.get(it, 0), it))
    bin_of = {it: min(NB - 1, i * NB // len(_ranked)) for i, it in enumerate(_ranked)}
    members = defaultdict(list)
    for it, b in bin_of.items(): members[b].append(it)
    def _matched_pool(item_i, hist_items):
        hset = set(hist_items); b = bin_of[item_i]; pool = []; width = 0
        while len(pool) < k - 1 and width <= NB:
            lo, hi = max(0, b - width), min(NB - 1, b + width)
            pool = [x for bb in range(lo, hi + 1) for x in members[bb] if x != item_i and x not in hset]
            width += 1
        w = [pre_pop.get(x, 0) + 1 for x in pool]; picked = []
        while len(picked) < k - 1:
            x = rng.choices(pool, weights=w, k=1)[0]
            if x not in picked: picked.append(x)
        return picked

    # `textmatched`: the same genericness-bin logic as proxy.task.build's `textmatched` branch, via
    # the one shared helper (proxy.textmatch) rather than a second hand-copied implementation here.
    # See the module docstring of textmatch.py for why the two call sites share it.
    gen_scores = gen_edges = None
    textmatch_fallback = None
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
        textmatch_fallback = {}

    def _textmatched_pool(item_i, hist_items):
        # Same popularity-bin pool construction as `_matched_pool` above, copied verbatim (not
        # refactored into a shared call, so a bug here can never change what `popmatched` itself
        # does), then intersected with the true item's genericness bin.
        hset = set(hist_items); b = bin_of[item_i]; pop_pool = []; width = 0
        while len(pop_pool) < k - 1 and width <= NB:
            lo, hi = max(0, b - width), min(NB - 1, b + width)
            pop_pool = [x for bb in range(lo, hi + 1) for x in members[bb] if x != item_i and x not in hset]
            width += 1
        pool = matched_pool(pop_pool, item_i, gen_scores, gen_edges, textmatch_fallback)
        w = [pre_pop.get(x, 0) + 1 for x in pool]; picked = []
        while len(picked) < k - 1:
            x = rng.choices(pool, weights=w, k=1)[0]
            if x not in picked: picked.append(x)
        return picked

    ref_seqs = seqrec._eligible_sequences(name, min_events=min_events, test_frac=test_frac)

    rng = random.Random(seed)
    instances = []
    total_positions = novel_positions = 0
    hist_lens = []
    ts_violations = 0
    checked_ts = 0

    for u in sorted(per):
        evs = sorted(per[u])
        if len(evs) < min_events:
            continue
        cut = int(len(evs) * (1 - test_frac))
        pre = evs[:cut]                      # [(ts, item), ...] -- the pre-cut prefix, chronological
        pre_items = [it for _, it in pre]
        assert pre_items == ref_seqs.get(u), (
            f"user {u}: this module's pre-cut mirror diverged from seqrec._eligible_sequences "
            f"({len(pre_items)} vs {len(ref_seqs.get(u, []))} items) -- slicing logic disagreement")
        cut_ts = evs[cut][0] if cut < len(evs) else None   # ts of the first held-out event, if any

        cands_for_user = []
        for i in range(1, len(pre)):
            ts_i, item_i = pre[i]
            hist_items = pre_items[:i]
            hist_ts = [t for t, _ in pre[:i]]
            total_positions += 1
            if item_i in set(hist_items):
                continue                      # a revisit, not a novel decision: skip (only novel decisions are scored)
            novel_positions += 1
            checked_ts += 1
            bad = i >= cut
            if cut_ts is not None:
                bad = bad or ts_i >= cut_ts or any(t >= cut_ts for t in hist_ts)
            if bad:
                ts_violations += 1
                continue
            cands_for_user.append((i, item_i, hist_items))

        if len(cands_for_user) > n_per_user_max:
            chosen = sorted(rng.sample(cands_for_user, n_per_user_max), key=lambda c: c[0])
        else:
            chosen = cands_for_user

        for i, item_i, hist_items in chosen:
            pool = [x for x in top if x != item_i]
            if len(pool) < k - 1:
                continue
            if distractors == "popmatched":
                _picked = _matched_pool(item_i, hist_items)
            elif distractors == "textmatched":
                _picked = _textmatched_pool(item_i, hist_items)
            else:
                _picked = rng.sample(pool, k - 1)
            cand_list = _picked + [item_i]
            rng.shuffle(cand_list)
            idx = cand_list.index(item_i)
            tgt = Target(user=u, true_item=item_i, candidates=cand_list, history=hist_items)
            prompt = render_prompt(tgt, cats, hist_n=HIST_N)
            hlen = min(len(hist_items), HIST_N)
            hist_lens.append(hlen)
            instances.append({"ds": name, "user": u, "prompt": prompt,
                              "completion": " " + LETTERS[idx],
                              "target_item": item_i, "history_len": hlen})

    assert ts_violations == 0, (
        f"{ts_violations}/{checked_ts} candidate instances had a target or history timestamp at "
        f"or after the user's cut -- pre-cut slicing is broken")

    # cross-check against the frozen eval set's own true_items for the 300 eval users
    eval_targets, _ = seqrec.regenerate_targets(name)
    eval_true = defaultdict(set)
    for t in eval_targets:
        eval_true[t.user].add(t.true_item)
    eval_users_in_train = {inst["user"] for inst in instances} & set(eval_true)
    collisions = [inst for inst in instances
                 if inst["target_item"] in eval_true.get(inst["user"], ())]
    assert not collisions, (
        f"{len(collisions)} training instance(s) target one of their user's frozen eval "
        f"true_items -- eval leakage")

    # PROXY_SFT_EXCLUDE_USERS_FROM (the default of --exclude-users-from; see main()): drop every
    # row belonging to an excluded user, as a pure post-filter of the fully built `instances` list
    # above. Every rng draw in the per-user loop (the seeded per-user subsample and the
    # per-instance distractor sampling) has already happened, identically to a default run, for
    # every user including the excluded ones, by the time we get here. So every retained row is
    # identical, in the same relative order, to a default (unfiltered) build. Excluding a user
    # earlier instead (for example by skipping them inside `for u in sorted(per):` above) would
    # consume fewer draws from the single shared `rng` stream and shift it for every user
    # processed after them in sorted-id order, silently changing their distractor sets too. This
    # filter runs before any later stage's own seeded subsample or shuffle, such as the train/val
    # split in hpc/sft_shared.py.
    excluded_users = _load_excluded_users(exclude_users_from) if exclude_users_from else set()
    n_rows_dropped_excluded = 0
    n_users_dropped_excluded = 0
    if excluded_users:
        kept, dropped = [], []
        for inst in instances:
            (dropped if inst["user"] in excluded_users else kept).append(inst)
        n_rows_dropped_excluded = len(dropped)
        n_users_dropped_excluded = len({inst["user"] for inst in dropped})
        instances = kept

    meta = {
        "n_users": len({inst["user"] for inst in instances}),
        "n_instances": len(instances),
        "novel_share_of_walk": (novel_positions / total_positions) if total_positions else None,
        "mean_history_len": (sum(hist_lens) / len(hist_lens)) if hist_lens else None,
        "n_positions_checked_for_ts_leakage": checked_ts,
        "ts_violations": ts_violations,
        "n_frozen_eval_users": len(eval_true),
        "n_frozen_eval_users_present_in_train": len(eval_users_in_train),
        "eval_true_item_collisions": len(collisions),
        "textmatch_fallback": textmatch_fallback,   # None unless distractors == "textmatched"
        "exclude_users_from": exclude_users_from,
        "n_rows_dropped_excluded": n_rows_dropped_excluded,
        "n_users_dropped_excluded": n_users_dropped_excluded,
    }
    return instances, meta


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n-per-user-max", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--distractors", default="popular")
    ap.add_argument("--genericness", default=None,
                    help="path to a JSON table of genericness scores per venue; required with --distractors textmatched")
    ap.add_argument("--exclude-users-from", default=os.environ.get("PROXY_SFT_EXCLUDE_USERS_FROM", ""),
                    help="path to a users json (a dict with a \"users\" list; also read from PROXY_SFT_EXCLUDE_USERS_FROM). Every "
                         "training row belonging to one of these users is dropped from the "
                         "output (see build_sft_instances). Default '' = no exclusion.")
    ap.add_argument("--limit", type=int, default=None,
                    help="write only the first N instances (for a fast local stub); the printed "
                         "counts below are always over the FULL built set, not the truncated file")
    args = ap.parse_args()

    print("=== SFT DATA BUILD (shared LoRA arm) ===", flush=True)
    print(f"  dataset {args.dataset}  n_per_user_max {args.n_per_user_max}  seed {args.seed}  "
         f"DRYRUN {os.environ.get('PROXY_DRYRUN', '0')}", flush=True)
    if args.exclude_users_from:
        print(f"  PROXY_SFT_EXCLUDE_USERS_FROM={args.exclude_users_from}", flush=True)

    instances, meta = build_sft_instances(args.dataset, n_per_user_max=args.n_per_user_max,
                                          seed=args.seed, distractors=args.distractors,
                                          genericness_path=args.genericness,
                                          exclude_users_from=args.exclude_users_from or None)

    print(f"  users        {meta['n_users']:,}", flush=True)
    print(f"  instances    {meta['n_instances']:,}", flush=True)
    print(f"  novel_share_of_walk  {meta['novel_share_of_walk']:.4f}  "
         f"(share of all pre-cut positions walked that were novel, before capping)", flush=True)
    print(f"  mean_history_len     {meta['mean_history_len']:.2f}  (truncated at hist_n={HIST_N})",
         flush=True)
    print(f"  LEAKAGE CHECK: {meta['n_positions_checked_for_ts_leakage']:,} candidate instances "
         f"checked, {meta['ts_violations']} had a target/history timestamp at-or-after the "
         f"user's cut; {meta['n_frozen_eval_users_present_in_train']}/{meta['n_frozen_eval_users']} "
         f"frozen eval users appear in this training set, {meta['eval_true_item_collisions']} of "
         f"their training targets collided with their own frozen eval true_item -- "
         f"{'OK, 0 violations' if meta['ts_violations'] == 0 and meta['eval_true_item_collisions'] == 0 else 'FAILED'}",
         flush=True)
    if args.exclude_users_from:
        print(f"  EXCLUSION: dropped {meta['n_rows_dropped_excluded']:,} row(s) / "
             f"{meta['n_users_dropped_excluded']:,} user(s) listed in {args.exclude_users_from} "
             f"(post-filter of the fully-built set -- see build_sft_instances)", flush=True)

    write = instances[:args.limit] if args.limit else instances
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        for inst in write:
            f.write(json.dumps(inst) + "\n")
    note = f" (dry stub, limited from {meta['n_instances']:,})" if args.limit else ""
    print(f"  wrote {len(write):,} rows -> {args.out}{note}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
