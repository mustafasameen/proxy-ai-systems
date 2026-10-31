"""Pure functions behind the delegate: choice probabilities, the question it asks, what asking
is worth, calibration, and the paired bootstrap.

Nothing in this module reads or writes a file. A choice is a list of probabilities, one per
option (five in this project). Each option has a category, and the delegate's only question is
"is it a <category>?". Ties are broken the same way everywhere, so one set of scores always gives
one set of picks and questions:

  * argmax returns the lowest index among equal values;
  * the question with the largest information gain wins, and the first such question wins a tie.
"""
import hashlib
import math
import random
import statistics as st

LETTERS = "ABCDE"

# Seven fixed confidence bins [lo, hi). The last upper edge is above 1 so that 1.0 is counted.
BINS = [(0.0, 0.3), (0.3, 0.4), (0.4, 0.5), (0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 1.01)]

# 200 temperatures spaced evenly on a log scale, from 0.25 to 50.
T_GRID = [0.25 * (200.0 ** (i / 199)) for i in range(200)]


# ---------------------------------------------------------------------------- probabilities

def entropy(p):
    """Shannon entropy in nats. Zero probabilities contribute nothing."""
    return -sum(x * math.log(x) for x in p if x > 0)


def softmax(xs):
    """Probabilities proportional to exp(x), computed after subtracting the largest value."""
    m = max(xs)
    exps = [math.exp(x - m) for x in xs]
    z = sum(exps)
    return [e / z for e in exps]


def argmax(xs):
    """Index of the largest value. The lowest index wins a tie: scan from the left and replace
    the best so far only on a strictly greater value."""
    best_i, best_v = 0, xs[0]
    for i in range(1, len(xs)):
        if xs[i] > best_v:
            best_i, best_v = i, xs[i]
    return best_i


# ---------------------------------------------------------------------------- questions

def ig_of(p, yes_idx):
    """Expected information gain, in nats, of a yes/no question that splits the options into
    yes_idx (a set of indices) and the rest, under the probabilities p. Returns None when the
    question cannot split the probability mass (all of it is on one side)."""
    py = sum(p[i] for i in yes_idx)
    if py <= 0 or py >= 1:
        return None
    n = len(p)
    pyes = [p[i] / py if i in yes_idx else 0.0 for i in range(n)]
    pno = [0.0 if i in yes_idx else p[i] / (1 - py) for i in range(n)]
    return entropy(p) - (py * entropy(pyes) + (1 - py) * entropy(pno))


def evpi_of(p, yes_idx):
    """Expected accuracy gain of the same question: the expected top probability after the answer
    minus the top probability now. Returns None when the question cannot split the mass."""
    py = sum(p[i] for i in yes_idx)
    if py <= 0 or py >= 1:
        return None
    n = len(p)
    pyes = [p[i] / py if i in yes_idx else 0.0 for i in range(n)]
    pno = [0.0 if i in yes_idx else p[i] / (1 - py) for i in range(n)]
    return py * max(pyes) + (1 - py) * max(pno) - max(p)


def choose_ig_yes_idx(p, menu):
    """The yes-set of the question with the largest information gain.

    menu is a list of (label, yes_idx) pairs. A question that cannot split the mass is skipped.
    A later question must be strictly better to replace an earlier one, so the first admissible
    question wins a tie. Returns None when no question is admissible."""
    best_i, best_v = None, -1e18
    for i, (_, yes_idx) in enumerate(menu):
        v = ig_of(p, yes_idx)
        if v is not None and v > best_v:
            best_v, best_i = v, i
    return None if best_i is None else menu[best_i][1]


def menu_of(cats):
    """The distinct categories among the options, as yes/no questions: one (category, set of
    option indices) pair per category, in sorted category order."""
    return [(v, {i for i, c in enumerate(cats) if c == v}) for v in sorted(set(cats))]


def restrict(p, keep):
    """The probabilities p cut down to the indices in keep and renormalised to sum to one."""
    z = sum(p[i] for i in keep)
    return [p[i] / z if i in keep else 0.0 for i in range(len(p))]


# ---------------------------------------------------------------------------- thresholds, masks

def quantile(sorted_vals, q):
    """Quantile of an already sorted list by linear interpolation between neighbours (the default
    method of numpy.quantile). An empty list gives 0.0; q at or below 0 gives the first value and
    q at or above 1 the last."""
    n = len(sorted_vals)
    if n == 0:
        return 0.0
    if n == 1 or q <= 0:
        return sorted_vals[0]
    if q >= 1:
        return sorted_vals[-1]
    pos = q * (n - 1)
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    if lo == hi:
        return sorted_vals[lo]
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def mask_random(n, rate, seed):
    """A seeded random subset of size round(rate * n) of range(n), as a list of n booleans."""
    k = min(n, max(0, round(rate * n)))
    rng = random.Random(seed)
    chosen = set(rng.sample(range(n), k))
    return [i in chosen for i in range(n)]


def value_threshold(gains, rate):
    """Threshold for asking on the `rate` share of decisions with the largest expected gain: ask
    when gain >= threshold. A rate of 0 or less asks never and 1 or more asks always."""
    if rate <= 0:
        return math.inf
    if rate >= 1:
        return -math.inf
    return quantile(sorted(gains), 1 - rate)


def confidence_threshold(maxps, rate):
    """Threshold for asking on the `rate` share of decisions with the lowest top probability: ask
    when top probability <= threshold. A rate of 0 or less asks never and 1 or more asks always."""
    if rate <= 0:
        return -math.inf
    if rate >= 1:
        return math.inf
    return quantile(sorted(maxps), rate)


# ---------------------------------------------------------------------------- prompts

def split_name_category(text):
    """'Cafe Grumpy (Coffee Shop)' gives ('Cafe Grumpy', 'Coffee Shop'). Parentheses inside the
    category are kept. A bare string is an unnamed venue and its text is the category."""
    text = text.strip()
    if not text.endswith(")"):
        return "", text
    depth = 0
    for i in range(len(text) - 1, -1, -1):
        if text[i] == ")":
            depth += 1
        elif text[i] == "(":
            depth -= 1
            if depth == 0:
                return text[:i].strip(), text[i + 1:-1].strip()
    return "", text


HIST_HEAD = "A person's recent places (most recent last):\n"
TOP_HEAD = "\nTheir most frequent categories: "
# Category names that appear in these files only without a venue name.
EXTRA_BARE_CATEGORIES = frozenset({"Water Park"})


def depth0_split(line):
    """Split the recent-places line at ', ' where no parenthesis is open."""
    out, depth, cur, i = [], 0, "", 0
    while i < len(line):
        ch = line[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if depth == 0 and line.startswith(", ", i):
            out.append(cur)
            cur, i = "", i + 2
            continue
        cur += ch
        i += 1
    if cur:
        out.append(cur)
    return out


def category_vocabulary(prompts):
    """Every category name used in the given prompts: categories of named recent places, the
    most-frequent-categories line, and the options, plus EXTRA_BARE_CATEGORIES."""
    cats = set(EXTRA_BARE_CATEGORIES)
    for prompt in prompts:
        hist_line, rest = prompt.split(HIST_HEAD, 1)[1].split(TOP_HEAD, 1)
        for frag in depth0_split(hist_line.strip()):
            name, cat = split_name_category(frag)
            if name:
                cats.add(cat)
        cats.update(c.strip() for c in rest.split("\n", 1)[0].split(", "))
        for line in prompt.split("\n"):
            line = line.strip()
            if len(line) > 3 and line[0] in LETTERS and line[1:3] == ". ":
                cats.add(split_name_category(line[3:])[1])
    return cats


def parse_history(line, vocabulary):
    """The recent places of one prompt. A fragment with no category in parentheses is an unnamed
    place when it is a known category name, and otherwise the first part of a venue name that
    contains a comma."""
    out, carry = [], ""
    for frag in depth0_split(line):
        frag = carry + ", " + frag if carry else frag
        carry = ""
        if not frag.endswith(")") and frag not in vocabulary:
            carry = frag
            continue
        out.append(frag)
    if carry:
        out.append(carry)
    return out


def parse_prompt(prompt, vocabulary=None):
    """Read a decision prompt. Returns (history, top, cands):

      history  the person's recent places, oldest first, as {"name": ..., "category": ...}
      top      their most frequent categories
      cands    the options, in order, as (name, category) pairs

    The prompt has a line of recent places after "A person's recent places (most recent
    last):", a line after "Their most frequent categories:", and one option per line written
    "A. name (category)". A ValueError is raised when a marker is missing. vocabulary is the set
    of known category names (category_vocabulary over every decision file in use); without it,
    the names found in this prompt are used."""
    head, rest = prompt.split(HIST_HEAD, 1)
    hist_line, rest = rest.split(TOP_HEAD, 1)
    top_line, rest = rest.split("\n", 1)
    if vocabulary is None:
        vocabulary = category_vocabulary([prompt])
    items = parse_history(hist_line.strip(), vocabulary)
    history = [dict(zip(("name", "category"), split_name_category(s))) for s in items]
    cands = []
    for line in rest.split("\n"):
        line = line.strip()
        if len(line) > 3 and line[0] in LETTERS and line[1:3] == ". ":
            cands.append(split_name_category(line[3:]))
    top = [c.strip() for c in top_line.split(", ")]
    return history, top, cands


# ---------------------------------------------------------------------------- one decision

def decision_record(p, cats, answer):
    """One decision as the delegate sees it, for choice probabilities p, the option categories
    cats and the index of the option the person really chose.

    The delegate picks argmax(p). It also finds the yes/no category question with the most
    information (None when no question can split the mass) and the expected accuracy gain from
    asking it. When it asks, the answer comes from the person's real choice, so the pick after
    asking is the argmax of the probabilities restricted to the side that holds the true answer.

    Keys: p, pick, maxp (top probability), pick_ask (pick after the answer), gain (expected
    accuracy gain, never negative), yes (the question's set of option indices or None),
    question (its category or None), post_yes and post_no (probabilities after each answer)."""
    k = len(p)
    pick = argmax(p)
    yes = choose_ig_yes_idx(p, menu_of(cats))
    if yes is None:
        return dict(p=p, pick=pick, maxp=max(p), pick_ask=pick, gain=0.0, yes=None,
                    question=None, post_yes=p, post_no=p)
    g = evpi_of(p, yes)
    gain = 0.0 if g is None else max(0.0, g)
    post_yes = restrict(p, yes)
    post_no = restrict(p, set(range(k)) - yes)
    post = post_yes if answer in yes else post_no
    return dict(p=p, pick=pick, maxp=max(p), pick_ask=argmax(post), gain=gain, yes=yes,
                question=cats[min(yes)], post_yes=post_yes, post_no=post_no)


def accuracy_with_questions(recs, mask):
    """Share of decisions right when the delegate asks where mask is True (using its pick after
    the answer) and acts on its own pick elsewhere. recs are decision records with the person's
    real choice added under the key "answer"."""
    return sum((x["pick_ask"] if m else x["pick"]) == x["answer"]
               for x, m in zip(recs, mask)) / len(recs)


def per_user_accuracy(recs, mask=None):
    """Accuracy of each person: their own picks, or the pick after the answer where mask is True.
    Returns {user: accuracy}. recs carry the keys "user" and "answer"."""
    per = {}
    for i, x in enumerate(recs):
        ask = mask is not None and mask[i]
        per.setdefault(x["user"], []).append((x["pick_ask"] if ask else x["pick"]) == x["answer"])
    return {u: st.mean(v) for u, v in per.items()}


# ---------------------------------------------------------------------------- calibration

def fit_temperature(logit_rows, answers, grid=T_GRID):
    """The grid temperature with the lowest mean negative log-likelihood of the true option.

    logit_rows holds one list of scores per decision, answers the index of the true option.
    Probabilities are softmax(scores / T). The first temperature on the grid wins a tie."""
    if not logit_rows:
        raise ValueError("no rows to fit a temperature on")
    best_t, best_nll = None, float("inf")
    for t in grid:
        nll = 0.0
        for xs, a in zip(logit_rows, answers):
            p = softmax([v / t for v in xs])
            nll -= math.log(max(p[a], 1e-300))
        nll /= len(logit_rows)
        if nll < best_nll:
            best_t, best_nll = t, nll
    return best_t


def fold_of(user):
    """Fold 0 or 1 of a person, from a fixed hash of their id, so the split never changes."""
    return int(hashlib.sha256(str(user).encode()).hexdigest(), 16) % 2


def crossfit_temperatures(logit_rows, answers, users, grid=T_GRID):
    """Two-fold cross-fitted temperatures. The temperature to use on a fold is fitted on the
    rows of the other fold. Returns {0: temperature for fold 0, 1: temperature for fold 1}."""
    folds = {k: [i for i, u in enumerate(users) if fold_of(u) == k] for k in (0, 1)}
    temps = {}
    for k in (0, 1):
        idx = folds[1 - k]
        temps[k] = fit_temperature([logit_rows[i] for i in idx], [answers[i] for i in idx], grid)
    return temps


def calibration_bins(maxps, correct, bins=BINS):
    """Reliability bins. For every non-empty bin [lo, hi) of the top probability, returns a
    dict with lo, hi, n, confidence (mean top probability) and accuracy (share right)."""
    out = []
    for lo, hi in bins:
        idx = [i for i, c in enumerate(maxps) if lo <= c < hi]
        if idx:
            out.append(dict(lo=lo, hi=hi, n=len(idx),
                            confidence=sum(maxps[i] for i in idx) / len(idx),
                            accuracy=sum(correct[i] for i in idx) / len(idx)))
    return out


def expected_calibration_error(maxps, correct, bins=BINS):
    """Expected calibration error: the bin-size weighted mean gap between confidence and
    accuracy over the seven fixed bins."""
    n = len(maxps)
    ece = 0.0
    for b in calibration_bins(maxps, correct, bins):
        ece += b["n"] / n * abs(b["confidence"] - b["accuracy"])
    return ece


# ---------------------------------------------------------------------------- bootstrap

def paired_bootstrap(a, b, n_boot=4000, seed=0):
    """Paired bootstrap over people of the difference a - b of two per-person values.

    a and b map person to value; only people in both are used, in sorted order. Each draw
    resamples the people with replacement and takes the mean difference. Returns
    [mean difference, 2.5th percentile, 97.5th percentile] of the draws."""
    users = sorted(set(a) & set(b))
    if not users:
        raise ValueError("no people in common")
    d = [a[u] - b[u] for u in users]
    rng = random.Random(seed)
    boots = sorted(st.mean(rng.choice(d) for _ in d) for _ in range(n_boot))
    return [st.mean(d), boots[int(0.025 * n_boot)], boots[int(0.975 * n_boot) - 1]]
