// Pure helpers for deciding when to ask and for reading the replay data.

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
