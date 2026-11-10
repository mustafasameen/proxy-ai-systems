# PROXY app: Milestone 5 redesign spec

The app becomes a live client of the PROXY API (`../api`, FastAPI on port 8787). It no longer replays precomputed picks.
The look is quiet and editorial: one column, type and hairline rules, no cards, no shadows, no gradients.

## 1. What changed and why (from the design review)

1. Remove raw model probabilities everywhere in the user view (the "over 99% sure" next to "right 7 in 10 times" contradiction).
   Confidence is shown only as the API's `confidence` object: a label ("Higher confidence" / "Moderate confidence" /
   "Lower confidence") plus "Similar picks matched the person's real choice about N in 10 times." When `confidence` is null,
   show nothing.
2. The reason line comes from the API (`ranking[i].reason`), a true count from the person's own history. Never write "learned from
   other people", "you'll love this" or anything not in the record.
3. Other options: a ranked list with name and category only. No percentages, no bars.
4. One continuous sequence in one column: question, then "You said: Yes · Change answer", then the pick in the same place.
5. Purposeful column: 640px content column, header max 1040px; 20px side margins on phones.
6. One visual vocabulary: typography, whitespace, 1px rules. No beige alert boxes, no blue meters, no bordered card stacks.
7. Pick shows name, category, the reason, then actions.
8. Distinct actions: "Choose this place" (records the choice locally, shows the accepted state), "Not for me" (promotes the next
   option into the main spot with "Not for you. Here's the next option."), "See all options", and after accepting or exhausting:
   "Next decision".
9. Live-model lifecycle: pending, slow (after 4 s), timeout, error, empty, and stale-response handling (ignore responses for a
   request that was cancelled or superseded by switching person, setting or decision). `aria-live="polite"` on the status line.
   Prevent double submission.
10. Settings in a compact panel; the person switcher stays but is visually secondary; ground truth only in developer view.

## 2. API contract (all JSON; base URL from `VITE_API_URL`, default `http://localhost:8787`)

- `GET /api/config` returns `{model, gateway, people:[{id, decisions}], settings:[{label, ask_rate, accuracy, accuracy_ci}],
  default_setting, evaluation:{act_now_accuracy, act_now_ci, always_ask_accuracy, always_ask_ci, report_rows, report_users,
  options_per_decision, ece, latency_s:{p50,p90,max,n}}}`.
- `POST /api/pick` with `{person:"1", decision:0, setting:"When unsure", answer:null|"yes"|"no"|"skip"}`.
  - When PROXY wants to ask: `{stage:"question", question:{text, category}, history:[...], history_total, request_id, ...}`.
    The client shows the question; the answer is sent with the same person, decision and setting.
  - Otherwise: `{stage:"pick", question|null, answer|null, ranking:[{index,name,category,reason}], ruled_out:[...],
    confidence:{label, matched_out_of_10, similar_picks}|null, without_answer:{index,name,category,reason}|null,
    history:[{name,category}] (last 8, most recent first), history_total, n_decisions, model, model_latency_s, cached, request_id}`.
  - `ranking[0]` is the pick; the rest are the other options in order. A "no" or "yes" answer removes ruled-out options
    (`ruled_out`).
  - Errors: HTTP 404 `{detail:{error:"no_more_decisions"|"unknown_person", message}}`, 422 validation or `no_options`,
    429 `rate_limited`, 503 `busy` | `model_unavailable`, 504 `timeout`. Always show `detail.message` (or the copy below).
- `POST /api/reveal` with `{person, decision}` returns `{answer_index, name}`. Developer view only.
- `GET /api/health`.

Client timeout: abort at 15 s and show the timeout state.

## 3. Screens and exact copy

Header (one line, max 1040px): "PROXY" wordmark left (600 weight, letter-spacing 0.08em, 14px); right: "Person 1" switcher
(native select styled as text with a chevron), a "Settings" text button.
Shopping is not in this milestone's live system; remove the Places/Shopping switch.

**Start.** Kicker (12px, uppercase, 0.08em tracking, secondary text): "PLACES · NEW YORK CITY".
H1 (36px/600): "Find somewhere new." Sub (16px, secondary): "One place picked from five options, based on your past choices."
Primary button: "Find me a place". Under it (14px secondary): "I'll ask one question if it could help. Change" ("Change" opens
settings). Below a rule, a quiet "What PROXY knows about you" list: the person's 8 most recent places (name, category),
with "and N more" (from the first API response; before it, omit).

**Loading.** Status line under the button: "Looking through your options…" with a "Cancel" text button. After 4 s add
"This is taking longer than expected." After an answer: "Using your answer to make a pick…".

**Question.** Kicker "ONE QUICK QUESTION". Question as H2 (28px/600). Three buttons in a row: "Yes", "No", "Skip". On answer the
controls are replaced by "You said: Yes · Change answer" (Change answer returns to the question for the same decision; the API
caches the model output, so this is instant).

**Pick.** Kicker "YOUR PICK" with "Decision 2 of 9" right-aligned in the same line (secondary). Name as H2 (28px/600).
Category (16px secondary). Rule. "Why this pick" (12px kicker) then the reason sentence (16px). Confidence line when present:
label in 600 weight then " · Similar picks matched the real choice about 7 in 10 times." (14px secondary).
Actions: primary "Choose this place", secondary text-style "Not for me", "See all options".
"See all options" expands a ranked list under a rule: "2  Babbo · Italian Restaurant" etc. (rank in tabular numerals, secondary);
each row is a button that makes that option the pick. Ruled-out options (after an answer) are listed under "Ruled out by your
answer" in secondary text.

**What did your answer change?** Only when `without_answer` exists. A disclosure under the pick:
"What did your answer change?" Expanded: two columns separated by a vertical rule: "WITHOUT ASKING" name, and "WITH YOUR ANSWER"
name. When the names are the same: "Your answer didn't change the first pick."

**Accepted.** "You chose Booker and Dax at Ssäm." and the button "Next decision".
**Not for me.** Status "Not for you. Here's the next option." and the next option takes the pick spot.
**All rejected.** "That's all five options." and "Next decision".
**End of decisions** (404 `no_more_decisions`): "That's all the decisions for Person 1." and "Start over".
**Errors.** "Couldn't reach the model." / "The model is busy. Try again in a moment." / "PROXY couldn't finish this request." /
"No recommendation was returned." each with a "Try again" button. Rate limit: "Too many requests. Wait a minute and try again."

**Settings panel** (a right-side sheet on desktop, full-screen on phones; flat, 1px left rule, no shadow; Escape closes; focus
trapped and returned). Heading "When should PROXY ask?". Five radio rows separated by rules: label (600), then
"Asks about 3 in 10 times" ("Picks without asking" and "Asks before every pick" at the ends) and on the right the measured match rate in tabular numerals ("58%"). From `/api/config` settings.
Footer note (14px secondary): "Share of held-out decisions where PROXY's pick matched the place the person really chose,
measured on N decisions from M people it never saw while being tuned. Asking more often generally helps."
Below a rule: "About PROXY" text link opens the About view. At the bottom: "Developer view" toggle (off by default, resets on reload).

**About view.** Plain page in the same column: what PROXY uses (only this person's past places, five options per decision, one
yes/no question at most), how it was evaluated (numbers from `/api/config.evaluation` with their 95% intervals), the model
("Llama 3.3 70B through UF NaviGator, called live for each decision"), and limitations (matching a past choice is not proof the
person enjoyed it; tested on past New York check-ins; demo people are anonymized records). Back link "Back".

**Developer view** (only when toggled): under the pick, a hairline-separated block in 13px monospace: request id, model,
model latency, cached, setting, and a "Reveal the real choice" button calling `/api/reveal` that marks the matching option in the
list with "real choice" in vermillion text (#D55E00 light / #F0A06A dark). Keep the existing trust report charts only here,
restyled to the tokens (blue #0072B2 for PROXY, greys for comparators), fed from `/api/config` where possible; drop any chart
whose data is not in the API.

## 4. Tokens (plain CSS custom properties in `styles.css`)

Light / dark (dark via `prefers-color-scheme` and an explicit `[data-theme]` override; follow the three-state pattern:
bare `:root` = light, `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`, `:root[data-theme="dark"] {...}`):

| token | light | dark |
|---|---|---|
| --bg | #FFFFFF | #111113 |
| --text | #18181B | #FAFAFA |
| --text-2 | #52525B | #B4B4BD |
| --rule | #D4D4D8 | #3F3F46 |
| --surface | #F4F4F5 | #202023 |
| --focus | #216E4E | #74D4A8 |
| --error | #9A3412 | #FDBA74 |
| --ink-btn-bg | #18181B | #FAFAFA |
| --ink-btn-text | #FFFFFF | #18181B |
| --accent-blue | #0072B2 | #56B4E9 |
| --accent-verm | #D55E00 | #F0A06A |

Type: Inter (Google Fonts, weights 400/500/600) with `system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif` fallback.
Scale: 12 (kicker/meta), 14 (secondary), 16 (body), 21 (section heading), 28 (pick name/question), 36 (start heading).
Line height 1.5 body, 1.2 headings, `text-wrap: balance` on headings. Tabular numerals for all numbers.
Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. 24 to 32 between sections.
Borders: 1px `--rule`. Radius 2px max. No shadows, no gradients, no tinted panels (the only fill is the primary button and the
`--surface` hover on list rows).
Buttons: primary = ink background, reversed text, 44px min height, 0 16px padding, 600 weight; secondary = 1px rule border,
transparent; text buttons = underline on hover. Focus: 2px solid `--focus`, offset 2px. Phones: full-width primary action.
Motion: none.
Content must be visible at rest (no opacity-0 entry states).

## 5. Rules

- No number on screen unless it comes from the API.
- Plain words: no em or en dashes, no exclamation marks, no semicolons in UI copy (the copy test enforces this).
- WCAG AA contrast in both themes; every control keyboard operable; visible focus.
- Keep `npm test` green: rewrite the tests for the new components and the API client (mock `fetch`), including:
  stale-response ignoring, timeout path, each error code's copy, "Not for me" promotion, all-rejected state, change-answer.
