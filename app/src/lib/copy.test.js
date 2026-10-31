import { describe, it, expect } from 'vitest';
import {
  CHECK_IN_NOTES,
  DOMAIN_COPY,
  MESSAGES,
  RECOMMENDED_IDX,
  SETTING_LABELS,
  answerLabel,
  checkInNote,
  domainCopy,
  domainKeyOf,
  historyLabelOf,
  settingLabel,
} from './copy.js';

// No em or en dashes, no exclamation marks, no semicolons.
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}!;]`);

const strings = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
};

describe('copy table', () => {
  it('uses plain words only', () => {
    const all = strings([SETTING_LABELS, CHECK_IN_NOTES, DOMAIN_COPY, MESSAGES]);
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });

  it('labels the five check-in options in order, with the third recommended', () => {
    expect(SETTING_LABELS).toEqual([
      'Never, just pick',
      'Rarely',
      'When unsure (recommended)',
      'Often',
      'Always ask first',
    ]);
    expect(RECOMMENDED_IDX).toBe(2);
    expect(CHECK_IN_NOTES).toHaveLength(5);
  });

  it('has the start-line wording for the recommended option', () => {
    expect(checkInNote(2)).toBe("I'll check with you when I'm unsure.");
  });

  it('falls back to the data label past the fifth option', () => {
    const settings = [1, 2, 3, 4, 5, 6].map((n) => ({ label: `Setting ${n}` }));
    expect(settingLabel(settings, 1)).toBe('Rarely');
    expect(settingLabel(settings, 5)).toBe('Setting 6');
    expect(settingLabel(settings, 9)).toBe('');
  });
});

describe('domain wording', () => {
  it('has the places and shopping start prompts and buttons', () => {
    expect(DOMAIN_COPY.places.prompt).toBe('Want me to find somewhere new?');
    expect(DOMAIN_COPY.places.start).toBe('Find me somewhere new');
    expect(DOMAIN_COPY.places.next).toBe('Next');
    expect(DOMAIN_COPY.places.confirmed).toBe('Great. Saved to your plans.');
    expect(DOMAIN_COPY.shopping.prompt).toBe('Want me to suggest your next buy?');
    expect(DOMAIN_COPY.shopping.start).toBe('Suggest something new');
    expect(DOMAIN_COPY.shopping.next).toBe('Try another');
    expect(DOMAIN_COPY.shopping.confirmed).toBe('Added to your list.');
  });

  it('takes the domain from about.domain, else from the file it came from', () => {
    expect(domainKeyOf({ domain: 'shopping' }, 'places')).toBe('shopping');
    expect(domainKeyOf({ domain: 'other' }, 'places')).toBe('places');
    expect(domainKeyOf({}, 'shopping')).toBe('shopping');
    expect(domainCopy('nonsense').key).toBe('places');
  });

  it('takes the history label from about.history_label, else the domain default', () => {
    expect(historyLabelOf({ history_label: 'recent games' }, 'shopping')).toBe('recent games');
    expect(historyLabelOf({}, 'places')).toBe('recent places');
    expect(historyLabelOf({ history_label: '  ' }, 'shopping')).toBe('recent purchases');
  });

  it('labels the bubble for each reply', () => {
    expect(answerLabel('yes')).toBe('Yes');
    expect(answerLabel('no')).toBe('No');
    expect(answerLabel('skip')).toBe('Just pick');
  });
});
