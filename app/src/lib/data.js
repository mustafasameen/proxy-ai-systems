// Loading the data files. places.json is required. shopping.json is optional: when it is missing
// or unusable the Shopping domain is simply hidden, with no error shown.

export const PLACES_URL = 'data/places.json';
export const SHOPPING_URL = 'data/shopping.json';

// A usable dataset has the parts the app reads: about, summary with settings, and people with decisions.
export function isDataset(d) {
  return Boolean(
    d &&
      typeof d === 'object' &&
      d.about &&
      typeof d.about === 'object' &&
      d.summary &&
      Array.isArray(d.summary.settings) &&
      d.summary.settings.length > 0 &&
      Array.isArray(d.people) &&
      d.people.length > 0 &&
      d.people.every((p) => p && Array.isArray(p.decisions)),
  );
}

async function getJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // A static server that falls back to index.html answers a missing file with HTML and status 200.
  // That fails here as a parse error, which the caller treats like a missing file.
  return response.json();
}

// Loads both files. Rejects when places.json cannot be used. Resolves shopping to null when its
// file is missing, is not JSON, or does not have the expected shape.
export async function loadDatasets(fetchImpl = (...args) => fetch(...args), signal) {
  const placesRequest = getJson(fetchImpl, PLACES_URL, signal);
  const shoppingRequest = getJson(fetchImpl, SHOPPING_URL, signal).catch(() => null);
  const [places, shopping] = await Promise.all([placesRequest, shoppingRequest]);
  if (!isDataset(places)) throw new Error('places data is not usable');
  return { places, shopping: isDataset(shopping) ? shopping : null };
}
