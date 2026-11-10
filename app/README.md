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

One column. The start screen asks for a place, the API may return one yes or no question, then one pick with a reason from the person's own history, a confidence line when the API sends one, and the other options. Settings (top right) choose how often PROXY asks and hold the About page and the developer view. The developer view (off by default, resets on reload) shows request details, the real choice on request, and the evaluation charts from `/api/config`.

The design is in `DESIGN_SPEC.md`. Network code is in `src/lib/api.js` (15 second timeout, a token per request so a superseded response is ignored), the state machine in `src/lib/state.js`, and every UI string in `src/lib/copy.js`, which `npm test` checks for plain words (no dashes, exclamation marks or semicolons).

`public/data/*.json` is no longer read by the app. The API reads `places.json` for its demo people.
