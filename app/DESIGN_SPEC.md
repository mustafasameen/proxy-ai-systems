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

## 6. Decision workspace (v2, supersedes the screen layout of section 3 where they differ)

Why: the question arrived with no context. The audience must see what PROXY knows and what it is choosing between before
it asks. One screen visibly transforms: five options, then one question, then one pick. History and the map are
supporting evidence, never the hero.

### API additions (all live on port 8787)

- Every endpoint takes `domain`: `"places"` (default) or `"shopping"`. `GET /api/config?domain=shopping`.
  Config adds `domain`, `domains`, `live` (true for places, false for shopping), and `map`: `{bounds: [[lat,lon],[lat,lon]],
  outline: "data/nyc_boroughs.json"}` for places, `null` for shopping. `nyc_boroughs.json` is served by the app itself
  from `public/data/` (GeoJSON FeatureCollection, properties.name = borough, coordinates [lon, lat]).
- `POST /api/context {domain, person, decision}` returns, without calling the model: `options` (all five in their
  original order: `{index, name, category, point}`), `history` (the shown history, most recent first:
  `{name, category, point}`), `history_total`, `history_summary` (`[{category, count}]`, top five), `n_decisions`, `live`.
  `point` is `[lat, lon]` rounded to about 500 m, or `null` (shopping, or a private place).
- `POST /api/pick` takes `domain` and returns the same context fields plus what it returned before. `question` now also
  has `yes_idx` (option indexes a Yes keeps). Shopping `category` on an option is the brand.
- `POST /api/reveal` takes `domain`.

### Layout

Header (max 1120px): "PROXY" left; right: a two-option switch "Places | Shopping" (text buttons, `aria-pressed`, the
active one in 600 weight with a 1px underline), the person select, the "Settings" text button. Switching domain resets
to Person 1, decision 0, cancels in-flight requests (stale handling as before).

Main (max 1120px, ≥ 960px wide): CSS grid, decision column 56% left, context column 44% right, a 1px `--rule` vertical
line between, 48px gap. Below 960px: one column, decision first, then the context inside
`<details>` "What PROXY knows about Person 1" (closed by default on phones).

### Decision column

1. Kicker: "PLACES · NEW YORK CITY" / "SHOPPING · VIDEO GAMES", with "Decision 2 of 10" right-aligned on the same line.
2. H1 (28px/600): "Where should Person 1 go next?" / "What will Person 1 buy next?"
3. Sub (16px, `--text-2`): "PROXY is choosing from five places this person has never been to." /
   "PROXY is choosing from five products this person has never bought."
4. Source line (12px meta): places "Live: Llama 3.3 70B through UF NaviGator"; shopping "Replay: saved scores of the
   fine-tuned model. No model call."
5. The options list, always visible, loaded from `/api/context` when the decision changes. Rows separated by rules:
   letter A to E (tabular, `--text-2`), a small marker matching the map (blue diamond, `--accent-blue`), name (600),
   category (14px `--text-2`). Long product titles wrap (no clipping). Row states:
   - default;
   - during a question: options in `yes_idx` show a 2px `--accent-blue` left bar and the meta text "Kept if you say yes";
   - excluded by the answer: opacity 0.25 and the meta text "Excluded by your answer" (animation A);
   - passed via "Not for me": opacity 0.25 and "Passed";
   - the current pick: a 2px `--accent-verm` left bar, name in `--text`, meta "PROXY's pick".
6. Action area under the list:
   - idle: primary "Let PROXY choose", and the hint "PROXY asks one question first if it could help. Change"
     ("Change" opens settings);
   - loading / slow / error states and copy exactly as in section 3;
   - question: kicker "YOUR ANSWER COULD CHANGE THE PICK", the question as H2 (21px/600), the line
     "A yes keeps {k} of these 5 options." (k = yes_idx length; "1 of these 5 options" is fine), then Yes / No / Skip;
   - after an answer: "You said: No · Change answer" (or "You skipped the question · Change answer");
   - pick: kicker "YOUR PICK", name H2 (28px places; 21px shopping), category, rule, "Why this pick" + reason,
     confidence line, then actions: primary "Choose this place" / "Choose this item", text button "Not for me".
     Drop "See all options" (the list is always visible); clicking a non-excluded row in the list makes it the pick.
     The "What did your answer change?" disclosure as before (animation C).
   - accepted / all rejected / end of decisions as before, with "Next decision".

### Context column

Kicker "WHAT PROXY KNOWS". A one-line summary from `history_summary`: "Last 30 visits · 2 parks · 2 theaters ·
2 boat or ferry" (top three, lowercase common nouns via the same rule as the API's reason lines, plural "s" added only
when count > 1; for shopping: "Last 6 purchases · 2 Nintendo · 1 PlayStation" brands keep their case).

Places: an SVG map (no external tiles, no map library). Fit the view to the bounding box of this decision's history
and option points, padded 15%, but never narrower than ~4 km; equirectangular with x scaled by cos(40.7°). Draw the
borough outlines from `nyc_boroughs.json` (fill `--surface`, stroke `--rule` 1px; water is the page background).
Past visits: `--text-2` circles r = 3 + 1.5 × (repeat count at that point - 1), 70% opacity. Options: `--accent-blue`
diamonds (8px) with their letter label beside them in 11px; the pick: `--accent-verm` diamond, 10px. Excluded options
fade with the list. Under the map, a legend (circle "Past visit", diamond "Option", vermillion diamond "PROXY's pick")
and the caption (12px meta): "Location context only. PROXY's model sees names and kinds of places, not locations.
Points are rounded to about 500 m, and private places are not shown." The map has `role="img"` and an `aria-label`
summarising it ("Map of 28 past visits and 5 options in Manhattan and Brooklyn" style is fine without borough names:
"Map of 28 past visits and 5 options").

Then "Most frequent" (12px kicker): the five `history_summary` rows as `name ........ count` with a thin bar
(4px tall, `--text-2` at 40% opacity, width proportional to count) under each name. Then "Recent" (12px kicker): the
first 8 history items (name, category) and a text button "Show all 30" that expands the rest.

Shopping: no map. The same "Most frequent" (brands) and "Recent purchases" list, with the caption "Brands come from the
product records. PROXY's model sees product titles only."

### Motion (only these three; none when `prefers-reduced-motion: reduce`)

A. Elimination: excluded rows and their map markers go to opacity 0.25 over 220ms ease-out; nothing is removed.
B. The pick: the picked row's marker and bar appear and the pick block fades in with a 6px upward move over 200ms.
C. "What did your answer change?": the two columns reveal left to right (opacity + 8px x-move, 200ms, second column
   delayed 80ms).
No bouncing pins, animated routes, flying cards, typing effects or fake thinking.

### Settings and About per domain

Settings rows and the footer note come from `/api/config?domain=` for the current domain ("…matched the place the person
really chose…" / "…matched the item the person really bought…"). About: places as before; shopping says the picks
replay saved scores of Llama-3.1-8B-Instruct fine-tuned on earlier purchases, Amazon Reviews 2023 Video Games, with the
same split method and the shopping numbers with their intervals, and the limitations "Tested on past Amazon purchases in
one category, video games." and "It sees product titles, not prices or reviews."

### Copy rules

Unchanged (no dashes, exclamation marks or semicolons in UI copy; numbers only from the API).

## 7. Playing the person (v2.1)

The user plays the person whose history is shown, so every screen gives what a human needs to answer and a way to check.

- **Role line.** Above the question: "You play this person. Use what PROXY knows about them to answer as they would."
- **Current lean.** "Without an answer, PROXY would pick B." The question response carries `leading`, the top option before any answer.
- **Evidence for the question.** The context panel counts the history entries of the asked kind ("Of their last 30 places,
  0 were a cocktail bar."), highlights them on the map and in the recent list, and widens the map to include them. Shopping
  counts purchases from the asked store; a product-category question shows no count, because the history does not record it.
- **Linked context.** Selecting a kind under Most frequent highlights its visits on the map and lists every matching entry
  under Recent; Clear resets it. Hovering or focusing an option row enlarges its map marker and names it on the map.
- **No question.** When PROXY does not ask, one line says why: no answer was likely to change the pick, or the setting is
  Never ask.
- **Payoff.** After a choice (or after every option is turned down), "See what this person really chose" shows the real
  choice, whether PROXY's first pick matched, and the truthful answer to the question beside the user's own.
- **Category line.** Hidden when it only repeats the name (generic places such as Residence).
- **Pick heading.** "How it fits your history" replaces "Why this pick", since the line describes the history, not the
  model's reasoning.
