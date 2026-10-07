"""Known answers: the options each distractor condition draws on the synthetic release.

Every hash is the md5 of the targets one call returns (user, true venue, ordered options and history of each). The values
were computed once. They change only when the sampling itself is meant to change.
"""
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest

from proxy import arms, task
from proxy.config import CANONICAL

from . import synthetic

HAVE_TORCH = importlib.util.find_spec("torch") is not None

TASK_BUILD = {"popmatched": "2a7f8944a66dd12f7141f4c3acc6c1cb", "popular": "9f9f155f918e4a397317df89df26fed0",
              "textmatched": "483d74587eeb53b8e55c59d175ddc34e"}
NOVEL_ROWS = {"popmatched": "b68bdd49edf8749287506ca90296ffa7", "popular": "a23741b9356dc2b5dca2a06ae787d1b5"}
NOVEL_ROWS_RETRIEVED_10 = "a5c043078e0c6b5314880e63f56ff784"


def rows_digest(targets, cats, **kw):
    """md5 of the lines hpc/build_targets.py writes for `targets`."""
    lines = "".join(json.dumps({"ds": synthetic.DATASET, "user": t.user, "k": len(t.candidates),
                                "answer_idx": t.candidates.index(t.true_item),
                                "prompt": arms.render_prompt_ordered(t, cats, **kw)}) + "\n" for t in targets)
    return hashlib.md5(lines.encode()).hexdigest()


class KnownAnswers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        rows = synthetic.make_rows()
        cls.genericness = synthetic.genericness_table(rows, os.path.join(cls._tmp.name, "genericness.json"))
        cls._reg = synthetic.registered(synthetic.write_release(cls._tmp.name, rows))
        cls._reg.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls._reg.__exit__(None, None, None)
        cls._tmp.cleanup()

    def build(self, **kw):
        if kw.get("distractors") == "textmatched":
            kw["genericness_path"] = self.genericness
        return task.build(synthetic.DATASET, **kw)

    def test_each_condition_draws_the_known_options(self):
        for mode, want in TASK_BUILD.items():
            targets, _ = self.build(k=5, min_events=20, test_frac=0.2, seed=0, distractors=mode)
            self.assertEqual(synthetic.digest(targets), want, mode)

    def test_a_call_that_names_nothing_is_the_canonical_condition(self):
        targets, n_users = self.build()
        self.assertEqual(synthetic.digest(targets), TASK_BUILD[CANONICAL["distractors"]])
        self.assertEqual(n_users, 401)

    def test_check_ins_with_the_same_timestamp_are_ordered_by_venue_id(self):
        targets, _ = self.build()
        history = next(t.history for t in targets if t.user == synthetic.TIE_USER)
        self.assertEqual(history[-2:], sorted(synthetic.TIE_VENUES))

    def test_prompts_of_the_shared_target_set(self):
        for mode, want in NOVEL_ROWS.items():
            targets, cats = arms.novel_targets(synthetic.DATASET, n_users=300, seed=0, distractors=mode)
            self.assertEqual(len(targets), 1268)
            self.assertEqual(rows_digest(targets, cats, hist_n=30, hist_order="recent"), want, mode)

    def test_retrieved_history(self):
        targets, cats = arms.novel_targets(synthetic.DATASET, n_users=300, seed=0, distractors="popmatched")
        lines = "".join(json.dumps({"user": t.user, "p": arms.render_prompt_ordered(t, cats, hist_n=10, hist_order="retrieved")})
                        + "\n" for t in targets)
        self.assertEqual(hashlib.md5(lines.encode()).hexdigest(), NOVEL_ROWS_RETRIEVED_10)

    @unittest.skipUnless(HAVE_TORCH, "seqrec imports torch")
    def test_sequential_baselines_regenerate_the_shared_target_set(self):
        from proxy import seqrec
        for mode in ("popmatched", "popular"):
            via_arms, _ = arms.novel_targets(synthetic.DATASET, n_users=300, seed=0, distractors=mode)
            via_seqrec, _ = seqrec.regenerate_targets(synthetic.DATASET, n_users=300, seed=0, distractors=mode)
            self.assertEqual(synthetic.digest(via_seqrec), synthetic.digest(via_arms), mode)
        default, _ = seqrec.regenerate_targets(synthetic.DATASET)
        canonical, _ = arms.novel_targets(synthetic.DATASET, n_users=300, seed=0, distractors="popmatched")
        self.assertEqual(synthetic.digest(default), synthetic.digest(canonical))


if __name__ == "__main__":
    unittest.main()
