// Pure helpers for the decision workspace: option row states and the context summary.
import { currentOption } from './flow.js';

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// State of each of the decision's options: default | kept | excluded | passed | pick.
export function optionRows({ context, phase, question, response, choice }) {
  const options = (context && context.options) || [];
  const kept = new Set(phase === 'question' && question && Array.isArray(question.yes_idx) ? question.yes_idx : []);
  const excluded = new Set(phase === 'pick' && response && Array.isArray(response.ruled_out) ? response.ruled_out.map((o) => o.index) : []);
  const passed = new Set();
  let pickIndex = null;
  if (phase === 'pick' && choice) {
    choice.rejected.forEach((pos) => { if (choice.ranking[pos]) passed.add(choice.ranking[pos].index); });
    const cur = currentOption(choice);
    if (cur) pickIndex = cur.index;
  }
  return options.map((option, i) => {
    let state = 'default';
    if (option.index === pickIndex) state = 'pick';
    else if (excluded.has(option.index)) state = 'excluded';
    else if (passed.has(option.index)) state = 'passed';
    else if (kept.has(option.index)) state = 'kept';
    return { option, letter: LETTERS[i] || String(i + 1), state };
  });
}

// Position of an option in the ranking, or -1 when the answer ruled it out.
export function positionOf(choice, optionIndex) {
  return choice ? choice.ranking.findIndex((o) => o.index === optionIndex) : -1;
}

// Only a row that is still in play can be chosen from the list.
export function canSelect(row, phase, choice) {
  return phase === 'pick' && Boolean(choice) && !choice.accepted && row.state === 'default';
}

// Same list as the API's reason lines (api/proxy_core.py PROPER).
const PROPER = new Set(['afghan', 'african', 'american', 'argentinian', 'asian', 'australian', 'brazilian', 'british', 'cajun', 'cantonese', 'caribbean', 'chinese', 'creole', 'cuban', 'eastern', 'ethiopian', 'european', 'filipino', 'french', 'german', 'greek', 'hawaiian', 'indian', 'indonesian', 'irish', 'israeli', 'italian', 'jamaican', 'japanese', 'korean', 'latin', 'lebanese', 'malaysian', 'mediterranean', 'mexican', 'middle', 'moroccan', 'mta', 'new', 'nyc', 'persian', 'peruvian', 'polish', 'portuguese', 'russian', 'scandinavian', 'southern', 'spanish', 'szechuan', 'taiwanese', 'tex-mex', 'thai', 'turkish', 'ukrainian', 'vietnamese', 'york']);

// "Boat or Ferry" -> "boat or ferry", "Park" -> "park". Words that name a place or cuisine keep their capital.
export function commonNoun(category) {
  return String(category).split(' ').map((w) => (PROPER.has(w.toLowerCase()) ? w : w.toLowerCase())).join(' ');
}

function plural(noun, count) {
  if (count <= 1 || / or /.test(noun) || /s$/.test(noun)) return noun;
  return `${noun}s`;
}

// "Last 30 visits · 2 parks · 2 theaters · 2 boat or ferry". Shopping brands keep their case and are not pluralised.
export function summaryLine(domain, total, summary) {
  const unit = domain === 'shopping' ? 'purchase' : 'visit';
  const head = `Last ${total} ${total === 1 ? unit : `${unit}s`}`;
  const parts = (summary || []).slice(0, 3).map((s) => (
    domain === 'shopping' ? `${s.count} ${s.category}` : `${s.count} ${plural(commonNoun(s.category), s.count)}`
  ));
  return [head, ...parts].join(' · ');
}

// "A yes keeps 2 of these 5 options."
export function yesKeeps(k, total) {
  return `A yes keeps ${k} of these ${total} ${total === 1 ? 'option' : 'options'}.`;
}

// The history entries that bear on a question: places of the asked kind, or purchases from the asked store.
// Only kinds the shown history records can be counted; a question about a product category returns null.
export function sameKind(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function evidence(history, question) {
  if (!question || !question.category || !Array.isArray(history)) return null;
  if (question.kind && question.kind !== 'category' && question.kind !== 'store') return null;
  const count = history.filter((h) => sameKind(h.category, question.category)).length;
  return { count, total: history.length, category: question.category };
}

// The kind the context panel highlights: the one the person picked, else the one PROXY is asking about.
export function focusKind(focus, state) {
  if (focus && focus.kind) return focus.kind;
  if (state.phase === 'question' && state.question && state.question.category
    && (!state.question.kind || state.question.kind === 'category' || state.question.kind === 'store')) {
    return state.question.category;
  }
  return null;
}
