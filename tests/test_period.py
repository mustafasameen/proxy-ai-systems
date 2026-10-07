"""popmatched_period: no option differs from the true venue in pre-cut period profile, and every option is active in the
decision's period. The checks use a second implementation written here from the raw rows, not src/proxy/period.py."""
import tempfile
import unittest
from collections import Counter, defaultdict
from datetime import datetime

from proxy import task

from . import synthetic

FORMAT = "%Y-%m-%d %H:%M:%S"


def label(name, category):
    return f"{name} ({category})" if name else category


class Release:
    """What the checks need, from the raw rows: held-out decisions per user in order, venue profiles, activity, labels."""

    def __init__(self, rows, min_events=20, test_frac=0.2):
        per, self.labels = defaultdict(list), {}
        for r in rows:
            per[r["user_id"]].append((datetime.strptime(r["timestamp"], FORMAT), r["venue_id"]))
            self.labels[r["venue_id"]] = label(r["name"], r["venue_category"])
        pre, self.active, self.decisions, self.history = defaultdict(set), defaultdict(set), {}, {}
        for user, evs in per.items():
            evs.sort()
            for ts, venue in evs:
                self.active[venue].add(ts.year >= 2017)
            if len(evs) >= min_events:
                cut = int(len(evs) * (1 - test_frac))
                for ts, venue in evs[:cut]:
                    pre[venue].add(ts.year >= 2017)
                self.decisions[user] = [(ts.year >= 2017, venue) for ts, venue in evs[cut:]]
                self.history[user] = {venue for _, venue in evs[:cut]}
        self.pre = pre

    def profile(self, venue):
        return (False in self.pre[venue], True in self.pre[venue])


class PeriodMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        rows = synthetic.make_rows()
        cls.release = Release(rows)
        cls._reg = synthetic.registered(synthetic.write_release(cls._tmp.name, rows))
        cls._reg.__enter__()
        cls.stats = {}
        cls.targets, _ = task.build(synthetic.DATASET, distractors="popmatched_period", fallback_stats=cls.stats)
        cls.plain, _ = task.build(synthetic.DATASET, distractors="popmatched")

    @classmethod
    def tearDownClass(cls):
        cls._reg.__exit__(None, None, None)
        cls._tmp.cleanup()

    def decisions(self, targets):
        """(target, decision period, true venue of the held-out event) pairs; every held-out decision has one target."""
        by_user, out = defaultdict(list), []
        for t in targets:
            by_user[t.user].append(t)
        for user, ts in by_user.items():
            self.assertEqual(len(ts), len(self.release.decisions[user]), user)
            out += [(t, period, venue) for t, (period, venue) in zip(ts, self.release.decisions[user])]
        return out

    def test_every_held_out_decision_has_a_question(self):
        self.assertEqual(self.stats.get("n_dropped", 0), 0)
        self.assertEqual(len(self.targets), sum(len(d) for d in self.release.decisions.values()))
        self.assertEqual(self.stats["n_rows"], len(self.targets))

    def test_no_option_differs_in_pre_cut_period_profile(self):
        for t, _, venue in self.decisions(self.targets):
            self.assertEqual(t.true_item, venue)
            for c in t.candidates:
                self.assertEqual(self.release.profile(c), self.release.profile(t.true_item), (t.user, c))

    def test_every_option_has_a_check_in_in_the_decisions_period(self):
        for t, period, _ in self.decisions(self.targets):
            for c in t.candidates:
                self.assertIn(period, self.release.active[c], (t.user, c))

    def test_each_question_is_one_true_venue_and_four_distinct_distractors(self):
        for t in self.targets:
            self.assertEqual(len(t.candidates), 5)
            self.assertEqual(t.candidates.count(t.true_item), 1)
            self.assertEqual(len(set(t.candidates)), 5)
            self.assertFalse(set(t.candidates) - {t.true_item} & self.release.history[t.user])
            self.assertEqual(len({self.release.labels[c] for c in t.candidates}), 5, t.user)

    def test_the_checks_can_fail(self):
        """The synthetic release has every profile and both periods, and plain popmatched breaks the constraint."""
        decisions = self.decisions(self.targets)
        self.assertEqual({self.release.profile(v) for _, _, v in decisions}, {(a, b) for a in (False, True) for b in (False, True)})
        self.assertEqual({period for _, period, _ in decisions}, {False, True})
        off_profile = sum(any(self.release.profile(c) != self.release.profile(t.true_item) for c in t.candidates)
                          for t in self.plain)
        off_period = sum(any(period not in self.release.active[c] for c in t.candidates)
                         for t, period, _ in self.decisions(self.plain))
        self.assertGreater(off_profile, len(self.plain) // 4)
        self.assertGreater(off_period, 0)

    def test_the_condition_is_deterministic_and_follows_the_seed(self):
        again, _ = task.build(synthetic.DATASET, distractors="popmatched_period")
        other, _ = task.build(synthetic.DATASET, distractors="popmatched_period", seed=1)
        self.assertEqual(synthetic.digest(again), synthetic.digest(self.targets))
        self.assertNotEqual(synthetic.digest(other), synthetic.digest(self.targets))

    def test_it_is_off_unless_named(self):
        default, _ = task.build(synthetic.DATASET)
        self.assertEqual(synthetic.digest(default), synthetic.digest(self.plain))
        self.assertNotEqual(synthetic.digest(default), synthetic.digest(self.targets))


class NoPool(unittest.TestCase):
    def test_a_decision_without_a_matching_pool_is_dropped_and_counted(self):
        """Six venues cannot give any decision four distractors outside the user's history."""
        rows = []
        for user in ("a", "b"):
            for i in range(25):
                rows.append({"user_id": user, "venue_id": f"v{i % 6}", "latitude": "40.7", "longitude": "-74.0",
                             "name": f"Place {i % 6}", "venue_category": "Cafe",
                             "timestamp": datetime(2012, 5, 1 + i // 24, i % 24, 0).strftime(FORMAT)})
        with tempfile.TemporaryDirectory() as tmp, synthetic.registered(synthetic.write_release(tmp, rows)):
            stats = {}
            targets, n_users = task.build(synthetic.DATASET, distractors="popmatched_period", fallback_stats=stats)
        self.assertEqual((targets, n_users), ([], 2))
        self.assertEqual(stats, {"n_rows": 10, "n_dropped": 10})


if __name__ == "__main__":
    unittest.main()
