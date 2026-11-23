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

// The match-rate line, or null when the API sent none. The number is a past track record: how often held-out picks
// with a similar model confidence matched the real choice. It is not the chance that this pick is right. After a yes or
// no the record comes from tests whose answers were simulated from the real choice, and the line says so.
export function confidenceLine(confidence, answered = false) {
  if (!confidence || !confidence.label) return null;
  const when = answered ? 'In past tests with answers simulated from the real choice,' : 'In past tests,';
  return `${when} similar picks matched the real choice about ${confidence.matched_out_of_10} in 10 times (${confidence.label.toLowerCase()}).`;
}

// Why a pick has no match rate. The reasons are the ones the API applies: only the first pick was measured, an answer
// that leaves one option has no record, and a thin group of similar picks has no record.
export function noRateLine({ later, answered, single }) {
  if (later) return "There is no match rate for this option. Past tests measured PROXY's first pick only.";
  if (answered && single) return 'There is no match rate here. Your answer left only one option.';
  return 'There is no match rate for this pick. Too few similar picks were seen in past tests.';
}

// A masked home is stored as the name "Home" with the kind "private".
export const PRIVATE_NAME = 'A private place (name hidden)';
export const PRIVATE_WHY = 'The name is hidden. Private places are not shown on the map.';
// A generic kind used as the name ("Health care") means the real name was masked. It is named by its kind instead.
const HIDDEN_KINDS = new Set(['health care', 'general entertainment', 'arts & entertainment']);
export const isGenericName = (o) => Boolean(o) && Boolean(o.category) && String(o.name).trim().toLowerCase() === String(o.category).trim().toLowerCase()
  && HIDDEN_KINDS.has(String(o.category).trim().toLowerCase());
export const isPrivate = (o) => Boolean(o) && String(o.name).trim().toLowerCase() === 'home' && String(o.category || '').trim().toLowerCase() === 'private';
export function genericName(o) {
  const kind = String(o.category).trim().toLowerCase();
  return `${/^[aeiou]/.test(kind) ? 'An' : 'A'} ${kind} place (name hidden)`;
}
export const displayName = (o) => {
  if (isPrivate(o)) return PRIVATE_NAME;
  if (isGenericName(o)) return genericName(o);
  return (o && o.name) || '';
};

export const ANSWER_LABELS = { yes: 'Yes', no: 'No', skip: 'Skip' };

// Error code to message. Codes come from the API (detail.error) or the client (timeout, network).
const ERROR_MESSAGES = {
  network: "Couldn't reach the model.",
  model_unavailable: "Couldn't reach the model.",
  busy: 'The model is busy. Try again in a moment.',
  timeout: "PROXY couldn't finish this request.",
  no_options: 'No recommendation was returned.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  gateway_auth: 'PROXY is not set up correctly.',
};

export function errorMessage(code, serverMessage) {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (serverMessage) return serverMessage;
  return "PROXY couldn't finish this request.";
}

export const COPY = {
  wordmark: 'PROXY',
  settingsLabel: 'Settings',
  personSwitcherLabel: 'Person',
  startHintBefore: 'PROXY asks one question first if it could help.',
  startHintNever: 'PROXY will not ask a question.',
  startHintAlways: 'PROXY asks one question first whenever it has one.',
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
  legendPick: 'Current pick',
  mapHeading: 'Map. PROXY does not use this map.',
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
  pickKicker: "PROXY'S PICK",
  nextPickKicker: "PROXY'S NEXT PICK",
  yourChoiceKicker: 'YOUR CHOICE',
  nextPick: "PROXY's next pick",
  yourChoice: 'Your choice',
  changeYourAnswer: 'Change your answer',
  matchRate: 'Match rate',
  settingsRestart: 'Changing the setting restarts the current decision.',
  whyHeading: 'From your history',
  notForMe: 'Not for me',
  nextDecision: 'Next decision',
  notForYou: 'Not for you. Next is the highest-scored option left.',
  notForYouAnswer: 'Not for you. Next is the highest-scored option your answer allows.',
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
    source: 'Places: PROXY scores the options live.',
    sourceDetail: 'Model: Llama 3.3 70B through UF NaviGator.',
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
    source: 'Shopping: a replay of saved scores, no live call.',
    sourceDetail: 'Scores: fine-tuned Llama 3.1 8B, saved offline.',
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
  return `Map of ${visits} past visits and ${options} options. PROXY does not use this map.`;
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

export const ROLE_LINE = "You are playing this person. Answer as they would, from the history shown. Skip if it isn't enough.";
export const roleLine = (person) => (person ? `You are playing Person ${person}. Answer as they would, from the history shown. Skip if it isn't enough.` : ROLE_LINE);
export const MECHANISM = 'PROXY has already scored all five options. Your answer rules some out, and PROXY picks the highest scored option left.';
export const PICKED_LABEL = "PROXY'S FIRST PICK";
export const REAL_LABEL = 'REAL CHOICE';
export const MODEL_READS = 'What the model reads';
export const EXACT_INPUT = 'The exact text the model scores';
export const SEE_REAL = 'See what this person really chose';
export const PICK_MATCHED = "PROXY's pick matched.";
export const PICK_MISSED = "PROXY's pick did not match.";

export const KIND_HINT = 'Select a kind to see where it shows up.';
export const SHOW_ALL_KINDS = 'Clear';

// Same list as the API's UNCOUNTABLE: generic kinds that take no article.
const MASS_KINDS = new Set(['health care', 'general entertainment', 'arts & entertainment']);

export function evidenceLine(domain, ev) {
  const n = ev.count;
  if (domain === 'shopping') {
    const what = n === 1 ? '1 was' : `${n} were`;
    return `Of your last ${ev.total} purchases, ${what} from ${ev.category}.`;
  }
  const kind = ev.category.toLowerCase();
  const art = MASS_KINDS.has(kind) ? '' : ' a';
  const what = n === 1 ? `1 was${art}` : `${n} were${art}`;
  return `Of your last ${ev.total} places, ${what} ${kind}.`;
}

export function tallyLine(matched, seen) {
  return `This session: PROXY's first pick matched the real choice ${matched} of ${seen} ${seen === 1 ? 'time' : 'times'}.`;
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

// Heading once every option still in play has been turned down. `left` is how many options the answer kept.
export function allRejected(total, left = total) {
  if (left >= total) return `That's all ${numberWord(total)} options.`;
  if (left === 1) return 'That was the only option your answer left.';
  return "That's every option your answer left.";
}

// Shown when every option left after a yes or no has been turned down.
export function answerLeftNone(answer, ruledOut) {
  return `${ruledOutLine(answer, ruledOut)} Change your answer to see more picks.`;
}

export function startHint(setting) {
  if (setting === 'Never ask') return COPY.startHintNever;
  if (setting === 'Always ask') return COPY.startHintAlways;
  return COPY.startHintBefore;
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
  out.push(confidenceLine({ label: 'Higher confidence', matched_out_of_10: 7 }), confidenceLine({ label: 'Lower confidence', matched_out_of_10: 3 }, true));
  out.push(noRateLine({ later: true }), noRateLine({ answered: true, single: true }), noRateLine({}), PRIVATE_NAME, PRIVATE_WHY, answerLeftNone('yes', 4), startHint('Never ask'), startHint('Always ask'), startHint('Rarely'));
  [askRateText(0), askRateText(0.04), askRateText(0.3), askRateText(0.97), askRateText(1)].forEach((s) => out.push(s));
  out.push(accepted('Place'), decisionOf(1, 9), youSaid('yes'), allRejected(5), allRejected(5, 1), allRejected(5, 3), COPY.notForYouAnswer, roleLine('3'), genericName({ category: 'Health care' }), endOfDecisions('1'), andMore(12));
  out.push(settingsNote(100, 20), settingsNote(100, 20, 'shopping'));
  out.push(MECHANISM, MODEL_READS, EXACT_INPUT, ruledOutLine('no', 1), ruledOutLine('yes', 3), ruledOutLine('no', 0), ...modelReadsLines('places'), ...modelReadsLines('shopping'), tallyLine(3, 5), KIND_HINT, SHOW_ALL_KINDS, evidenceLine('places', { count: 3, total: 30, category: 'Cocktail Bar' }), evidenceLine('shopping', { count: 1, total: 10, category: 'Capcom' }), offVisits(1), offVisits(7), ROLE_LINE, SEE_REAL, PICK_MATCHED, PICK_MISSED, leanLine('Kin Shop'), noQuestionLine('Never ask'), noQuestionLine('When unsure'), truthfulLine(true, 'no'), truthfulLine(false, 'no'), truthfulLine(true, 'skip'));
  out.push(workspaceTitle('places', '1'), workspaceTitle('shopping', '1'), contextSummaryTitle('1'), showAll(30), mapLabel(28, 5));
  out.push(...Object.values(DOMAIN_COPY).flatMap((d) => [d.tab, d.kicker, d.sub, d.source, d.sourceDetail, d.choose, d.recent, d.contextCaption, d.usesBody, d.modelBody, ...d.limits]));
  const ev = {
    act_now_accuracy: 0.5, act_now_ci: [0.4, 0.6], always_ask_accuracy: 0.6, always_ask_ci: [0.5, 0.7],
    report_rows: 100, report_users: 20, options_per_decision: 5,
  };
  evalSentences(ev).forEach((s) => out.push(s));
  return out;
}
