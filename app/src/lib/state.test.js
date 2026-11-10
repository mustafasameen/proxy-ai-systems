import { describe, it, expect } from 'vitest';
import { reducer, initialState } from './state.js';
import { currentOption, isExhausted } from './flow.js';

const opt = (i, name) => ({ index: i, name, category: 'Cafe', reason: `Reason ${name}` });
const pickData = (extra = {}) => ({
  stage: 'pick', question: null, answer: null, ruled_out: [], confidence: null, without_answer: null,
  ranking: [opt(0, 'A'), opt(1, 'B'), opt(2, 'C')], history: [{ name: 'H', category: 'Bar' }], history_total: 12,
  n_decisions: 9, ...extra,
});
const questionData = () => ({
  stage: 'question', question: { text: 'Are you up for a cafe?', category: 'Cafe' }, history: [], history_total: 12, n_decisions: 9,
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
    expect(s.knows.total).toBe(12);
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
