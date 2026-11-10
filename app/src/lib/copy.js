// Every user-facing string lives here so one test can check the plain-words rule.

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// Small counts as words ("five"), larger ones as digits.
export function numberWord(n) {
  return Number.isInteger(n) && n >= 0 && n <= 10 ? NUMBER_WORDS[n] : String(n);
}

export function fmtCount(n) {
  return Number(n).toLocaleString('en-US');
}

export function pct(x) {
  return `${Math.round(Number(x) * 100)}%`;
}

// "Asks about 3 in 10 times", computed from the ask rate the API reports.
export function askRateText(rate) {
  const r = Number(rate);
  if (!(r > 0)) return 'Picks without asking';
  if (r >= 1) return 'Asks before every pick';
  const n = Math.round(r * 10);
  if (n <= 0) return 'Asks less than once in 10 times';
  if (n >= 10) return 'Asks almost every time';
  return `Asks about ${n} in 10 times`;
}

// Confidence line, or null when the API sent none.
export function confidenceParts(confidence) {
  if (!confidence || !confidence.label) return null;
  return {
    label: confidence.label,
    rest: ` · Similar picks matched the real choice about ${confidence.matched_out_of_10} in 10 times.`,
  };
}

export const ANSWER_LABELS = { yes: 'Yes', no: 'No', skip: 'Skip' };

// Error code to message. Codes come from the API (detail.error) or the client (timeout, network).
const ERROR_MESSAGES = {
  network: "Couldn't reach the model.",
  model_unavailable: "Couldn't reach the model.",
  busy: 'The model is busy. Try again in a moment.',
  timeout: "PROXY couldn't finish this request.",
  no_options: 'No recommendation was returned.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
};

export function errorMessage(code, serverMessage) {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (serverMessage) return serverMessage;
  return "PROXY couldn't finish this request.";
}

export const COPY = {
  wordmark: 'PROXY',
  settingsLabel: 'Settings',
  personSwitcherLabel: 'Demo person',
  startKicker: 'PLACES · NEW YORK CITY',
  startTitle: 'Find somewhere new.',
  startSub: 'One place picked from five options, based on your past choices.',
  startButton: 'Find me a place',
  startHintBefore: "I'll ask one question if it could help.",
  startHintChange: 'Change',
  knowsHeading: 'What PROXY knows about you',
  looking: 'Looking through your options…',
  slow: 'This is taking longer than expected.',
  using: 'Using your answer to make a pick…',
  cancel: 'Cancel',
  tryAgain: 'Try again',
  questionKicker: 'ONE QUICK QUESTION',
  yes: 'Yes',
  no: 'No',
  skip: 'Skip',
  changeAnswer: 'Change answer',
  pickKicker: 'YOUR PICK',
  whyHeading: 'Why this pick',
  choose: 'Choose this place',
  notForMe: 'Not for me',
  seeAll: 'See all options',
  hideAll: 'Hide options',
  ruledOut: 'Ruled out by your answer',
  nextDecision: 'Next decision',
  notForYou: "Not for you. Here's the next option.",
  answerChangedTitle: 'What did your answer change?',
  withoutAsking: 'WITHOUT ASKING',
  withAnswer: 'WITH YOUR ANSWER',
  answerSame: "Your answer didn't change the first pick.",
  startOver: 'Start over',
  settingsTitle: 'When should PROXY ask?',
  aboutLink: 'About PROXY',
  developerToggle: 'Developer view',
  close: 'Close',
  back: 'Back',
  aboutTitle: 'About PROXY',
  revealButton: 'Reveal the real choice',
  realChoice: 'real choice',
  configFail: "Couldn't reach the model.",
  uses: 'What PROXY uses',
  usesBody:
    "Only this person's past places, five options per decision, and at most one yes or no question.",
  evaluated: 'How it was evaluated',
  modelHeading: 'The model',
  modelBody: 'Llama 3.3 70B through UF NaviGator, called live for each decision.',
  limitsHeading: 'Limitations',
  limits: [
    "Matching a past choice is not proof the person enjoyed it.",
    'PROXY was tested on past New York check-ins.',
    'The demo people are anonymized records.',
  ],
  devHeading: 'Developer view',
  trustHeading: 'Trust report',
  chartBarsCaption: 'Match rate with 95% interval',
  chartBarsLabel: 'Match rate with 95% interval for picking now and always asking',
  chartPickNow: 'Pick now, no question',
  chartAlwaysAsk: 'Always ask',
  chartCurveCaption: 'Match rate by how often PROXY asks',
  chartCurveLabel: 'Match rate for each ask setting',
  chartAsksLess: 'Asks less',
  chartAsksMore: 'Asks more',
};

export function accepted(name) {
  return `You chose ${name}.`;
}

export function decisionOf(index, total) {
  return `Decision ${index + 1} of ${total}`;
}

export function youSaid(answer) {
  if (answer === 'skip') return 'You skipped the question';
  return `You said: ${ANSWER_LABELS[answer] || answer}`;
}

export function allRejected(total) {
  return `That's all ${numberWord(total)} options.`;
}

export function endOfDecisions(person) {
  return `That's all the decisions for Person ${person}.`;
}

export function andMore(n) {
  return `and ${fmtCount(n)} more`;
}

export function settingsNote(rows, users) {
  return `Share of test decisions where PROXY's pick matched the place the person really chose, measured on ${fmtCount(rows)} decisions from ${fmtCount(users)} people it never saw while being tuned. Asking more often generally helps.`;
}

export function personLabel(id) {
  return `Person ${id}`;
}

export function interval(ci) {
  if (!Array.isArray(ci) || ci.length < 2) return '';
  return `95% interval ${pct(ci[0])} to ${pct(ci[1])}`;
}

export function evalSentences(ev) {
  const out = [];
  out.push(
    `Acting on its first pick with no question, PROXY matched the person's real choice ${pct(ev.act_now_accuracy)} of the time (${interval(ev.act_now_ci)}).`,
  );
  out.push(
    `Asking its one question every time, it matched ${pct(ev.always_ask_accuracy)} of the time (${interval(ev.always_ask_ci)}).`,
  );
  out.push(
    `These come from ${fmtCount(ev.report_rows)} test decisions from ${fmtCount(ev.report_users)} people the model never saw while being tuned, with ${numberWord(ev.options_per_decision)} options per decision.`,
  );
  return out;
}

// Strings used by tests to check the plain-words rule.
export function allCopyStrings() {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(COPY);
  walk(ERROR_MESSAGES);
  walk(ANSWER_LABELS);
  const c = confidenceParts({ label: 'Higher confidence', matched_out_of_10: 7 });
  out.push(c.label + c.rest);
  [askRateText(0), askRateText(0.04), askRateText(0.3), askRateText(0.97), askRateText(1)].forEach((s) => out.push(s));
  out.push(accepted('Place'), decisionOf(1, 9), youSaid('yes'), allRejected(5), endOfDecisions('1'), andMore(12));
  out.push(settingsNote(100, 20));
  const ev = {
    act_now_accuracy: 0.5, act_now_ci: [0.4, 0.6], always_ask_accuracy: 0.6, always_ask_ci: [0.5, 0.7],
    report_rows: 100, report_users: 20, options_per_decision: 5,
  };
  evalSentences(ev).forEach((s) => out.push(s));
  return out;
}
