"""Write a frozen target file from arms.novel_targets + arms.render_prompt. With no option but --out it
writes the canonical question file (src/proxy/config.py): steps_new_york, popmatched distractors, 300
users, seed 0, the 30 most recent check-ins, 5 options. Every option's default is read from that file.
Known-answer test: with --check-against an existing target file, the rebuilt rows must reproduce that
file row for row (when --hist-n is the canonical 30; for another --hist-n only user, k and answer_idx
are compared, since the prompts differ by design). --hist-order chooses which --hist-n items are
rendered (arms.select_history): 'recent' (default) is the last hist_n visits; 'retrieved' is the BM25
retrieval-ranked baseline."""
import json, os, sys, argparse, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, os.path.join(ROOT, "src"))
from proxy.arms import novel_targets, render_prompt_ordered, BM25_K1, BM25_B
from proxy.config import CANONICAL
ap = argparse.ArgumentParser(); ap.add_argument("--dataset", default=CANONICAL["dataset"]); ap.add_argument("--distractors", default=CANONICAL["distractors"])
ap.add_argument("--n-users", type=int, default=CANONICAL["n_users"]); ap.add_argument("--seed", type=int, default=CANONICAL["seed"]); ap.add_argument("--out", required=True)
ap.add_argument("--check-against", default=None)
ap.add_argument("--hist-n", type=int, default=CANONICAL["hist_n"], help="history items rendered into the prompt (render_prompt default 30); candidates/answers never change")
ap.add_argument("--hist-order", choices=["recent", "retrieved"], default=CANONICAL["hist_order"],
                help="WHICH --hist-n items: 'recent' (default) = the last hist_n; "
                     "'retrieved' = the hist_n items of the user's whole history with the highest BM25 score against the row's "
                     "five candidates' text, shown in chronological order (arms.select_history)")
ap.add_argument("--exclude-users-from", default=None,
                help="jsonl with a 'user' field per row (e.g. an existing frozen target file); its distinct "
                     "users are removed from the sampling pool before the seeded --n-users sample "
                     "(arms.novel_targets's exclude_users), so a fresh draw is disjoint from it. By default no users "
                     "are removed.")
a = ap.parse_args()
print(f"hist_n={a.hist_n} hist_order={a.hist_order}"
      + (f" (pool=whole history, BM25 k1={BM25_K1} b={BM25_B})" if a.hist_order == "retrieved" else ""))
exclude = None
if a.exclude_users_from:
    exclude = {json.loads(l)["user"] for l in open(a.exclude_users_from)}
    print(f"excluding {len(exclude)} users read from {a.exclude_users_from}")
tg, cats = novel_targets(a.dataset, n_users=a.n_users, seed=a.seed, distractors=a.distractors, exclude_users=exclude)
rows = []
for t in tg:
    rows.append({"ds": a.dataset, "user": t.user, "k": len(t.candidates), "answer_idx": t.candidates.index(t.true_item),
                 "prompt": render_prompt_ordered(t, cats, hist_n=a.hist_n, hist_order=a.hist_order)})
if a.check_against:
    ref = [json.loads(l) for l in open(a.check_against)]
    strip = lambda r: {k: v for k, v in r.items() if k != "prompt"}
    same = len(ref) == len(rows) and all(r == q for r, q in zip(ref, rows))
    same_struct = len(ref) == len(rows) and all(strip(r) == strip(q) for r, q in zip(ref, rows))
    if a.hist_n == CANONICAL["hist_n"]:
        print(f"KNOWN-ANSWER vs {a.check_against}: {'IDENTICAL' if same else 'DIFFERENT'} (n={len(rows)} vs {len(ref)})")
        if not same: sys.exit(3)
    else:
        print(f"STRUCTURE (user/k/answer_idx) vs {a.check_against}: {'IDENTICAL' if same_struct else 'DIFFERENT'}; prompts differ by design (hist_n={a.hist_n}, hist_order={a.hist_order})")
        if not same_struct: sys.exit(3)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
with open(a.out, "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")
with open(a.out, "rb") as f: digest = hashlib.sha256(f.read()).hexdigest()
print(f"wrote {len(rows)} rows / {len({r['user'] for r in rows})} users -> {a.out}  sha256 {digest}")
