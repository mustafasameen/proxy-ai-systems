import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OptionsList, Outcome, showCategory } from './Flow.jsx';
import MapView, { placeOptions } from './MapView.jsx';
import { makeProjection } from '../lib/map.js';

const options = ['Babbo', 'Booker', 'Colicchio'].map((name, index) => ({ index, name, category: 'Cafe', point: [40.73, -74.0 + index * 0.01] }));
const row = (i, state) => ({ option: options[i], letter: 'ABC'[i], state });

describe('options list', () => {
  it('renders every option with its letter and state text, as buttons only when selectable', () => {
    const choice = { ranking: options, current: 1, rejected: [], accepted: false };
    const html = renderToStaticMarkup(
      <OptionsList rows={[row(0, 'default'), row(1, 'pick'), row(2, 'excluded')]} phase="pick" choice={choice} reveal={null} onSelect={() => {}} />,
    );
    expect(html).toContain('Babbo');
    expect(html).toContain("PROXY&#x27;s pick");
    expect(html).toContain('Excluded by your answer');
    expect((html.match(/<button/g) || []).length).toBe(1);
    expect(html).toContain('opt-excluded');
  });

  it('marks rows a yes keeps during the question', () => {
    const html = renderToStaticMarkup(
      <OptionsList rows={[row(0, 'kept'), row(1, 'default'), row(2, 'kept')]} phase="question" choice={null} reveal={null} onSelect={() => {}} />,
    );
    expect((html.match(/Kept if you say yes/g) || []).length).toBe(2);
    expect(html).not.toContain('<button');
  });
});

describe('map view', () => {
  it('labels the map, draws a marker for each option, and puts them in the viewBox', () => {
    const history = [{ name: 'H', category: 'Bar', point: [40.72, -74.0] }, { name: 'P', category: 'Bar', point: null }];
    const html = renderToStaticMarkup(
      <MapView history={history} rows={[row(0, 'default'), row(1, 'pick'), row(2, 'passed')]} outline={null} bounds={null} />,
    );
    expect(html).toContain('aria-label="Map of 1 past visits and 3 options"');
    expect(html).toContain('role="img"');
    expect(html).toContain('map-pick');
    expect(html).toContain('is-faded');
    const project = makeProjection([[40.72, -74.0], ...options.map((o) => o.point)]);
    placeOptions([row(0, 'default'), row(1, 'default')], project).forEach(({ x, y }) => {
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(project.width);
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(project.height);
    });
  });

  it('fans out options that share a point', () => {
    const same = [{ ...options[0], point: [40.7, -74] }, { ...options[1], point: [40.7, -74] }];
    const project = makeProjection([[40.7, -74]]);
    const marks = placeOptions(same.map((o, i) => ({ option: o, letter: 'AB'[i], state: 'default' })), project);
    expect(marks[0].x).not.toBe(marks[1].x);
  });
});

describe('category line and outcome', () => {
  it('hides a category that only repeats the name', () => {
    expect(showCategory({ name: 'Residence', category: 'residence' })).toBe(false);
    expect(showCategory({ name: 'Babbo', category: 'Italian Restaurant' })).toBe(true);
    expect(showCategory({ name: 'Babbo', category: null })).toBe(false);
  });

  const base = {
    response: { ranking: [{ index: 1, name: 'Booker' }] },
    question: { text: 'Are you up for a cafe?', category: 'Cafe', yes_idx: [0, 2] },
    answer: 'yes',
  };
  it('offers the reveal before it is loaded', () => {
    const html = renderToStaticMarkup(<Outcome state={{ ...base, reveal: null }} domain="places" onReveal={() => {}} />);
    expect(html).toContain('See what this person really chose');
  });
  it('says whether the pick matched and what the truthful answer was', () => {
    const miss = renderToStaticMarkup(<Outcome state={{ ...base, reveal: { answer_index: 3, name: 'Kin Shop' } }} domain="places" onReveal={() => {}} />);
    expect(miss).toContain('Kin Shop');
    expect(miss).toContain('did not match');
    expect(miss).toContain("Their real choice fits a No. You said Yes. How they would really have answered is unknown.");
    const hit = renderToStaticMarkup(<Outcome state={{ ...base, answer: 'skip', reveal: { answer_index: 1, name: 'Booker' } }} domain="places" onReveal={() => {}} />);
    expect(hit).toContain('matched.');
    expect(hit).toContain("Their real choice fits a No.");
  });
});

describe('linked map focus', () => {
  it('highlights visits of the focused kind and names the focused option', () => {
    const history = [{ name: 'X', category: 'Cafe', point: [40.73, -74.0] }, { name: 'Y', category: 'Park', point: [40.74, -73.99] }];
    const html = renderToStaticMarkup(
      <MapView history={history} rows={[row(0, 'default'), row(1, 'default')]} outline={null} bounds={null} kind="cafe" focusOption={1} />,
    );
    expect(html).toContain('map-visit is-on');
    expect(html).toContain('map-visit is-dim');
    expect(html).toContain('class="map-name"');
  });
});
