"""The canonical experiment configuration, in one place.

Every entry point reads its defaults from CANONICAL (src/proxy/task.py, arms.py, seqrec.py, sft_data.py and
hpc/build_targets.py), so a call that names no option builds the same questions as every other call that names none.

`popmatched` is the canonical distractor condition. Each wrong option is drawn from the right venue's own popularity band,
so popularity does not identify the answer. `textmatched` is the harder condition. It also matches how generic each venue
reads, which removes the cue that the right venue's text is more specific than its decoys. Every other condition is chosen by
name and is never a default.
"""

CANONICAL = {
    "dataset": "steps_new_york",    # Massive-STEPS New York, the full check-in file
    "distractors": "popmatched",    # how the four wrong options are drawn
    "n_users": 300,                 # users in the evaluation sample, a seeded draw from the users with a new-venue decision
    "seed": 0,                      # seed of the user draw and of the option draws
    "hist_n": 30,                   # check-ins of history shown in each prompt
    "hist_order": "recent",         # which hist_n check-ins: the most recent ones
    "k": 5,                         # options per question: the right venue and k - 1 wrong ones
}
