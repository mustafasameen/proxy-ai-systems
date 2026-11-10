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
  leading: null,
  answer: null,
  response: null,
  choice: null,
  error: null,
  notice: null,
  reveal: null,
  retry: null,
};

const CONTEXT_RESET = { context: null, contextStatus: 'loading', contextError: null, contextToken: null };

export function initialState() {
  return {
    domain: 'places',
    epoch: 0, // bumped whenever the context must be loaded again
    person: '1',
    setting: DEFAULT_SETTING,
    decision: 0,
    view: 'main', // main | about
    settingsOpen: false,
    devView: false,
    ...CONTEXT_RESET,
    ...FLOW_RESET,
  };
}

// The context (options, history, summary) is shared by /api/context and /api/pick. A pick response refreshes it.
const CONTEXT_FIELDS = ['options', 'history', 'history_total', 'history_summary', 'n_decisions', 'live'];

function contextFrom(data, previous) {
  if (!data || !Array.isArray(data.options)) return previous;
  const next = { ...(previous || {}) };
  CONTEXT_FIELDS.forEach((k) => { if (data[k] !== undefined) next[k] = data[k]; });
  return next;
}

// Moves to another decision: the flow resets and the context is dropped so it can be loaded again.
function moveTo(state, changes) {
  return { ...state, ...FLOW_RESET, ...CONTEXT_RESET, ...changes, epoch: state.epoch + 1 };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'REQUEST': {
      const decision = action.decision;
      const sameDecision = decision === state.decision;
      const base = sameDecision
        ? state
        : { ...state, response: null, choice: null, question: null, answer: null, reveal: null, phase: 'start' };
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
        context: contextFrom(data, state.context),
        contextStatus: Array.isArray(data.options) ? 'ready' : state.contextStatus,
        contextError: Array.isArray(data.options) ? null : state.contextError,
      };
      if (data.stage === 'question') {
        return { ...common, phase: 'question', question: data.question, leading: data.leading || null, answer: null, response: null, choice: null };
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
    case 'CONTEXT_RETRY':
      return { ...state, epoch: state.epoch + 1, contextStatus: 'loading', contextError: null };
    case 'CONTEXT_REQUEST':
      return { ...state, contextToken: action.token, contextStatus: 'loading', contextError: null };
    case 'CONTEXT_RESPONSE':
      if (action.token !== state.contextToken) return state; // superseded or cancelled
      return {
        ...state, context: contextFrom(action.data, null), contextStatus: 'ready', contextError: null, contextToken: null,
      };
    case 'CONTEXT_FAILURE': {
      if (action.token !== state.contextToken) return state;
      if (action.error.code === 'cancelled') return state;
      if (action.error.code === 'no_more_decisions') {
        return { ...state, ...FLOW_RESET, phase: 'end', started: true, contextStatus: 'ready', contextToken: null };
      }
      return { ...state, contextStatus: 'error', contextToken: null, contextError: action.error };
    }
    case 'SET_DOMAIN':
      if (action.domain === state.domain) return state;
      return moveTo(state, { domain: action.domain, person: '1', decision: 0 });
    case 'SET_PERSON':
      if (action.person === state.person) return state;
      return moveTo(state, { person: action.person, decision: 0 });
    case 'SET_SETTING':
      if (action.setting === state.setting) return state;
      return { ...state, ...FLOW_RESET, setting: action.setting };
    case 'NEXT_DECISION': {
      const total = state.context && state.context.n_decisions;
      if (total && state.decision + 1 >= total) {
        return { ...state, ...FLOW_RESET, phase: 'end', started: true };
      }
      return moveTo(state, { decision: state.decision + 1 });
    }
    case 'RESTART':
      return moveTo(state, { decision: 0 });
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
