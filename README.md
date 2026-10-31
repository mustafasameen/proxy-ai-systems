# PROXY: predicting a person's next new place from their check-in history

PROXY is the semester project for EGN 6216 AI Systems (University of Florida, Fall 2026). It asks how well an AI system that
acts on someone's behalf can predict the choice that person would make. The test is concrete: given a person's earlier
check-ins, pick the new venue they actually visit next from five options. The four wrong options are matched to the answer on
popularity, so popularity alone cannot give the answer away.

## Repository

| path | contents |
|---|---|
| `playground.ipynb` | downloads the dataset, verifies it and takes a first look at it |
| `src/proxy/` | data loading, the per-user split, the five-option questions, their prompts, and paired per-user statistics |
| `src/proxy/config.py` | the canonical configuration, the one place the defaults come from |
| `hpc/` | scripts that write the question files, build the other-person control, and train the model adapter on a GPU cluster |
| `hpc/requirements_hpc.txt` | pinned packages of the cluster environment that ran the GPU jobs |
| `tests/` | tests that run on a small synthetic release |
| `app/` | the delegate interface (React): it replays held-out decisions, asks one question when that helps, and reports how far its picks can be trusted |
| `experiments/m4/` | the comparison of candidate models, the calibration step, the ask-rule comparison and the export of the interface data |
| `proposal/milestone3/` | the statistics and checks reported in the Milestone 3 data document |
| `requirements.txt` | Python packages for the notebook |

## Data

Massive-STEPS New York (Wongso et al., 2025, arXiv 2505.11239), published on Hugging Face as
[`CRUISEResearchGroup/Massive-STEPS-New-York`](https://huggingface.co/datasets/CRUISEResearchGroup/Massive-STEPS-New-York)
under the Apache 2.0 license. The project uses the full check-in file `new_york_checkins.csv`: 272,368 check-ins from 6,929
users at 45,804 venues, collected in 2012-13 and 2017-18.

| item | value |
|---|---|
| revision | commit `1e6af440a88ee54c83b1e30930290699e194a726` |
| SHA-256 | `edc194f732cb236d841dbee775000c40d9e69bd9668c0aeebf266a159167b3a6` |
| license | Apache 2.0, with upstream sources Semantic Trails (CC0 1.0) and Foursquare Open Source Places (Apache 2.0) |
| retrieved | first on August 31, 2026, and re-verified by the notebook on October 5, 2026 |

Apart from the interface sample described below, the repository holds no data. The notebook downloads the file and checks its
checksum. To run the code in `src/` and `hpc/`, place the release under `data/massive_steps/new_york/` or point
`PROXY_DATA_ROOT` at a folder with that layout.

Venue histories can identify a person. The code and documents show no user id, no exact time and no coordinates. The
exceptions are the interface samples in `app/public/data/`: `places.json` holds 105 held-out decisions of 12 people,
each with that person's recent places, under the dataset's Apache 2.0 license, and `shopping.json` holds 62 held-out
purchase decisions of 12 people from Amazon Reviews 2023 (video games), with product titles only. In that file user ids are replaced by "Person 1" to
"Person 12", homes carry no name, and places that reveal health, religion, sexual orientation or a residence are shown only
by a generic label such as "Health care" or "Place of worship". See `app/public/data/NOTICE.md`.

## Model

Llama-3.1-8B-Instruct from Meta, published on Hugging Face as
[`meta-llama/Llama-3.1-8B-Instruct`](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct), revision
`0e9e39f249a16976918f6564b8830bc894c89659`. It is released under the Llama 3.1 Community License and Meta's Acceptable Use
Policy. Access is gated: each user accepts the license on Hugging Face before downloading. The repository holds no model
weights; the scoring script loads the model by name and revision.

## Canonical configuration

`src/proxy/config.py` holds one configuration. Every entry point reads its defaults from it, so a call that names no option
builds the canonical question file. Every model is scored on that one file.

| setting | value |
|---|---|
| `dataset` | `steps_new_york` |
| `distractors` | `popmatched` |
| `n_users` | 300 |
| `seed` | 0 |
| `hist_n` | 30 |
| `hist_order` | `recent` |
| `k` | 5 |

To write the file:

```
PYTHONPATH=src python hpc/build_targets.py --out results/targets/steps_new_york_popmatched.jsonl
```

Building it again from the same release gives the same bytes.

## How a prediction question is built

- Users with at least 20 check-ins are kept, and the last 20% of each user's check-ins are held out for testing.
- A user's check-ins are ordered by time. Two check-ins of one user with the same timestamp are ordered by venue id. The New
  York release has one such pair among its 272,368 check-ins.
- Each question is one held-out visit to a place the user had never been before.
- The five options are that place and four decoys. A decoy comes from the same popularity band as the answer, or from a
  neighbouring band when that band has too few venues, and never from the user's own history. Popularity is the number of
  check-ins that kept users made before their split, and the venues are cut into 20 bands by it.
- The system sees the user's 30 most recent earlier check-ins and picks one of the five options.

## Decoy conditions

The condition is chosen with `distractors`. It is always named beside any number.

| condition | how the four decoys are drawn |
|---|---|
| `popmatched` | the canonical condition, described above |
| `textmatched` | the harder condition. A decoy also comes from the same genericness band as the answer, so the answer cannot be picked because its text reads as more specific. The scores come from a JSON table passed as `genericness_path` to `proxy.task.build`. The table is not part of this repository |
| `popmatched_period` | optional and off unless named. A decoy also has the answer's pre-cut period profile and a check-in in the question's period |
| `popular` | the city's most visited venues. It gives the answer away and serves only as a reference |

The release covers two periods, 2012-13 and 2017-18. The canonical condition does not look at them, so a decoy can come from
the other period. `popmatched_period` closes that gap for every question. The pre-cut period profile of a venue says in which
periods a kept user checked in there before their split: only 2012-13, only 2017-18, both, or neither. If no decoy pool
qualifies for a question, the question is dropped and `fallback_stats` of `proxy.task.build` counts it. The profile is never
relaxed. To write the file:

```
PYTHONPATH=src python hpc/build_targets.py --distractors popmatched_period --out results/targets/steps_new_york_popmatched_period.jsonl
```

## Run

```
pip install -r requirements.txt
jupyter nbconvert --to notebook --execute --inplace playground.ipynb
python -m unittest
```

The tests use a small synthetic release. The checks of the sequence models need `torch` and are skipped without it.
Training the adapter on a GPU needs the packages pinned in `hpc/requirements_hpc.txt`: torch, transformers, peft, vLLM and
the CUDA 13.0 runtime.

Tested with Python 3.12.7.
