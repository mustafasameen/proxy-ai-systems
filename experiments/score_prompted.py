"""Score the development questions with a prompted instruction-tuned model, zero-shot, and measure what it costs.

Run 1 renders each question as the canonical prompt (src/proxy/arms.py). Run 2 (--distance-cue) adds one phrase to each option
line, the distance in km from that option to the nearest place in the person's history (src/proxy/geo.py), and nothing else.
Both runs read the same rows, decode greedily with the answer constrained to the letters A to E, and write one prediction per
question plus a run file with the full configuration and the measured constraints.

Two passes over the same prompts. The decode pass picks the letter with vLLM's constrained choice decoding. The log-prob pass
reads the five letter log-probabilities (normalized over the five letters) that the ranking metrics need. The prediction is the
decoded letter, and the run file counts the rows on which it differs from the largest log-prob.

Rows. --targets names a JSONL file of development questions. If it does not exist, it is built from the dataset (PROXY_DATA_ROOT, see
src/proxy/datasets.py) with the canonical configuration and written there, so the scoring job itself needs no dataset when the file
is already in place. --build-only writes the file and stops. The file holds the 300 development users only (seed 0). The seed of the
held-out test users is refused.

    python experiments/score_prompted.py --build-only --targets results/targets/dev_rows.jsonl
    python experiments/score_prompted.py --targets results/targets/dev_rows.jsonl --name run1
    python experiments/score_prompted.py --targets results/targets/dev_rows.jsonl --name run2 --distance-cue
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from proxy.arms import LETTERS, novel_targets, parse_choice, render_prompt_ordered  # noqa: E402
from proxy.config import CANONICAL  # noqa: E402
from proxy.datasets import load  # noqa: E402
from proxy.geo import add_cue, candidate_distances, coordinate_table  # noqa: E402
from proxy.ranking import TEST_SEED  # noqa: E402

MODEL = "meta-llama/Llama-3.1-8B-Instruct"
REVISION = "0e9e39f2"            # the commit of the model files, a prefix is enough
BATCH = 512                      # prompts per generate call


def rows_from(targets, cats, coords, dataset=CANONICAL["dataset"], hist_n=CANONICAL["hist_n"], hist_order=CANONICAL["hist_order"]):
    """One dict per decision: the canonical prompt, the answer index and, per option, the distance in km to the nearest place in
    the person's whole earlier history (None when it cannot be computed)."""
    rows = []
    for t in targets:
        d = candidate_distances(t.candidates, t.history, coords)
        rows.append({"ds": dataset, "user": t.user, "k": len(t.candidates), "answer_idx": t.candidates.index(t.true_item),
                     "prompt": render_prompt_ordered(t, cats, hist_n=hist_n, hist_order=hist_order),
                     "cand_km": [None if x is None else round(x, 6) for x in d]})
    return rows


def build_rows(dataset=CANONICAL["dataset"], distractors=CANONICAL["distractors"], n_users=CANONICAL["n_users"],
               seed=CANONICAL["seed"], hist_n=CANONICAL["hist_n"], hist_order=CANONICAL["hist_order"]):
    """The development questions, built from the dataset with the canonical configuration."""
    if seed == TEST_SEED:
        raise ValueError("this seed draws the held-out test users; development questions use the canonical seed")
    targets, cats = novel_targets(dataset, n_users=n_users, seed=seed, distractors=distractors)
    return rows_from(targets, cats, coordinate_table(load(dataset)), dataset, hist_n, hist_order)


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def read_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f]


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def resolve_revision(model, revision):
    """A commit prefix becomes the full commit when the local Hugging Face cache holds that snapshot (an offline job cannot
    expand a prefix). Otherwise the revision is passed through unchanged."""
    home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    snaps = Path(os.environ.get("HF_HUB_CACHE", Path(home) / "hub")) / ("models--" + model.replace("/", "--")) / "snapshots"
    if snaps.is_dir():
        hits = [p.name for p in snaps.iterdir() if p.name.startswith(revision)]
        if len(hits) == 1:
            return hits[0]
    return revision


def chat_prompts(tok, prompts):
    """The text the model sees: each prompt as one user turn, with the template's generation prompt after it."""
    return [tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True)
            for p in prompts]


class GpuPeak:
    """Peak memory in use on GPU 0 as the driver reports it, sampled in a thread. This sees the engine whichever process it runs
    in, which torch.cuda.max_memory_allocated in this process does not."""

    def __init__(self, every=0.5):
        self.peak, self._stop, self.every = None, threading.Event(), every
        try:
            import pynvml
            pynvml.nvmlInit()
            self._nv, self._h = pynvml, pynvml.nvmlDeviceGetHandleByIndex(0)
            self._t = threading.Thread(target=self._run, daemon=True)
            self._t.start()
        except Exception:
            self._nv = None

    def _run(self):
        while not self._stop.is_set():
            used = self._nv.nvmlDeviceGetMemoryInfo(self._h).used
            self.peak = used if self.peak is None else max(self.peak, used)
            self._stop.wait(self.every)

    def stop(self):
        self._stop.set()
        return None if self.peak is None else self.peak / 1e9


def choice_params(SamplingParams, k):
    """Greedy decoding constrained to the letters, under whichever name the installed vLLM gives the option."""
    base, choices, errs = dict(temperature=0.0, max_tokens=2), list(LETTERS[:k]), []
    try:
        from vllm.sampling_params import StructuredOutputsParams
        return SamplingParams(**base, structured_outputs=StructuredOutputsParams(choice=choices))
    except Exception as e:
        errs.append(f"StructuredOutputsParams(choice): {e}")
    try:
        from vllm.sampling_params import GuidedDecodingParams
        return SamplingParams(**base, guided_decoding=GuidedDecodingParams(choice=choices))
    except Exception as e:
        errs.append(f"GuidedDecodingParams(choice): {e}")
    try:
        return SamplingParams(**base, guided_choice=choices)
    except Exception as e:
        errs.append(f"guided_choice: {e}")
    raise RuntimeError("could not enable constrained choice decoding:\n  " + "\n  ".join(errs))


def by_request(outs):
    return sorted(outs, key=lambda o: int(o.request_id)) if outs and hasattr(outs[0], "request_id") else outs


def log_softmax(v):
    import math
    m = max(v)
    z = m + math.log(sum(math.exp(x - m) for x in v))
    return [x - z for x in v]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--targets", default=os.environ.get("PROXY_TARGETS", "results/targets/dev_rows.jsonl"))
    ap.add_argument("--out-dir", default=os.environ.get("PROXY_OUT", "results/module7"))
    ap.add_argument("--name", default=None, help="prefix of the output files (default run1, or run2 with --distance-cue)")
    ap.add_argument("--distance-cue", action="store_true", help="run 2: state each option's distance to the history")
    ap.add_argument("--build-only", action="store_true", help="write the question file and stop")
    ap.add_argument("--model", default=os.environ.get("PROXY_MODEL", MODEL))
    ap.add_argument("--revision", default=os.environ.get("PROXY_REVISION", REVISION))
    ap.add_argument("--max-model-len", type=int, default=4096)
    ap.add_argument("--gpu-memory-utilization", type=float, default=0.85)
    ap.add_argument("--limit", type=int, default=None, help="score only the first N rows (smoke test)")
    ap.add_argument("--in-process", action="store_true",
                    help="run the engine in this process so torch.cuda.max_memory_allocated sees it (otherwise it reads 0)")
    ap.add_argument("--dry-run", action="store_true", help="no model: write the output files with a constant prediction")
    a = ap.parse_args()
    name = a.name or ("run2" if a.distance_cue else "run1")
    t_start = time.time()

    targets = Path(a.targets)
    if a.build_only or not targets.exists():
        rows = build_rows()
        write_jsonl(targets, rows)
        print(f"wrote {len(rows)} rows / {len({r['user'] for r in rows})} users to {targets}", flush=True)
        if a.build_only:
            return
    rows = read_jsonl(targets)
    if a.limit:
        rows = rows[:a.limit]
    k = rows[0]["k"]
    prompts = [r["prompt"] for r in rows]
    if a.distance_cue:
        if any("cand_km" not in r for r in rows):
            raise ValueError(f"{targets} has no cand_km field; build it with --build-only")
        prompts = [add_cue(p, r["cand_km"]) for p, r in zip(prompts, rows)]
    print(f"=== {name}: {len(rows)} rows, {len({r['user'] for r in rows})} users, cue {a.distance_cue}, dry {a.dry_run}", flush=True)

    # Greedy decoding is bit-reproducible only with this setting (temperature 0 alone is not enough across serving configs).
    os.environ.setdefault("VLLM_BATCH_INVARIANT", "1")
    if a.in_process:
        os.environ["VLLM_ENABLE_V1_MULTIPROCESSING"] = "0"
    revision = a.revision if a.dry_run else resolve_revision(a.model, a.revision)
    versions = {"python": sys.version.split()[0]}
    gpu = GpuPeak()
    kv_gb = peak_torch_gb = logprobs_mode = None
    if a.dry_run:
        load_s, chat = 0.0, list(prompts)
        decode = lambda texts: ["A" for _ in texts]                                  # noqa: E731
        letter_lp = lambda texts: [[-1.6094379] * k for _ in texts]                   # noqa: E731
    else:
        import torch
        import transformers
        import vllm
        from transformers import AutoTokenizer
        from vllm import LLM, SamplingParams
        versions.update(vllm=vllm.__version__, torch=torch.__version__, transformers=transformers.__version__)
        t0 = time.time()
        tok = AutoTokenizer.from_pretrained(a.model, revision=revision)
        kw = dict(model=a.model, revision=revision, dtype="bfloat16", gpu_memory_utilization=a.gpu_memory_utilization,
                  max_model_len=a.max_model_len, seed=0)
        try:                                   # log-probs after the letter mask, if this vLLM can report them
            llm, logprobs_mode = LLM(**kw, logprobs_mode="processed_logprobs"), "processed_logprobs"
        except (TypeError, ValueError):
            llm, logprobs_mode = LLM(**kw), "raw_logprobs"
        load_s = time.time() - t0
        # The chat template already starts with the begin-of-text token. Passing the text to vLLM would tokenize it again and add a
        # second one, so the prompts go in as token ids built without special tokens (one begin-of-text token, as in training).
        chat = [{"prompt_token_ids": tok(t, add_special_tokens=False)["input_ids"]} for t in chat_prompts(tok, prompts)]
        bad = [i for i, c in enumerate(chat) if c["prompt_token_ids"][:1] != [tok.bos_token_id] or c["prompt_token_ids"][1:].count(tok.bos_token_id)]
        if bad:
            raise ValueError(f"{len(bad)} prompts do not carry exactly one begin-of-text token at the start")
        ids = [tok.encode(L, add_special_tokens=False) for L in LETTERS[:k]]
        if any(len(i) != 1 for i in ids):
            raise ValueError(f"a letter is not one token: {ids}")
        letter_ids = [i[0] for i in ids]
        p_choice = choice_params(SamplingParams, k)
        p_lp = SamplingParams(temperature=0.0, max_tokens=1, logprobs=20, allowed_token_ids=letter_ids)

        def decode(texts):
            return [o.outputs[0].text for o in by_request(llm.generate(texts, p_choice, use_tqdm=False))]

        def letter_lp(texts):
            out = []
            for o in by_request(llm.generate(texts, p_lp, use_tqdm=False)):
                d = o.outputs[0].logprobs[0]
                missing = [i for i in letter_ids if i not in d]
                if missing:
                    raise RuntimeError(f"letter tokens {missing} are not among the returned log-probs")
                out.append(log_softmax([d[i].logprob for i in letter_ids]))
            return out

        try:                                   # KV cache size from the engine's block count and the model's shape
            from transformers import AutoConfig
            cfg = AutoConfig.from_pretrained(a.model, revision=revision)
            per_token = 2 * cfg.num_hidden_layers * cfg.num_key_value_heads * (cfg.hidden_size // cfg.num_attention_heads) * 2
            cc = llm.llm_engine.vllm_config.cache_config
            kv_gb = cc.num_gpu_blocks * cc.block_size * per_token / 1e9
        except Exception:
            pass

    t0 = time.time()
    texts = []
    for i in range(0, len(chat), BATCH):
        texts += decode(chat[i:i + BATCH])
        print(f"  decode {min(i + BATCH, len(chat))}/{len(chat)}", flush=True)
    decode_s = time.time() - t0
    t0 = time.time()
    lps = []
    for i in range(0, len(chat), BATCH):
        lps += letter_lp(chat[i:i + BATCH])
        print(f"  log-probs {min(i + BATCH, len(chat))}/{len(chat)}", flush=True)
    lp_s = time.time() - t0
    score_s = decode_s + lp_s
    if not a.dry_run:
        peak_torch_gb = torch.cuda.max_memory_allocated() / 1e9
    peak_nvml_gb = gpu.stop()

    picks = [parse_choice(t, k) for t in texts]
    preds = [{"row": i, "user": r["user"], "answer_idx": r["answer_idx"], "pick": p,
              "logprobs": [round(x, 6) for x in lp]} for i, (r, p, lp) in enumerate(zip(rows, picks, lps))]
    n = len(rows)
    n_gpu = 1 if a.dry_run else max(1, torch.cuda.device_count())
    disagree = sum(1 for r in preds if r["pick"] is not None and r["logprobs"].index(max(r["logprobs"])) != r["pick"])
    out = Path(a.out_dir)
    write_jsonl(out / f"{name}_predictions.jsonl", preds)
    run = {
        "name": name,
        "config": {
            "model": a.model, "revision_requested": a.revision, "revision_used": revision,
            "dataset": rows[0]["ds"], "distractors": CANONICAL["distractors"], "split": "development",
            "n_users": len({r["user"] for r in rows}), "n_rows": n, "seed": CANONICAL["seed"],
            "hist_n": CANONICAL["hist_n"], "hist_order": CANONICAL["hist_order"], "k": k,
            "prompt": "canonical" + (" plus the distance to the nearest history place on each option line" if a.distance_cue else ""),
            "distance_cue": a.distance_cue, "zero_shot": True, "adapter": None,
            "decoding": {"temperature": 0.0, "max_tokens": 2, "constraint": f"choice over {list(LETTERS[:k])}",
                         "log_prob_pass": {"max_tokens": 1, "allowed_token_ids": "the five letters", "mode": logprobs_mode},
                         "batch_size": BATCH, "VLLM_BATCH_INVARIANT": os.environ.get("VLLM_BATCH_INVARIANT"),
                         "max_model_len": a.max_model_len, "gpu_memory_utilization": a.gpu_memory_utilization, "seed": 0},
            "versions": versions, "targets_file": targets.name, "prompt_md5": md5("\n".join(prompts)),
            "chat_prompt_md5": md5("\n".join(c if isinstance(c, str) else " ".join(map(str, c["prompt_token_ids"])) for c in chat)), "prompt_input": "token ids, one begin-of-text token", "dry_run": a.dry_run,
        },
        "result": {"top1": sum(1 for r in preds if r["pick"] == r["answer_idx"]) / n,
                   "unparsed": sum(1 for p in picks if p is None), "pick_differs_from_max_logprob": disagree},
        "constraints": {
            "model_load_seconds": round(load_s, 1), "decode_seconds": round(decode_s, 2), "logprob_seconds": round(lp_s, 2),
            "scoring_seconds": round(score_s, 2), "decisions_per_second": round(n / score_s, 2),
            "mean_latency_ms_per_decision": round(1000 * score_s / n, 2),
            "peak_gpu_memory_gb_torch_allocated": None if peak_torch_gb is None else round(peak_torch_gb, 2),
            "peak_gpu_memory_gb_driver": None if peak_nvml_gb is None else round(peak_nvml_gb, 2),
            "kv_cache_gb": None if kv_gb is None else round(kv_gb, 2), "gpus": n_gpu,
            "gpu_hours": round(n_gpu * (time.time() - t_start) / 3600, 4),
            "gpu_hours_note": "whole run from start to finish, model load included",
            "latency_note": "scoring seconds divided by rows, with 512 prompts per batch",
        },
    }
    with open(out / f"{name}_run.json", "w") as f:
        json.dump(run, f, indent=1)
    print(json.dumps({"result": run["result"], "constraints": run["constraints"]}, indent=1), flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    if not a.dry_run:
        os._exit(0)                            # vLLM's engine processes can keep the interpreter alive at exit


if __name__ == "__main__":
    main()
