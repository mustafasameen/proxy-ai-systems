// Pure helpers for deciding when to ask, for reading the data, and for the wording of the end-user view.
import { plural, withArticle } from './format.js';

// Whether to ask the question or pick right away, for one decision under one ask setting.
export function decideMode(decision, setting) {
  if (!decision || !decision.question) return 'act';
  if (setting.ask_all) return 'ask';
  if (setting.tau === null || setting.tau === undefined) return 'act';
  return decision.ask_value >= setting.tau ? 'ask' : 'act';
}

// The answer this person would give: 'yes' if their real choice matches the question, else 'no'.
export function answerAsPerson(decision) {
  const q = decision && decision.question;
  if (!q) return null;
  return q.yes_idx.includes(decision.answer_idx) ? 'yes' : 'no';
}

// Share of picks that were right in the confidence bin holding conf.
// A value on a bin edge falls in the upper bin, and the top edge stays in the last bin.
export function binAccuracy(reliability, conf) {
  if (!reliability || reliability.length === 0) return null;
  for (const bin of reliability) {
    if (conf < bin.hi) return bin.accuracy;
  }
  return reliability[reliability.length - 1].accuracy;
}

// Whole-number percent, for example 0.468 becomes 47.
export function pct(x) {
  return Math.round(x * 100 + 1e-9);
}

// Percent with one decimal as text, for example 0.1158 becomes "11.6".
export function pct1(x) {
  return (x * 100 + 1e-9).toFixed(1);
}

// Probabilities, pick and confidence as they stand now: before a question, or after a yes or no.
export function currentView(decision, answer) {
  let probs;
  let pick;
  if (answer === 'yes' && decision.after_yes) {
    probs = decision.after_yes.probs;
    pick = decision.after_yes.pick;
  } else if (answer === 'no' && decision.after_no) {
    probs = decision.after_no.probs;
    pick = decision.after_no.pick;
  } else {
    probs = decision.candidates.map((c) => c.prob);
    pick = decision.pick;
  }
  const confidence = answer ? probs[pick] : decision.confidence;
  return { probs, pick, confidence };
}

// ---------------------------------------------------------------------------
// End-user wording and flow
// ---------------------------------------------------------------------------

// Confidence in words with the number, for example "Pretty sure (74%)".
// The bands follow the probability itself: 0.7 and above, 0.45 up to 0.7, and below 0.45.
export function confidenceWords(p) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '';
  const q = Math.min(1, Math.max(0, p));
  const n = pct(q);
  if (q >= 0.995) return 'Pretty sure (over 99%)';
  if (q >= 0.7) return `Pretty sure (${n}%)`;
  if (q >= 0.45) return `Fairly sure (${n}%)`;
  return `Not very sure (${n}%)`;
}

// A share rounded to a whole number out of ten, for example 0.7033 becomes 7.
// Returns null when there is no number to round.
export function outOfTen(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return Math.min(10, Math.max(0, Math.round(x * 10 + 1e-9)));
}

// Index of the highest probability that is not excluded. The lowest index wins a tie.
// Returns null when every index is excluded. excluded is an array or a Set of indexes.
export function nextBest(probs, excluded = []) {
  if (!probs || typeof probs.length !== 'number') return null;
  const skip = excluded instanceof Set ? excluded : new Set(excluded || []);
  const value = (i) => (Number.isFinite(probs[i]) ? probs[i] : -Infinity);
  let best = null;
  for (let i = 0; i < probs.length; i += 1) {
    if (skip.has(i)) continue;
    if (best === null || value(i) > value(best)) best = i;
  }
  return best;
}

// The full question sentence: the data's own text when present, else the places wording.
// Returns an empty string when the decision has no usable question.
export function questionText(decision) {
  const q = decision && decision.question;
  if (!q) return '';
  const text = typeof q.text === 'string' ? q.text.trim() : '';
  if (text) return text;
  const category = typeof q.category === 'string' ? q.category.trim() : '';
  return category ? `Are you up for ${withArticle(category)}?` : '';
}

// The one plain reason shown on a pick card. noun is what the history counts, for example "places".
// A candidate's own reason wins. Without one, the places wording is built from history_count and
// category. With neither a reason nor a category (a shopping option), there is no line at all.
export function reasonLine(candidate, historyLength = 0, noun = 'places') {
  if (!candidate) return '';
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
  if (reason) return reason;
  const category = typeof candidate.category === 'string' ? candidate.category.trim() : '';
  if (!category) return '';
  const n = candidate.history_count || 0;
  if (n > 0) {
    return `${n} of your last ${historyLength} ${noun} ${plural(n, 'was', 'were')} ${category}.`;
  }
  if (noun !== 'places') return '';
  return `None of your recent places were this kind of place, so this pick leans on patterns PROXY learned from other people.`;
}

// The measured accuracy line on a pick card, or an empty string when nothing was measured.
// Before a question it reads the reliability bin for this confidence. After a question it
// uses the accuracy of picks made after one question.
export function accuracyLine({ answered, confidence, reliability, alwaysAskAccuracy }) {
  if (answered) {
    const n = outOfTen(alwaysAskAccuracy);
    return n === null ? '' : `Picks made after one question have been right about ${n} in 10 times.`;
  }
  const n = outOfTen(binAccuracy(reliability, confidence));
  return n === null ? '' : `Picks this sure have been right about ${n} in 10 times.`;
}

// How often a setting asks, in plain words.
export function askRatePhrase(rate) {
  if (typeof rate !== 'number' || !(rate > 0)) return 'never';
  if (rate >= 1) return 'every time';
  const n = outOfTen(rate);
  if (n === 0) return 'fewer than 1 in 10 times';
  if (n === 10) return 'almost every time';
  return `about ${n} in 10 times`;
}

// The measured trade-off under one check-in setting, for example
// "Asks about 3 in 10 times, right about 6 in 10 times."
export function tradeoffText(setting) {
  const acc = setting ? setting.accuracy : null;
  const right = typeof acc === 'number' && Number.isFinite(acc) ? Math.round(acc * 100) : null;
  const rate = setting ? setting.ask_rate : null;
  let asks;
  if (typeof rate !== 'number' || !(rate > 0)) asks = 'Never asks';
  else if (rate >= 1) asks = 'Asks every time';
  else asks = `Asks ${askRatePhrase(rate)}`;
  return right === null ? `${asks}.` : `${asks}, right about ${right}% of the time.`;
}

// What has happened on the current request. Reset for each new request.
export const FRESH_FLOW = Object.freeze({
  started: false, // the person pressed the start or next button
  answer: null, // 'yes', 'no' or 'skip' (Just pick)
  rejected: Object.freeze([]), // indexes the person turned down with "Not for me"
  confirmed: false, // "Go with this" was pressed
  others: false, // the other options are open
  revealed: false, // developer view: the real choice was revealed
});

// Everything the conversation needs to know, worked out from the decision, the check-in setting
// and the flow so far.
//   asking     waiting for a yes, no or Just pick
//   view       probabilities, PROXY's own pick and its confidence (after a yes or no when answered)
//   first      the card shows PROXY's own pick, not a next best
//   shownIdx   index of the option on the card, or null when nothing is left to show
//   confidence the number behind the words: PROXY's own confidence, or the next best's probability
// A next best is never an option the person's own yes or no ruled out (probability zero).
export function conversationView(decision, setting, flow) {
  const question = questionText(decision);
  const willAsk = decideMode(decision, setting) === 'ask' && question !== '';
  const answered = flow.answer !== null && flow.answer !== undefined;
  const asking = flow.started && willAsk && !answered;
  const yn = flow.answer === 'yes' || flow.answer === 'no' ? flow.answer : null;
  const view = currentView(decision, yn);
  const first = flow.rejected.length === 0;
  let shownIdx = first ? view.pick : nextBest(view.probs, flow.rejected);
  if (shownIdx !== null && !decision.candidates[shownIdx]) shownIdx = null;
  if (!first && shownIdx !== null && !(view.probs[shownIdx] > 0)) shownIdx = null;
  const confidence = shownIdx === null ? null : first ? view.confidence : view.probs[shownIdx];
  return { question, willAsk, answered, asking, yn, view, first, shownIdx, confidence };
}

// The options other than the one on the card and the ones turned down, most likely first.
// The lowest index comes first on ties. Returns [{ i, p }].
export function otherOptions(probs, shownIdx, rejected = []) {
  const out = [];
  for (let i = 0; i < probs.length; i += 1) {
    if (i === shownIdx || rejected.includes(i)) continue;
    out.push({ i, p: Number.isFinite(probs[i]) ? probs[i] : 0 });
  }
  return out.sort((a, b) => b.p - a.p || a.i - b.i);
}

// Totals for the developer tally: choices revealed and right, and questions answered.
// tally is keyed by `${prefix}/${decision.id}`.
export function tallyFor(decisions, tally, prefix) {
  let right = 0;
  let revealed = 0;
  let asked = 0;
  for (const d of decisions) {
    const t = tally[`${prefix}/${d.id}`];
    if (!t) continue;
    if (t.asked) asked += 1;
    if (typeof t.right === 'boolean') {
      revealed += 1;
      if (t.right) right += 1;
    }
  }
  return { right, revealed, asked };
}
