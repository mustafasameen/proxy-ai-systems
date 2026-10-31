// Synthetic data for the tests. Not shipped: the app never imports this file.

export const settings = [
  { label: 'Never ask', ask_rate: 0, accuracy: 0.5024, tau: null, ask_all: false },
  { label: 'Rarely', ask_rate: 0.3, accuracy: 0.5999, tau: 0.26, ask_all: false },
  { label: 'Sometimes', ask_rate: 0.5, accuracy: 0.6571, tau: 0.1, ask_all: false },
  { label: 'Often', ask_rate: 0.7, accuracy: 0.697, tau: 0.05, ask_all: false },
  { label: 'Always ask', ask_rate: 1, accuracy: 0.735, tau: null, ask_all: true },
];

export const summary = {
  act_now_accuracy: 0.5024,
  always_ask_accuracy: 0.735,
  chance: 0.2,
  settings,
  curves: { voi: [], confidence: [], random: [] },
  reliability: [
    { lo: 0, hi: 0.3, n: 10, confidence: 0.25, accuracy: 0.24 },
    { lo: 0.3, hi: 0.6, n: 10, confidence: 0.45, accuracy: 0.4 },
    { lo: 0.6, hi: 1, n: 10, confidence: 0.8, accuracy: 0.7 },
  ],
  ece: 0.02,
  confidently_wrong: { '0.7': 10 },
  error_patterns: { n_wrong: 10 },
};

export const about = {
  data: 'Test data (CC0), names from a test source',
  n_decisions: 2502,
  n_people: 300,
};

const history = Array.from({ length: 14 }, (_, i) => ({
  name: i % 5 === 4 ? '' : `Place ${i + 1}`,
  category: i % 2 ? 'Park' : 'Coffee Shop',
}));

// A places decision: five candidates, one with no name, a question about a Bar.
export const placesDecision = {
  id: 't-1',
  history,
  top_categories: ['Park', 'Coffee Shop'],
  candidates: [
    { name: 'Alpha Cafe', category: 'Coffee Shop', prob: 0.5, history_count: 2 },
    { name: 'Beta Park', category: 'Park', prob: 0.2, history_count: 0 },
    { name: 'Gamma Bar', category: 'Bar', prob: 0.2, history_count: 1 },
    { name: '', category: 'Library', prob: 0.07, history_count: 0 },
    { name: 'Delta Books', category: 'Bookstore', prob: 0.03, history_count: 0 },
  ],
  answer_idx: 2,
  pick: 0,
  confidence: 0.5,
  question: { category: 'Bar', yes_idx: [2] },
  ask_value: 0.2,
  after_yes: { probs: [0, 0, 1, 0, 0], pick: 2 },
  after_no: { probs: [0.6, 0.25, 0, 0.1, 0.05], pick: 0 },
};

// A shopping decision: empty categories, a full question sentence, and a reason on some candidates.
export const shoppingDecision = {
  id: 's-1',
  history: [
    { name: 'Halo Infinite', category: '' },
    { name: 'Forza Horizon 5', category: '' },
    { name: 'Wireless mouse', category: '' },
  ],
  top_categories: [],
  candidates: [
    {
      name: 'Starfield',
      category: '',
      prob: 0.72,
      history_count: 0,
      reason: 'Two of your recent purchases are Xbox games.',
    },
    { name: 'Desk lamp', category: '', prob: 0.18, history_count: 0 },
    { name: 'Phone case', category: '', prob: 0.1, history_count: 0 },
  ],
  answer_idx: 1,
  pick: 0,
  confidence: 0.72,
  question: { text: 'Is it for gaming?', category: '', yes_idx: [0] },
  ask_value: 0.3,
  after_yes: { probs: [1, 0, 0], pick: 0 },
  after_no: { probs: [0, 0.64, 0.36], pick: 1 },
};

export const people = Array.from({ length: 12 }, (_, i) => ({
  id: `Person ${i + 1}`,
  decisions: [placesDecision],
}));
