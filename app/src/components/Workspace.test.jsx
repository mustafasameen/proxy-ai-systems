import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OptionsList, Outcome, Pick, pickLabel, showCategory } from './Flow.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import { selectOption, rejectCurrent, initChoice } from '../lib/flow.js';
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
    expect(html).toContain("PROXY&#x27;s next pick");
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
    expect(html).toContain('aria-label="Map of 1 past visits and 3 options. PROXY does not use this map."');
    expect(html).toContain('role="img"');
    expect(html).toContain('Map. PROXY does not use this map.');
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

describe('pilot fixes', () => {
  it('names each pick correctly: PROXY, PROXY next, or the user', () => {
    const ranking = [0, 1, 2].map((i) => ({ index: i, name: `N${i}` }));
    const first = initChoice(ranking);
    expect(pickLabel(first)).toBe("PROXY's pick");
    expect(pickLabel(rejectCurrent(first))).toBe("PROXY's next pick");
    expect(pickLabel(selectOption(first, 2))).toBe('Your choice');
    expect(pickLabel(selectOption(selectOption(first, 2), 0))).toBe("PROXY's pick");
  });

  it('keeps the real choice row at full strength even when it was excluded', () => {
    const choice = { ranking: options, current: 1, rejected: [], accepted: false };
    const html = renderToStaticMarkup(
      <OptionsList rows={[row(0, 'excluded'), row(1, 'pick'), row(2, 'default')]} phase="pick" choice={choice} reveal={{ answer_index: 0, name: 'Babbo' }} onSelect={() => {}} />,
    );
    expect(html).toContain('opt-excluded is-real');
    expect(html).toContain('real choice');
    expect(html).not.toContain('opt-pick is-real');
  });

  it('shows a masked home as a private place with the reason', () => {
    const priv = { index: 0, name: 'Home', category: 'private', point: null };
    const html = renderToStaticMarkup(
      <OptionsList rows={[{ option: priv, letter: 'A', state: 'default' }]} phase="start" choice={null} reveal={null} onSelect={() => {}} />,
    );
    expect(html).toContain('A private place (name hidden)');
    expect(html).toContain('Private places are not shown on the map');
    expect(html).not.toContain('>private<');
    expect(showCategory(priv)).toBe(false);
  });

  it('counts only the options the answer left once they are all turned down', () => {
    const kept = { index: 1, name: 'Booker', category: 'Cocktail Bar' };
    const noop = () => {};
    const render = (ranking, ruledOut) => renderToStaticMarkup(
      <Pick
        state={{ response: { answer: 'yes', ranking, ruled_out: ruledOut, confidence: null }, choice: { ranking, current: null, rejected: ranking.map((_, i) => i), accepted: false, byUser: false }, reveal: null }}
        domain="places" total={5} onChoose={noop} onReject={noop} onNext={noop} onChangeAnswer={noop} onReveal={noop}
      />,
    );
    const one = render([kept], [0, 2, 3, 4]);
    expect(one).toContain('That was the only option your answer left.');
    expect(one).not.toContain('all five options');
    expect(one).toContain('Change your answer');
    const all = render([0, 1, 2, 3, 4].map((index) => ({ index, name: `N${index}` })), []);
    expect(all).toContain('That&#x27;s all five options.');
  });

  it('shows the accepted pick with a match line and puts Change answer right after the buttons', () => {
    const noop = () => {};
    const ranking = [0, 1].map((index) => ({ index, name: `N${index}`, category: 'Cafe', reason: 'You went to a cafe 2 times in your last 30 places.' }));
    const render = (current, byUser, accepted) => renderToStaticMarkup(
      <Pick
        state={{ response: { answer: 'no', question: { text: 'Q' }, ranking, ruled_out: [], confidence: { label: 'Higher confidence', matched_out_of_10: 7 } }, question: { text: 'Q' }, answer: 'no', choice: { ranking, current, rejected: [], accepted, byUser }, reveal: null }}
        domain="places" total={5} onChoose={noop} onReject={noop} onNext={noop} onChangeAnswer={noop} onReveal={noop}
      />,
    );
    expect(render(0, false, true)).toContain('similar picks matched the real choice about 7 in 10 times');
    expect(render(1, true, true)).toContain('There is no match rate for this option');
    const open = render(0, false, false);
    expect(open.indexOf('Not for me')).toBeLessThan(open.indexOf('Change answer'));
    expect(open.indexOf('Choose this place')).toBeLessThan(open.indexOf('Change answer'));
  });

  it('shows a masked sensitive place by its kind', () => {
    const o = { index: 0, name: 'Health care', category: 'Health care', point: null };
    const html = renderToStaticMarkup(
      <OptionsList rows={[{ option: o, letter: 'C', state: 'default' }]} phase="start" choice={null} reveal={null} onSelect={() => {}} />,
    );
    expect(html).toContain('A health care place (name hidden)');
  });

  it('heads the settings percentages "Match rate"', () => {
    const config = {
      settings: [{ label: 'Never ask', ask_rate: 0, accuracy: 0.37, accuracy_ci: [0.3, 0.4] }],
      evaluation: { report_rows: 100, report_users: 20 },
    };
    const html = renderToStaticMarkup(
      <SettingsSheet domain="places" config={config} setting="Never ask" devView={false} onSetting={() => {}} onDev={() => {}} onAbout={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain('Match rate');
    expect(html).toContain('37%');
    expect(html).toContain('restarts the current decision');
  });
});
