# Candidate comparison, calibration, ask rules and interface data

These scripts compare candidate rankers by what the delegate needs, from saved per-decision
scores. No model is run. They use only the Python standard library (Python 3.10 or newer);
the tests need pytest.

- `delegate_math.py`: the pure functions. Softmax, argmax, information gain, expected accuracy
  gain, question choice, quantile, seeded random mask, prompt parsing, temperature fitting,
  calibration error and the paired bootstrap.
- `compare_candidates.py`: the per-arm table, the calibration step, the selection rule, paired
  contrasts and the ask-trigger comparison.
- `export_interface_data.py`: writes the JSON file that the interface in `app/` reads, for one
  arm on one split.
- `test_delegate_math.py`: tests on synthetic data. Run `pytest experiments/m4`.
- `check_equivalence.py`: compares these scripts with the saved outputs of the original analysis.
  It needs those files and is not needed to use the scripts.

## Input layout

The score files come from the scoring jobs and are not in the repository, so the comparison
and the export cannot run without them. A decision file is a jsonl file with one decision per
line (`user`, `answer_idx`, `prompt`, and optionally `k`), as written by `hpc/build_targets.py`.
Scores sit in one folder per arm and seed, in the same order as the decision file:

```
<scores-root>/<arm>/s<seed>/scores_<split>.jsonl
    one line per decision: {"user": ..., "answer_idx": ..., "scores": [5 numbers]}
<scores-root>/<arm>/s<seed>/summary.json
    {"files": {"<split>": {"Hit@1": {"mean": ...}}}}
```

`--world NAME` adds a folder level (`<arm>/<world>/s<seed>`), and `--file-prefix P` renames the
score file to `scores_<P>_<split>.jsonl` and the summary key to `<P>_<split>`. For every run the
mean over people of top-1 accuracy must match the stored `Hit@1` to within 0.0005, otherwise the
script exits with status 1.

## Reproducing the tables of Section 7

The arm names below are examples; use the names of your folders. An arm written `name:0` runs
that seed only, and the other arms use `--seeds`. `pilot` is the development split and `fresh`
the test split. Make the selection on the development split only.

Development people: the per-arm table (right alone, after one question, at the default setting,
calibration error and confident misses, raw and with the cross-fitted temperature), the
selection and the ask-trigger comparison at ask rates 0.3, 0.5 and 0.7.

```
python compare_candidates.py --decisions dev_decisions.jsonl --scores-root scores \
    --split pilot --calibrate crossfit --arms zero_shot:0 five_shot:0 tuned tuned_pref \
    --seeds 0 1 2 3 4 --simpler tuned --triggers --out dev_tables.json
```

Test people, with one temperature per run fitted on the development scores, and the paired
contrasts (`ARM+cal` is the calibrated run of ARM):

```
python compare_candidates.py --decisions test_decisions.jsonl \
    --design-decisions dev_decisions.jsonl --scores-root scores --split fresh \
    --calibrate design --arms zero_shot:0 five_shot:0 tuned tuned_pref --seeds 0 1 2 3 4 \
    --contrasts tuned:tuned_pref tuned+cal:tuned_pref+cal --out test_tables.json
```

In the output, `arms.<arm>.raw` and `arms.<arm>.calibrated` hold `acc` (right alone),
`always_ask` (after one question), `voi_050` (asking on half the choices where the question is
worth most), `ece` and `confidently_wrong`. `selection` names the chosen arm, `paired` holds
`[mean, low, high]` of each contrast and `triggers.rates` the three ways of choosing where to ask.

Interface data for the selected arm on the test split:

```
python export_interface_data.py --decisions test_decisions.jsonl \
    --design-decisions dev_decisions.jsonl --scores-root scores --arm tuned_pref --seed 0 \
    --split fresh --out interface_data.json --numbers-out headline_numbers.json
```

Add `--reference file.json` (a list of `{"key", "value", "label", "split"}` objects) for the
numbers the interface shows beside the replay. The output holds venue names and recent places,
so replace places that reveal sensitive details by a generic label before sharing it.

## Notes

- Ties are fixed: `argmax` takes the lowest index and the first question wins an equal
  information gain, so one set of scores always gives one set of picks and questions.
- The bootstrap is over people, 4,000 draws with seed 0. The random ask rule uses seed 0.
- The recent-places line lists places as "name (category)", or as a bare category for a place
  with no name, separated by ", ". `parse_prompt` splits it at ", " outside parentheses and
  treats a fragment without parentheses as an unnamed place when it is a known category name
  (collected from every decision file given), and otherwise as the first part of a venue name
  that contains a comma. On the design file this reproduces the exact history lists of all
  2,291 decisions.
