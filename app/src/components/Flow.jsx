import { useEffect, useRef } from 'react';
import {
  COPY, PICK_MATCHED, PICK_MISSED, ROLE_LINE, SEE_REAL, accepted, allRejected, confidenceParts, dc, decisionOf, endOfDecisions,
  errorMessage, leanLine, noQuestionLine, truthfulLine, workspaceTitle, youSaid,
} from '../lib/copy.js';
import { currentOption, isExhausted } from '../lib/flow.js';
import { canSelect, optionRows, positionOf, yesKeeps } from '../lib/workspace.js';
import DevPanel from './DevPanel.jsx';

function Status({ state, onCancel }) {
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
      {cancel && <button type="button" className="text-btn" onClick={onCancel}>{COPY.cancel}</button>}
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

function Diamond({ pick }) {
  return (
    <svg className={pick ? 'diamond is-pick' : 'diamond'} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" />
    </svg>
  );
}

function RealMark({ revealed, option }) {
  if (!revealed || revealed.answer_index !== option.index) return null;
  return <span className="real"> {COPY.realChoice}</span>;
}

// A generic place (a residence, a clinic) is named by its kind, so the kind line would only repeat the name.
export function showCategory(option) {
  return Boolean(option.category) && option.category.trim().toLowerCase() !== String(option.name).trim().toLowerCase();
}

function metaFor(row) {
  if (row.state === 'kept') return COPY.keptIfYes;
  if (row.state === 'excluded') return COPY.excluded;
  if (row.state === 'passed') return COPY.passed;
  if (row.state === 'pick') return COPY.isPick;
  return '';
}

export function OptionsList({ rows, phase, choice, reveal, onSelect, focusOption = null, onOption = () => {} }) {
  return (
    <ol className="options" aria-label={COPY.optionsLabel}>
      {rows.map((row) => {
        const { option } = row;
        const meta = metaFor(row);
        const inner = (
          <>
            <span className="opt-letter num" aria-hidden="true">{row.letter}</span>
            {Array.isArray(option.point) ? <Diamond pick={row.state === 'pick'} /> : <span className="diamond" aria-hidden="true" />}
            <span className="opt-text">
              <span className={option.name.length > 60 ? 'opt-name long' : 'opt-name'}>{option.name}</span>
              {showCategory(option) && <span className="opt-cat">{option.category}</span>}
              {(meta || (reveal && reveal.answer_index === option.index)) && (
                <span className={row.state === 'kept' ? 'opt-meta kept' : 'opt-meta'}>
                  {meta}
                  <RealMark revealed={reveal} option={option} />
                </span>
              )}
            </span>
          </>
        );
        return (
          <li
            key={option.index}
            className={`opt opt-${row.state}${focusOption === option.index ? ' is-focus' : ''}`}
            data-state={row.state}
            onMouseEnter={() => onOption(option.index)}
            onMouseLeave={() => onOption(null)}
            onFocus={() => onOption(option.index)}
            onBlur={() => onOption(null)}
          >
            {canSelect(row, phase, choice) ? (
              <button type="button" className="opt-main opt-button" onClick={() => onSelect(positionOf(choice, option.index))}>
                {inner}
              </button>
            ) : (
              <div className="opt-main">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Idle({ onFind, onSettings, ready, busy }) {
  return (
    <div className="idle">
      <button type="button" className="primary-btn" disabled={busy || !ready} onClick={onFind}>{COPY.startButton}</button>
      <p className="hint">
        {COPY.startHintBefore}{' '}
        <button type="button" className="text-link" onClick={onSettings}>{COPY.startHintChange}</button>
      </p>
    </div>
  );
}

function Question({ state, total, onAnswer }) {
  const busy = Boolean(state.busy);
  const k = Array.isArray(state.question.yes_idx) ? state.question.yes_idx.length : null;
  return (
    <div>
      <p className="meta role">{ROLE_LINE}</p>
      {state.leading && <p className="meta lean">{leanLine(state.leading.name)}</p>}
      <p className="kicker">{COPY.questionKicker}</p>
      <h2 className="h-q">{state.question.text}</h2>
      {k !== null && <p className="meta keeps">{yesKeeps(k, total)}</p>}
      {state.pendingAnswer ? (
        <p className="meta you-said">{youSaid(state.pendingAnswer)}</p>
      ) : (
        <div className="answer-row">
          {['yes', 'no', 'skip'].map((a) => (
            <button key={a} type="button" className="secondary-btn" disabled={busy} onClick={() => onAnswer(a)}>{COPY[a]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerLine({ state, onChange }) {
  if (!state.question || !state.answer) return null;
  return (
    <p className="meta you-said asked">
      {youSaid(state.answer)}
      {' · '}
      <button type="button" className="text-link" onClick={onChange}>{COPY.changeAnswer}</button>
    </p>
  );
}

function Changed({ response }) {
  const wa = response.without_answer;
  const first = response.ranking[0];
  if (!wa || !first) return null;
  return (
    <details className="changed">
      <summary>{COPY.answerChangedTitle}</summary>
      {wa.index === first.index ? (
        <p>{COPY.answerSame}</p>
      ) : (
        <div className="two-col">
          <div className="col-a">
            <p className="kicker">{COPY.withoutAsking}</p>
            <p>{wa.name}</p>
          </div>
          <div className="col-rule col-b">
            <p className="kicker">{COPY.withAnswer}</p>
            <p>{first.name}</p>
          </div>
        </div>
      )}
    </details>
  );
}

export function Outcome({ state, domain, onReveal }) {
  const { reveal, response } = state;
  if (!reveal) {
    return (
      <div className="outcome">
        <button type="button" className="secondary-btn" onClick={onReveal}>{SEE_REAL}</button>
      </div>
    );
  }
  const top = response && response.ranking[0];
  const matched = Boolean(top) && top.index === reveal.answer_index;
  const q = state.question;
  const yes = q && Array.isArray(q.yes_idx) ? q.yes_idx.includes(reveal.answer_index) : null;
  return (
    <div className="outcome" role="status">
      <p className="kicker">{dc(domain).really}</p>
      <p className="outcome-name">{reveal.name}</p>
      <p className={matched ? 'meta outcome-verdict matched' : 'meta outcome-verdict'}>{matched ? PICK_MATCHED : PICK_MISSED}</p>
      {yes !== null && state.answer && <p className="meta">{truthfulLine(yes, state.answer)}</p>}
    </div>
  );
}

function Pick({ state, domain, total, onChoose, onReject, onNext, onChangeAnswer, onReveal }) {
  const { response, choice } = state;
  const option = currentOption(choice);
  const conf = choice.current === 0 ? confidenceParts(response.confidence) : null;
  const big = domain === 'shopping' ? 'h-q' : 'h-pick';
  let main;
  if (choice.accepted && option) {
    main = (
      <div className="pick-block" key="accepted">
        <h2 className={big}>{accepted(option.name)}</h2>
        <Outcome state={state} domain={domain} onReveal={onReveal} />
        <div className="actions">
          <button type="button" className="primary-btn" onClick={onNext}>{COPY.nextDecision}</button>
        </div>
      </div>
    );
  } else if (isExhausted(choice)) {
    main = (
      <div className="pick-block" key="exhausted">
        <h2 className={big}>{allRejected(total)}</h2>
        <Outcome state={state} domain={domain} onReveal={onReveal} />
        <div className="actions">
          <button type="button" className="primary-btn" onClick={onNext}>{COPY.nextDecision}</button>
        </div>
      </div>
    );
  } else {
    main = (
      <div className="pick-block" key={`pick-${option.index}`}>
        <p className="kicker">{COPY.pickKicker}</p>
        <h2 className={big}>{option.name}<RealMark revealed={state.reveal} option={option} /></h2>
        {showCategory(option) && <p className="category">{option.category}</p>}
        {option.reason && (
          <div className="why">
            <p className="kicker">{COPY.whyHeading}</p>
            <p>{option.reason}</p>
          </div>
        )}
        {conf && <p className="meta confidence"><strong>{conf.label}</strong>{conf.rest}</p>}
        <div className="actions">
          <button type="button" className="primary-btn" onClick={onChoose}>{dc(domain).choose}</button>
          <button type="button" className="text-btn" onClick={onReject}>{COPY.notForMe}</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <AnswerLine state={state} onChange={onChangeAnswer} />
      {!response.question && <p className="meta no-question">{noQuestionLine(state.setting)}</p>}
      {main}
      <Changed response={response} />
    </div>
  );
}

function End({ state, onRestart }) {
  return (
    <div>
      <h2 className="h-pick">{endOfDecisions(state.person)}</h2>
      <div className="actions">
        <button type="button" className="primary-btn" onClick={onRestart}>{COPY.startOver}</button>
      </div>
    </div>
  );
}

export default function Flow(props) {
  const { state, config, onSelect } = props;
  const domain = state.domain;
  const copy = dc(domain);
  const region = useRef(null);
  const ended = state.phase === 'end';
  const rows = optionRows(state);
  const total = rows.length;
  const nDecisions = (state.context && state.context.n_decisions)
    || (config && (config.people.find((p) => p.id === state.person) || {}).decisions) || null;

  const key = `${state.phase}|${state.decision}|${state.answer}|${state.pendingAnswer}|${state.choice && state.choice.accepted}|${isExhausted(state.choice)}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = region.current;
    const h = root && (root.querySelector('.action h2') || root.querySelector('h1'));
    if (h && state.started) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }, [key, state.started]);

  let body;
  if (ended) {
    body = <End {...props} />;
  } else if (state.phase === 'question' && state.question) {
    body = <Question {...props} total={total} />;
  } else if (state.phase === 'pick' && state.response && state.choice) {
    body = <Pick {...props} domain={domain} total={total} />;
  } else {
    body = <Idle {...props} ready={state.contextStatus === 'ready'} busy={Boolean(state.busy)} />;
  }

  return (
    <section className="decision" ref={region} aria-labelledby="decision-title">
      <div className="pick-head">
        <p className="kicker">{copy.kicker}</p>
        {!ended && nDecisions && <p className="meta num">{decisionOf(state.decision, nDecisions)}</p>}
      </div>
      <h1 className="h-work" id="decision-title">{workspaceTitle(domain, state.person)}</h1>
      <p className="sub">{copy.sub}</p>
      <p className="source meta">{copy.source}</p>
      {!ended && (
        state.contextStatus === 'error' ? (
          <ErrorLine error={state.contextError} onRetry={props.onRetryContext} />
        ) : state.context ? (
          <OptionsList
            rows={rows}
            phase={state.phase}
            choice={state.choice}
            reveal={state.reveal}
            onSelect={onSelect}
            focusOption={props.focus ? props.focus.option : null}
            onOption={props.onOption}
          />
        ) : (
          <p className="meta loading-options">{COPY.loadingOptions}</p>
        )
      )}
      <div className="action">
        <div className="action-body" key={key}>{body}</div>
        <Status state={state} onCancel={props.onCancel} />
        <ErrorLine error={state.error} onRetry={props.onRetry} />
      </div>
      {state.devView && state.response && (
        <DevPanel response={state.response} setting={state.setting} config={config} revealed={state.reveal} onReveal={props.onReveal} />
      )}
    </section>
  );
}
