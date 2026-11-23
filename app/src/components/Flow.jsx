import { useEffect, useRef } from 'react';
import {
  COPY, MECHANISM, PICKED_LABEL, PICK_MATCHED, PICK_MISSED, PRIVATE_WHY, REAL_LABEL, SEE_REAL, answerLeftNone, ruledOutLine, accepted, allRejected,
  confidenceLine, dc, decisionOf, displayName, endOfDecisions, errorMessage, evidenceLine, isPrivate, roleLine, leanLine, noQuestionLine, noRateLine, startHint, tallyLine, truthfulLine, workspaceTitle, youSaid,
} from '../lib/copy.js';
import { currentOption, isExhausted } from '../lib/flow.js';
import { canSelect, evidence, optionRows, positionOf, yesKeeps } from '../lib/workspace.js';
import DevPanel from './DevPanel.jsx';

function Status({ state, onCancel }) {
  let text = '';
  let cancel = false;
  if (state.busy) {
    text = state.busy === 'using' ? COPY.using : COPY.looking;
    cancel = true;
  } else if (state.notice === 'next') {
    const cut = state.response && Array.isArray(state.response.ruled_out) && state.response.ruled_out.length > 0;
    text = cut ? COPY.notForYouAnswer : COPY.notForYou;
  }
  return (
    <div className="status-wrap">
      <p className={state.notice === 'next' && !state.busy ? 'status note-next' : 'status'} role="status" aria-live="polite">
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
  return Boolean(option.category) && !isPrivate(option) && option.category.trim().toLowerCase() !== String(option.name).trim().toLowerCase();
}

// The current pick is PROXY's pick only until the user clicks another row, and PROXY's next pick after "Not for me".
export function pickLabel(choice) {
  if (choice && choice.byUser) return COPY.yourChoice;
  return choice && choice.current > 0 ? COPY.nextPick : COPY.isPick;
}

function metaFor(row, choice) {
  if (row.state === 'kept') return COPY.keptIfYes;
  if (row.state === 'excluded') return COPY.excluded;
  if (row.state === 'passed') return COPY.passed;
  if (row.state === 'pick') return pickLabel(choice);
  return '';
}

export function OptionsList({ rows, phase, choice, reveal, onSelect, focusOption = null, onOption = () => {} }) {
  return (
    <ol className="options" aria-label={COPY.optionsLabel}>
      {rows.map((row) => {
        const { option } = row;
        const meta = metaFor(row, choice);
        const isReal = Boolean(reveal) && reveal.answer_index === option.index;
        const inner = (
          <>
            <span className="opt-letter num" aria-hidden="true">{row.letter}</span>
            {Array.isArray(option.point) ? <Diamond pick={row.state === 'pick'} /> : <span className="diamond" aria-hidden="true" />}
            <span className="opt-text">
              <span className={option.name.length > 60 ? 'opt-name long' : 'opt-name'}>{displayName(option)}</span>
              {showCategory(option) && <span className="opt-cat">{option.category}</span>}
              {isPrivate(option) && <span className="opt-cat">{PRIVATE_WHY}</span>}
              {(meta || isReal) && (
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
            className={`opt opt-${row.state}${isReal ? ' is-real' : ''}${focusOption === option.index ? ' is-focus' : ''}`}
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

function Idle({ onFind, onSettings, ready, busy, setting }) {
  return (
    <div className="idle">
      <button type="button" className="primary-btn" disabled={busy || !ready} onClick={onFind}>{COPY.startButton}</button>
      <p className="hint">
        {startHint(setting)}{' '}
        <button type="button" className="text-link" onClick={onSettings}>{COPY.startHintChange}</button>
      </p>
    </div>
  );
}

function Question({ state, total, onAnswer }) {
  const busy = Boolean(state.busy);
  const k = Array.isArray(state.question.yes_idx) ? state.question.yes_idx.length : null;
  // the same count the context column shows, here beside the question so it is read first
  const ev = evidence(state.context && state.context.history, state.question);
  return (
    <div>
      <p className="meta role">{roleLine(state.person)}</p>
      {state.leading && <p className="meta lean">{leanLine(displayName(state.leading))}</p>}
      <p className="kicker">{COPY.questionKicker}</p>
      <h2 className="h-q">{state.question.text}</h2>
      {ev && <p className="meta evidence-line">{evidenceLine(state.domain, ev)}</p>}
      {k !== null && <p className="meta keeps">{yesKeeps(k, total)}</p>}
      <p className="meta mechanism">{MECHANISM}</p>
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
      {(state.answer === 'yes' || state.answer === 'no') && state.response && Array.isArray(state.response.ruled_out)
        ? ` · ${ruledOutLine(state.answer, state.response.ruled_out.length)}` : ''}
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
            <p>{displayName(wa)}</p>
          </div>
          <div className="col-rule col-b">
            <p className="kicker">{COPY.withAnswer}</p>
            <p>{displayName(first)}</p>
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
  const real = ((state.context && state.context.options) || []).find((o) => o.index === reveal.answer_index);
  const realName = real ? displayName(real) : reveal.name;
  const matched = Boolean(top) && top.index === reveal.answer_index;
  const q = state.question;
  const yes = q && Array.isArray(q.yes_idx) ? q.yes_idx.includes(reveal.answer_index) : null;
  const tally = state.tally && state.tally[domain];
  return (
    <div className="outcome" role="status">
      <div className="two-col outcome-compare">
        <div className="col-a">
          <p className="kicker">{PICKED_LABEL}</p>
          <p className="outcome-name">{top ? displayName(top) : ''}</p>
        </div>
        <div className="col-rule col-b">
          <p className="kicker">{REAL_LABEL}</p>
          <p className="outcome-name">{realName}</p>
        </div>
      </div>
      <p className={matched ? 'meta outcome-verdict matched' : 'meta outcome-verdict'}>{matched ? PICK_MATCHED : PICK_MISSED}</p>
      {yes !== null && state.answer && <p className="meta">{truthfulLine(yes, state.answer)}</p>}
      {tally && tally.seen > 0 && <p className="meta tally num">{tallyLine(tally.matched, tally.seen)}</p>}
    </div>
  );
}

export function Pick({ state, domain, total, onChoose, onReject, onNext, onChangeAnswer, onReveal }) {
  const { response, choice } = state;
  const option = currentOption(choice);
  const answered = response.answer === 'yes' || response.answer === 'no';
  const later = choice.current !== 0;
  const conf = later ? null : confidenceLine(response.confidence, answered);
  const rateNote = conf || noRateLine({ later, answered, single: response.ranking.length === 1 });
  const big = domain === 'shopping' ? 'h-q' : 'h-pick';
  let main;
  if (choice.accepted && option) {
    main = (
      <div className="pick-block" key="accepted">
        <h2 className={big}>{accepted(displayName(option))}</h2>
        <p className="meta confidence">{rateNote}</p>
        <Outcome state={state} domain={domain} onReveal={onReveal} />
        <div className="actions">
          <button type="button" className="primary-btn" onClick={onNext}>{COPY.nextDecision}</button>
        </div>
      </div>
    );
  } else if (isExhausted(choice)) {
    main = (
      <div className="pick-block" key="exhausted">
        <h2 className={big}>{allRejected(total, response.ranking.length)}</h2>
        {answered && response.ruled_out.length > 0 && <p className="meta all-rejected">{answerLeftNone(response.answer, response.ruled_out.length)}</p>}
        <Outcome state={state} domain={domain} onReveal={onReveal} />
        <div className="actions">
          {answered && response.ruled_out.length > 0 && (
            <button type="button" className="secondary-btn" onClick={onChangeAnswer}>{COPY.changeYourAnswer}</button>
          )}
          <button type="button" className="primary-btn" onClick={onNext}>{COPY.nextDecision}</button>
        </div>
      </div>
    );
  } else {
    main = (
      <div className="pick-block" key={`pick-${option.index}`}>
        <p className="kicker">{choice.byUser ? COPY.yourChoiceKicker : later ? COPY.nextPickKicker : COPY.pickKicker}</p>
        <h2 className={big}>{displayName(option)}<RealMark revealed={state.reveal} option={option} /></h2>
        {showCategory(option) && <p className="category">{option.category}</p>}
        {option.reason && !isPrivate(option) && (
          <div className="why">
            <p className="kicker">{COPY.whyHeading}</p>
            <p>{option.reason}</p>
          </div>
        )}
        <p className="meta confidence">{rateNote}</p>
        <div className="actions">
          <button type="button" className="primary-btn" onClick={onChoose}>{dc(domain).choose}</button>
          <button type="button" className="text-btn" onClick={onReject}>{COPY.notForMe}</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      {!response.question && <p className="meta no-question">{noQuestionLine(state.setting)}</p>}
      {main}
      <AnswerLine state={state} onChange={onChangeAnswer} />
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

  const key = `${state.phase}|${state.decision}|${state.answer}|${state.pendingAnswer}|${state.choice && state.choice.accepted}|${isExhausted(state.choice)}|${state.choice && state.choice.current}|${Boolean(state.reveal)}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = region.current;
    const h = root && (root.querySelector('.action h2') || root.querySelector('h1'));
    // Focus follows the change, so a keyboard or screen reader user is not left on a control that was removed. Before a
    // decision is started (after "Next decision") it moves to the page heading, and only when focus was lost.
    const lost = !document.activeElement || document.activeElement === document.body;
    if (h && (state.started || lost)) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
      if (!state.started) return;
      // keep the question or pick in view on short screens, where it sits below the five options
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const action = root.querySelector('.action');
      if (action && action.scrollIntoView) action.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
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
    body = <Idle {...props} ready={state.contextStatus === 'ready'} busy={Boolean(state.busy)} setting={state.setting} />;
  }

  return (
    <section className="decision" ref={region} aria-labelledby="decision-title">
      <div className="pick-head">
        <p className="kicker">{copy.kicker}</p>
        {!ended && nDecisions && <p className="meta num">{decisionOf(state.decision, nDecisions)}</p>}
      </div>
      <h1 className="h-work" id="decision-title">{workspaceTitle(domain, state.person)}</h1>
      <p className="sub">{copy.sub}</p>
      <p className="source meta">{copy.source}<br /><span className="source-detail">{copy.sourceDetail}</span></p>
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
