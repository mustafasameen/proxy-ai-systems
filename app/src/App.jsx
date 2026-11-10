import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getConfig, postPick, postReveal } from './lib/api.js';
import { reducer, initialState } from './lib/state.js';
import Header from './components/Header.jsx';
import Flow from './components/Flow.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import About from './components/About.jsx';
import { COPY } from './lib/copy.js';

const SLOW_MS = 4000;

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [config, setConfig] = useState(null);
  const [configFailed, setConfigFailed] = useState(false);
  const inflight = useRef(null);
  const slowTimer = useRef(null);
  const settingsButton = useRef(null);
  const configHandle = useRef(null);

  const loadConfig = useCallback(() => {
    if (configHandle.current) configHandle.current.cancel();
    const h = getConfig();
    configHandle.current = h;
    setConfigFailed(false);
    h.promise.then(
      (data) => { if (configHandle.current === h) setConfig(data); },
      (err) => { if (configHandle.current === h && err.code !== 'cancelled') setConfigFailed(true); },
    );
  }, []);

  useEffect(() => {
    loadConfig();
    return () => {
      if (configHandle.current) configHandle.current.cancel();
    };
  }, [loadConfig]);

  const stop = useCallback(() => {
    clearTimeout(slowTimer.current);
    if (inflight.current) inflight.current.cancel();
    inflight.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // Starts one pick request. The reducer ignores any response whose token is no longer current.
  const run = useCallback((decision, answer, person = state.person, setting = state.setting) => {
    stop();
    const h = postPick({ person, decision, setting, answer });
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
  }, [state.person, state.setting, stop]);

  const onCancel = () => {
    stop();
    dispatch({ type: 'CANCEL' });
  };

  const onPerson = (person) => {
    stop();
    dispatch({ type: 'SET_PERSON', person });
  };

  const onSetting = (setting) => {
    stop();
    dispatch({ type: 'SET_SETTING', setting });
  };

  const onReveal = () => {
    const { person, decision } = state;
    const h = postReveal({ person, decision });
    h.promise.then(
      (data) => dispatch({ type: 'REVEAL', person, decision, data }),
      () => {},
    );
  };

  const retry = () => {
    const r = state.retry || { decision: state.decision, answer: null };
    run(r.decision, r.answer);
  };

  const closeSettings = () => dispatch({ type: 'CLOSE_SETTINGS' });

  return (
    <>
      <Header
        people={config ? config.people : []}
        person={state.person}
        onPerson={onPerson}
        onSettings={() => dispatch({ type: 'OPEN_SETTINGS' })}
        settingsButtonRef={settingsButton}
        onHome={() => { stop(); dispatch({ type: 'SET_VIEW', view: 'main' }); }}
      />
      <main className="column">
        {state.view === 'about' ? (
          <About config={config} onBack={() => dispatch({ type: 'SET_VIEW', view: 'main' })} />
        ) : (
          <>
            <Flow
              state={state}
              config={config}
              ready={Boolean(config)}
              onFind={() => run(state.decision, null)}
              onAnswer={(a) => run(state.decision, a)}
              onChoose={() => dispatch({ type: 'ACCEPT' })}
              onReject={() => dispatch({ type: 'NOT_FOR_ME' })}
              onSelect={(position) => dispatch({ type: 'SELECT_OPTION', position })}
              onNext={() => run(state.decision + 1, null)}
              onChangeAnswer={() => { stop(); dispatch({ type: 'CHANGE_ANSWER' }); }}
              onRestart={() => { stop(); dispatch({ type: 'RESTART' }); }}
              onSettings={() => dispatch({ type: 'OPEN_SETTINGS' })}
              onReveal={onReveal}
              onCancel={onCancel}
              onRetry={retry}
            />
            {configFailed && !config && (
              <div className="error" role="alert">
                <p>{COPY.configFail}</p>
                <button type="button" className="secondary-btn" onClick={loadConfig}>{COPY.tryAgain}</button>
              </div>
            )}
          </>
        )}
      </main>
      {state.settingsOpen && (
        <SettingsSheet
          config={config}
          setting={state.setting}
          devView={state.devView}
          onSetting={onSetting}
          onDev={(on) => dispatch({ type: 'SET_DEV', on })}
          onAbout={() => dispatch({ type: 'SET_VIEW', view: 'about' })}
          onClose={closeSettings}
        />
      )}
    </>
  );
}
