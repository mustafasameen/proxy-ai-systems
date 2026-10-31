import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import Assistant from './Assistant.jsx';
import AboutPage from './AboutPage.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import { FRESH_FLOW, conversationView, questionText, reasonLine } from '../lib/decide.js';
import { domainCopy, domainKeyOf, historyLabelOf } from '../lib/copy.js';
import { historyNoun } from '../lib/format.js';
import { isDataset } from '../lib/data.js';

// Renders every decision in the files the app ships with: public/data/places.json, and
// public/data/shopping.json when it exists. This is a smoke test of the data against the view,
// and a check that the copy fields in the data are plain words.

const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}!;]`);
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

const files = [
  { slot: 'places', url: new URL('../../public/data/places.json', import.meta.url) },
  { slot: 'shopping', url: new URL('../../public/data/shopping.json', import.meta.url) },
].filter((f) => existsSync(f.url));

it('has a places file to test against', () => {
  expect(files.some((f) => f.slot === 'places')).toBe(true);
});

for (const { slot, url } of files) {
  describe(`${slot}.json`, () => {
    const data = JSON.parse(readFileSync(url, 'utf8'));
    const { about, summary, people } = data;
    const domainKey = domainKeyOf(about, slot);
    const copy = domainCopy(domainKey);
    const noun = historyNoun(historyLabelOf(about, domainKey));
    const decisions = people.flatMap((p) => p.decisions);

    it('has the shape the app reads', () => {
      expect(isDataset(data)).toBe(true);
      expect(summary.settings.length).toBe(5);
      expect(decisions.length).toBeGreaterThan(0);
      for (const d of decisions) {
        expect(d.candidates.length).toBeGreaterThan(0);
        expect(d.candidates[d.pick]).toBeTruthy();
        expect(d.candidates[d.answer_idx]).toBeTruthy();
      }
    });

    it('uses plain words in the copy fields of the data', () => {
      const copyFields = [about.history_label, ...(about.limitations || [])];
      for (const d of decisions) {
        if (d.question && typeof d.question.text === 'string') copyFields.push(d.question.text);
        for (const c of d.candidates) if (typeof c.reason === 'string') copyFields.push(c.reason);
      }
      expect(copyFields.filter((s) => typeof s === 'string' && FORBIDDEN.test(s))).toEqual([]);
      if (about.limitations !== undefined) {
        expect(Array.isArray(about.limitations)).toBe(true);
        expect(about.limitations.every((s) => typeof s === 'string')).toBe(true);
      }
    });

    it('gives every decision a question text and a pick it can show', () => {
      for (const d of decisions) {
        const cv = conversationView(d, summary.settings[4], { ...FRESH_FLOW, started: true, answer: 'skip' });
        expect(cv.shownIdx).not.toBe(null);
        if (d.question) {
          expect(questionText(d)).not.toBe('');
        }
        // A reason line is a sentence, or nothing. It is never a fragment.
        const line = reasonLine(d.candidates[d.pick], d.history.length, noun);
        expect(line === '' || /[.?]$/.test(line)).toBe(true);
      }
    });

    it('renders every decision at three check-in settings and several states', () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const flows = [
        FRESH_FLOW,
        { ...FRESH_FLOW, started: true },
        { ...FRESH_FLOW, started: true, answer: 'yes' },
        { ...FRESH_FLOW, started: true, answer: 'no' },
        { ...FRESH_FLOW, started: true, answer: 'skip', rejected: [0], others: true },
        { ...FRESH_FLOW, started: true, answer: 'skip', confirmed: true, revealed: true },
      ];
      let count = 0;
      for (const person of people) {
        person.decisions.forEach((d, index) => {
          for (const settingIdx of [0, 2, 4]) {
            for (const flow of flows) {
              const html = renderToStaticMarkup(
                h(Assistant, {
                  copy,
                  decision: d,
                  position: { index, count: person.decisions.length },
                  summary,
                  settingIdx,
                  flow,
                  dev: true,
                  tally: { right: 0, revealed: 0, asked: 0 },
                  noun,
                  focusTick: 0,
                  actions,
                }),
              );
              expect(html.length).toBeGreaterThan(100);
              count += 1;
            }
          }
        });
      }
      expect(count).toBe(decisions.length * 3 * flows.length);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    }, 60000);

    it('renders the About page and the settings sheet', () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const about1 = renderToStaticMarkup(
        h(AboutPage, { about, summary, dev: true, onBack: noop, onEvaluation: noop }),
      );
      expect(about1).toContain('How often is PROXY right?');
      const sheet = renderToStaticMarkup(
        h(SettingsSheet, {
          open: false,
          onClose: noop,
          settings: summary.settings,
          settingIdx: 2,
          onSetting: noop,
          history: people[0].decisions[0].history,
          historyLabel: historyLabelOf(about, domainKey),
          onAbout: noop,
          dev: false,
          onDev: noop,
        }),
      );
      expect(sheet).toContain('When should PROXY check with you?');
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });
}
