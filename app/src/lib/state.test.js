import { describe, it, expect } from 'vitest';
import { reducer, initialState } from './state.js';
import { currentOption, isExhausted } from './flow.js';
import { optionRows, positionOf, canSelect } from './workspace.js';

const opt = (i, name) => ({ index: i, name, category: 'Cafe', reason: `Reason ${name}` });
const OPTS = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ index: i, name, category: 'Cafe', point: [40.7 + i * 0.01, -74] }));
const contextData = (extra = {}) => ({
  domain: 'places', live: true, person: '1', decision: 0, n_decisions: 3, options: OPTS,
  history: [{ name: 'H', category: 'Bar', point: [40.7, -74] }], history_total: 12,
  history_summary: [{ category: 'Bar', count: 1 }], ...extra,
});
const pickData = (extra = {}) => ({
  stage: 'pick', question: null, answer: null, ruled_out: [], confidence: null, without_answer: null,
  ranking: [opt(0, 'A'), opt(1, 'B'), opt(2, 'C')], history: [{ name: 'H', category: 'Bar' }], history_total: 12,
  n_decisions: 9, options: OPTS, ...extra,
});
const questionData = () => ({
  stage: 'question', question: { text: 'Are you up for a cafe?', category: 'Cafe', yes_idx: [0, 1] }, history: [], history_total: 12, n_decisions: 9,
});
const run = (s, ...actions) => actions.reduce(reducer, s);

describe('request lifecycle', () => {
  it('goes busy then shows the pick', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 1, decision: 0, answer: null });
    expect(s.busy).toBe('looking');
    s = reducer(s, { type: 'RESPONSE', token: 1, data: pickData() });
    expect(s.busy).toBeNull();
    expect(s.phase).toBe('pick');
    expect(currentOption(s.choice).name).toBe('A');
    expect(s.context.history_total).toBe(12);
  });

  it('marks slow only for the current request', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 5, decision: 0, answer: null });
    expect(reducer(s, { type: 'SLOW', token: 4 }).slow).toBe(false);
    expect(reducer(s, { type: 'SLOW', token: 5 }).slow).toBe(true);
  });

  it('ignores a response from a superseded request', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 1, decision: 0, answer: null });
    s = reducer(s, { type: 'REQUEST', token: 2, decision: 0, answer: null });
    const late = reducer(s, { type: 'RESPONSE', token: 1, data: pickData() });
    expect(late).toBe(s);
    expect(late.response).toBeNull();
  });

  it('ignores a response after switching person', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 1, decision: 0, answer: null });
    s = reducer(s, { type: 'SET_PERSON', person: '2' });
    expect(reducer(s, { type: 'RESPONSE', token: 1, data: pickData() })).toBe(s);
    expect(s.person).toBe('2');
    expect(s.started).toBe(false);
  });

  it('ignores a response after switching setting or cancelling', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 1, decision: 0, answer: null });
    const afterSetting = reducer(s, { type: 'SET_SETTING', setting: 'Often' });
    expect(reducer(afterSetting, { type: 'RESPONSE', token: 1, data: pickData() })).toBe(afterSetting);
    const cancelled = reducer(s, { type: 'CANCEL' });
    expect(cancelled.started).toBe(false);
    expect(reducer(cancelled, { type: 'RESPONSE', token: 1, data: pickData() })).toBe(cancelled);
  });

  it('ignores a late failure from a superseded request', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 2, decision: 0, answer: null });
    expect(reducer(s, { type: 'FAILURE', token: 1, error: { code: 'busy', message: '' } })).toBe(s);
  });
});

describe('failures', () => {
  it('stores the error code and returns to start when nothing was shown', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 1, decision: 0, answer: null });
    s = reducer(s, { type: 'FAILURE', token: 1, error: { code: 'timeout', message: '' } });
    expect(s.error.code).toBe('timeout');
    expect(s.busy).toBeNull();
    expect(s.started).toBe(false);
    expect(s.retry).toEqual({ decision: 0, answer: null });
  });

  it('keeps the question when answering fails', () => {
    let s = run(initialState(),
      { type: 'REQUEST', token: 1, decision: 0, answer: null },
      { type: 'RESPONSE', token: 1, data: questionData() },
      { type: 'REQUEST', token: 2, decision: 0, answer: 'yes' });
    expect(s.busy).toBe('using');
    s = reducer(s, { type: 'FAILURE', token: 2, error: { code: 'busy', message: '' } });
    expect(s.phase).toBe('question');
    expect(s.started).toBe(true);
    expect(s.error.code).toBe('busy');
    expect(s.retry.answer).toBe('yes');
  });

  it('shows the end of decisions on no_more_decisions', () => {
    let s = reducer(initialState(), { type: 'REQUEST', token: 1, decision: 9, answer: null });
    s = reducer(s, { type: 'FAILURE', token: 1, error: { code: 'no_more_decisions', message: '' } });
    expect(s.phase).toBe('end');
    expect(s.error).toBeNull();
    expect(reducer(s, { type: 'RESTART' }).decision).toBe(0);
  });
});

describe('question and answer', () => {
  const asked = () => run(initialState(),
    { type: 'REQUEST', token: 1, decision: 0, answer: null },
    { type: 'RESPONSE', token: 1, data: questionData() });

  it('shows the question', () => {
    const s = asked();
    expect(s.phase).toBe('question');
    expect(s.question.text).toBe('Are you up for a cafe?');
  });

  it('keeps the question and answer in the pick, and Change answer returns to the question', () => {
    let s = run(asked(),
      { type: 'REQUEST', token: 2, decision: 0, answer: 'no' },
      { type: 'RESPONSE', token: 2, data: pickData({ question: { text: 'Are you up for a cafe?', category: 'Cafe' }, answer: 'no' }) });
    expect(s.phase).toBe('pick');
    expect(s.answer).toBe('no');
    expect(s.question.category).toBe('Cafe');
    s = reducer(s, { type: 'CHANGE_ANSWER' });
    expect(s.phase).toBe('question');
    expect(s.answer).toBeNull();
    expect(s.choice).toBeNull();
    expect(s.question.text).toBe('Are you up for a cafe?');
    s = reducer(s, { type: 'REQUEST', token: 3, decision: 0, answer: 'yes' });
    expect(s.decision).toBe(0);
    expect(s.question).not.toBeNull();
  });

  it('cancelling an answer returns to the question', () => {
    let s = reducer(asked(), { type: 'REQUEST', token: 2, decision: 0, answer: 'yes' });
    s = reducer(s, { type: 'CANCEL' });
    expect(s.phase).toBe('question');
    expect(s.started).toBe(true);
    expect(s.pendingAnswer).toBeNull();
  });
});

describe('choosing', () => {
  const picked = () => run(initialState(),
    { type: 'REQUEST', token: 1, decision: 0, answer: null },
    { type: 'RESPONSE', token: 1, data: pickData() });

  it('"Not for me" promotes the next option with a notice', () => {
    const s = reducer(picked(), { type: 'NOT_FOR_ME' });
    expect(currentOption(s.choice).name).toBe('B');
    expect(s.notice).toBe('next');
  });

  it('rejecting everything gives the all-rejected state', () => {
    const s = run(picked(), { type: 'NOT_FOR_ME' }, { type: 'NOT_FOR_ME' }, { type: 'NOT_FOR_ME' });
    expect(isExhausted(s.choice)).toBe(true);
    expect(s.notice).toBeNull();
  });

  it('choosing from the list changes the pick, accept locks it', () => {
    let s = reducer(picked(), { type: 'SELECT_OPTION', position: 2 });
    expect(currentOption(s.choice).name).toBe('C');
    s = reducer(s, { type: 'ACCEPT' });
    expect(s.choice.accepted).toBe(true);
  });

  it('next decision clears the old pick before the new one arrives', () => {
    let s = reducer(picked(), { type: 'REQUEST', token: 2, decision: 1, answer: null });
    expect(s.decision).toBe(1);
    expect(s.response).toBeNull();
    expect(s.choice).toBeNull();
    expect(s.busy).toBe('looking');
  });

  it('reveal applies only to the current person and decision', () => {
    const s = picked();
    expect(reducer(s, { type: 'REVEAL', person: '1', decision: 0, data: { answer_index: 1, name: 'B' } }).reveal.answer_index).toBe(1);
    expect(reducer(s, { type: 'REVEAL', person: '1', decision: 3, data: { answer_index: 1, name: 'B' } })).toBe(s);
  });
});

describe('context loading', () => {
  const loaded = () => run(initialState(),
    { type: 'CONTEXT_REQUEST', token: 1 },
    { type: 'CONTEXT_RESPONSE', token: 1, data: contextData() });

  it('starts loading and stores the context from /api/context', () => {
    expect(initialState().contextStatus).toBe('loading');
    const s = loaded();
    expect(s.contextStatus).toBe('ready');
    expect(s.context.options).toHaveLength(5);
    expect(s.context.history_summary[0].category).toBe('Bar');
  });

  it('ignores a context response that was superseded or cancelled', () => {
    let s = run(initialState(), { type: 'CONTEXT_REQUEST', token: 1 }, { type: 'CONTEXT_REQUEST', token: 2 });
    expect(reducer(s, { type: 'CONTEXT_RESPONSE', token: 1, data: contextData() })).toBe(s);
    expect(reducer(s, { type: 'CONTEXT_FAILURE', token: 1, error: { code: 'network' } })).toBe(s);
  });

  it('shows an error with retry that bumps the epoch', () => {
    let s = run(initialState(), { type: 'CONTEXT_REQUEST', token: 1 },
      { type: 'CONTEXT_FAILURE', token: 1, error: { code: 'network', message: '' } });
    expect(s.contextStatus).toBe('error');
    const before = s.epoch;
    s = reducer(s, { type: 'CONTEXT_RETRY' });
    expect(s.epoch).toBe(before + 1);
    expect(s.contextStatus).toBe('loading');
  });

  it('shows the end of decisions when the context says no more decisions', () => {
    const s = run(initialState(), { type: 'CONTEXT_REQUEST', token: 1 },
      { type: 'CONTEXT_FAILURE', token: 1, error: { code: 'no_more_decisions', message: '' } });
    expect(s.phase).toBe('end');
  });

  it('a pick response refreshes the context', () => {
    const s = run(loaded(),
      { type: 'REQUEST', token: 5, decision: 0, answer: null },
      { type: 'RESPONSE', token: 5, data: pickData({ history_total: 13 }) });
    expect(s.context.history_total).toBe(13);
    expect(s.context.options).toHaveLength(5);
  });
});

describe('domain switch', () => {
  it('resets to Person 1, decision 0, clears the flow and invalidates in-flight requests', () => {
    let s = run(initialState(),
      { type: 'CONTEXT_REQUEST', token: 1 },
      { type: 'CONTEXT_RESPONSE', token: 1, data: contextData() },
      { type: 'SET_PERSON', person: '4' },
      { type: 'REQUEST', token: 2, decision: 0, answer: null },
      { type: 'CONTEXT_REQUEST', token: 3 });
    const epoch = s.epoch;
    s = reducer(s, { type: 'SET_DOMAIN', domain: 'shopping' });
    expect(s.domain).toBe('shopping');
    expect(s.person).toBe('1');
    expect(s.decision).toBe(0);
    expect(s.started).toBe(false);
    expect(s.busy).toBeNull();
    expect(s.context).toBeNull();
    expect(s.epoch).toBe(epoch + 1);
    // late responses from the places requests are ignored
    expect(reducer(s, { type: 'RESPONSE', token: 2, data: pickData() })).toBe(s);
    expect(reducer(s, { type: 'CONTEXT_RESPONSE', token: 3, data: contextData() })).toBe(s);
  });

  it('does nothing when the domain is unchanged', () => {
    const s = initialState();
    expect(reducer(s, { type: 'SET_DOMAIN', domain: 'places' })).toBe(s);
  });
});

describe('option rows through the decision', () => {
  const base = () => run(initialState(),
    { type: 'CONTEXT_REQUEST', token: 1 },
    { type: 'CONTEXT_RESPONSE', token: 1, data: contextData() });
  const states = (s) => optionRows(s).map((r) => r.state);

  it('marks the options a yes keeps while the question is shown', () => {
    const s = run(base(), { type: 'REQUEST', token: 2, decision: 0, answer: null },
      { type: 'RESPONSE', token: 2, data: questionData() });
    expect(states(s)).toEqual(['kept', 'kept', 'default', 'default', 'default']);
    expect(optionRows(s).map((r) => r.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('excludes the ruled-out options after an answer and marks the pick', () => {
    const ranking = [opt(1, 'B'), opt(0, 'A')];
    const s = run(base(),
      { type: 'REQUEST', token: 2, decision: 0, answer: null },
      { type: 'RESPONSE', token: 2, data: questionData() },
      { type: 'REQUEST', token: 3, decision: 0, answer: 'yes' },
      { type: 'RESPONSE', token: 3, data: pickData({ ranking, ruled_out: [OPTS[2], OPTS[3], OPTS[4]], answer: 'yes', question: { text: 'q', category: 'c', yes_idx: [0, 1] } }) });
    expect(states(s)).toEqual(['default', 'pick', 'excluded', 'excluded', 'excluded']);
  });

  it('clicking a row makes it the pick, and Not for me marks it passed', () => {
    let s = run(base(), { type: 'REQUEST', token: 2, decision: 0, answer: null },
      { type: 'RESPONSE', token: 2, data: pickData({ ranking: OPTS.map((o) => opt(o.index, o.name)) }) });
    const rowC = optionRows(s)[2];
    expect(canSelect(rowC, s.phase, s.choice)).toBe(true);
    expect(canSelect(optionRows(s)[0], s.phase, s.choice)).toBe(false); // the pick itself
    s = reducer(s, { type: 'SELECT_OPTION', position: positionOf(s.choice, 2) });
    expect(states(s)[2]).toBe('pick');
    expect(states(s)[0]).toBe('default');
    s = reducer(s, { type: 'NOT_FOR_ME' });
    expect(states(s)[2]).toBe('passed');
    expect(states(s)[0]).toBe('pick');
    expect(canSelect(optionRows(s)[2], s.phase, s.choice)).toBe(false);
  });

  it('an excluded row is not selectable', () => {
    const s = run(base(), { type: 'REQUEST', token: 2, decision: 0, answer: null },
      { type: 'RESPONSE', token: 2, data: pickData({ ranking: [opt(0, 'A')], ruled_out: [OPTS[1], OPTS[2], OPTS[3], OPTS[4]] }) });
    expect(canSelect(optionRows(s)[3], s.phase, s.choice)).toBe(false);
    expect(positionOf(s.choice, 3)).toBe(-1);
  });
});

describe('moving between decisions', () => {
  it('next decision clears the flow and the context so the new options load', () => {
    let s = run(initialState(), { type: 'CONTEXT_REQUEST', token: 1 }, { type: 'CONTEXT_RESPONSE', token: 1, data: contextData() },
      { type: 'REQUEST', token: 2, decision: 0, answer: null }, { type: 'RESPONSE', token: 2, data: pickData() },
      { type: 'ACCEPT' }, { type: 'NEXT_DECISION' });
    expect(s.decision).toBe(1);
    expect(s.phase).toBe('start');
    expect(s.context).toBeNull();
    expect(s.contextStatus).toBe('loading');
  });

  it('after the last decision it shows the end screen without a request', () => {
    let s = run(initialState(), { type: 'CONTEXT_REQUEST', token: 1 }, { type: 'CONTEXT_RESPONSE', token: 1, data: contextData({ n_decisions: 1 }) },
      { type: 'NEXT_DECISION' });
    expect(s.phase).toBe('end');
    expect(reducer(s, { type: 'RESTART' }).decision).toBe(0);
  });
});

describe('session score', () => {
  const finished = (choice) => ({
    ...initialState(), response: { ranking: [{ index: 2 }, { index: 0 }] }, choice,
  });
  it('counts a decision once, after it is finished, by the first pick', () => {
    let s = finished({ accepted: true, current: 0, rejected: [], ranking: [] });
    s = reducer(s, { type: 'REVEAL', person: s.person, decision: s.decision, data: { answer_index: 2 } });
    expect(s.tally.places).toMatchObject({ matched: 1, seen: 1 });
    s = reducer(s, { type: 'REVEAL', person: s.person, decision: s.decision, data: { answer_index: 2 } });
    expect(s.tally.places.seen).toBe(1);
  });
  it('does not count a reveal before the user has chosen', () => {
    let s = finished({ accepted: false, current: 0, rejected: [], ranking: [{ index: 2 }] });
    s = reducer(s, { type: 'REVEAL', person: s.person, decision: s.decision, data: { answer_index: 0 } });
    expect(s.tally.places.seen).toBe(0);
  });
});
