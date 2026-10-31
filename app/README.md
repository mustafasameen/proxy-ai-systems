# PROXY demo

PROXY is a delegate that picks one of five new places for a person, using only that person's recent check-in history, and asks a single yes or no question first when a question is expected to help. This app replays real, held-out decisions from anonymized New York check-in data, lets you control how often PROXY may ask, reveals what the person actually chose, and reports how far PROXY can be trusted.

## Run it

```
npm install
npm run dev
```

Other scripts: `npm test` runs the unit tests, `npm run build` writes the static site to `dist/`, and `npm run preview` serves that build.

## Data

The app reads `public/data/demo.json`: 105 held-out decisions from 12 people, chosen at random
with a fixed seed, plus summary numbers computed over all 2,502 held-out decisions of 300 people.
The decisions come from the New York release of Massive-STEPS (Apache License 2.0), with venue
names from Foursquare Open Source Places. See `public/data/NOTICE.md` for attribution.
