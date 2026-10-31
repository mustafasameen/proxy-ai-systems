import { describe, it, expect } from 'vitest';
import { decideMode, answerAsPerson, binAccuracy, pct, pct1, currentView } from './decide.js';
import { withArticle, placeName, probLabel } from './format.js';

const question = { category: 'Coffee Shop', yes_idx: [2] };
const base = {
  question,
  ask_value: 0.2,
  answer_idx: 2,
  pick: 0,
  confidence: 0.5,
  candidates: [
    { name: 'A', category: 'Bar', prob: 0.5, history_count: 1 },
    { name: 'B', category: 'Park', prob: 0.2, history_count: 0 },
    { name: 'C', category: 'Coffee Shop', prob: 0.3, history_count: 0 },
  ],
  after_yes: { probs: [0, 0, 1], pick: 2 },
  after_no: { probs: [0.7, 0.3, 0], pick: 0 },
};

const never = { label: 'Never ask', ask_rate: 0, tau: null, ask_all: false };
const always = { label: 'Always ask', ask_rate: 1, tau: null, ask_all: true };
const some = (tau) => ({ label: 'Sometimes', ask_rate: 0.5, tau, ask_all: false });

describe('decideMode', () => {
  it('never asks when the setting has no threshold', () => {
    expect(decideMode(base, never)).toBe('act');
  });

  it('always asks when a question exists', () => {
    expect(decideMode(base, always)).toBe('ask');
  });

  it('acts under always-ask when there is no question', () => {
    expect(decideMode({ ...base, question: null }, always)).toBe('act');
  });

  it('acts under a threshold setting when there is no question', () => {
    expect(decideMode({ ...base, question: null, ask_value: 0.9 }, some(0.1))).toBe('act');
  });

  it('asks when the gain is exactly the threshold', () => {
    expect(decideMode({ ...base, ask_value: 0.2 }, some(0.2))).toBe('ask');
  });

  it('asks above the threshold and acts below it', () => {
    expect(decideMode({ ...base, ask_value: 0.25 }, some(0.2))).toBe('ask');
    expect(decideMode({ ...base, ask_value: 0.15 }, some(0.2))).toBe('act');
  });
});

describe('answerAsPerson', () => {
  it('answers yes when the real choice matches the question', () => {
    expect(answerAsPerson({ ...base, answer_idx: 2 })).toBe('yes');
  });

  it('answers no when the real choice does not match', () => {
    expect(answerAsPerson({ ...base, answer_idx: 1 })).toBe('no');
  });

  it('returns null when there is no question', () => {
    expect(answerAsPerson({ ...base, question: null })).toBe(null);
  });

  it('answers yes when any matching option was chosen', () => {
    const d = { ...base, question: { category: 'Bar', yes_idx: [0, 1] }, answer_idx: 1 };
    expect(answerAsPerson(d)).toBe('yes');
  });
});

describe('binAccuracy', () => {
  const bins = [
    { lo: 0, hi: 0.3, n: 10, confidence: 0.25, accuracy: 0.2 },
    { lo: 0.3, hi: 0.6, n: 10, confidence: 0.45, accuracy: 0.4 },
    { lo: 0.6, hi: 1.0, n: 10, confidence: 0.8, accuracy: 0.75 },
  ];

  it('finds the bin that holds the value', () => {
    expect(binAccuracy(bins, 0.1)).toBe(0.2);
    expect(binAccuracy(bins, 0.45)).toBe(0.4);
    expect(binAccuracy(bins, 0.7)).toBe(0.75);
  });

  it('puts a value on a bin edge in the upper bin', () => {
    expect(binAccuracy(bins, 0.3)).toBe(0.4);
    expect(binAccuracy(bins, 0.6)).toBe(0.75);
  });

  it('keeps 1.0 in the last bin', () => {
    expect(binAccuracy(bins, 1.0)).toBe(0.75);
  });

  it('keeps 0 in the first bin', () => {
    expect(binAccuracy(bins, 0)).toBe(0.2);
  });

  it('returns null without bins', () => {
    expect(binAccuracy([], 0.5)).toBe(null);
  });
});

describe('pct', () => {
  it('rounds to whole percents', () => {
    expect(pct(0.474)).toBe(47);
    expect(pct(0.615)).toBe(62);
    expect(pct(1)).toBe(100);
    expect(pct(0)).toBe(0);
  });

  it('formats one decimal', () => {
    expect(pct1(0.1158)).toBe('11.6');
    expect(pct1(0.08)).toBe('8.0');
  });
});

describe('currentView', () => {
  it('uses the stored pick and confidence before a question', () => {
    expect(currentView(base, null)).toEqual({ probs: [0.5, 0.2, 0.3], pick: 0, confidence: 0.5 });
  });

  it('uses the posterior after an answer', () => {
    expect(currentView(base, 'yes')).toEqual({ probs: [0, 0, 1], pick: 2, confidence: 1 });
    expect(currentView(base, 'no')).toEqual({ probs: [0.7, 0.3, 0], pick: 0, confidence: 0.7 });
  });
});

describe('format helpers', () => {
  it('chooses a or an', () => {
    expect(withArticle('Italian Restaurant')).toBe('an Italian Restaurant');
    expect(withArticle('Coffee Shop')).toBe('a Coffee Shop');
    expect(withArticle('University')).toBe('a University');
  });

  it('falls back to the category for unnamed places', () => {
    expect(placeName({ name: '', category: 'Park' })).toBe('Park');
    expect(placeName({ name: 'Home', category: 'private' })).toBe('Home');
  });

  it('labels tiny probabilities', () => {
    expect(probLabel(0.002)).toBe('<1%');
    expect(probLabel(0)).toBe('0%');
    expect(probLabel(0.456)).toBe('46%');
  });
});
