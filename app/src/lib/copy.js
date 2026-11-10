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
  startHintBefore: 'PROXY asks one question first if it could help.',
  startHintChange: 'Change',
  startButton: 'Let PROXY choose',
  loadingOptions: 'Loading the options…',
  questionKicker: 'YOUR ANSWER COULD CHANGE THE PICK',
  optionsLabel: 'The five options',
  keptIfYes: 'Kept if you say yes',
  excluded: 'Excluded by your answer',
  passed: 'Passed',
  isPick: "PROXY's pick",
  switchLabel: 'Domain',
  contextKicker: 'WHAT PROXY KNOWS',
  mostFrequent: 'Most frequent',
  showFewer: 'Show fewer',
  legendVisit: 'Past visit',
  legendOption: 'Option',
  legendPick: "PROXY's pick",
  mapCaption: "Location context only. PROXY's model sees names and kinds of places, not locations. Points are rounded to about 500 m, and private places are not shown.",
  mapUnavailable: 'The borough outline could not be loaded.',
  looking: 'Looking through your options…',
  slow: 'This is taking longer than expected.',
  using: 'Using your answer to make a pick…',
  cancel: 'Cancel',
  tryAgain: 'Try again',
  yes: 'Yes',
  no: 'No',
  skip: 'Skip',
  changeAnswer: 'Change answer',
  pickKicker: 'YOUR PICK',
  whyHeading: 'From their history',
  notForMe: 'Not for me',
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
  evaluated: 'How it was evaluated',
  modelHeading: 'The model',
  limitsHeading: 'Limitations',
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

export const DOMAINS = ['places', 'shopping'];

export const DOMAIN_COPY = {
  places: {
    tab: 'Places',
    kicker: 'PLACES · NEW YORK CITY',
    sub: 'PROXY is choosing from five places this person has never been to.',
    really: 'This person really went to',
    source: 'Live: Llama 3.3 70B through UF NaviGator',
    choose: 'Choose this place',
    recent: 'Recent',
    unit: 'visit',
    contextCaption: '',
    usesBody: "Only this person's past places, five options per decision, and at most one yes or no question.",
    modelBody: 'Llama 3.3 70B through UF NaviGator, called live for each decision.',
    limits: [
      'Matching a past choice is not proof the person enjoyed it.',
      'PROXY was tested on past New York check-ins.',
      'The demo people are anonymized records.',
    ],
    settingsNoun: 'place the person really chose',
  },
  shopping: {
    tab: 'Shopping',
    kicker: 'SHOPPING · VIDEO GAMES',
    sub: 'PROXY is choosing from five products this person has never bought.',
    really: 'This person really bought',
    source: 'Replay: saved scores of the fine-tuned model. No model call.',
    choose: 'Choose this item',
    recent: 'Recent purchases',
    unit: 'purchase',
    contextCaption: "Brands come from the product records. PROXY's model sees product titles only.",
    usesBody: "Only this person's past purchases, five products per decision, and at most one yes or no question.",
    modelBody: 'The picks replay saved scores of Llama-3.1-8B-Instruct fine-tuned on earlier purchases from Amazon Reviews 2023 Video Games, using the same split method. No model is called for each decision.',
    limits: [
      'Matching a past purchase is not proof the person wanted it.',
      'Tested on past Amazon purchases in one category, video games.',
      'It sees product titles, not prices or reviews.',
      'The demo people are anonymized records.',
    ],
    settingsNoun: 'item the person really bought',
  },
};

export const dc = (domain) => DOMAIN_COPY[domain] || DOMAIN_COPY.places;

export function workspaceTitle(domain, person) {
  return domain === 'shopping' ? `What will Person ${person} buy next?` : `Where should Person ${person} go next?`;
}

export function contextSummaryTitle(person) {
  return `What PROXY knows about Person ${person}`;
}

export function showAll(n) {
  return `Show all ${fmtCount(n)}`;
}

export function mapLabel(visits, options) {
  return `Map of ${visits} past visits and ${options} options`;
}

export function accepted(name) {
  return `You chose ${name}.`;
}

export function decisionOf(index, total) {
  return `Decision ${index + 1} of ${total}`;
}

// Past visits that fall outside the map's view, which centres on the options.
export function offVisits(n) {
  return n === 1 ? 'One more past visit is outside this view.' : `${n} more past visits are outside this view.`;
}

export const ROLE_LINE = "Answer as this person would, using their history. Skip if the evidence isn't enough.";
export const MECHANISM = 'PROXY has already scored all five options. Your answer rules some out, and PROXY picks the highest scored option left.';
export const LATER_PICK_NOTE = 'A match rate is shown for the first pick only.';
export const PICKED_LABEL = 'PROXY PICKED';
export const REAL_LABEL = 'REAL CHOICE';
export const MODEL_READS = 'What the model reads';
export const EXACT_INPUT = 'The exact text the model scores';
export const SEE_REAL = 'See what this person really chose';
export const PICK_MATCHED = "PROXY's pick matched.";
export const PICK_MISSED = "PROXY's pick did not match.";

export const KIND_HINT = 'Select a kind to see where it shows up.';
export const SHOW_ALL_KINDS = 'Clear';

export function evidenceLine(domain, ev) {
  const n = ev.count;
  if (domain === 'shopping') {
    const what = n === 1 ? '1 was' : `${n} were`;
    return `Of their last ${ev.total} purchases, ${what} from ${ev.category}.`;
  }
  const what = n === 1 ? '1 was a' : `${n} were a`;
  return `Of their last ${ev.total} places, ${what} ${ev.category.toLowerCase()}.`;
}

export function tallyLine(matched, seen) {
  return `This session: PROXY's first pick matched ${matched} of ${seen}.`;
}

export function leanLine(name) {
  return `Without an answer, PROXY would pick ${name}.`;
}

export function noQuestionLine(setting) {
  return setting === 'Never ask'
    ? "PROXY didn't ask, because it is set to never ask."
    : "PROXY didn't ask. No answer was likely to change this pick.";
}

// The person was never asked, so their answer is inferred from the real choice and labelled as such.
export function truthfulLine(yes, answer) {
  const t = yes ? 'Yes' : 'No';
  let mine = '';
  if (answer === 'yes' || answer === 'no') {
    const a = answer === 'yes' ? 'Yes' : 'No';
    mine = a === t ? ', the same as yours' : `. You said ${a}`;
  }
  return `Their real choice fits a ${t}${mine}. How they would really have answered is unknown.`;
}

export function ruledOutLine(answer, n) {
  const a = answer === 'yes' ? 'Yes' : 'No';
  if (n === 0) return `Your ${a} ruled out no options.`;
  return `Your ${a} ruled out ${n === 1 ? '1 option' : `${n} options`}.`;
}

export function modelReadsLines(domain) {
  return domain === 'shopping'
    ? ["The model's saved scores came from the titles of this person's recent purchases and of the five products.",
      'The question uses the store and category records. Your answer rules products in or out after scoring.']
    : ['The model reads the names and kinds of the last 30 places and of the five options.',
      'It does not see locations, the map, or times. Your answer rules options in or out after scoring.'];
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

export function settingsNote(rows, users, domain = 'places') {
  return `Share of test decisions where PROXY's pick matched the ${dc(domain).settingsNoun}, measured on ${fmtCount(rows)} decisions from ${fmtCount(users)} people it never saw while being tuned. Answers were simulated from each real choice, so real answers may help less. Asking more often generally helps.`;
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
  out.push(settingsNote(100, 20), settingsNote(100, 20, 'shopping'));
  out.push(MECHANISM, LATER_PICK_NOTE, MODEL_READS, EXACT_INPUT, ruledOutLine('no', 1), ruledOutLine('yes', 3), ruledOutLine('no', 0), ...modelReadsLines('places'), ...modelReadsLines('shopping'), tallyLine(3, 5), KIND_HINT, SHOW_ALL_KINDS, evidenceLine('places', { count: 3, total: 30, category: 'Cocktail Bar' }), evidenceLine('shopping', { count: 1, total: 10, category: 'Capcom' }), offVisits(1), offVisits(7), ROLE_LINE, SEE_REAL, PICK_MATCHED, PICK_MISSED, leanLine('Kin Shop'), noQuestionLine('Never ask'), noQuestionLine('When unsure'), truthfulLine(true, 'no'), truthfulLine(false, 'no'), truthfulLine(true, 'skip'));
  out.push(workspaceTitle('places', '1'), workspaceTitle('shopping', '1'), contextSummaryTitle('1'), showAll(30), mapLabel(28, 5));
  out.push(...Object.values(DOMAIN_COPY).flatMap((d) => [d.tab, d.kicker, d.sub, d.source, d.choose, d.recent, d.contextCaption, d.usesBody, d.modelBody, ...d.limits]));
  const ev = {
    act_now_accuracy: 0.5, act_now_ci: [0.4, 0.6], always_ask_accuracy: 0.6, always_ask_ci: [0.5, 0.7],
    report_rows: 100, report_users: 20, options_per_decision: 5,
  };
  evalSentences(ev).forEach((s) => out.push(s));
  return out;
}
