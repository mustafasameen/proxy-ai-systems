import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getConfig, getOutline, postContext, postPick, postReveal } from './lib/api.js';
import { reducer, initialState } from './lib/state.js';
import { optionRows } from './lib/workspace.js';
import Header from './components/Header.jsx';
import Flow from './components/Flow.jsx';
import Context from './components/Context.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import About from './components/About.jsx';
import { COPY, contextSummaryTitle } from './lib/copy.js';

const SLOW_MS = 4000;
const WIDE = '(min-width: 960px)';

function useWide() {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [config, setConfig] = useState(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [outline, setOutline] = useState(null);
  const [outlineFailed, setOutlineFailed] = useState(false);
  const wide = useWide();
  // What the person is looking at in the context panel: a kind of place (or store) and an option. Reset per decision.
  const [focus, setFocus] = useState({ kind: null, option: null });
  useEffect(() => { setFocus({ kind: null, option: null }); }, [state.domain, state.person, state.decision]);
  const setKind = (kind) => setFocus((f) => ({ ...f, kind: f.kind === kind ? null : kind }));
  const setOption = (option) => setFocus((f) => (f.option === option ? f : { ...f, option }));
  const inflight = useRef(null);
  const slowTimer = useRef(null);
  const settingsButton = useRef(null);
  const configHandle = useRef(null);
  const contextHandle = useRef(null);
  const { domain, person, decision, epoch } = state;

  const loadConfig = useCallback(() => {
    if (configHandle.current) configHandle.current.cancel();
    const h = getConfig(domain);
    configHandle.current = h;
    setConfigFailed(false);
    h.promise.then(
      (data) => { if (configHandle.current === h) setConfig(data); },
      (err) => { if (configHandle.current === h && err.code !== 'cancelled') setConfigFailed(true); },
    );
  }, [domain]);

  useEffect(() => {
    setConfig(null);
    loadConfig();
    return () => {
      if (configHandle.current) configHandle.current.cancel();
    };
  }, [loadConfig]);

  // The borough outline is a static file, read once.
  useEffect(() => {
    const h = getOutline();
    h.promise.then(setOutline, (err) => { if (err.code !== 'cancelled') setOutlineFailed(true); });
    return () => h.cancel();
  }, []);

  // Options, history and summary come from /api/context whenever the decision changes. No model is called.
  useEffect(() => {
    if (contextHandle.current) contextHandle.current.cancel();
    const h = postContext({ domain, person, decision });
    contextHandle.current = h;
    dispatch({ type: 'CONTEXT_REQUEST', token: h.token });
    h.promise.then(
      (data) => dispatch({ type: 'CONTEXT_RESPONSE', token: h.token, data }),
      (error) => dispatch({ type: 'CONTEXT_FAILURE', token: h.token, error: { code: error.code || 'network', message: error.message } }),
    );
    return () => h.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  const stop = useCallback(() => {
    clearTimeout(slowTimer.current);
    if (inflight.current) inflight.current.cancel();
    inflight.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // Starts one pick request. The reducer ignores any response whose token is no longer current.
  const run = useCallback((answer) => {
    stop();
    const h = postPick({ domain, person, decision, setting: state.setting, answer });
    inflight.current = h;
    dispatch({ type: 'REQUEST', token: h.token, decision, answer });
    slowTimer.current = setTimeout(() => dispatch({ type: 'SLOW', token: h.token }), SLOW_MS);
    h.promise.then(
      (data) => {
        clearTimeout(slowTimer.current);
        dispatch({ type: 'RESPONSE', token: h.token, data });
      },
      (error) => {
        clearTimeout(slowTimer.current);
        dispatch({ type: 'FAILURE', token: h.token, error: { code: error.code || 'network', message: error.message } });
      },
    );
  }, [domain, person, decision, state.setting, stop]);

  const onCancel = () => {
    stop();
    dispatch({ type: 'CANCEL' });
  };

  const onDomain = (next) => {
    stop();
    dispatch({ type: 'SET_DOMAIN', domain: next });
  };

  const onPerson = (next) => {
    stop();
    dispatch({ type: 'SET_PERSON', person: next });
  };

  const onSetting = (setting) => {
    stop();
    dispatch({ type: 'SET_SETTING', setting });
  };

  const onReveal = () => {
    const h = postReveal({ domain, person, decision });
    h.promise.then(
      (data) => dispatch({ type: 'REVEAL', person, decision, data }),
      () => {},
    );
  };

  const retry = () => {
    const r = state.retry;
    run(r ? r.answer : null);
  };

  const rows = optionRows(state);
  const context = (
    <Context
      domain={domain}
      context={state.context}
      rows={rows}
      state={state}
      focus={focus}
      onKind={setKind}
      onOption={setOption}
      outline={outline}
      outlineFailed={outlineFailed && !outline}
      bounds={config && config.map ? config.map.bounds : null}
    />
  );

  return (
    <>
      <Header
        domain={domain}
        onDomain={onDomain}
        people={config ? config.people : []}
        person={person}
        onPerson={onPerson}
        onSettings={() => dispatch({ type: 'OPEN_SETTINGS' })}
        settingsButtonRef={settingsButton}
        onHome={() => { stop(); dispatch({ type: 'SET_VIEW', view: 'main' }); }}
      />
      {state.view === 'about' ? (
        <main className="column">
          <About domain={domain} config={config} onBack={() => dispatch({ type: 'SET_VIEW', view: 'main' })} />
        </main>
      ) : (
        <main className="workspace">
          <Flow
            state={state}
            config={config}
            onFind={() => run(null)}
            onAnswer={(a) => run(a)}
            onChoose={() => dispatch({ type: 'ACCEPT' })}
            onReject={() => dispatch({ type: 'NOT_FOR_ME' })}
            onSelect={(position) => dispatch({ type: 'SELECT_OPTION', position })}
            onNext={() => { stop(); dispatch({ type: 'NEXT_DECISION' }); }}
            onChangeAnswer={() => { stop(); dispatch({ type: 'CHANGE_ANSWER' }); }}
            onRestart={() => { stop(); dispatch({ type: 'RESTART' }); }}
            onSettings={() => dispatch({ type: 'OPEN_SETTINGS' })}
            onReveal={onReveal}
            focus={focus}
            onOption={setOption}
            onCancel={onCancel}
            onRetry={retry}
            onRetryContext={() => dispatch({ type: 'CONTEXT_RETRY' })}
          />
          {(wide ? (
            <aside className="context-col">{context}</aside>
          ) : (
            <details className="context-details">
              <summary>{contextSummaryTitle(person)}</summary>
              {context}
            </details>
          ))}
          {configFailed && !config && (
            <div className="error config-error" role="alert">
              <p>{COPY.configFail}</p>
              <button type="button" className="secondary-btn" onClick={loadConfig}>{COPY.tryAgain}</button>
            </div>
          )}
        </main>
      )}
      {state.settingsOpen && (
        <SettingsSheet
          domain={domain}
          config={config}
          setting={state.setting}
          devView={state.devView}
          onSetting={onSetting}
          onDev={(on) => dispatch({ type: 'SET_DEV', on })}
          onAbout={() => dispatch({ type: 'SET_VIEW', view: 'about' })}
          onClose={() => dispatch({ type: 'CLOSE_SETTINGS' })}
        />
      )}
    </>
  );
}
