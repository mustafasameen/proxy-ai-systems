import { useEffect, useRef, useState } from 'react';
import {
  COPY, accepted, allRejected, andMore, confidenceParts, decisionOf, endOfDecisions, errorMessage, youSaid,
} from '../lib/copy.js';
import { currentOption, isExhausted, otherOptions } from '../lib/flow.js';
import DevPanel from './DevPanel.jsx';

function Status({ state }) {
  let text = '';
  let cancel = false;
  if (state.busy) {
    text = state.busy === 'using' ? COPY.using : COPY.looking;
    cancel = true;
  } else if (state.notice === 'next') {
    text = COPY.notForYou;
  }
  return (
    <div className="status-wrap">
      <p className="status" role="status" aria-live="polite">
        {text}
        {state.busy && state.slow && <span className="slow"> {COPY.slow}</span>}
      </p>
      {cancel && <button type="button" className="text-btn" onClick={state.onCancel}>{COPY.cancel}</button>}
    </div>
  );
}

function ErrorLine({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      <p>{errorMessage(error.code, error.message)}</p>
      <button type="button" className="secondary-btn" onClick={onRetry}>{COPY.tryAgain}</button>
    </div>
  );
}

function Knows({ knows }) {
  if (!knows || !knows.items.length) return null;
  const more = knows.total - knows.items.length;
  return (
    <section className="knows">
      <h2 className="kicker">{COPY.knowsHeading}</h2>
      <ul className="plain-list">
        {knows.items.map((h, i) => (
          <li key={`${h.name}-${i}`}>
            <span>{h.name}</span>
            {h.category && <span className="meta"> · {h.category}</span>}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="meta">{andMore(more)}</p>}
    </section>
  );
}

function Start({ state, ready, onFind, onSettings, onRetry, onCancel }) {
  const busy = Boolean(state.busy);
  return (
    <section className="start">
      <p className="kicker">{COPY.startKicker}</p>
      <h1 className="h-start">{COPY.startTitle}</h1>
      <p className="sub">{COPY.startSub}</p>
      <button type="button" className="primary-btn" disabled={busy || !ready} onClick={onFind}>{COPY.startButton}</button>
      <p className="hint">
        {COPY.startHintBefore}{' '}
        <button type="button" className="text-link" onClick={onSettings}>{COPY.startHintChange}</button>
      </p>
      <Status state={{ ...state, onCancel }} />
      <ErrorLine error={state.error} onRetry={onRetry} />
      <hr />
      <Knows knows={state.knows} />
    </section>
  );
}

function AnswerLine({ state, onChange }) {
  if (!state.question) return null;
  const answer = state.pendingAnswer || state.answer;
  return (
    <div className="asked">
      <p className="asked-text">{state.question.text}</p>
      <p className="meta you-said">
        {answer ? youSaid(answer) : ''}
        {answer && !state.pendingAnswer && (
          <>
            {' · '}
            <button type="button" className="text-link" onClick={onChange}>{COPY.changeAnswer}</button>
          </>
        )}
      </p>
    </div>
  );
}

function Question({ state, onAnswer, onCancel, onRetry }) {
  const busy = Boolean(state.busy);
  return (
    <section>
      <p className="kicker">{COPY.questionKicker}</p>
      <h2 className="h-pick">{state.question.text}</h2>
      {state.pendingAnswer ? (
        <p className="meta you-said">{youSaid(state.pendingAnswer)}</p>
      ) : (
        <div className="answer-row">
          {['yes', 'no', 'skip'].map((a) => (
            <button key={a} type="button" className="secondary-btn" disabled={busy} onClick={() => onAnswer(a)}>{COPY[a]}</button>
          ))}
        </div>
      )}
      <Status state={{ ...state, onCancel }} />
      <ErrorLine error={state.error} onRetry={onRetry} />
    </section>
  );
}

function RealMark({ revealed, option }) {
  if (!revealed || revealed.answer_index !== option.index) return null;
  return <span className="real"> {COPY.realChoice}</span>;
}

function Pick({ state, config, onChoose, onReject, onSelect, onNext, onChangeAnswer, onReveal, onCancel, onRetry }) {
  const [open, setOpen] = useState(false);
  const { response, choice } = state;
  useEffect(() => { setOpen(false); }, [state.decision, response]);

  const option = currentOption(choice);
  const total = (config && config.evaluation && config.evaluation.options_per_decision)
    || response.ranking.length + response.ruled_out.length;
  const conf = choice.current === 0 ? confidenceParts(response.confidence) : null;
  const wa = response.without_answer;
  const first = response.ranking[0];
  const rows = otherOptions(choice);

  return (
    <section>
      <AnswerLine state={state} onChange={onChangeAnswer} />
      {choice.accepted && option ? (
        <>
          <div className="pick-head">
            <p className="kicker">{COPY.pickKicker}</p>
            <p className="meta num">{decisionOf(state.decision, response.n_decisions)}</p>
          </div>
          <h2 className="h-pick">{accepted(option.name)}</h2>
          <div className="actions">
            <button type="button" className="primary-btn" onClick={onNext}>{COPY.nextDecision}</button>
          </div>
        </>
      ) : isExhausted(choice) ? (
        <>
          <div className="pick-head">
            <p className="kicker">{COPY.pickKicker}</p>
            <p className="meta num">{decisionOf(state.decision, response.n_decisions)}</p>
          </div>
          <h2 className="h-pick">{allRejected(total)}</h2>
          <div className="actions">
            <button type="button" className="primary-btn" onClick={onNext}>{COPY.nextDecision}</button>
          </div>
        </>
      ) : (
        <>
          <div className="pick-head">
            <p className="kicker">{COPY.pickKicker}</p>
            <p className="meta num">{decisionOf(state.decision, response.n_decisions)}</p>
          </div>
          <h2 className="h-pick">{option.name}<RealMark revealed={state.reveal} option={option} /></h2>
          {option.category && <p className="category">{option.category}</p>}
          {option.reason && (
            <div className="why">
              <p className="kicker">{COPY.whyHeading}</p>
              <p>{option.reason}</p>
            </div>
          )}
          {conf && (
            <p className="meta confidence"><strong>{conf.label}</strong>{conf.rest}</p>
          )}
          <Status state={{ ...state, onCancel }} />
          <div className="actions">
            <button type="button" className="primary-btn" onClick={onChoose}>{COPY.choose}</button>
            <button type="button" className="text-btn" onClick={onReject}>{COPY.notForMe}</button>
            {rows.length > 0 && (
              <button type="button" className="text-btn" aria-expanded={open} aria-controls="all-options" onClick={() => setOpen(!open)}>
                {open ? COPY.hideAll : COPY.seeAll}
              </button>
            )}
          </div>
          {open && (
            <div id="all-options" className="all-options">
              <ol className="option-list">
                {rows.map(({ option: o, position, rank }) => (
                  <li key={o.index}>
                    <button type="button" className="option-row" onClick={() => onSelect(position)}>
                      <span className="rank num">{rank}</span>
                      <span>{o.name}{o.category && <span className="meta"> · {o.category}</span>}<RealMark revealed={state.reveal} option={o} /></span>
                    </button>
                  </li>
                ))}
              </ol>
              {response.ruled_out.length > 0 && (
                <div className="ruled">
                  <p className="kicker">{COPY.ruledOut}</p>
                  <ul className="plain-list meta">
                    {response.ruled_out.map((o) => (
                      <li key={o.index}>{o.name}{o.category && ` · ${o.category}`}<RealMark revealed={state.reveal} option={o} /></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {wa && first && (
        <details className="changed">
          <summary>{COPY.answerChangedTitle}</summary>
          {wa.index === first.index ? (
            <p>{COPY.answerSame}</p>
          ) : (
            <div className="two-col">
              <div>
                <p className="kicker">{COPY.withoutAsking}</p>
                <p>{wa.name}</p>
              </div>
              <div className="col-rule">
                <p className="kicker">{COPY.withAnswer}</p>
                <p>{first.name}</p>
              </div>
            </div>
          )}
        </details>
      )}
      <ErrorLine error={state.error} onRetry={onRetry} />
      {state.devView && (
        <DevPanel response={response} setting={state.setting} config={config} revealed={state.reveal} onReveal={onReveal} />
      )}
    </section>
  );
}

function End({ state, onRestart }) {
  return (
    <section>
      <h2 className="h-pick">{endOfDecisions(state.person)}</h2>
      <div className="actions">
        <button type="button" className="primary-btn" onClick={onRestart}>{COPY.startOver}</button>
      </div>
    </section>
  );
}

export default function Flow(props) {
  const { state } = props;
  const region = useRef(null);
  const key = `${state.phase}|${state.started}|${state.decision}|${state.answer}|${state.pendingAnswer}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = region.current && region.current.querySelector('h1, h2');
    if (h && state.started) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }, [key, state.started]);

  const showStart = state.phase === 'start' && (state.decision === 0 || (!state.busy && !state.error));
  let body;
  if (showStart) {
    body = <Start {...props} ready={props.ready} />;
  } else if (state.phase === 'end') {
    body = <End {...props} />;
  } else if (state.phase === 'question' && state.question) {
    body = <Question {...props} />;
  } else if (state.phase === 'pick' && state.response && state.choice) {
    body = <Pick {...props} />;
  } else {
    body = (
      <section>
        <Status state={{ ...state, onCancel: props.onCancel }} />
        <ErrorLine error={state.error} onRetry={props.onRetry} />
      </section>
    );
  }
  return <div className="region" key={key} ref={region}>{body}</div>;
}
