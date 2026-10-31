"""Tests for delegate_math.py. All data here is synthetic, made up for the tests.

Run with:  pytest experiments/m4
"""
import math
import random

import pytest

import delegate_math as dm


# ---------------------------------------------------------------------------- argmax, softmax

def test_argmax_ties_go_to_the_lowest_index():
    assert dm.argmax([0.2, 0.5, 0.5, 0.1]) == 1
    assert dm.argmax([1, 1, 1]) == 0
    assert dm.argmax([-3.0, -3.0]) == 0
    assert dm.argmax([0.1, 0.9, 0.9, 0.9, 0.9]) == 1


def test_argmax_plain_cases():
    assert dm.argmax([4.0]) == 0
    assert dm.argmax([0.1, 0.2, 0.7]) == 2
    assert dm.argmax([0.7, 0.2, 0.1]) == 0


def test_softmax_values_and_shift_invariance():
    assert dm.softmax([0.0, 0.0]) == [0.5, 0.5]
    p = dm.softmax([0.0, math.log(3.0)])
    assert p == pytest.approx([0.25, 0.75])
    shifted = dm.softmax([1000.0, 1000.0 + math.log(3.0)])   # would overflow without the shift
    assert shifted == pytest.approx([0.25, 0.75])
    assert sum(dm.softmax([-40.0, -0.5, -3.0, -17.0, -0.0])) == pytest.approx(1.0)


def test_entropy_ignores_zeros():
    assert dm.entropy([0.5, 0.5]) == pytest.approx(math.log(2.0))
    assert dm.entropy([1.0, 0.0, 0.0]) == 0.0
    assert dm.entropy([0.5, 0.5, 0.0]) == pytest.approx(math.log(2.0))


# ---------------------------------------------------------------------------- questions

P4 = [0.1, 0.2, 0.3, 0.4]


def binary_entropy(q):
    return -q * math.log(q) - (1 - q) * math.log(1 - q)


def test_information_gain_of_a_yes_no_question_is_the_binary_entropy_of_yes():
    # With a question that sorts the options into two groups, the information gained is the
    # entropy of the yes probability: 0.5 -> ln 2, 0.2 -> 0.5004, 0.3 -> 0.6109.
    assert dm.ig_of(P4, {0, 3}) == pytest.approx(math.log(2.0))
    assert dm.ig_of(P4, {1}) == pytest.approx(binary_entropy(0.2))
    assert dm.ig_of(P4, {2}) == pytest.approx(binary_entropy(0.3))
    assert dm.ig_of(P4, {1}) == pytest.approx(0.5004024)


def test_a_question_that_cannot_split_the_mass_has_no_value():
    assert dm.ig_of(P4, {0, 1, 2, 3}) is None
    assert dm.ig_of(P4, set()) is None
    assert dm.evpi_of(P4, {0, 1, 2, 3}) is None


def test_question_choice_hand_worked_example():
    # Yes probabilities are 0.5, 0.2, 0.3 and 1.0. The first question splits the mass evenly, so
    # it has the most information; the last one cannot split and is skipped.
    menu = [("x", {0, 3}), ("y", {1}), ("z", {2}), ("w", {0, 1, 2, 3})]
    assert dm.choose_ig_yes_idx(P4, menu) == {0, 3}
    # The same questions in another order: the best one is still found.
    assert dm.choose_ig_yes_idx(P4, [menu[3], menu[2], menu[1], menu[0]]) == {0, 3}


def test_question_choice_tie_goes_to_the_first_admissible_question():
    uniform = [0.25] * 4
    assert dm.choose_ig_yes_idx(uniform, [("a", {0, 1}), ("b", {2, 3})]) == {0, 1}
    assert dm.choose_ig_yes_idx(uniform, [("b", {2, 3}), ("a", {0, 1})]) == {2, 3}
    # An inadmissible question in front does not take the first place.
    menu = [("all", {0, 1, 2, 3}), ("b", {2, 3}), ("a", {0, 1})]
    assert dm.choose_ig_yes_idx(uniform, menu) == {2, 3}


def test_question_choice_without_an_admissible_question():
    assert dm.choose_ig_yes_idx(P4, []) is None
    assert dm.choose_ig_yes_idx(P4, [("all", {0, 1, 2, 3})]) is None


def test_expected_accuracy_gain_hand_worked_example():
    # Yes = {0, 3} has probability 0.5. After yes the top probability is 0.4 / 0.5 = 0.8, after
    # no it is 0.3 / 0.5 = 0.6. Expected accuracy after the answer is 0.5*0.8 + 0.5*0.6 = 0.7,
    # against 0.4 now, so the gain is 0.3.
    assert dm.evpi_of(P4, {0, 3}) == pytest.approx(0.3)


def test_menu_of_lists_each_category_once_in_sorted_order():
    cats = ["Diner", "Bakery", "Coffee Shop", "Coffee Shop", "Pizza Place"]
    assert dm.menu_of(cats) == [("Bakery", {1}), ("Coffee Shop", {2, 3}), ("Diner", {0}),
                                ("Pizza Place", {4})]


def test_restrict_renormalises_and_zeroes_the_rest():
    out = dm.restrict([0.1, 0.2, 0.3, 0.4], {1, 3})
    assert out == pytest.approx([0.0, 1 / 3, 0.0, 2 / 3])


def test_decision_record_when_the_question_helps():
    cats = ["a", "a", "b", "c"]
    p = [0.4, 0.2, 0.3, 0.1]
    # Question "a" has the largest information (yes = 0.6). The pick is option 0.
    rec = dm.decision_record(p, cats, answer=2)
    assert rec["pick"] == 0 and rec["maxp"] == 0.4
    assert rec["yes"] == {0, 1} and rec["question"] == "a"
    assert rec["gain"] == pytest.approx(0.3)
    assert rec["post_yes"] == pytest.approx([2 / 3, 1 / 3, 0.0, 0.0])
    assert rec["post_no"] == pytest.approx([0.0, 0.0, 0.75, 0.25])
    # The answer "no" comes from the true option 2, so the pick after asking is option 2.
    assert rec["pick_ask"] == 2
    # When the true option is in the yes group, asking does not change the pick here.
    assert dm.decision_record(p, cats, answer=1)["pick_ask"] == 0


def test_decision_record_without_a_question():
    rec = dm.decision_record([0.5, 0.3, 0.2], ["x", "x", "x"], answer=2)
    assert rec["yes"] is None and rec["question"] is None
    assert rec["gain"] == 0.0 and rec["pick_ask"] == rec["pick"] == 0
    assert rec["post_yes"] == rec["post_no"] == [0.5, 0.3, 0.2]


# ---------------------------------------------------------------------------- thresholds, masks

# Expected values below were produced by the original implementation of these helpers.
@pytest.mark.parametrize("values, q, expected", [
    ([0.0, 0.1, 0.4, 0.9], 0.5, 0.25),         # between two values: 0.1 and 0.4, halfway
    ([1, 2, 3, 4, 5], 0.25, 2),                # lands exactly on an element
    ([0.0] * 6 + [0.2, 0.4], 0.5, 0.0),        # mostly ties at zero
])
def test_quantile_matches_the_original(values, q, expected):
    assert dm.quantile(values, q) == pytest.approx(expected, abs=1e-15)


def test_quantile_edges():
    assert dm.quantile([], 0.5) == 0.0
    assert dm.quantile([7.0], 0.9) == 7.0
    assert dm.quantile([1.0, 2.0], 1.5) == 2.0
    assert dm.quantile([1.0, 2.0], -0.1) == 1.0
    assert dm.quantile([0.1, 0.2, 0.3], 0.7) == pytest.approx(0.24)


def test_mask_random_matches_the_original_and_is_seeded():
    def chosen(n, rate, seed=0):
        return [i for i, m in enumerate(dm.mask_random(n, rate, seed)) if m]

    assert chosen(10, 0.3) == [0, 6, 9]
    assert chosen(8, 0.5) == [0, 3, 6, 7]
    assert chosen(10, 0.35) == [0, 2, 6, 9]
    assert chosen(10, 0.3) == chosen(10, 0.3)
    # The size is round(rate * n), and a half rounds to the even number: 2.5 gives 2, 3.5 gives 4.
    assert len(chosen(10, 0.25)) == 2
    assert len(chosen(10, 0.35)) == 4
    assert chosen(5, 0.0) == []
    assert chosen(5, 1.0) == [0, 1, 2, 3, 4]


def test_ask_thresholds_pick_the_requested_share():
    gains = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    tau = dm.value_threshold(gains, 0.3)
    assert sum(g >= tau for g in gains) == 3                     # the three largest gains
    maxps = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1]
    tau = dm.confidence_threshold(maxps, 0.3)
    assert sum(m <= tau for m in maxps) == 3                     # the three lowest confidences
    assert dm.value_threshold(gains, 0.0) == math.inf
    assert dm.value_threshold(gains, 1.0) == -math.inf
    assert dm.confidence_threshold(maxps, 0.0) == -math.inf
    assert dm.confidence_threshold(maxps, 1.0) == math.inf


def test_accuracy_with_questions_and_per_user_accuracy():
    recs = [dict(user="a", pick=0, pick_ask=1, answer=1),
            dict(user="a", pick=2, pick_ask=2, answer=2),
            dict(user="b", pick=0, pick_ask=0, answer=3),
            dict(user="b", pick=1, pick_ask=3, answer=3)]
    assert dm.accuracy_with_questions(recs, [False] * 4) == 0.25
    assert dm.accuracy_with_questions(recs, [True] * 4) == 0.75
    assert dm.accuracy_with_questions(recs, [True, False, False, True]) == 0.75
    assert dm.per_user_accuracy(recs) == {"a": 0.5, "b": 0.0}
    assert dm.per_user_accuracy(recs, [True, False, False, True]) == {"a": 1.0, "b": 0.5}


# ---------------------------------------------------------------------------- prompts

PROMPT = (
    "A person's recent places (most recent last):\n"
    "  Blue Door Cafe (Coffee Shop), Pine Park (Park), Quick Gym (Gym), "
    "Elm St Station (Metro Station), Home (private)\n"
    "Their most frequent categories: Coffee Shop, Park, Gym\n"
    "\n"
    "They are about to go somewhere they have NOT been before. Which of these will they choose?\n"
    "  A. Maple Diner (Diner)\n"
    "  B. Oak Bakery (Bakery)\n"
    "  C. Birch Cafe (Coffee Shop)\n"
    "  D. Corner Flats (Residential Building (Apartment / Condo))\n"
    "  E. Pizza Place\n"
    "\n"
    "Answer with one letter (A/B/C/D/E). Answer:")


def test_split_name_category():
    assert dm.split_name_category("Cafe Grumpy (Coffee Shop)") == ("Cafe Grumpy", "Coffee Shop")
    assert dm.split_name_category("Stop (Metro Station (Line 1))") == ("Stop",
                                                                      "Metro Station (Line 1)")
    assert dm.split_name_category("Bakery") == ("", "Bakery")
    assert dm.split_name_category("  Bar (Bar)  ") == ("Bar", "Bar")


def test_parse_prompt():
    history, top, cands = dm.parse_prompt(PROMPT)
    assert [h["category"] for h in history] == ["Coffee Shop", "Park", "Gym", "Metro Station",
                                                 "private"]
    assert history[0] == {"name": "Blue Door Cafe", "category": "Coffee Shop"}
    assert top == ["Coffee Shop", "Park", "Gym"]
    assert cands == [("Maple Diner", "Diner"), ("Oak Bakery", "Bakery"),
                     ("Birch Cafe", "Coffee Shop"),
                     ("Corner Flats", "Residential Building (Apartment / Condo)"),
                     ("", "Pizza Place")]


def test_parse_prompt_rejects_a_prompt_without_the_markers():
    with pytest.raises(ValueError):
        dm.parse_prompt("not a decision prompt")


# ---------------------------------------------------------------------------- calibration

def test_calibration_bins_use_half_open_intervals():
    bins = dm.calibration_bins([0.3, 0.8, 1.0, 0.29999], [True, True, False, False])
    by_lo = {b["lo"]: b for b in bins}
    assert by_lo[0.0]["n"] == 1                      # 0.29999
    assert by_lo[0.3]["n"] == 1                      # 0.3 belongs to [0.3, 0.4)
    assert by_lo[0.8]["n"] == 2                      # 0.8 and 1.0 belong to the last bin
    assert by_lo[0.8]["accuracy"] == 0.5
    assert len(bins) == 3                            # empty bins are left out


def test_ece_hand_worked_example():
    # 10 decisions in three bins.
    #   4 at confidence 0.35, 1 right : bin [0.3, 0.4), confidence 0.35, accuracy 0.25, gap 0.10
    #   2 at confidence 0.65, 2 right : bin [0.6, 0.7), confidence 0.65, accuracy 1.00, gap 0.35
    #   4 at confidence 0.90, 3 right : bin [0.8, 1.01), confidence 0.90, accuracy 0.75, gap 0.15
    # ECE = 0.4 * 0.10 + 0.2 * 0.35 + 0.4 * 0.15 = 0.04 + 0.07 + 0.06 = 0.17
    maxps = [0.35] * 4 + [0.65] * 2 + [0.90] * 4
    correct = [True, False, False, False] + [True, True] + [True, True, True, False]
    assert dm.expected_calibration_error(maxps, correct) == pytest.approx(0.17, abs=1e-12)


def test_ece_is_zero_when_confidence_equals_accuracy():
    maxps = [0.5] * 4 + [0.9] * 10
    correct = [True, True, False, False] + [True] * 9 + [False]
    assert dm.expected_calibration_error(maxps, correct) == pytest.approx(0.0, abs=1e-12)


def synthetic_logits(n, t_true, sigma, seed):
    """n decisions with five Gaussian logits each, and true options drawn from softmax(z / T)."""
    rng = random.Random(seed)
    rows, labels = [], []
    for _ in range(n):
        z = [rng.gauss(0.0, sigma) for _ in range(5)]
        u, total, label = rng.random(), 0.0, 4
        for i, q in enumerate(dm.softmax([v / t_true for v in z])):
            total += q
            if u < total:
                label = i
                break
        rows.append(z)
        labels.append(label)
    return rows, labels


def test_temperature_grid():
    assert len(dm.T_GRID) == 200
    assert dm.T_GRID[0] == 0.25
    assert dm.T_GRID[-1] == pytest.approx(50.0)
    ratios = [b / a for a, b in zip(dm.T_GRID, dm.T_GRID[1:])]
    assert max(ratios) == pytest.approx(min(ratios))             # evenly spaced on a log scale


def test_temperature_fit_recovers_a_known_temperature():
    # One grid step is a factor of 1.027, so a fit within 4 percent is within about a step.
    for t_true in (2.0, 0.7):
        rows, labels = synthetic_logits(4000, t_true, 4.0 * t_true / 2.0, seed=0)
        fitted = dm.fit_temperature(rows, labels)
        assert abs(math.log(fitted / t_true)) < 0.04


def test_temperature_fit_follows_the_scale_of_the_scores():
    rows, labels = synthetic_logits(1500, 2.0, 4.0, seed=1)
    base = dm.fit_temperature(rows, labels)
    doubled = dm.fit_temperature([[2 * v for v in r] for r in rows], labels)
    assert abs(math.log(doubled / (2 * base))) < 0.04


def test_temperature_fit_first_grid_value_wins_a_tie():
    rows = [[1.0, 0.0, 0.0]]
    assert dm.fit_temperature(rows, [0], grid=[1.0, 1.0, 2.0]) == 1.0
    with pytest.raises(ValueError):
        dm.fit_temperature([], [])


def test_fold_of_is_fixed_and_uses_the_text_of_the_id():
    assert dm.fold_of("alice") == 0 and dm.fold_of("bob") == 1
    assert dm.fold_of("carol") == 1 and dm.fold_of("dave") == 0
    assert dm.fold_of(7) == dm.fold_of("7") == 1


def test_crossfit_fits_each_fold_on_the_other_one():
    rows, labels = synthetic_logits(600, 1.5, 3.0, seed=2)
    users = [f"person{i % 40}" for i in range(600)]
    temps = dm.crossfit_temperatures(rows, labels, users)
    assert set(temps) == {0, 1}
    for k in (0, 1):
        other = [i for i, u in enumerate(users) if dm.fold_of(u) == 1 - k]
        expect = dm.fit_temperature([rows[i] for i in other], [labels[i] for i in other])
        assert temps[k] == expect
    assert dm.crossfit_temperatures(rows, labels, users) == temps


# ---------------------------------------------------------------------------- bootstrap

def test_paired_bootstrap_of_a_constant_difference():
    a = {f"u{i}": 0.5 + i / 100 for i in range(20)}
    b = {u: v - 0.125 for u, v in a.items()}                     # 0.125 is exact in binary
    mean, low, high = dm.paired_bootstrap(a, b, n_boot=200, seed=0)
    assert mean == low == high == pytest.approx(0.125)


def test_paired_bootstrap_is_seeded_and_uses_common_people_only():
    rng = random.Random(5)
    a = {f"u{i}": rng.random() for i in range(30)}
    b = {f"u{i}": rng.random() for i in range(5, 40)}
    first = dm.paired_bootstrap(a, b, n_boot=300, seed=0)
    assert first == dm.paired_bootstrap(a, b, n_boot=300, seed=0)
    assert first != dm.paired_bootstrap(a, b, n_boot=300, seed=1)
    common = sorted(set(a) & set(b))
    assert first[0] == pytest.approx(sum(a[u] - b[u] for u in common) / len(common))
    assert first[1] <= first[0] <= first[2]


def test_paired_bootstrap_needs_common_people():
    with pytest.raises(ValueError):
        dm.paired_bootstrap({"a": 1.0}, {"b": 1.0})


def test_parse_history_unnamed_place_and_comma_name():
    vocab = {"Bus Line", "Neighborhood", "Metro Station", "Office"}
    line = ("Bus Line, MTA Subway - Park Place (S) (Metro Station), "
            "Cambria Heights, NY (Neighborhood), Bartle, Bogle & Hegarty (Office)")
    assert dm.parse_history(line, vocab) == [
        "Bus Line",
        "MTA Subway - Park Place (S) (Metro Station)",
        "Cambria Heights, NY (Neighborhood)",
        "Bartle, Bogle & Hegarty (Office)",
    ]


def test_parse_history_nested_category():
    line = "230 Park Place (Residential Building (Apartment / Condo)), Home (private)"
    assert dm.parse_history(line, set()) == [
        "230 Park Place (Residential Building (Apartment / Condo))", "Home (private)"]
