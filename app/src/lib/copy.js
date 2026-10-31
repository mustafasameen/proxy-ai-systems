// Fixed wording for the end-user view, kept in one place so it can be checked in one test.
// Plain words only: no em or en dashes, no exclamation marks, no semicolons.

// The five check-in options, in the order of summary.settings.
export const SETTING_LABELS = [
  'Never, just pick',
  'Rarely',
  'When unsure (recommended)',
  'Often',
  'Always ask first',
];

// The option the app starts on and the one the About page reports.
export const RECOMMENDED_IDX = 2;

// The small line under the start button, one per check-in option.
export const CHECK_IN_NOTES = [
  "I'll just pick, without checking with you first.",
  "I'll rarely check with you before I pick.",
  "I'll check with you when I'm unsure.",
  "I'll often check with you before I pick.",
  "I'll always ask you a question first.",
];

// Wording that changes with the domain.
export const DOMAIN_COPY = {
  places: {
    key: 'places',
    label: 'Places',
    prompt: 'Want me to find somewhere new?',
    start: 'Find me somewhere new',
    next: 'Next',
    confirmed: 'Great. Saved to your plans.',
    historyLabel: 'recent places',
    chose: 'They went to',
  },
  shopping: {
    key: 'shopping',
    label: 'Shopping',
    prompt: 'Want me to suggest your next buy?',
    start: 'Suggest something new',
    next: 'Try another',
    confirmed: 'Added to your list.',
    historyLabel: 'recent purchases',
    chose: 'They bought',
  },
};

// Messages that do not change with the domain.
export const MESSAGES = {
  askLead: 'Before I pick, a quick question:',
  yes: 'Yes',
  no: 'No',
  justPick: 'Just pick',
  nextBest: "OK, here's my next best.",
  outOfIdeas: "That's all I have for this one.",
};

// The label for check-in option i. Falls back to the data's own label past the fifth option.
export function settingLabel(settings, i) {
  if (i >= 0 && i < SETTING_LABELS.length) return SETTING_LABELS[i];
  return settings && settings[i] ? settings[i].label : '';
}

// The line under the start button for option i.
export function checkInNote(i) {
  return CHECK_IN_NOTES[i] || CHECK_IN_NOTES[RECOMMENDED_IDX];
}

// The domain a dataset declares in about.domain, else the slot it was loaded for.
export function domainKeyOf(about, fallback) {
  const d = about && about.domain;
  return d === 'places' || d === 'shopping' ? d : fallback;
}

export function domainCopy(key) {
  return DOMAIN_COPY[key] || DOMAIN_COPY.places;
}

// The label for the history list: about.history_label when present, else the domain's default.
export function historyLabelOf(about, domainKey) {
  const label = about && typeof about.history_label === 'string' ? about.history_label.trim() : '';
  return label || domainCopy(domainKey).historyLabel;
}

// The option the user said yes or no to, shown as a small bubble.
export function answerLabel(answer) {
  if (answer === 'yes') return MESSAGES.yes;
  if (answer === 'no') return MESSAGES.no;
  return MESSAGES.justPick;
}
