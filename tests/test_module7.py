"""The first model exploration: the distance function, the prompt with and without the distance cue, the metrics on toy inputs,
and the development split. Run from the repository root with `python -m unittest` or `pytest`."""
import math
import sys
import tempfile
import unittest
from pathlib import Path

from proxy import arms, geo, ranking
from proxy.config import CANONICAL
from proxy.datasets import Event

from . import synthetic

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
import score_prompted  # noqa: E402

HALF_CIRCLE = math.pi * geo.EARTH_R_KM


class Distance(unittest.TestCase):
    def test_same_point_is_zero(self):
        self.assertEqual(geo.haversine_km(40.7, -74.0, 40.7, -74.0), 0.0)

    def test_antipodes_are_half_the_circumference(self):
        # a generic antipodal pair is exact only to the float rounding of the degrees (about 0.1 m here)
        self.assertAlmostEqual(geo.haversine_km(40.0, -74.0, -40.0, 106.0), HALF_CIRCLE, delta=1e-3)
        self.assertAlmostEqual(geo.haversine_km(90.0, 0.0, -90.0, 0.0), HALF_CIRCLE, places=6)
        self.assertAlmostEqual(geo.haversine_km(0.0, 0.0, 0.0, 180.0), HALF_CIRCLE, places=6)

    def test_one_degree_of_latitude_and_symmetry(self):
        self.assertAlmostEqual(geo.haversine_km(0.0, 0.0, 1.0, 0.0), math.radians(1) * geo.EARTH_R_KM, places=9)
        self.assertEqual(geo.haversine_km(40.7, -74.0, 40.8, -73.9), geo.haversine_km(40.8, -73.9, 40.7, -74.0))

    def test_longitude_wraps_around_the_date_line(self):
        self.assertAlmostEqual(geo.haversine_km(0.0, 179.5, 0.0, -179.5), math.radians(1) * geo.EARTH_R_KM, places=9)

    def test_known_city_pair(self):
        # Times Square to the Statue of Liberty is about 8.7 km on the ground
        d = geo.haversine_km(40.7580, -73.9855, 40.6892, -74.0445)
        self.assertTrue(8.0 < d < 9.5, d)

    def test_missing_coordinates_give_none(self):
        for args in [(None, -74.0, 40.7, -74.0), (40.7, None, 40.7, -74.0), (40.7, -74.0, None, None),
                     (float("nan"), -74.0, 40.7, -74.0)]:
            self.assertIsNone(geo.haversine_km(*args))

    def test_nearest_in_a_history(self):
        hist = [(0.0, 0.0), None, (0.0, 2.0)]
        self.assertAlmostEqual(geo.nearest_km((0.0, 1.9), hist), math.radians(0.1) * geo.EARTH_R_KM, places=9)
        self.assertIsNone(geo.nearest_km(None, hist))                # an unlocated option has no distance
        self.assertIsNone(geo.nearest_km((0.0, 0.0), [None, None]))  # a history with no located place gives none
        self.assertIsNone(geo.nearest_km((0.0, 0.0), []))
        self.assertEqual(geo.nearest_km((0.0, 0.0), [(0.0, 0.0)]), 0.0)

    def test_candidate_distances_use_the_whole_history(self):
        coords = {"h1": (0.0, 0.0), "h2": (10.0, 10.0), "c1": (10.0, 10.1), "c2": (50.0, 50.0)}
        d = geo.candidate_distances(["c1", "c2", "unknown"], ["h1", "h2", "no_coords"], coords)
        self.assertAlmostEqual(d[0], geo.haversine_km(10.0, 10.1, 10.0, 10.0))
        self.assertAlmostEqual(d[1], geo.haversine_km(50.0, 50.0, 10.0, 10.0))
        self.assertIsNone(d[2])

    def test_coordinate_table_keeps_the_first_located_event(self):
        ev = [Event("u", None, "v", lat=None, lon=None), Event("u", None, "v", lat=1.0, lon=2.0),
              Event("u", None, "v", lat=3.0, lon=4.0)]
        self.assertEqual(geo.coordinate_table(ev), {"v": (1.0, 2.0)})


class Prompt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls._reg = synthetic.registered(synthetic.write_release(cls._tmp.name))
        cls._reg.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls._reg.__exit__(None, None, None)
        cls._tmp.cleanup()

    def test_cue_changes_only_the_distance_text(self):
        rows = score_prompted.build_rows(n_users=20)
        self.assertTrue(rows)
        for r in rows[:25]:
            plain, cued = r["prompt"], geo.add_cue(r["prompt"], r["cand_km"])
            self.assertEqual(geo.strip_cue(cued), plain)
            pl, cl = plain.split("\n"), cued.split("\n")
            self.assertEqual(len(pl), len(cl))
            diff = [i for i, (a, b) in enumerate(zip(pl, cl)) if a != b]
            self.assertEqual(len(diff), 5)                                   # the five option lines and no other line
            for j, i in enumerate(diff):
                self.assertTrue(cl[i].startswith(pl[i]))
                self.assertEqual(cl[i][len(pl[i]):], geo.cue_text(r["cand_km"][j]))
            self.assertEqual(cl[0], pl[0])                                   # history block untouched

    def test_cue_text(self):
        self.assertEqual(geo.cue_text(None), " [distance unknown]")
        self.assertEqual(geo.cue_text(1.24), " [1.2 km from the nearest place in their history]")
        self.assertEqual(geo.cue_text(0.0), " [0.0 km from the nearest place in their history]")

    def test_cue_refuses_a_prompt_of_another_shape_and_a_second_cue(self):
        with self.assertRaises(ValueError):
            geo.add_cue("not a prompt", [1.0] * 5)
        p = score_prompted.build_rows(n_users=5)[0]
        once = geo.add_cue(p["prompt"], p["cand_km"])
        with self.assertRaises(ValueError):
            geo.add_cue(once, p["cand_km"])

    def test_the_rows_are_the_canonical_prompts(self):
        targets, cats = arms.novel_targets(synthetic.DATASET, n_users=20, seed=CANONICAL["seed"])
        rows = score_prompted.build_rows(n_users=20)
        self.assertEqual([r["prompt"] for r in rows], [arms.render_prompt(t, cats) for t in targets])
        self.assertEqual([r["answer_idx"] for r in rows], [t.candidates.index(t.true_item) for t in targets])

    def test_chat_wrapper_adds_the_generation_prompt_only(self):
        class Tok:
            def apply_chat_template(self, msgs, tokenize, add_generation_prompt):
                return f"<u>{msgs[0]['content']}</u><a>" if add_generation_prompt and not tokenize else None
        self.assertEqual(score_prompted.chat_prompts(Tok(), ["p", "q"]), ["<u>p</u><a>", "<u>q</u><a>"])

    def test_development_split_has_no_test_user(self):
        dev = score_prompted.build_rows(n_users=100)
        dev_users = {r["user"] for r in dev}
        test, _ = arms.novel_targets(synthetic.DATASET, n_users=100, seed=ranking.TEST_SEED, exclude_users=dev_users)
        test_users = {t.user for t in test}
        self.assertEqual(len(dev_users), 100)
        self.assertEqual(len(test_users), 100)
        self.assertFalse(dev_users & test_users)
        # without the exclusion the two seeds do overlap, so the exclusion is what keeps the samples apart
        plain, _ = arms.novel_targets(synthetic.DATASET, n_users=100, seed=ranking.TEST_SEED)
        self.assertTrue(dev_users & {t.user for t in plain})

    def test_the_test_seed_is_refused(self):
        with self.assertRaises(ValueError):
            score_prompted.build_rows(seed=ranking.TEST_SEED, n_users=5)


class Metrics(unittest.TestCase):
    ROWS = [  # user, answer, pick, log-probs
        {"user": "a", "answer_idx": 0, "pick": 0, "logprobs": [-0.1, -2.0, -3.0, -4.0, -5.0]},   # rank 1
        {"user": "a", "answer_idx": 1, "pick": 0, "logprobs": [-0.5, -1.0, -3.0, -4.0, -5.0]},   # rank 2
        {"user": "b", "answer_idx": 4, "pick": 0, "logprobs": [-0.5, -1.0, -3.0, -4.0, -5.0]},   # rank 5
        {"user": "b", "answer_idx": 2, "pick": 2, "logprobs": [-3.0, -2.0, -0.2, -4.0, -5.0]},   # rank 1
    ]

    def test_ranks(self):
        self.assertEqual([ranking.rank_of(r["logprobs"], r["answer_idx"]) for r in self.ROWS], [1, 2, 5, 1])
        self.assertEqual(ranking.rank_of([-1.0] * 5, 3), 1)                # a tie is not counted against the answer

    def test_top1_acc2_mrr(self):
        self.assertEqual(ranking.top1(self.ROWS), 0.5)
        self.assertEqual(ranking.acc_at(self.ROWS, 2), 0.75)
        self.assertEqual(ranking.acc_at(self.ROWS, 5), 1.0)
        self.assertAlmostEqual(ranking.mrr(self.ROWS), (1 + 0.5 + 0.2 + 1) / 4)

    def test_probs_sum_to_one(self):
        p = ranking.probs([-1.0, -2.0, -3.0, -4.0, -5.0])
        self.assertAlmostEqual(float(p.sum()), 1.0)
        self.assertEqual(int(p.argmax()), 0)

    def test_per_user_accuracy(self):
        self.assertEqual(ranking.per_user_accuracy(self.ROWS), {"a": 0.5, "b": 0.5})

    def test_pooled_accuracy_interval(self):
        acc, lo, hi = ranking.pooled_accuracy_ci(self.ROWS)
        self.assertEqual(acc, 0.5)
        self.assertTrue(lo <= acc <= hi)
        self.assertEqual(ranking.pooled_accuracy_ci(self.ROWS), (acc, lo, hi))    # fixed seed
        all_right = [dict(r, pick=r["answer_idx"]) for r in self.ROWS]
        self.assertEqual(ranking.pooled_accuracy_ci(all_right), (1.0, 1.0, 1.0))

    def test_sign_test(self):
        self.assertEqual(ranking.sign_test_p(0, 0), 1.0)
        self.assertEqual(ranking.sign_test_p(5, 5), 1.0)
        self.assertAlmostEqual(ranking.sign_test_p(0, 10), 2 / 1024)

    def test_nearest_rule(self):
        self.assertEqual(ranking.nearest_rule_pick([3.0, 1.0, None, 2.0, 5.0]), 1)
        self.assertEqual(ranking.nearest_rule_pick([None, None, 4.0, None, None]), 2)    # an option with no distance ranks last
        self.assertEqual(ranking.nearest_rule_pick([2.0, 2.0, 3.0, 4.0, 5.0]), 0)        # ties go to the earlier letter
        self.assertEqual(ranking.nearest_rule_pick([None] * 5), 0)

    def test_popularity_and_random(self):
        self.assertEqual(ranking.popularity_pick([3, 9, 9, 1, 0]), 1)
        a, b = ranking.random_picks(50, seed=0), ranking.random_picks(50, seed=0)
        self.assertEqual(a, b)
        self.assertTrue(all(0 <= x < 5 for x in a))


if __name__ == "__main__":
    unittest.main()
