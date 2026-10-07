"""Every entry point reads its defaults from src/proxy/config.py, and the canonical values are the documented ones."""
import importlib.util
import inspect
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from proxy import arms, task
from proxy.config import CANONICAL

from . import synthetic

ROOT = Path(__file__).resolve().parents[1]
HAVE_TORCH = importlib.util.find_spec("torch") is not None


def default(fn, name):
    return inspect.signature(fn).parameters[name].default


class CanonicalValues(unittest.TestCase):
    def test_values(self):
        self.assertEqual(CANONICAL, {"dataset": "steps_new_york", "distractors": "popmatched", "n_users": 300, "seed": 0,
                                     "hist_n": 30, "hist_order": "recent", "k": 5})


class FunctionDefaults(unittest.TestCase):
    def test_task(self):
        self.assertEqual(default(task.build, "distractors"), CANONICAL["distractors"])
        self.assertEqual(default(task.build, "seed"), CANONICAL["seed"])
        self.assertEqual(default(task.build, "k"), CANONICAL["k"])
        self.assertEqual(task.K, CANONICAL["k"])

    def test_arms(self):
        self.assertEqual(default(arms.novel_targets, "seed"), CANONICAL["seed"])
        for fn in (arms.render_prompt, arms.render_prompt_ordered, arms.sft_examples):
            self.assertEqual(default(fn, "hist_n"), CANONICAL["hist_n"], fn.__name__)
        self.assertEqual(default(arms.render_prompt_ordered, "hist_order"), CANONICAL["hist_order"])

    @unittest.skipUnless(HAVE_TORCH, "seqrec imports torch")
    def test_sequential_baselines(self):
        from proxy import seqrec
        for fn in (seqrec.regenerate_targets, seqrec.regenerate_full):
            self.assertEqual(default(fn, "distractors"), CANONICAL["distractors"], fn.__name__)
            self.assertEqual(default(fn, "seed"), CANONICAL["seed"], fn.__name__)
            self.assertEqual(default(fn, "n_users"), CANONICAL["n_users"], fn.__name__)
        self.assertEqual(default(seqrec.build_vocab, "seed"), CANONICAL["seed"])
        self.assertEqual(seqrec.BUILD_ARGS["distractors"], CANONICAL["distractors"])
        self.assertEqual(seqrec.BUILD_ARGS["k"], CANONICAL["k"])
        self.assertEqual(seqrec.HIST_N, CANONICAL["hist_n"])


class BuildTargetsDefaults(unittest.TestCase):
    """hpc/build_targets.py with only --out is the canonical call, on a synthetic release large enough to see every default."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name)
        synthetic.write_release(cls.root)
        cls.n_runs = 0
        cls.base = cls.run_cli()

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    @classmethod
    def run_cli(cls, *args):
        cls.n_runs += 1
        out = cls.root / f"targets_{cls.n_runs}.jsonl"
        env = dict(os.environ, PROXY_DATA_ROOT=str(cls.root))
        subprocess.run([sys.executable, str(ROOT / "hpc" / "build_targets.py"), "--out", str(out), *args],
                       check=True, capture_output=True, env=env)
        return out.read_bytes()

    def test_no_option_is_the_canonical_call(self):
        explicit = self.run_cli("--dataset", CANONICAL["dataset"], "--distractors", CANONICAL["distractors"],
                                "--n-users", str(CANONICAL["n_users"]), "--seed", str(CANONICAL["seed"]),
                                "--hist-n", str(CANONICAL["hist_n"]), "--hist-order", CANONICAL["hist_order"])
        self.assertEqual(self.base, explicit)

    def test_the_canonical_file_has_the_canonical_shape(self):
        rows = [json.loads(line) for line in self.base.decode().splitlines()]
        self.assertEqual(len({r["user"] for r in rows}), CANONICAL["n_users"])
        self.assertEqual({r["k"] for r in rows}, {CANONICAL["k"]})
        self.assertEqual({r["ds"] for r in rows}, {CANONICAL["dataset"]})
        shown = [len(r["prompt"].split("\n")[1].strip().split(", ")) for r in rows]
        self.assertEqual(max(shown), CANONICAL["hist_n"])


if __name__ == "__main__":
    unittest.main()
