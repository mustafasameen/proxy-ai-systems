import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Assistant from './Assistant.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import AboutPage from './AboutPage.jsx';
import TopBar from './TopBar.jsx';
import { FRESH_FLOW } from '../lib/decide.js';
import { DOMAIN_COPY } from '../lib/copy.js';
import {
  about,
  people,
  placesDecision,
  settings,
  shoppingDecision,
  summary,
} from '../testing/fixtures.js';

// ---- helpers: render, read the visible text, and lint it ----------------------------------

const noop = () => {};
const actions = {
  onStart: noop,
  onChange: noop,
  onAnswer: noop,
  onAsPerson: noop,
  onConfirm: noop,
  onReject: noop,
  onToggleOthers: noop,
  onReveal: noop,
  onNext: noop,
};

const decode = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const attributes = (html) =>
  [...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => decode(m[1]));

// No em or en dashes, no exclamation marks, no semicolons, in text or in labels.
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}!;]`);
const lint = (html) => [text(html), ...attributes(html)].filter((s) => FORBIDDEN.test(s));

// Every control is a real button or input: no role="button", no links, no focusable divs.
const fakeControls = (html) => html.match(/role="button"|<a[ >]|tabindex="0"/g) || [];

const assistantProps = (over = {}) => ({
  copy: DOMAIN_COPY.places,
  decision: placesDecision,
  position: { index: 0, count: 3 },
  summary,
  settingIdx: 2,
  flow: FRESH_FLOW,
  dev: false,
  tally: { right: 0, revealed: 0, asked: 0 },
  noun: 'places',
  focusTick: 0,
  actions,
  ...over,
});
const renderAssistant = (over) => renderToStaticMarkup(h(Assistant, assistantProps(over)));
const started = (patch = {}) => ({ ...FRESH_FLOW, started: true, ...patch });

const shopping = (over = {}) => ({
  copy: DOMAIN_COPY.shopping,
  decision: shoppingDecision,
  noun: 'purchases',
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- the start state -----------------------------------------------------------------------

describe('start state', () => {
  it('shows the places prompt, one primary button and the check-in line with Change', () => {
    const html = renderAssistant();
    const t = text(html);
    expect(t).toContain('Want me to find somewhere new?');
    expect(t).toContain('Find me somewhere new');
    expect(t).toContain("I'll check with you when I'm unsure. Change");
    expect(html).not.toContain('class="stack"');
  });

  it('shows the shopping prompt and button', () => {
    const t = text(renderAssistant(shopping()));
    expect(t).toContain('Want me to suggest your next buy?');
    expect(t).toContain('Suggest something new');
  });

  it('describes the chosen check-in setting', () => {
    expect(text(renderAssistant({ settingIdx: 0 }))).toContain("I'll just pick, without checking");
    expect(text(renderAssistant({ settingIdx: 4 }))).toContain("I'll always ask you a question first.");
  });

  it('has no replay banner and no table', () => {
    const html = renderAssistant();
    expect(text(html)).not.toMatch(/Replaying|held-out|anonymized New York/);
    expect(html).not.toContain('<table');
  });
});

// ---- the question --------------------------------------------------------------------------

describe('the question', () => {
  it('asks first at the recommended setting when the gain is high enough', () => {
    const t = text(renderAssistant({ flow: started() }));
    expect(t).toContain('Before I pick, a quick question:');
    expect(t).toContain('Are you up for a Bar?');
    expect(t).toContain('Yes No Just pick');
    expect(t).not.toContain('My pick');
  });

  it('uses the full question sentence from the data when there is one', () => {
    const t = text(renderAssistant({ ...shopping(), settingIdx: 4, flow: started() }));
    expect(t).toContain('Is it for gaming?');
  });

  it('shows the answer as a bubble and then the pick', () => {
    const html = renderAssistant({ flow: started({ answer: 'yes' }) });
    const t = text(html);
    expect(html).toContain('class="bubble"');
    expect(t).toContain('You said: Yes');
    expect(t).toContain('My pick');
    expect(t).toContain('Gamma Bar');
    expect(t).toContain('Pretty sure (over 99%)');
    expect(t).toContain('Picks made after one question have been right about 7 in 10 times.');
    expect(t).not.toContain('Yes No Just pick');
  });

  it('shows Just pick as a bubble too, and the pick without a question answer', () => {
    const t = text(renderAssistant({ flow: started({ answer: 'skip' }) }));
    expect(t).toContain('You said: Just pick');
    expect(t).toContain('Alpha Cafe');
    expect(t).toContain('Fairly sure (50%)');
    expect(t).toContain('Picks this sure have been right about 4 in 10 times.');
  });

  it('does not ask when the setting says never', () => {
    const t = text(renderAssistant({ settingIdx: 0, flow: started() }));
    expect(t).not.toContain('Before I pick');
    expect(t).toContain('My pick');
  });
});

// ---- the pick card -------------------------------------------------------------------------

describe('pick card', () => {
  const act = (over = {}) => renderAssistant({ settingIdx: 0, flow: started(), ...over });

  it('shows name, category, reason, confidence in words and the measured line', () => {
    const t = text(act());
    expect(t).toContain('Alpha Cafe');
    expect(t).toContain('Coffee Shop');
    expect(t).toContain('2 of your last 14 places were Coffee Shop.');
    expect(t).toContain('Fairly sure (50%)');
    expect(t).toContain('Picks this sure have been right about 4 in 10 times.');
  });

  it('offers the three actions and a next button', () => {
    const t = text(act());
    expect(t).toContain('Go with this');
    expect(t).toContain('Show other options');
    expect(t).toContain('Not for me');
    expect(t).toMatch(/Next$/);
  });

  it('confirms with the places wording, then drops Go with this and Not for me', () => {
    const t = text(act({ flow: started({ confirmed: true }) }));
    expect(t).toContain('Great. Saved to your plans.');
    expect(t).not.toContain('Go with this');
    expect(t).not.toContain('Not for me');
    expect(t).toContain('Show other options');
  });

  it('confirms with the shopping wording and labels the next button Try another', () => {
    const t = text(renderAssistant({ ...shopping(), settingIdx: 0, flow: started({ confirmed: true }) }));
    expect(t).toContain('Added to your list.');
    expect(t).toMatch(/Try another$/);
  });

  it('shows the other options with probabilities and leaves out the pick', () => {
    const html = act({ flow: started({ others: true }) });
    const t = text(html);
    expect(t).toContain('Hide other options');
    expect(html).toContain('aria-label="Other options"');
    expect(t).toContain('Beta Park');
    expect(t).toContain('Gamma Bar');
    expect(t).toContain('Library');
    expect(t).toContain('Delta Books');
    expect(t).toContain('20%');
    expect(t).toContain('3%');
    const list = html.slice(html.indexOf('class="others"'));
    expect(list).not.toContain('Alpha Cafe');
  });

  it('says OK and shows the next best after Not for me, without a measured line', () => {
    const html = act({ flow: started({ rejected: [0] }) });
    const t = text(html);
    expect(t).toContain("OK, here's my next best.");
    expect(t).toContain('My next best');
    expect(t).toContain('Beta Park');
    expect(t).toContain('Not very sure (20%)');
    expect(html).not.toContain('class="pick-measured"');
    expect(t).not.toContain('Alpha Cafe');
  });

  it('leaves out options that were turned down from the other options', () => {
    const html = act({ flow: started({ rejected: [1], others: true }) });
    const list = html.slice(html.indexOf('class="others"'));
    expect(text(html)).toContain('Alpha Cafe');
    expect(list).not.toContain('Beta Park');
    expect(list).toContain('Gamma Bar');
  });

  it('says so when nothing is left to show', () => {
    const html = act({ flow: started({ rejected: [0, 1, 2, 3, 4] }) });
    const t = text(html);
    expect(t).toContain("That's all I have for this one.");
    expect(t).not.toContain('My pick');
    expect(t).toMatch(/Next$/);
  });

  it('uses the candidate reason and omits the category when it is empty', () => {
    const html = renderAssistant({ ...shopping(), settingIdx: 0, flow: started() });
    const t = text(html);
    expect(t).toContain('Starfield');
    expect(t).toContain('Two of your recent purchases are Xbox games.');
    expect(t).toContain('Pretty sure (72%)');
    expect(html).not.toContain('class="pick-cat"');
  });

  it('shows no reason line and no category line when both are missing', () => {
    const html = renderAssistant({ ...shopping(), settingIdx: 0, flow: started({ rejected: [0] }) });
    const t = text(html);
    expect(t).toContain('Desk lamp');
    expect(html).not.toContain('class="pick-why"');
    expect(html).not.toContain('class="pick-cat"');
    expect(t).not.toContain('of your last');
    expect(t).not.toContain('None of your recent');
  });
});

// ---- developer view ------------------------------------------------------------------------

describe('developer view', () => {
  const act = (over = {}) => renderAssistant({ settingIdx: 0, flow: started(), ...over });

  it('is hidden by default', () => {
    const t = text(act()) + text(renderAssistant({ flow: started() }));
    expect(t).not.toContain('Developer view');
    expect(t).not.toContain('Reveal what this person actually chose');
    expect(t).not.toContain('Answer as this person would');
    expect(t).not.toContain('This person so far');
  });

  it('adds the reveal button and the running tally', () => {
    const t = text(act({ dev: true, tally: { right: 1, revealed: 2, asked: 1 } }));
    expect(t).toContain('Reveal what this person actually chose');
    expect(t).toContain(
      'Decision t-1 (1 of 3). This person so far: right on 1 of 2 revealed choices, asked 1 time.',
    );
  });

  it('adds Answer as this person would on the question', () => {
    const t = text(renderAssistant({ dev: true, flow: started() }));
    expect(t).toContain('Answer as this person would');
  });

  it('reveals the real choice with a wrong badge, and confidently wrong when sure', () => {
    const sure = { ...placesDecision, confidence: 0.8 };
    const t = text(act({ dev: true, decision: sure, flow: started({ revealed: true }) }));
    expect(t).toContain('They went to Gamma Bar.');
    expect(t).toContain('PROXY was wrong');
    expect(t).toContain('Confidently wrong');
  });

  it('shows a right badge when the pick matches', () => {
    const lucky = { ...placesDecision, answer_idx: 0 };
    const t = text(act({ dev: true, decision: lucky, flow: started({ revealed: true }) }));
    expect(t).toContain('PROXY was right');
    expect(t).not.toContain('Confidently wrong');
  });

  it('says they bought it for shopping', () => {
    const t = text(
      renderAssistant({ ...shopping(), settingIdx: 0, dev: true, flow: started({ revealed: true }) }),
    );
    expect(t).toContain('They bought Desk lamp.');
  });
});

// ---- the top bar ---------------------------------------------------------------------------

describe('top bar', () => {
  const props = (over = {}) => ({
    domains: [
      { key: 'places', label: 'Places' },
      { key: 'shopping', label: 'Shopping' },
    ],
    domain: 'places',
    onDomain: noop,
    people,
    personIdx: 2,
    onPerson: noop,
    onSettings: noop,
    ...over,
  });

  it('shows the wordmark, the domain switch, the account chip and a settings button', () => {
    const html = renderToStaticMarkup(h(TopBar, props()));
    const t = text(html);
    expect(t).toContain('PROXY');
    expect(t).toContain('Places Shopping');
    expect(t).toContain('Demo account: Person 3');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('puts the note and Person 1 to 12 in the account menu, closed to start with', () => {
    const html = renderToStaticMarkup(h(TopBar, props()));
    expect(text(html)).toContain('Real, anonymized histories. Pick one to try PROXY as that person.');
    expect(html.match(/class="person-btn"/g)).toHaveLength(12);
    expect(html).toMatch(/class="menu"[^>]*hidden/);
    expect(html).toContain('aria-current="true"');
  });

  it('leaves out the switch when only places is loaded', () => {
    const html = renderToStaticMarkup(h(TopBar, props({ domains: [{ key: 'places', label: 'Places' }] })));
    expect(html).not.toContain('class="domain"');
    expect(text(html)).not.toContain('Shopping');
  });
});

// ---- the settings sheet --------------------------------------------------------------------

describe('settings sheet', () => {
  const props = (over = {}) => ({
    open: false,
    onClose: noop,
    settings,
    settingIdx: 2,
    onSetting: noop,
    history: placesDecision.history,
    historyLabel: 'recent places',
    onAbout: noop,
    dev: false,
    onDev: noop,
    ...over,
  });
  const render = (over) => renderToStaticMarkup(h(SettingsSheet, props(over)));

  it('asks when PROXY should check, with five options in order and the third recommended', () => {
    const html = render();
    const t = text(html);
    expect(t).toContain('When should PROXY check with you?');
    const order = [
      'Never, just pick',
      'Rarely',
      'When unsure (recommended)',
      'Often',
      'Always ask first',
    ].map((label) => t.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => /checked/.test(m[0]));
    expect(radios).toEqual([false, false, true, false, false]);
  });

  it('shows the measured trade-off under each option', () => {
    const t = text(render());
    expect(t).toContain('Never asks, right about 50% of the time.');
    expect(t).toContain('Asks about 3 in 10 times, right about 60% of the time.');
    expect(t).toContain('Asks about 5 in 10 times, right about 66% of the time.');
    expect(t).toContain('Asks about 7 in 10 times, right about 70% of the time.');
    expect(t).toContain('Asks every time, right about 74% of the time.');
  });

  it('lists what PROXY knows, with the history label, and says what it never sees', () => {
    const t = text(render());
    expect(t).toContain('What PROXY knows about you');
    expect(t).toContain('Recent places');
    expect(t).toContain('Show all 14');
    expect(t).toContain('PROXY uses only this list. It never sees your location, contacts or messages.');
    expect(text(render({ historyLabel: 'recent purchases' }))).toContain('Recent purchases');
  });

  it('links to the About page and holds the developer switch', () => {
    const html = render();
    expect(text(html)).toContain('How well does PROXY work?');
    expect(text(html)).toContain('Developer view (for evaluation)');
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);
    expect(render({ dev: true })).toMatch(/<input type="checkbox"[^>]*checked/);
  });

  it('is a modal dialog that starts closed', () => {
    const html = render();
    expect(html).toMatch(/^<dialog /);
    expect(html).not.toMatch(/^<dialog [^>]*\bopen\b/);
  });
});

// ---- the About page ------------------------------------------------------------------------

describe('about page', () => {
  const limits = ['First limit.', 'Second limit.', 'Third limit.', 'Fourth limit.', 'Fifth limit.'];
  const render = (over = {}) =>
    renderToStaticMarkup(
      h(AboutPage, {
        about: { ...about, limitations: limits },
        summary,
        dev: false,
        onBack: noop,
        onEvaluation: noop,
        ...over,
      }),
    );

  it('shows three big numbers: alone, after one question, at the recommended setting', () => {
    const t = text(render());
    expect(t).toContain('How often is PROXY right?');
    const at = ['50%', '74%', '66%'].map((n) => t.indexOf(n));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(t).toContain('On its own');
    expect(t).toContain('After one question');
    expect(t).toContain('At the recommended setting');
    expect(t).toContain('Measured on 2,502 real choices from 300 people, kept aside for testing.');
    expect(t).toContain('A random guess would be right about 2 in 10 times.');
  });

  it('says in one sentence when it is unsure', () => {
    const t = text(render());
    expect(t).toContain('When is it unsure?');
    expect(t).toContain('which at the recommended setting is about 5 in 10 times.');
  });

  it('lists up to four limitations and the data attribution', () => {
    const t = text(render());
    expect(t).toContain("What it can't do yet");
    expect(t).toContain('Fourth limit.');
    expect(t).not.toContain('Fifth limit.');
    expect(t).toContain('Data: Test data (CC0), names from a test source');
  });

  it('leaves out the limitations section when the data has none', () => {
    const t = text(render({ about }));
    expect(t).not.toContain("What it can't do yet");
  });

  it('shows Detailed evaluation only in the developer view', () => {
    expect(text(render())).not.toContain('Detailed evaluation');
    expect(text(render({ dev: true }))).toContain('Detailed evaluation');
  });
});

// ---- copy and controls across every state ---------------------------------------------------

describe('copy and controls', () => {
  it('uses plain words and real controls in every state', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flows = [
      FRESH_FLOW,
      started(),
      started({ answer: 'yes' }),
      started({ answer: 'no' }),
      started({ answer: 'skip' }),
      started({ answer: 'skip', rejected: [0] }),
      started({ answer: 'skip', rejected: [0, 1, 2, 3, 4] }),
      started({ answer: 'skip', confirmed: true, others: true, revealed: true }),
    ];
    const worlds = [{}, shopping()];
    let rendered = 0;
    for (const world of worlds) {
      for (const settingIdx of [0, 2, 4]) {
        for (const flow of flows) {
          for (const dev of [false, true]) {
            const html = renderAssistant({ ...world, settingIdx, flow, dev });
            expect(lint(html)).toEqual([]);
            expect(fakeControls(html)).toEqual([]);
            rendered += 1;
          }
        }
      }
    }
    expect(rendered).toBe(2 * 3 * 8 * 2);

    const pages = [
      renderToStaticMarkup(h(AboutPage, { about: { ...about, limitations: ['A short limit.'] }, summary, dev: true, onBack: noop, onEvaluation: noop })),
      renderToStaticMarkup(h(SettingsSheet, { open: false, onClose: noop, settings, settingIdx: 2, onSetting: noop, history: placesDecision.history, historyLabel: 'recent places', onAbout: noop, dev: true, onDev: noop })),
      renderToStaticMarkup(h(TopBar, { domains: [{ key: 'places', label: 'Places' }, { key: 'shopping', label: 'Shopping' }], domain: 'places', onDomain: noop, people, personIdx: 0, onPerson: noop, onSettings: noop })),
    ];
    for (const html of pages) {
      expect(lint(html)).toEqual([]);
      expect(fakeControls(html)).toEqual([]);
    }
    expect(errors).not.toHaveBeenCalled();
  });
});
