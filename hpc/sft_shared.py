"""Shared-LoRA SFT: one adapter trained on every eligible user's pre-cut decisions (the output of
src/proxy/sft_data.py), to be evaluated on the frozen novel-venue targets. It tests the hypothesis
that supervised adaptation on the person's own past choices suffices, with one adapter for all
users, not one per user.

The recipe is a standard completion-only LoRA fine-tune: the prompt is masked to -100 so only the
completion draws gradient; LoRA r=16 / alpha=32 on q_proj and v_proj; a validation split held out
by group (here by user: a user's many rows share their own history prefix, so splitting by row
would leak the same user's decisions across train and validation); the best-validation epoch is
saved; and a DRY mode exercises the tokenisation and masking contract on a stub tokenizer with no
model, torch or peft import reached (those imports sit strictly after the DRY early return, so the
script runs on a machine with none of them installed).

With PROXY_DRYRUN=1 no model is loaded and no training runs.

Input schema (from src/proxy/sft_data.py): {"ds","user","prompt","completion","target_item",
"history_len"} per line. Only "user", "prompt", "completion" are used here.

PROXY_SFT_INIT_ADAPTER (default ""; when unset the behaviour is unchanged): when set to a saved
adapter directory, LoRA training starts from that adapter (PeftModel.from_pretrained(...,
is_trainable=True)) instead of a freshly initialised LoraConfig. This is a warm start, for example
continuing the training of a shared adapter on a different dataset. Inert under PROXY_DRYRUN=1
(DRY mode never reaches the model-loading code this flag branches in).

PROXY_MODEL_CLASS / PROXY_LORA_TARGETS (both default ""; when unset the behaviour is unchanged).
They support checkpoints that need special handling, such as google/gemma-3-12b-it, the
multimodal Gemma3ForConditionalGeneration checkpoint. (1) PROXY_MODEL_CLASS names the transformers
class `main()` loads the base model with, in case the installed transformers does not resolve the
checkpoint through AutoModelForCausalLM (a text-only forward pass is unaffected either way, since
pixel_values is optional). (2) PROXY_LORA_TARGETS overrides the fresh-LoRA branch's
target_modules, because this checkpoint's SigLIP vision tower also names its attention
projections q_proj and v_proj, and an unrestricted match would put LoRA weights on vision-tower
layers that vLLM's LoRARequest does not expect for a text-only adapter. Both are inert under
PROXY_DRYRUN=1 (DRY mode never reaches the model-loading code they branch in). See the two
environment reads below for the exact semantics.
"""
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DRY = os.environ.get("PROXY_DRYRUN") == "1"


def build_examples(rows, tok, max_len):
    """Tokenise into (input_ids, labels) with the prompt masked out (-100). The prompt is already a
    full multiple-choice question (long history text), and only the one-letter completion should
    draw gradient."""
    out = []
    for r in rows:
        msgs = [{"role": "user", "content": r["prompt"]}]
        p_text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        p_ids = tok(p_text, add_special_tokens=False)["input_ids"]
        c_ids = tok(r["completion"] + tok.eos_token, add_special_tokens=False)["input_ids"]
        # Truncate the prompt from the left if needed: the candidate list and the "Answer:" cue at
        # the end of the prompt are what matter, and the oldest history lines are the least damaging
        # to drop (render_prompt already caps history at hist_n).
        budget = max_len - len(c_ids)
        if budget < 32:
            continue
        if len(p_ids) > budget:
            p_ids = p_ids[-budget:]
        ids = p_ids + c_ids
        labels = [-100] * len(p_ids) + list(c_ids)
        out.append({"input_ids": ids, "labels": labels})
    return out


def main() -> int:
    # SFT_IN defaults to the stub that src/proxy/sft_data.py writes with --limit, so
    # `PROXY_DRYRUN=1 python hpc/sft_shared.py` works standalone right after a stub run. A real
    # run sets PROXY_SFT_DATA to the full training file, built by sft_data.py wherever the raw
    # check-in data is available and copied to the machine that trains.
    SFT_IN = os.environ.get("PROXY_SFT_DATA",
                            os.path.join(ROOT, "results", "_stub", "sft_train_steps_new_york.jsonl"))
    OUT = os.environ.get("PROXY_SFT_OUT", os.path.join(ROOT, "results", "sft_shared_steps_new_york"))
    model = os.environ.get("PROXY_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
    EPOCHS = float(os.environ.get("PROXY_SFT_EPOCHS", "3"))
    LR = float(os.environ.get("PROXY_SFT_LR", "1e-4"))
    BS = int(os.environ.get("PROXY_SFT_BS", "4"))
    MAXLEN = int(os.environ.get("PROXY_SFT_MAXLEN", "2048"))
    VAL_FRAC = float(os.environ.get("PROXY_SFT_VAL", "0.15"))
    SEED = int(os.environ.get("PROXY_SEED", "0"))
    # Off by default ("" = a fresh LoraConfig, as below). When set, LoRA training starts from an
    # existing saved adapter (for example one this same script produced earlier) instead of
    # randomly initialised LoRA weights: a warm start. No other code path changes. DRY mode never
    # reaches the model-loading block below, so this flag is inert under PROXY_DRYRUN=1.
    INIT_ADAPTER = os.environ.get("PROXY_SFT_INIT_ADAPTER", "")

    rows = [json.loads(l) for l in open(SFT_IN)]
    print("=== ARTIFACT BANNER (shared LoRA SFT) ===", flush=True)
    for k, v in (("data", SFT_IN), ("examples", len(rows)),
                 ("users", len({r["user"] for r in rows})),
                 ("model", model), ("epochs", EPOCHS), ("lr", LR), ("bs", BS),
                 ("max_len", MAXLEN), ("val_frac", VAL_FRAC), ("seed", SEED),
                 ("out", OUT), ("DRYRUN", DRY),
                 ("init_adapter", INIT_ADAPTER or "(none -- fresh LoRA init)")):
        print(f"  {k:12} {v}", flush=True)

    # ---- split by user, not by row -------------------------------------------------------------
    # A shared adapter is trained on every eligible user's rows at once; a user's ~20 instances all
    # share overlapping history prefixes, so splitting by row would put near-duplicate context in
    # both train and val and understate the val loss.
    users = sorted({r["user"] for r in rows})
    # The frozen eval users must stay in train. This arm tests "supervised adaptation on the person's
    # own past choices suffices"; a user drawn into the validation pool would be evaluated as an
    # unseen user, which is a different hypothesis, and the pooled number would silently mix the two.
    # Validation users are drawn only from users who have no frozen eval targets.
    _tf = os.environ.get("PROXY_EVAL_TARGETS", os.path.join(ROOT, "targets", "steps_new_york.jsonl"))
    eval_users = set()
    if os.path.exists(_tf):
        eval_users = {json.loads(l)["user"] for l in open(_tf)}
    pool = [u for u in users if u not in eval_users]
    rng = random.Random(SEED)
    rng.shuffle(pool)
    n_val = max(1, int(len(users) * VAL_FRAC))
    val_users = set(pool[:n_val])
    print(f"  eval users found in the targets file: {len(eval_users)}; kept in TRAIN: "
          f"{len(eval_users & set(users))}; val drawn from the other {len(pool)} users", flush=True)
    tr = [r for r in rows if r["user"] not in val_users]
    va = [r for r in rows if r["user"] in val_users]
    assert not ({r["user"] for r in tr} & {r["user"] for r in va}), \
        "user leaked across the SFT split"
    assert not (eval_users & {r["user"] for r in va}), "a frozen eval user landed in the validation split"
    print(f"  split: {len(tr)} train / {len(va)} val rows "
         f"({len(users)-n_val}/{n_val} users, disjoint)", flush=True)

    if DRY:
        # Exercise the tokenisation + masking contract without loading an 8B model.
        class T:
            eos_token = "</s>"

            def apply_chat_template(self, m, tokenize=False, add_generation_prompt=True):
                return "U:" + m[0]["content"] + "\nA:"

            def __call__(self, t, add_special_tokens=False):
                return {"input_ids": [ord(c) % 97 for c in t][:4000]}
        tok = T()
        ex = build_examples(tr[:8] if tr else rows[:8], tok, MAXLEN)
        assert ex, "no examples built"
        for e in ex:
            assert len(e["input_ids"]) == len(e["labels"])
            assert any(l != -100 for l in e["labels"]), "all labels masked — nothing to learn"
            first = next(i for i, l in enumerate(e["labels"]) if l != -100)
            assert all(l == -100 for l in e["labels"][:first]), "prompt not fully masked"
            assert e["labels"][first:] == e["input_ids"][first:], "completion labels misaligned"
        print(f"  OK  masking verified on {len(ex)} examples: prompt -100, completion aligned",
             flush=True)
        print("  DRY RUN COMPLETE (no model loaded)", flush=True)
        return 0

    import torch
    from torch.utils.data import DataLoader
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, PeftModel, get_peft_model
    import transformers as _transformers_mod

    # PROXY_MODEL_CLASS: the default "" resolves to AutoModelForCausalLM (see the module docstring).
    # ModelCls is used at the .from_pretrained call further down instead of the bare
    # AutoModelForCausalLM name.
    _model_cls_name = os.environ.get("PROXY_MODEL_CLASS", "") or "AutoModelForCausalLM"
    ModelCls = getattr(_transformers_mod, _model_cls_name)

    if INIT_ADAPTER:
        assert os.path.isdir(INIT_ADAPTER), \
            f"PROXY_SFT_INIT_ADAPTER={INIT_ADAPTER!r} is not a directory"

    tok = AutoTokenizer.from_pretrained(model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tr_ex = build_examples(tr, tok, MAXLEN)
    va_ex = build_examples(va, tok, MAXLEN)
    print(f"  tokenised: {len(tr_ex)} train / {len(va_ex)} val "
         f"(dropped {len(tr)-len(tr_ex)}/{len(va)-len(va_ex)} over-length)", flush=True)

    def collate(batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = torch.full((len(batch), n), tok.pad_token_id, dtype=torch.long)
        lab = torch.full((len(batch), n), -100, dtype=torch.long)
        att = torch.zeros((len(batch), n), dtype=torch.long)
        for i, b in enumerate(batch):
            L = len(b["input_ids"])
            ids[i, :L] = torch.tensor(b["input_ids"])
            lab[i, :L] = torch.tensor(b["labels"])
            att[i, :L] = 1
        return ids, lab, att

    t0 = time.time()
    hf = ModelCls.from_pretrained(model, torch_dtype=torch.bfloat16, device_map="cuda")
    if INIT_ADAPTER:
        # Warm start: continue training from an existing saved adapter instead of a fresh,
        # randomly initialised LoRA. is_trainable=True is required: PeftModel.from_pretrained
        # defaults to frozen (inference-only) adapter weights, which would silently train nothing.
        # The same LoRA geometry requirement as the fresh-init branch below applies automatically
        # here: loading fails loudly if INIT_ADAPTER's own r/alpha/target_modules do not match
        # what the adapter was saved with, rather than silently reshaping.
        hf = PeftModel.from_pretrained(hf, INIT_ADAPTER, is_trainable=True)
        print(f"  loaded existing adapter from {INIT_ADAPTER} (is_trainable=True; continuing "
             f"training from it, not a fresh LoRA init)", flush=True)
    else:
        # The adapter must be loadable by vLLM's LoRARequest at evaluation time without a shape
        # mismatch, so the LoRA geometry (r=16, alpha=32, q_proj/v_proj) is fixed.
        # PROXY_LORA_TARGETS: the default "" resolves to the plain ["q_proj", "v_proj"] list below
        # (see the module docstring). A comma-separated value overrides the list (same PEFT
        # substring/suffix module-name matching); a value starting "regex:" is passed straight
        # through as LoraConfig(target_modules=<regex string>) (PEFT's own documented regex form,
        # matched against each named module's full dotted path), e.g.
        # 'regex:.*language_model.*\.(q_proj|v_proj)$' to reach only Gemma3Model.language_model's
        # attention and exclude the vision tower's.
        _lora_targets_env = os.environ.get("PROXY_LORA_TARGETS", "")
        if not _lora_targets_env:
            _lora_targets = ["q_proj", "v_proj"]
        elif _lora_targets_env.startswith("regex:"):
            _lora_targets = _lora_targets_env[len("regex:"):]
        else:
            _lora_targets = [t.strip() for t in _lora_targets_env.split(",") if t.strip()]
        hf = get_peft_model(hf, LoraConfig(r=16, lora_alpha=32, target_modules=_lora_targets,
                                           task_type="CAUSAL_LM"))
    hf.train()
    print(f"  model+LoRA in {time.time()-t0:.0f}s; trainable "
         f"{sum(p.numel() for p in hf.parameters() if p.requires_grad)}", flush=True)

    opt = torch.optim.AdamW([p for p in hf.parameters() if p.requires_grad], lr=LR)
    dl = DataLoader(tr_ex, batch_size=BS, shuffle=True, collate_fn=collate)

    def val_loss():
        hf.eval()
        tot = n = 0
        with torch.no_grad():
            for i in range(0, len(va_ex), BS):
                ids, lab, att = collate(va_ex[i:i + BS])
                o = hf(input_ids=ids.cuda(), attention_mask=att.cuda(), labels=lab.cuda())
                tot += float(o.loss) * len(va_ex[i:i + BS]); n += len(va_ex[i:i + BS])
        hf.train()
        return tot / max(n, 1)

    v0 = val_loss()
    print(f"\n  val loss @ epoch 0 (untrained adapter): {v0:.4f}", flush=True)
    best, best_ep = v0, 0
    steps_per = len(dl)
    for ep in range(1, int(EPOCHS) + 1):
        tot = n = 0
        t0 = time.time()
        for ids, lab, att in dl:
            o = hf(input_ids=ids.cuda(), attention_mask=att.cuda(), labels=lab.cuda())
            o.loss.backward()
            torch.nn.utils.clip_grad_norm_([p for p in hf.parameters() if p.requires_grad], 1.0)
            opt.step(); opt.zero_grad()
            tot += float(o.loss); n += 1
        v = val_loss()
        print(f"  epoch {ep}: train {tot/max(n,1):.4f}  val {v:.4f}  "
             f"[{time.time()-t0:.0f}s, {steps_per} steps]", flush=True)
        # Early stopping on validation loss: keep the best epoch. A shared adapter over ~60K
        # one-letter completions overfits fast on an 8B model.
        if v < best:
            best, best_ep = v, ep
            os.makedirs(OUT, exist_ok=True)
            hf.save_pretrained(OUT)
            print(f"    saved (best so far) -> {OUT}", flush=True)

    if best_ep == 0:
        starting_point = f"the adapter loaded from {INIT_ADAPTER}" if INIT_ADAPTER else \
            "the untrained (fresh-LoRA) adapter"
        print(f"\n  No epoch improved on {starting_point} in validation loss, so nothing was saved. "
             "This is a result, not a crash: the adapter would be worse than its starting point.", flush=True)
        return 1
    print(f"\n  BEST epoch {best_ep}  val {best:.4f} (from {v0:.4f})  -> {OUT}", flush=True)
    json.dump({"data": SFT_IN, "n_train": len(tr_ex), "n_val": len(va_ex),
              "val_users": sorted(val_users), "epochs_run": int(EPOCHS),
              "best_epoch": best_ep, "val_loss_untrained": v0, "val_loss_best": best,
              "lr": LR, "bs": BS, "max_len": MAXLEN, "seed": SEED, "model": model,
              "init_adapter": INIT_ADAPTER or None},
             open(os.path.join(OUT, "sft_report.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
