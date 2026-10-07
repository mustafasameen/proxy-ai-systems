"""A small synthetic check-in release in the Massive-STEPS file layout, written by the tests.

Nothing here reads real data. The release has the features the task code has to handle: venues that are only ever visited in
2012-13, only in 2017-18 or in both, users who stay in one period and users who span both, users below the 20-check-in floor,
revisits, venues whose rendered label is shared (private homes, a coffee chain), and one pair of check-ins of one user with the
same timestamp.
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from proxy import datasets

DATASET = "steps_new_york"
HEADER = ["user_id", "venue_id", "latitude", "longitude", "name", "venue_category", "timestamp"]
CATEGORIES = ["Cafe", "Bar", "Gym", "Park", "Bakery", "Museum", "Bookstore", "Pizza Place"]
CLASS_SIZE = 300                                  # venues per class: visited in 2012-13 only, 2017-18 only, or both
TIE_USER = "u_tie"
TIE_VENUES = ("v_tie_b", "v_tie_a")               # file order; the task orders them by venue id, so a before b


def _venues(rng):
    """{class: [(venue_id, name, category)]}. Private homes and a coffee chain share one rendered label per group."""
    out = {}
    for cls in ("old", "new", "both"):
        rows = []
        for i in range(CLASS_SIZE):
            vid = f"v_{cls}_{i:03d}"
            if i < 6:
                rows.append((vid, "", "Home (private)"))
            elif i < 10:
                rows.append((vid, "Corner Cafe", "Coffee Shop"))
            else:
                rows.append((vid, f"Place {cls} {i}", rng.choice(CATEGORIES)))
        out[cls] = rows
    return out


def _zipf(rng, n):
    w = [1.0 / (r + 1) for r in range(n)]
    rng.shuffle(w)
    return w


def _timeline(rng, n, kind):
    """n strictly increasing timestamps. 'old' users live in 2012-13, 'new' ones in 2017-18, 'span' ones in both."""
    first = {"old": datetime(2012, 4, 1), "new": datetime(2017, 7, 1), "span": datetime(2012, 4, 1)}[kind]
    ts, t = [], first + timedelta(days=rng.randrange(0, 60))
    for i in range(n):
        if kind == "span" and i == int(n * 0.6):
            t = datetime(2017, 7, 1) + timedelta(days=rng.randrange(0, 60))
        t += timedelta(minutes=rng.randrange(30, 3000))
        ts.append(t)
    return ts


def make_rows(seed=2026, n_old=150, n_new=150, n_span=100, n_small=30):
    """Rows (a list of dicts keyed by HEADER) of the synthetic release."""
    rng = random.Random(seed)
    venues = _venues(rng)
    weights = {cls: _zipf(rng, CLASS_SIZE) for cls in venues}
    info = {v[0]: v for cls in venues.values() for v in cls}
    rows = []

    def draw_new(period):
        cls = rng.choices(["old", "both"] if period == 0 else ["new", "both"], weights=[7, 3], k=1)[0]
        return venues[cls][rng.choices(range(CLASS_SIZE), weights=weights[cls], k=1)[0]][0]

    def add(user, vid, ts):
        _, name, cat = info[vid]
        rows.append({"user_id": user, "venue_id": vid, "latitude": f"{40.6 + rng.random() * 0.2:.6f}",
                     "longitude": f"{-74.0 + rng.random() * 0.2:.6f}", "name": name, "venue_category": cat,
                     "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S")})

    plan = [("old", n_old, (25, 48)), ("new", n_new, (25, 48)), ("span", n_span, (25, 48)), ("old", n_small, (8, 15))]
    uid = 0
    for kind, count, (lo, hi) in plan:
        for _ in range(count):
            uid += 1
            n = rng.randrange(lo, hi + 1)
            seen = []
            for t in _timeline(rng, n, kind):
                period = int(t.year >= 2017)
                vid = rng.choice(seen) if seen and rng.random() < 0.3 else draw_new(period)
                seen.append(vid)
                add(f"u{uid:04d}", vid, t)

    # one user with two check-ins at the same second, written in reverse venue-id order, at the end of the pre-cut part
    ts = _timeline(rng, 25, "old")
    for i, t in enumerate(ts):
        if i in (18, 19):
            continue
        add(TIE_USER, draw_new(0), t)
    for vid in TIE_VENUES:
        info[vid] = (vid, f"Tie {vid}", "Cafe")
        add(TIE_USER, vid, ts[18])
    return rows


def write_release(root, rows=None):
    """Write the release under `root` the way datasets.REGISTRY lays it out. Returns the csv path."""
    path = Path(root) / "massive_steps" / "new_york" / "new_york_checkins.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        w.writerows(make_rows() if rows is None else rows)
    return path


@contextmanager
def registered(path, name=DATASET):
    """Point datasets.REGISTRY[name] at `path` for the duration of the block."""
    with mock.patch.dict(datasets.REGISTRY, {name: Path(path)}):
        yield


def genericness_table(rows, path):
    """Write a genericness table for every venue of `rows` (a score from a hash of the venue id, so it is fixed)."""
    scores = {r["venue_id"]: int(hashlib.md5(r["venue_id"].encode()).hexdigest()[:8], 16) / 16 ** 8 for r in rows}
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f)
    return path


def digest(targets):
    """md5 of a list of task.Target: user, true venue, the ordered options and the history of every one."""
    h = hashlib.md5()
    for t in targets:
        h.update(json.dumps([t.user, t.true_item, t.candidates, t.history]).encode())
    return h.hexdigest()
