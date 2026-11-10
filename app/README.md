# PROXY app

A small React + Vite front end for the live PROXY API. It no longer replays a JSON file: every pick, question and number comes from the API.

## Run it

1. Start the API (see `../api`, FastAPI on port 8787):

   ```
   cd ../api
   uvicorn app:app --port 8787
   ```

   The API needs `PROXY_GATEWAY_URL` and `PROXY_GATEWAY_KEY` in its environment. Its allowed origins default to `http://localhost:5174`.

2. Start the app:

   ```
   npm install
   npm run dev
   ```

   The API address comes from `VITE_API_URL` and defaults to `http://localhost:8787`.

Other scripts: `npm test` runs the unit tests and `npm run build` writes the static site to `dist/`.

## What it does

The screen is one decision workspace. A switch in the header chooses Places (New York City, live model) or Shopping (video games, replayed saved scores). The left column lists the five options for the current decision from the start, then asks at most one yes or no question that marks which options a yes keeps, then shows one pick with a reason from the person's own history. The right column shows what PROXY knows: a one-line summary, a hand-drawn map of past visits and options for Places, the most frequent kinds and the most recent items. Clicking an option in the list makes it the pick, and answers rule options out by fading them. Settings (top right) choose how often PROXY asks and hold the About page and the developer view, which shows request details, the real choice on request, and the evaluation charts from `/api/config`. Below 960 pixels the screen becomes one column with the context in a closed section.

The design is in `DESIGN_SPEC.md`. Network code is in `src/lib/api.js` (15 second timeout, a token per request so a superseded response is ignored), the state machine in `src/lib/state.js`, and every UI string in `src/lib/copy.js`, which `npm test` checks for plain words (no dashes, exclamation marks or semicolons).

`public/data/*.json` is no longer read by the app. The API reads `places.json` for its demo people.
