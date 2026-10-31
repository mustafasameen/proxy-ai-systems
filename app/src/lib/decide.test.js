import { describe, it, expect } from 'vitest';
import {
  decideMode,
  answerAsPerson,
  binAccuracy,
  pct,
  pct1,
  currentView,
  confidenceWords,
  outOfTen,
  nextBest,
  questionText,
  reasonLine,
  accuracyLine,
  askRatePhrase,
  tradeoffText,
  conversationView,
  otherOptions,
  tallyFor,
  FRESH_FLOW,
} from './decide.js';
import {
  withArticle,
  placeName,
  probLabel,
  hasCategory,
  capitalizeFirst,
  historyNoun,
  chosenName,
} from './format.js';

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

// ---------------------------------------------------------------------------
// End-user wording and flow
// ---------------------------------------------------------------------------

describe('confidenceWords', () => {
  it('says pretty sure from 0.7 up', () => {
    expect(confidenceWords(0.74)).toBe('Pretty sure (74%)');
    expect(confidenceWords(0.7)).toBe('Pretty sure (70%)');
    expect(confidenceWords(1)).toBe('Pretty sure (over 99%)');
  });

  it('says fairly sure from 0.45 up to 0.7', () => {
    expect(confidenceWords(0.52)).toBe('Fairly sure (52%)');
    expect(confidenceWords(0.45)).toBe('Fairly sure (45%)');
    expect(confidenceWords(0.69)).toBe('Fairly sure (69%)');
  });

  it('says not very sure below 0.45', () => {
    expect(confidenceWords(0.31)).toBe('Not very sure (31%)');
    expect(confidenceWords(0.44)).toBe('Not very sure (44%)');
    expect(confidenceWords(0)).toBe('Not very sure (0%)');
  });

  it('sets the band from the probability itself', () => {
    expect(confidenceWords(0.6996)).toMatch(/^Fairly sure/);
    expect(confidenceWords(0.4499)).toMatch(/^Not very sure/);
  });

  it('keeps values between 0 and 1 and returns nothing for a non-number', () => {
    expect(confidenceWords(1.2)).toBe('Pretty sure (over 99%)');
    expect(confidenceWords(-0.1)).toBe('Not very sure (0%)');
    expect(confidenceWords(NaN)).toBe('');
    expect(confidenceWords(undefined)).toBe('');
  });
});

describe('outOfTen', () => {
  it('rounds a share to a whole number out of ten', () => {
    expect(outOfTen(0.7033)).toBe(7);
    expect(outOfTen(0.735)).toBe(7);
    expect(outOfTen(0.5024)).toBe(5);
    expect(outOfTen(0.6571)).toBe(7);
    expect(outOfTen(0.04)).toBe(0);
    expect(outOfTen(0.96)).toBe(10);
  });

  it('rounds half up and keeps both ends', () => {
    expect(outOfTen(0.45)).toBe(5);
    expect(outOfTen(0.35)).toBe(4);
    expect(outOfTen(0)).toBe(0);
    expect(outOfTen(1)).toBe(10);
  });

  it('stays between 0 and 10', () => {
    expect(outOfTen(1.4)).toBe(10);
    expect(outOfTen(-0.2)).toBe(0);
  });

  it('returns null when there is no number', () => {
    expect(outOfTen(null)).toBe(null);
    expect(outOfTen(undefined)).toBe(null);
    expect(outOfTen(NaN)).toBe(null);
  });
});

describe('nextBest', () => {
  const probs = [0.1, 0.5, 0.3, 0.1];

  it('returns the highest probability when nothing is excluded', () => {
    expect(nextBest(probs, [])).toBe(1);
    expect(nextBest(probs)).toBe(1);
  });

  it('skips excluded indexes', () => {
    expect(nextBest(probs, [1])).toBe(2);
    expect(nextBest(probs, [1, 2])).toBe(0);
  });

  it('takes the lowest index on a tie', () => {
    expect(nextBest([0.2, 0.4, 0.4], [])).toBe(1);
    expect(nextBest([0, 0, 0], [0])).toBe(1);
  });

  it('returns null when every index is excluded or there is nothing to choose from', () => {
    expect(nextBest(probs, [0, 1, 2, 3])).toBe(null);
    expect(nextBest([], [])).toBe(null);
  });

  it('accepts a Set and ignores indexes that do not exist', () => {
    expect(nextBest(probs, new Set([1]))).toBe(2);
    expect(nextBest(probs, [9])).toBe(1);
  });
});

describe('questionText', () => {
  it('uses the full sentence when the data has one', () => {
    const d = { question: { text: 'Do you want a console game?', category: '', yes_idx: [0] } };
    expect(questionText(d)).toBe('Do you want a console game?');
  });

  it('builds the places wording from the category otherwise', () => {
    expect(questionText({ question })).toBe('Are you up for a Coffee Shop?');
    expect(questionText({ question: { category: 'Italian Restaurant', yes_idx: [1] } })).toBe(
      'Are you up for an Italian Restaurant?',
    );
  });

  it('falls back to the category when the text is blank', () => {
    expect(questionText({ question: { text: '  ', category: 'Park', yes_idx: [] } })).toBe(
      'Are you up for a Park?',
    );
  });

  it('returns an empty string without a question, or without text or category', () => {
    expect(questionText({ ...base, question: null })).toBe('');
    expect(questionText(null)).toBe('');
    expect(questionText({ question: { category: '', yes_idx: [0] } })).toBe('');
  });
});

describe('reasonLine', () => {
  it('shows the candidate reason when it has one', () => {
    const c = {
      name: 'Starfield',
      category: '',
      history_count: 0,
      reason: ' Two of your recent purchases are Xbox games. ',
    };
    expect(reasonLine(c, 20, 'purchases')).toBe('Two of your recent purchases are Xbox games.');
  });

  it('prefers the reason over the places wording', () => {
    const c = { category: 'Bar', history_count: 3, reason: 'You went to a similar bar last week.' };
    expect(reasonLine(c, 20)).toBe('You went to a similar bar last week.');
  });

  it('builds the places wording from history_count and category', () => {
    expect(reasonLine({ category: 'Park', history_count: 1 }, 20)).toBe(
      '1 of your last 20 places was Park.',
    );
    expect(reasonLine({ category: 'Park', history_count: 3 }, 20)).toBe(
      '3 of your last 20 places were Park.',
    );
  });

  it('says so when none of the recent places were this kind', () => {
    expect(reasonLine({ category: 'Park', history_count: 0 }, 20)).toBe(
      'None of your recent places were this kind of place, so this pick leans on patterns PROXY learned from other people.',
    );
  });

  it('shows no line at all when there is no reason and the category is empty', () => {
    expect(reasonLine({ name: 'Starfield', category: '', history_count: 0 }, 20)).toBe('');
    expect(reasonLine({ name: 'Starfield', category: '   ', history_count: 2 }, 20)).toBe('');
    expect(reasonLine({ name: 'Starfield', history_count: 0 }, 20)).toBe('');
  });

  it('ignores a blank reason', () => {
    expect(reasonLine({ category: 'Park', history_count: 1, reason: '   ' }, 5)).toBe(
      '1 of your last 5 places was Park.',
    );
  });

  it('counts the noun of the history it is given', () => {
    expect(reasonLine({ category: 'Games', history_count: 2 }, 12, 'purchases')).toBe(
      '2 of your last 12 purchases were Games.',
    );
  });
});

describe('accuracyLine', () => {
  const reliability = [
    { lo: 0, hi: 0.5, accuracy: 0.3 },
    { lo: 0.5, hi: 1, accuracy: 0.7033 },
  ];

  it('reads the reliability bin before a question', () => {
    const line = (confidence) =>
      accuracyLine({ answered: false, confidence, reliability, alwaysAskAccuracy: 0.735 });
    expect(line(0.74)).toBe('Picks this sure have been right about 7 in 10 times.');
    expect(line(0.2)).toBe('Picks this sure have been right about 3 in 10 times.');
  });

  it('uses the accuracy after one question once a question was answered', () => {
    const line = accuracyLine({
      answered: true,
      confidence: 1,
      reliability,
      alwaysAskAccuracy: 0.735,
    });
    expect(line).toBe('Picks made after one question have been right about 7 in 10 times.');
  });

  it('returns nothing when nothing was measured', () => {
    expect(
      accuracyLine({ answered: false, confidence: 0.5, reliability: [], alwaysAskAccuracy: 0.7 }),
    ).toBe('');
    expect(
      accuracyLine({ answered: true, confidence: 1, reliability, alwaysAskAccuracy: undefined }),
    ).toBe('');
  });
});

describe('askRatePhrase and tradeoffText', () => {
  it('names how often a setting asks', () => {
    expect(askRatePhrase(0)).toBe('never');
    expect(askRatePhrase(1)).toBe('every time');
    expect(askRatePhrase(0.5)).toBe('about 5 in 10 times');
  });

  it('writes N in 10 asks and the percent right', () => {
    expect(tradeoffText({ ask_rate: 0.3, accuracy: 0.5999 })).toBe(
      'Asks about 3 in 10 times, right about 60% of the time.',
    );
    expect(tradeoffText({ ask_rate: 0.5, accuracy: 0.6571 })).toBe(
      'Asks about 5 in 10 times, right about 66% of the time.',
    );
  });

  it('uses plain words at the two ends', () => {
    expect(tradeoffText({ ask_rate: 0, accuracy: 0.5024 })).toBe(
      'Never asks, right about 50% of the time.',
    );
    expect(tradeoffText({ ask_rate: 1, accuracy: 0.735 })).toBe(
      'Asks every time, right about 74% of the time.',
    );
  });

  it('does not round a small or large rate to never or every time', () => {
    expect(tradeoffText({ ask_rate: 0.04, accuracy: 0.5 })).toBe(
      'Asks fewer than 1 in 10 times, right about 50% of the time.',
    );
    expect(tradeoffText({ ask_rate: 0.97, accuracy: 0.5 })).toBe(
      'Asks almost every time, right about 50% of the time.',
    );
  });

  it('leaves out the accuracy when it is missing', () => {
    expect(tradeoffText({ ask_rate: 0.3 })).toBe('Asks about 3 in 10 times.');
  });
});

describe('conversationView', () => {
  const started = { ...FRESH_FLOW, started: true };

  it('is not asking before the request starts', () => {
    expect(conversationView(base, always, FRESH_FLOW).asking).toBe(false);
  });

  it('asks when the setting says to and a question exists', () => {
    const cv = conversationView(base, always, started);
    expect(cv.asking).toBe(true);
    expect(cv.question).toBe('Are you up for a Coffee Shop?');
  });

  it('shows the pick straight away when the setting says not to ask', () => {
    const cv = conversationView(base, never, started);
    expect(cv).toMatchObject({ asking: false, first: true, shownIdx: 0, confidence: 0.5 });
  });

  it('does not ask without a usable question', () => {
    expect(conversationView({ ...base, question: null }, always, started).asking).toBe(false);
    const blank = { ...base, question: { category: '', yes_idx: [2] } };
    expect(conversationView(blank, always, started).asking).toBe(false);
  });

  it('moves to the pick after Yes, No or Just pick', () => {
    expect(conversationView(base, always, { ...started, answer: 'yes' })).toMatchObject({
      asking: false,
      yn: 'yes',
      shownIdx: 2,
      confidence: 1,
    });
    expect(conversationView(base, always, { ...started, answer: 'no' })).toMatchObject({
      yn: 'no',
      shownIdx: 0,
      confidence: 0.7,
    });
    expect(conversationView(base, always, { ...started, answer: 'skip' })).toMatchObject({
      asking: false,
      yn: null,
      shownIdx: 0,
      confidence: 0.5,
    });
  });

  it('shows the next most likely option after Not for me', () => {
    const one = conversationView(base, never, { ...started, rejected: [0] });
    expect(one).toMatchObject({ first: false, shownIdx: 2, confidence: 0.3 });
    const two = conversationView(base, never, { ...started, rejected: [0, 2] });
    expect(two).toMatchObject({ first: false, shownIdx: 1, confidence: 0.2 });
  });

  it('has nothing left to show once every option is turned down', () => {
    expect(conversationView(base, never, { ...started, rejected: [0, 2, 1] }).shownIdx).toBe(null);
  });

  it('does not offer an option the answer itself ruled out', () => {
    const cv = conversationView(base, always, { ...started, answer: 'yes', rejected: [2] });
    expect(cv.shownIdx).toBe(null);
  });
});

describe('otherOptions', () => {
  it('lists the other options, most likely first', () => {
    expect(otherOptions([0.1, 0.5, 0.3, 0.1], 1)).toEqual([
      { i: 2, p: 0.3 },
      { i: 0, p: 0.1 },
      { i: 3, p: 0.1 },
    ]);
  });

  it('leaves out the options turned down', () => {
    expect(otherOptions([0.1, 0.5, 0.3, 0.1], 1, [2])).toEqual([
      { i: 0, p: 0.1 },
      { i: 3, p: 0.1 },
    ]);
  });

  it('keeps ruled-out options last, at zero', () => {
    expect(otherOptions([0, 1, 0], 1)).toEqual([
      { i: 0, p: 0 },
      { i: 2, p: 0 },
    ]);
  });
});

describe('tallyFor', () => {
  it('counts revealed, right and asked for one domain only', () => {
    const decisions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const tally = {
      'places/a': { asked: true, right: true },
      'places/b': { right: false },
      'shopping/c': { asked: true, right: true },
    };
    expect(tallyFor(decisions, tally, 'places')).toEqual({ right: 1, revealed: 2, asked: 1 });
  });
});

describe('more format helpers', () => {
  it('tells whether an item has a category to show', () => {
    expect(hasCategory({ name: 'X', category: 'Park' })).toBe(true);
    expect(hasCategory({ name: 'X', category: '  ' })).toBe(false);
    expect(hasCategory({ name: 'X' })).toBe(false);
  });

  it('capitalizes a history label', () => {
    expect(capitalizeFirst('recent places')).toBe('Recent places');
    expect(capitalizeFirst('')).toBe('');
  });

  it('finds the noun a history label counts', () => {
    expect(historyNoun('recent places')).toBe('places');
    expect(historyNoun('recent purchases')).toBe('purchases');
    expect(historyNoun('')).toBe('places');
  });

  it('names the option the person actually chose', () => {
    expect(chosenName({ name: 'Babbo', category: 'Italian' })).toBe('Babbo');
    expect(chosenName({ name: '', category: 'Park' })).toBe('an unnamed Park');
    expect(chosenName({ name: '', category: '' })).toBe('an unnamed option');
  });
});
