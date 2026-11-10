// The app's state machine as a pure reducer, so the lifecycle is testable without a browser.
import { initChoice, rejectCurrent, selectOption, accept } from './flow.js';

export const DEFAULT_SETTING = 'When unsure';

const FLOW_RESET = {
  started: false,
  phase: 'start', // start | question | pick | end
  token: null,
  busy: null, // null | looking | using
  slow: false,
  pendingAnswer: null,
  question: null,
  answer: null,
  response: null,
  choice: null,
  error: null,
  notice: null,
  knows: null,
  reveal: null,
  retry: null,
};

export function initialState() {
  return {
    person: '1',
    setting: DEFAULT_SETTING,
    decision: 0,
    view: 'main', // main | about
    settingsOpen: false,
    devView: false,
    ...FLOW_RESET,
  };
}

function knowsFrom(data, previous) {
  if (!data || !Array.isArray(data.history)) return previous;
  return { items: data.history, total: data.history_total };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'REQUEST': {
      const decision = action.decision;
      const sameDecision = decision === state.decision;
      const base = sameDecision
        ? state
        : { ...state, response: null, choice: null, question: null, answer: null, reveal: null, phase: 'start', knows: state.knows };
      return {
        ...base,
        decision,
        started: true,
        token: action.token,
        busy: action.answer ? 'using' : 'looking',
        slow: false,
        pendingAnswer: action.answer || null,
        error: null,
        notice: null,
        retry: { decision, answer: action.answer || null },
      };
    }
    case 'SLOW':
      return action.token === state.token && state.busy ? { ...state, slow: true } : state;
    case 'RESPONSE': {
      if (action.token !== state.token) return state; // superseded or cancelled
      const data = action.data;
      const common = {
        ...state, token: null, busy: null, slow: false, pendingAnswer: null, error: null, notice: null,
        knows: knowsFrom(data, state.knows),
      };
      if (data.stage === 'question') {
        return { ...common, phase: 'question', question: data.question, answer: null, response: null, choice: null };
      }
      return {
        ...common,
        phase: 'pick',
        question: data.question || null,
        answer: data.answer || null,
        response: data,
        choice: initChoice(data.ranking),
      };
    }
    case 'FAILURE': {
      if (action.token !== state.token) return state;
      const error = action.error;
      if (error.code === 'cancelled') return state;
      const settled = { ...state, token: null, busy: null, slow: false, pendingAnswer: null, notice: null };
      if (error.code === 'no_more_decisions') {
        return { ...settled, phase: 'end', started: true, error: null, response: null, choice: null, question: null };
      }
      const failure = { code: error.code, message: error.message };
      // A first request that fails returns to the start screen, with the error beneath the button.
      const hasContent = state.phase !== 'start';
      return { ...settled, error: failure, started: hasContent ? state.started : false };
    }
    case 'CANCEL':
      if (!state.busy) return state;
      return { ...state, token: null, busy: null, slow: false, pendingAnswer: null, started: state.phase === 'start' ? false : state.started };
    case 'CHANGE_ANSWER':
      return {
        ...state, phase: 'question', answer: null, response: null, choice: null, pendingAnswer: null, notice: null,
        error: null, token: null, busy: null, slow: false,
      };
    case 'NOT_FOR_ME': {
      if (!state.choice) return state;
      const choice = rejectCurrent(state.choice);
      return { ...state, choice, notice: choice.current === null ? null : 'next' };
    }
    case 'SELECT_OPTION':
      return state.choice ? { ...state, choice: selectOption(state.choice, action.position), notice: null } : state;
    case 'ACCEPT':
      return state.choice ? { ...state, choice: accept(state.choice), notice: null } : state;
    case 'REVEAL':
      if (action.person !== state.person || action.decision !== state.decision) return state;
      return { ...state, reveal: action.data };
    case 'SET_PERSON':
      if (action.person === state.person) return state;
      return { ...state, ...FLOW_RESET, person: action.person, decision: 0 };
    case 'SET_SETTING':
      if (action.setting === state.setting) return state;
      return { ...state, ...FLOW_RESET, setting: action.setting };
    case 'RESTART':
      return { ...state, ...FLOW_RESET, decision: 0 };
    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true };
    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false };
    case 'SET_VIEW':
      return { ...state, view: action.view, settingsOpen: false };
    case 'SET_DEV':
      return { ...state, devView: Boolean(action.on) };
    default:
      return state;
  }
}
