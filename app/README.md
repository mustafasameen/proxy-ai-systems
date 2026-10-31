# PROXY demo

PROXY is a personal assistant that picks something new for a person (a place, or something to buy) using only that person's own history. It asks one yes or no question first when a question is expected to help. This app replays real, held-out decisions from anonymized data, so you can try PROXY as one of 12 people.

## User view (the default)

A phone-first column. The start prompt ("Want me to find somewhere new?") opens a short conversation: PROXY may ask one question (Yes, No or Just pick), then shows its pick with a plain reason, how sure it is in words ("Pretty sure (74%)") and how often picks that sure have been right ("about 7 in 10 times"). The person can go with it, see the other options, or say "Not for me" to get the next best. "Next" (or "Try another" for shopping) moves to that person's next decision. The top bar has the Places and Shopping switch (Shopping appears only when its file loads), a demo account menu (Person 1 to 12) and Settings. Settings holds "When should PROXY check with you?" (five options with their measured trade-offs), what PROXY knows about you, and a link to the About page.

## Developer view

Off by default and reset on reload. Turn it on with "Developer view (for evaluation)" at the bottom of Settings. It adds "Answer as this person would" on the question, "Reveal what this person actually chose" on each pick (right, wrong and confidently wrong badges), a running tally, and a "Detailed evaluation" button on the About page that opens the full trust report with all its charts.

## Run it

```
npm install
npm run dev
```

Other scripts: `npm test` runs the unit tests, `npm run build` writes the static site to `dist/`, and `npm run preview` serves that build.

## Data

The app loads `public/data/places.json` (required) and `public/data/shopping.json` (optional, and when it is missing the Shopping switch is hidden). Both have the same shape: `about`, `summary`, `reference` and `people[].decisions[]`. Optional fields the view uses when present:

- `decision.question.text`: the full question sentence. Without it the question reads "Are you up for a/an {category}?".
- `candidate.reason`: one plain sentence for the pick card. Without it the places wording is built from `history_count` and `category`, and a candidate with neither shows no reason line.
- `about.domain` ("places" or "shopping"), `about.history_label` (for example "recent purchases") and `about.limitations` (up to four short strings for the About page).

`places.json` holds 105 held-out decisions from 12 people, chosen at random with a fixed seed, plus summary numbers computed over all 2,502 held-out decisions of 300 people. The decisions come from the New York release of Massive-STEPS (Apache License 2.0), with venue names from Foursquare Open Source Places. See `public/data/NOTICE.md` for attribution.

`npm test` also renders every decision in whichever of these files exist, and checks that the copy fields in them (`question.text`, `reason`, `limitations`, `history_label`) use plain words: no em or en dashes, no exclamation marks, no semicolons.
