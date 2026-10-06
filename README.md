# PROXY: predicting a person's next new place from their check-in history

PROXY is the semester project for EGN 6216 AI Systems (University of Florida, Fall 2026). It asks how well an AI system that
acts on someone's behalf can predict the choice that person would make. The test is concrete: given a person's earlier
check-ins, pick the new venue they actually visit next from five options. The four wrong options are matched to the answer on
popularity, so popularity alone cannot give the answer away.

## Repository

| path | contents |
|---|---|
| `playground.ipynb` | downloads the dataset, verifies it and takes a first look at it |
| `src/proxy/` | data loading, the per-user split, the five-option decisions and their prompts |
| `hpc/` | scripts that write the decision files and train the model adapter on a GPU cluster |
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
| license | Apache 2.0; upstream sources Semantic Trails (CC0 1.0) and Foursquare Open Source Places (Apache 2.0) |
| retrieved | first on August 31, 2026; re-verified by the notebook on October 5, 2026 |

The repository holds no data. The notebook downloads the file and checks its checksum. To run the code in `src/` and `hpc/`,
place the release under `data/massive_steps/new_york/` or point `PROXY_DATA_ROOT` at a folder with that layout.

Venue histories can identify a person, so nothing here shows a user id, an exact time, or more than one check-in of the same
person.

## How a decision is built

- Users with at least 20 check-ins are kept, and the last 20% of each user's check-ins are held out.
- A decision is a held-out check-in at a venue the user has not visited before. Its options are that venue and four others
  drawn from the same popularity band, never from the user's own history.
- The system sees the user's 30 most recent earlier check-ins and picks one option.

## Run

```
pip install -r requirements.txt
jupyter nbconvert --to notebook --execute --inplace playground.ipynb
```

Tested with Python 3.12.7.
