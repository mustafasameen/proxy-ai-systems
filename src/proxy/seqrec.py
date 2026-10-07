"""CPU-only sequential-recommender baselines (FPMC, GRU4Rec-style GRU) for the delegation-fidelity
novel-venue subset. They test the hypothesis that sequence structure suffices and no LLM is needed.

Nothing here loads or calls an LLM; everything is plain torch on CPU.

Where the frozen targets come from. `arms.novel_targets(name, n_users=300, seed=0)` writes the
frozen novel-venue target set: it calls `task.build(name, seed=0, k=5, min_events=20,
test_frac=0.2, distractors="popmatched")` (task.py's own defaults, the canonical configuration of
src/proxy/config.py), keeps only novel decisions (true_item not in the user's pre-cut history),
then caps to 300 users via a `random.Random(0).sample` over the sorted novel-user list.
`regenerate_targets` below calls `novel_targets` directly instead of re-deriving that filter and
cap in this file. A second copy of that logic that drifted from arms.py by one line (a different
`sorted()` key, or sampling before rather than after the novel filter) would silently decouple
this arm's "shared target set" from the one every other arm is scored against, which is the
failure arms.py's docstring warns about ("an arm that regenerates its own targets is not
comparable").

Pipeline
  regenerate_targets(name)  -> the frozen novel-only, 300-user Target list, for align_check.
  regenerate_full(name)     -> pooled / novel / revisit Target lists over that same 300-user
                                population (revisit and pooled are new: the frozen jsonl is
                                novel-only, so those two are derived here, not reproduced).
  align_check(...)          -> hard fail (raises AssertionError with a diff) if the regenerated
                                novel set does not match the frozen jsonl row for row: same length,
                                same user per row, and the same rendered label at the frozen row's
                                answer_idx (rendered with arms._label, the helper
                                arms.render_prompt itself calls).
  build_vocab(name)         -> global item vocabulary (<PAD>=0, <UNK>=1, then first-seen order)
                                over every eligible user's pre-cut sequence (task.py's own
                                eligibility rule: >= min_events events; ineligible users are never
                                split by task.build and so have no pre-cut sequence to contribute).
  FPMC / GRU4Rec              torch nn.Module, CPU, d=64 by default, trained by next-item
                                cross-entropy over the full vocabulary (about 37k items for
                                steps_new_york; small enough that a full softmax is simpler and no
                                less correct than a sampled softmax, so that is what is used).
  score(...)                  argmax over the 5 candidate embeddings for one target.
  evaluate(...) / report(...) pooled / novel (headline) / revisit accuracy, per-user distribution
                                (mean/p10/p50/p90), candidate-OOV rate, n_targets, n_users, config.

Information-budget parity: HIST_N=30 (arms.render_prompt's own default `hist_n`) truncates both
the GRU's training/eval input window and what "history" means for FPMC's last-item lookup, so
these baselines see the same amount of individual history as the prompted arm's prompt text, not
more and not less.
"""
from __future__ import annotations

import json
import os
import random
from collections import defaultdict

import torch
import torch.nn as nn
import torch.nn.functional as F

from proxy.arms import LETTERS, _label, novel_targets
from proxy.config import CANONICAL
from proxy.task import build

BUILD_ARGS = dict(k=CANONICAL["k"], min_events=20, test_frac=0.2,
                  distractors=CANONICAL["distractors"])   # task.py's own defaults
N_USERS_CAP = CANONICAL["n_users"]     # number of users in the frozen evaluation sample
HIST_N = CANONICAL["hist_n"]           # matches arms.render_prompt's default hist_n -- same info budget as the prompt
PAD_ID, UNK_ID = 0, 1


# --------------------------------------------------------------------------------- (a) targets

def regenerate_targets(name, n_users=N_USERS_CAP, seed=CANONICAL["seed"],
                       distractors=CANONICAL["distractors"],
                       genericness_path=None, fallback_stats=None):
    """The frozen novel-only, n_users-capped target set (the one hpc/build_targets.py writes).
    Returns (targets, cats); cats is arms.py's {item: {"cat":..., "name":...}} map, needed to
    render labels the same way arms.render_prompt does (see align_check).

    `genericness_path` and `fallback_stats` are passed straight through to proxy.task.build (via
    arms.novel_targets's own **kw forwarding). They have no effect for any distractors= value
    except `textmatched` (src/proxy/textmatch.py).

    Two environment variables override the arguments; when they are unset, the arguments are used:
    PROXY_TARGETS_SEED: if non-empty, replaces `seed` (for example 20260920, the build seed of the
      test sample).
    PROXY_TARGETS_EXCLUDE_USERS_FROM: if non-empty, a path to a targets jsonl (a 'user' field per
      row); its distinct users are excluded from the sampling pool before the seeded draw. The
      derivation is the same as hpc/build_targets.py's `--exclude-users-from` handling:
      `exclude = {json.loads(l)["user"] for l in open(a.exclude_users_from)}`. That script is a
      command-line entry point, not a module, so the line is copied rather than imported."""
    seed_override = os.environ.get("PROXY_TARGETS_SEED", "")
    if seed_override:
        seed = int(seed_override)
    exclude_users = None
    exclude_from = os.environ.get("PROXY_TARGETS_EXCLUDE_USERS_FROM", "")
    if exclude_from:
        exclude_users = {json.loads(l)["user"] for l in open(exclude_from)}
    return novel_targets(name, n_users=n_users, seed=seed, exclude_users=exclude_users,
                         **{**BUILD_ARGS, "distractors": distractors,
                            "genericness_path": genericness_path, "fallback_stats": fallback_stats})


def regenerate_full(name, n_users=N_USERS_CAP, seed=CANONICAL["seed"],
                    distractors=CANONICAL["distractors"],
                    genericness_path=None, fallback_stats=None):
    """Pooled / novel / revisit Target lists over the same 300 users as regenerate_targets, for
    the pooled/novel/revisit breakdown in report(). `keep` is read off the novel set's own users
    (never re-sampled), so it is guaranteed identical to what novel_targets actually kept.

    Both calls below forward `distractors` explicitly. The module-level BUILD_ARGS holds the
    canonical distractors, so a call that spread BUILD_ARGS without overriding it would silently
    score the canonical task whatever distractor mode was requested. For the same reason
    `genericness_path` is forwarded to both calls: every mirrored call site gets every
    distractor-related argument, so none can drop one. `fallback_stats`, if given, is therefore
    mutated by both the `regenerate_targets` call and the `build` call: its counts mix the
    novel-only population and the full (all eligible users) population, and are not a clean
    per-population count. A caller that needs an unambiguous fallback count should call
    `regenerate_targets` directly."""
    novel, cats = regenerate_targets(name, n_users=n_users, seed=seed, distractors=distractors,
                                     genericness_path=genericness_path, fallback_stats=fallback_stats)
    keep = {t.user for t in novel}
    tg_all, n_eligible = build(name, seed=seed,
                              **{**BUILD_ARGS, "distractors": distractors,
                                 "genericness_path": genericness_path,
                                 "fallback_stats": fallback_stats})
    pooled = [t for t in tg_all if t.user in keep]
    revisit = [t for t in pooled if t.true_item in set(t.history)]
    assert len(novel) + len(revisit) == len(pooled), (len(novel), len(revisit), len(pooled))
    return {"novel": novel, "revisit": revisit, "pooled": pooled, "cats": cats,
            "keep_users": keep, "n_eligible": n_eligible}


# --------------------------------------------------------------------------------- (b) align check
import re  # noqa: E402

_OPTION_LINE = re.compile(r"^\s*([A-E])\.\s+(.*)$", re.MULTILINE)


def align_check(targets, jsonl_rows, cats):
    """Hard fail (raises AssertionError with a diff) unless, row by row: same length overall, same
    user, and the candidate at the frozen row's answer_idx renders (via arms._label, the helper
    arms.render_prompt uses) to the exact text printed at that letter in the frozen prompt.
    A mismatch means the frozen jsonl was not produced by task.build with the arguments this
    module assumes, or the dataset file behind it has changed. It is not a formatting quirk."""
    if len(targets) != len(jsonl_rows):
        raise AssertionError(
            f"ALIGN_CHECK FAIL: length mismatch: regenerated={len(targets)} "
            f"frozen={len(jsonl_rows)}")

    diffs = []
    for i, (t, row) in enumerate(zip(targets, jsonl_rows)):
        if t.user != row["user"]:
            diffs.append(f"row {i}: user regenerated={t.user!r} frozen={row['user']!r}")
            continue
        ans_idx = row["answer_idx"]
        if not (0 <= ans_idx < len(t.candidates)):
            diffs.append(f"row {i} user={row['user']}: answer_idx {ans_idx} out of range "
                         f"for {len(t.candidates)} regenerated candidates")
            continue
        expected = _label(cats, t.candidates[ans_idx])
        options = dict(_OPTION_LINE.findall(row["prompt"]))
        letter = LETTERS[ans_idx]
        frozen = options.get(letter)
        if frozen != expected:
            diffs.append(f"row {i} user={row['user']} letter={letter}: "
                         f"regenerated_label={expected!r} frozen_label={frozen!r}")
        if len(diffs) >= 20:
            break

    if diffs:
        raise AssertionError(
            f"ALIGN_CHECK FAIL: {len(diffs)}{'+' if len(diffs) >= 20 else ''} mismatch(es) out of "
            f"{len(targets)} rows (showing up to 20):\n  " + "\n  ".join(diffs))

    return {"status": "OK", "n": len(targets), "n_users": len({t.user for t in targets})}


# --------------------------------------------------------------------------------- (c) vocab

def _eligible_sequences(name, min_events=20, test_frac=0.2):
    """Mirror task.py's own per-user split: sort chronologically, keep users with >= min_events,
    cut at int(len*(1-test_frac)); return {user: pre-cut item list}. build_vocab cross-checks the
    eligible-user count against task.build's own rather than trusting this blindly."""
    from proxy.datasets import load
    per = defaultdict(list)
    for e in load(name):
        per[e.user].append((e.ts, e.item))
    seqs = {}
    for u, evs in per.items():
        if len(evs) < min_events:
            continue
        evs.sort()
        cut = int(len(evs) * (1 - test_frac))
        seqs[u] = [it for _, it in evs[:cut]]
    return seqs


def build_vocab(name, min_events=20, test_frac=0.2, seed=CANONICAL["seed"]):
    """Global item vocabulary over every eligible user's pre-cut sequence, plus <PAD>/<UNK>.
    Returns (item2id, sequences). Asserts its eligible-user count against task.build's own count
    for the same args, so a later change to task.py's eligibility rule cannot silently desync this
    vocabulary."""
    seqs = _eligible_sequences(name, min_events=min_events, test_frac=test_frac)
    _, n_eligible = build(name, seed=seed, **{**BUILD_ARGS, "min_events": min_events,
                                              "test_frac": test_frac})
    assert n_eligible == len(seqs), (
        f"build_vocab eligibility ({len(seqs)} users) diverged from task.build's own count "
        f"({n_eligible}) -- task.py's split logic changed under this mirror")
    item2id = {"<PAD>": PAD_ID, "<UNK>": UNK_ID}
    for u in sorted(seqs):        # deterministic id assignment, independent of dict hash order
        for it in seqs[u]:
            if it not in item2id:
                item2id[it] = len(item2id)
    return item2id, seqs


# --------------------------------------------------------------------------------- (d) models

class FPMC(nn.Module):
    """Factorised personalised Markov chain (Rendle 2010): score(u, last, cand) =
    <U_u, I_out_cand> + <I_in_last, I_out_cand>. Full softmax over I_out for training."""

    def __init__(self, n_users, n_items, d=64):
        super().__init__()
        self.U = nn.Embedding(n_users, d)
        self.I_in = nn.Embedding(n_items, d, padding_idx=PAD_ID)
        self.I_out = nn.Embedding(n_items, d, padding_idx=PAD_ID)
        for emb in (self.U, self.I_in, self.I_out):
            nn.init.normal_(emb.weight, std=0.02)

    def logits(self, user_idx, last_idx):
        q = self.U(user_idx) + self.I_in(last_idx)          # (B, d)
        return q @ self.I_out.weight.T                        # (B, n_items)

    def score_candidates(self, user_idx, last_idx, cand_idx):
        q = self.U(user_idx) + self.I_in(last_idx)            # (B, d)
        cand_emb = self.I_out(cand_idx)                        # (B, k, d)
        return torch.einsum("bd,bkd->bk", q, cand_emb)


class GRU4Rec(nn.Module):
    """GRU4Rec-style: a GRU over the (HIST_N-truncated) pre-cut sequence, next-item cross-entropy
    at every step against the full item vocab."""

    def __init__(self, n_items, d=64):
        super().__init__()
        self.E = nn.Embedding(n_items, d, padding_idx=PAD_ID)
        self.gru = nn.GRU(d, d, batch_first=True)
        self.out = nn.Linear(d, n_items)
        nn.init.normal_(self.E.weight, std=0.02)

    def logits(self, seq_idx):
        h, _ = self.gru(self.E(seq_idx))
        return self.out(h)                                     # (B, T, n_items)

    def encode(self, hist_idx):
        h, _ = self.gru(self.E(hist_idx))
        return h[:, -1]                                          # (B, d) -- final hidden state

    def score_candidates(self, hist_idx, cand_idx):
        h = self.encode(hist_idx)                                # (B, d)
        w = self.out.weight[cand_idx]                              # (B, k, d)
        b = self.out.bias[cand_idx]                                 # (B, k)
        return torch.einsum("bd,bkd->bk", h, w) + b


def _training_pool(item2id, sequences, keep_users, max_users, seed):
    """The user pool used for training. The vocabulary itself stays global over every eligible
    user (from build_vocab); only the training population shrinks here, so OOV rates at evaluation
    remain a property of the real vocabulary, not an artifact of subsampling it. `keep_users` (the
    frozen evaluation users) are always included so evaluation never meets an unseen user;
    `max_users` trims the rest of the eligible pool for fast smoke runs (None for a full run)."""
    all_users = sorted(sequences)
    if max_users is None:
        return all_users
    rest = [u for u in all_users if u not in keep_users]
    random.Random(seed).shuffle(rest)
    budget = max(0, max_users - len(keep_users & set(all_users)))
    pool = sorted((keep_users & set(all_users)) | set(rest[:budget]))
    return pool


def train_fpmc(item2id, sequences, users, d=64, epochs=20, lr=0.01, batch_size=512, seed=0):
    random.seed(seed); torch.manual_seed(seed)
    user2id = {u: i for i, u in enumerate(sorted(users))}
    n_users = len(user2id) + 1     # +1 reserved row for an eval-time user never in `users`
    model = FPMC(n_users, len(item2id), d=d)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    pairs = []
    for u in users:
        ids = [item2id.get(it, UNK_ID) for it in sequences[u]]
        uidx = user2id[u]
        pairs += [(uidx, ids[t - 1], ids[t]) for t in range(1, len(ids))]
    rng = random.Random(seed)
    last_loss = None
    for _ in range(epochs):
        rng.shuffle(pairs)
        for i in range(0, len(pairs), batch_size):
            batch = pairs[i:i + batch_size]
            if not batch:
                continue
            u = torch.tensor([b[0] for b in batch])
            last = torch.tensor([b[1] for b in batch])
            nxt = torch.tensor([b[2] for b in batch])
            loss = F.cross_entropy(model.logits(u, last), nxt)
            opt.zero_grad(); loss.backward(); opt.step()
            last_loss = loss.item()
    return model, user2id, {"final_loss": last_loss, "n_train_pairs": len(pairs),
                            "n_train_users": len(users), "epochs": epochs}


def train_gru(item2id, sequences, users, d=64, epochs=20, lr=0.01, batch_size=64, seed=0,
             hist_n=HIST_N):
    random.seed(seed); torch.manual_seed(seed)
    model = GRU4Rec(len(item2id), d=d)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    data = []
    for u in users:
        ids = [item2id.get(it, UNK_ID) for it in sequences[u][-(hist_n + 1):]]
        if len(ids) >= 2:
            data.append(ids)
    rng = random.Random(seed)
    last_loss = None
    for _ in range(epochs):
        rng.shuffle(data)
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            if not batch:
                continue
            inp = [s[:-1] for s in batch]
            tgt = [s[1:] for s in batch]
            maxlen = max(len(s) for s in inp)
            x = torch.full((len(inp), maxlen), PAD_ID, dtype=torch.long)
            y = torch.full((len(inp), maxlen), PAD_ID, dtype=torch.long)
            for j, (si, so) in enumerate(zip(inp, tgt)):
                x[j, :len(si)] = torch.tensor(si, dtype=torch.long)
                y[j, :len(so)] = torch.tensor(so, dtype=torch.long)
            logits = model.logits(x)
            loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), y.reshape(-1),
                                   ignore_index=PAD_ID)
            opt.zero_grad(); loss.backward(); opt.step()
            last_loss = loss.item()
    return model, {"final_loss": last_loss, "n_train_sequences": len(data),
                  "n_train_users": len(users), "epochs": epochs}


# --------------------------------------------------------------------------------- (e) scoring

def score(model, hist_ids, cand_ids, item2id, user_id=None, user2id=None, hist_n=HIST_N):
    """Argmax over the 5 candidate embeddings for one target. hist_ids/cand_ids are raw item ids
    (as stored on Target); mapped through item2id (unseen -> <UNK>). user_id/user2id are required
    for FPMC (a user never seen in training falls back to the reserved unseen-user row) and
    ignored for GRU4Rec."""
    with torch.no_grad():
        cand_idx = torch.tensor([[item2id.get(c, UNK_ID) for c in cand_ids]], dtype=torch.long)
        if isinstance(model, FPMC):
            last = hist_ids[-1] if hist_ids else None
            last_idx = torch.tensor([item2id.get(last, UNK_ID) if last is not None else UNK_ID],
                                    dtype=torch.long)
            uidx = torch.tensor([user2id.get(user_id, len(user2id))], dtype=torch.long)
            logits = model.score_candidates(uidx, last_idx, cand_idx)
        elif isinstance(model, GRU4Rec):
            win = hist_ids[-hist_n:] if hist_ids else [PAD_ID]
            hist_idx = torch.tensor([[item2id.get(h, UNK_ID) for h in win]], dtype=torch.long)
            logits = model.score_candidates(hist_idx, cand_idx)
        else:
            raise TypeError(f"unknown model type {type(model)}")
        return int(torch.argmax(logits, dim=-1).item())


# --------------------------------------------------------------------------------- (f) reporting

def evaluate(model, targets, item2id, user2id=None, hist_n=HIST_N, return_rows=False):
    """Pooled accuracy, per-user accuracy distribution (mean/p10/p50/p90) and candidate-OOV rate
    on `targets`. With return_rows=True the result also has a "rows" key (a list of
    {"user", "correct"} in the order of `targets`), the per-row correctness needed to bootstrap
    over users; the default False returns the aggregate fields only."""
    if not targets:
        out = {"acc": None, "n": 0, "n_users": 0, "candidate_oov_rate": None,
               "per_user_acc": {"mean": None, "p10": None, "p50": None, "p90": None}}
        if return_rows:
            out["rows"] = []
        return out
    hits = 0
    oov = 0
    k = len(targets[0].candidates)
    per_user = defaultdict(lambda: [0, 0])
    rows = [] if return_rows else None
    for t in targets:
        pick = score(model, t.history, t.candidates, item2id, user_id=t.user, user2id=user2id,
                    hist_n=hist_n)
        ok = int(t.candidates[pick] == t.true_item)
        hits += ok
        pu = per_user[t.user]; pu[0] += ok; pu[1] += 1
        oov += sum(1 for c in t.candidates if item2id.get(c, UNK_ID) == UNK_ID)
        if return_rows:
            rows.append({"user": t.user, "correct": ok})
    n = len(targets)
    dist = sorted(h / c for h, c in per_user.values())
    q = lambda f: dist[min(len(dist) - 1, int(f * len(dist)))] if dist else None
    out = {"acc": hits / n, "n": n, "n_users": len(per_user),
           "candidate_oov_rate": oov / (n * k),
           "per_user_acc": {"mean": sum(dist) / len(dist) if dist else None,
                            "p10": q(0.10), "p50": q(0.50), "p90": q(0.90)}}
    if return_rows:
        out["rows"] = rows
    return out


def report(model, model_name, split, item2id, user2id, config, return_rows=False):
    out = {"model": model_name, "config": config}
    for name, targets in split.items():
        if name == "cats" or name == "keep_users" or name == "n_eligible":
            continue
        out[name] = evaluate(model, targets, item2id, user2id, return_rows=return_rows)
    return out
