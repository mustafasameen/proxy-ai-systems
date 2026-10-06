"""Arms and scoring for delegation fidelity, on the novel-decision subset.

All arms share one target set. It is built once, cached, and handed to every arm (prompted,
per-user SFT, RLVR), so differences are attributable to the method and paired tests are valid. An
arm that regenerates its own targets is not comparable to the others.

Why novel decisions only: on all targets a per-user frequency lookup comes close to the recall
ceiling (the share of targets whose true item is already in the user's history), so a headline
number there grades habit lookup. On novel decisions every history-recall baseline scores 0 by
construction and a category heuristic scores above chance, which is the room a delegated agent
has to earn.

No ceiling can be estimated directly on the novel subset. For revisits, whether the person
repeated themselves bounds any recall method. For genuinely new venues there is no analogous
within-person bound, so results are reported against the category heuristic as a structured-prior
floor, not against an invented ceiling.
"""
from __future__ import annotations

import re
import json
import math
import random
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from proxy.datasets import load
from proxy.task import build

LETTERS = "ABCDE"


def novel_targets(name, n_users=None, seed=0, exclude_users=None, **kw):
    """The shared target set: novel-venue held-out decisions, optionally capped to n_users.
    Returns (targets, meta) where meta[item] = {"cat":..., "name":...}. Massive-STEPS carries venue
    names; Foursquare 2014 and Gowalla do not (opaque venue ids), so prompts are category-only
    there. That asymmetry is a property of the releases and must be stated beside any cross-dataset
    comparison rather than hidden by rendering both the same way.

    `exclude_users`: optional set/iterable of user ids dropped from the sampling pool before the
    seeded n_users sample, so a second, disjoint draw (for example a fresh sample that excludes the
    users of an earlier one) is a clean seeded sample over the remaining pool. The default None
    leaves the sampling unchanged."""
    tg, _ = build(name, seed=seed, **kw)
    cats = {}
    for e in load(name):
        if e.cat or e.name:
            cats[e.item] = {"cat": e.cat, "name": e.name}
    novel = [t for t in tg if t.true_item not in set(t.history)]
    if n_users is not None:
        rng = random.Random(seed)
        users = sorted({t.user for t in novel})
        if exclude_users:
            users = [u for u in users if u not in exclude_users]
        keep = set(rng.sample(users, min(n_users, len(users))))
        novel = [t for t in novel if t.user in keep]
    return novel, cats


def _cat(meta, item):
    m = meta.get(item) or {}
    return m.get("cat") or "?"


def _label(meta, item):
    """Venue name plus category when the release has names, else category alone."""
    m = meta.get(item) or {}
    c, n = m.get("cat") or "Unknown", m.get("name")
    return f"{n} ({c})" if n else c


def render_prompt(t, cats, hist_n=30):
    """One decision as a multiple-choice question. History is the last `hist_n` visits, the only
    individual information the model gets."""
    hist = t.history[-hist_n:]
    hc = Counter(_cat(cats, i) for i in hist)
    lines = ["A person's recent places (most recent last):",
             "  " + ", ".join(_label(cats, i) for i in hist),
             f"Their most frequent categories: "
             f"{', '.join(c for c, _ in hc.most_common(6))}",
             "",
             "They are about to go somewhere they have NOT been before. Which of these will they "
             "choose?"]
    for i, c in enumerate(t.candidates):
        lines.append(f"  {LETTERS[i]}. {_label(cats, c)}")
    lines.append("")
    lines.append(f"Answer with one letter ({'/'.join(LETTERS[:len(t.candidates)])}). Answer:")
    return "\n".join(lines)


# History order (selected with hpc/build_targets.py --hist-order). render_prompt shows the last
# hist_n visits (the recency rule). The retrieval-ranked baseline follows LaMP (Salemi et al.,
# arXiv 2304.11406), Section 3: the retriever R(q, P_u, k) ranks the user's entire profile and k
# only sets how many items enter the prompt. Here the profile is the user's whole pre-cut history,
# the query is the concatenated text of the row's five candidates, the ranking is BM25 (k1=1.2,
# b=0.75), and the kept hist_n items are rendered in their original chronological order through
# render_prompt itself. Between the two orders only the selection of shown items differs; the
# template, the candidates, the answer and the most-frequent-categories rule (computed over the
# shown items, as in the recency prompt) do not. Retrieved items can predate the last 30 visits,
# the window the recency prompt shows.
BM25_K1, BM25_B = 1.2, 0.75
_TOKEN_RE = re.compile(r"[^\W_]+")
_POSSESSIVE_RE = re.compile(r"['’]s\b")
_STOPWORDS = frozenset("a an and are as at be but by for if in into is it no not of on or such that the "
                       "their then there these they this to was will with".split())


def _tokens(text):
    """Lowercase, drop a possessive 's, keep runs of Unicode letters/digits of two or more characters
    that are not stopwords; no stemming. Unfiltered, 's / the / of and subway-line letters are the
    commonest tokens in candidate text and match unrelated venues (Audrey's ~ McDonald's)."""
    return [w for w in _TOKEN_RE.findall(_POSSESSIVE_RE.sub("", text.lower()))
            if len(w) > 1 and w not in _STOPWORDS]


def bm25_scores(docs, query, k1=BM25_K1, b=BM25_B):
    """Okapi BM25 of each tokenised doc against a tokenised query (query tokens count with
    multiplicity), idf(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5)), the non-negative form.
    N, df and avgdl come from `docs` alone: in select_history, one user's own history."""
    n = len(docs)
    if n == 0:
        return []
    avgdl = sum(len(d) for d in docs) / n
    df = Counter(tok for d in docs for tok in set(d))
    idf = {tok: math.log(1 + (n - c + 0.5) / (c + 0.5)) for tok, c in df.items()}
    scores = []
    for d in docs:
        tf = Counter(d)
        norm = k1 * (1 - b + (b * len(d) / avgdl if avgdl else 0.0))
        scores.append(sum(idf[q] * tf[q] * (k1 + 1) / (tf[q] + norm) for q in query if q in tf))
    return scores


def select_history(history, candidates, meta, k, order="recent"):
    """The k history items a prompt shows, oldest first.

    order="recent":    history[-k:], render_prompt's own truncation.
    order="retrieved": the k items of the whole history whose text scores highest under BM25
                       against the candidates' concatenated text (LaMP Section 3: rank the entire
                       profile, keep k); equal scores go to the more recent item, so slots no item
                       earns by word overlap fall back to recency; the kept items are returned in
                       their original chronological order.

    Fields read. This function is never handed a Target, so it cannot see the answer:
      history    = t.history, this user's own pre-cut visits, all of them;
      candidates = t.candidates, the row's five candidate ids, used only as one sorted bag of
                   words, so the pick cannot depend on candidate order or on which one is correct;
      meta[item]["name"], meta[item]["cat"] for those items only (through _label): the public
                   venue name and category text the prompt itself renders.
    Never read: t.true_item, answer_idx, t.user, any other row, any other user's history. The BM25
    corpus statistics (N, df, avgdl) are this one user's history's."""
    if k < 1:
        raise ValueError(f"k must be >= 1, got {k}")
    if order == "recent":
        return list(history[-k:])
    if order != "retrieved":
        raise ValueError(f"unknown history order {order!r} (recent|retrieved)")
    pool = list(history)
    if len(pool) <= k:
        return pool
    query = sorted(_tokens(" ".join(_label(meta, c) for c in candidates)))   # sorted: the float sum,
                                                                              # so the pick, ignores candidate order
    scores = bm25_scores([_tokens(_label(meta, i)) for i in pool], query)
    keep = sorted(range(len(pool)), key=lambda j: (-scores[j], -j))[:k]
    return [pool[j] for j in sorted(keep)]


def render_prompt_ordered(t, cats, hist_n=30, hist_order="recent"):
    """render_prompt over select_history's items. For hist_order="recent" and any hist_n >= 1 the
    prompt is byte-identical to render_prompt(t, cats, hist_n)."""
    shown = select_history(t.history, t.candidates, cats, hist_n, hist_order)
    return render_prompt(SimpleNamespace(history=shown, candidates=t.candidates), cats,
                         hist_n=len(shown))


def parse_choice(text, k):
    """The first standalone letter in range wins (word-bounded, first line); an unparsed completion
    gives None (counted, never silently wrong). Scanning for the first A-E character anywhere would
    parse a completion such as "Based on..." as B, which is a metric bug, not a model answer."""
    line = (text or "").strip().split(chr(10))[0].upper()
    m = re.search(r"(?<![A-Z])([A-E])(?![A-Z])", line)
    if m and m.group(1) in LETTERS[:k]:
        return LETTERS.index(m.group(1))
    return None


def score(targets, picks):
    """picks: list of index-or-None aligned to targets. Returns per-user and pooled accuracy."""
    assert len(picks) == len(targets), (len(picks), len(targets))
    per_user = {}
    hits = unparsed = 0
    for t, p in zip(targets, picks):
        if p is None:
            unparsed += 1
        ok = (p is not None and t.candidates[p] == t.true_item)
        hits += ok
        u = per_user.setdefault(t.user, [0, 0])
        u[0] += ok; u[1] += 1
    return {"pooled": hits / len(targets),
            "unparsed_frac": unparsed / len(targets),
            "n": len(targets), "n_users": len(per_user),
            "per_user": {u: h / n for u, (h, n) in per_user.items()}}


def paired_bootstrap(a, b, n_boot=10000, seed=0):
    """Cluster bootstrap over users on the per-user accuracy difference. Users are the unit;
    resampling decisions would ignore within-person correlation."""
    users = sorted(set(a["per_user"]) & set(b["per_user"]))
    d = [a["per_user"][u] - b["per_user"][u] for u in users]
    if len(d) < 3:
        return None
    rng = random.Random(seed)
    n = len(d)
    obs = sum(d) / n
    bs = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(n_boot))
    lo, hi = bs[int(0.025 * n_boot)], bs[int(0.975 * n_boot)]
    return {"delta": obs, "ci95": [lo, hi], "n_users": n,
            "significant": (lo > 0) == (hi > 0) and lo != hi}


def sft_examples(targets, cats, hist_n=30):
    """Per-user supervised examples: the same prompt, with the correct letter as the completion.
    Used for the OPPU-style per-user SFT arm, the baseline the personalization literature implies."""
    out = []
    for t in targets:
        idx = t.candidates.index(t.true_item)
        out.append({"user": t.user, "prompt": render_prompt(t, cats, hist_n),
                    "completion": " " + LETTERS[idx]})
    return out


def heuristic_picks(targets, cats):
    """Category-preference heuristic: the structured-prior floor every model arm must beat."""
    picks = []
    for t in targets:
        hc = Counter(_cat(cats, i) for i in t.history)
        best, bi = -1, 0
        for i, c in enumerate(t.candidates):
            v = hc.get(_cat(cats, c), 0)
            if v > best:
                best, bi = v, i
        picks.append(bi)
    return picks


def random_picks(targets, seed=0):
    rng = random.Random(seed)
    return [rng.randrange(len(t.candidates)) for t in targets]
