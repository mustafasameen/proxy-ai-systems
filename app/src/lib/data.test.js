import { describe, it, expect } from 'vitest';
import { PLACES_URL, SHOPPING_URL, isDataset, loadDatasets } from './data.js';
import { about, people, summary } from '../testing/fixtures.js';

const dataset = { about, summary, reference: [], people };

const answer = (body, ok = true, status = 200) => () =>
  Promise.resolve({
    ok,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  });
const missing = answer(null, false, 404);
const htmlPage = answer(new SyntaxError('Unexpected token <'));
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

// A fetch that answers by URL. An unknown URL behaves like a network error.
const fakeFetch = (routes, seen = []) => (url) => {
  seen.push(url);
  return routes[url] ? routes[url]() : offline();
};

describe('loadDatasets', () => {
  it('loads places and shopping from their own files', async () => {
    const seen = [];
    const shopping = { ...dataset, about: { ...about, domain: 'shopping' } };
    const routes = { [PLACES_URL]: answer(dataset), [SHOPPING_URL]: answer(shopping) };
    const out = await loadDatasets(fakeFetch(routes, seen));
    expect(out.places).toEqual(dataset);
    expect(out.shopping).toEqual(shopping);
    expect(seen.sort()).toEqual(['data/places.json', 'data/shopping.json']);
  });

  it('hides shopping when its file is missing', async () => {
    const out = await loadDatasets(fakeFetch({ [PLACES_URL]: answer(dataset), [SHOPPING_URL]: missing }));
    expect(out.shopping).toBe(null);
    expect(out.places).toEqual(dataset);
  });

  it('hides shopping when the server answers with a page instead of JSON', async () => {
    const out = await loadDatasets(fakeFetch({ [PLACES_URL]: answer(dataset), [SHOPPING_URL]: htmlPage }));
    expect(out.shopping).toBe(null);
  });

  it('hides shopping on a network error', async () => {
    const out = await loadDatasets(fakeFetch({ [PLACES_URL]: answer(dataset) }));
    expect(out.shopping).toBe(null);
  });

  it('hides shopping when its file does not have the expected shape', async () => {
    const routes = { [PLACES_URL]: answer(dataset), [SHOPPING_URL]: answer({ people: [] }) };
    expect((await loadDatasets(fakeFetch(routes))).shopping).toBe(null);
  });

  it('fails when places cannot be loaded', async () => {
    const routes = { [PLACES_URL]: missing, [SHOPPING_URL]: answer(dataset) };
    await expect(loadDatasets(fakeFetch(routes))).rejects.toThrow('HTTP 404');
  });

  it('fails when places does not have the expected shape', async () => {
    const routes = { [PLACES_URL]: answer({ about }), [SHOPPING_URL]: missing };
    await expect(loadDatasets(fakeFetch(routes))).rejects.toThrow('not usable');
  });
});

describe('isDataset', () => {
  it('accepts a dataset with about, settings and people with decisions', () => {
    expect(isDataset(dataset)).toBe(true);
  });

  it('rejects anything missing a part the app reads', () => {
    expect(isDataset(null)).toBe(false);
    expect(isDataset({})).toBe(false);
    expect(isDataset({ ...dataset, about: undefined })).toBe(false);
    expect(isDataset({ ...dataset, summary: { ...summary, settings: [] } })).toBe(false);
    expect(isDataset({ ...dataset, people: [] })).toBe(false);
    expect(isDataset({ ...dataset, people: [{ id: 'Person 1' }] })).toBe(false);
  });
});
