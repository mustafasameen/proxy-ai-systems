import { useEffect, useRef } from 'react';
import PickCard from './PickCard.jsx';
import {
  accuracyLine,
  conversationView,
  otherOptions,
  pct,
  reasonLine,
} from '../lib/decide.js';
import { MESSAGES, answerLabel, checkInNote } from '../lib/copy.js';
import { chosenName, plural } from '../lib/format.js';

// The default view: a start prompt, then a short conversation. PROXY may ask one question first,
// then shows its pick on a card with how sure it is and what the measurements say.
//
//   copy      wording for the domain (prompt, start button, confirmation, next button)
//   decision  the decision being replayed for the demo account
//   position  { index, count } of the decision for this person, shown in the developer tally only
//   flow      what has happened so far on this request (see FRESH_FLOW)
//   noun      what the history counts, for example "places"
//   focusTick goes up after each action, so focus can move to the newest message
//   actions   { onStart, onChange, onAnswer, onAsPerson, onConfirm, onReject, onToggleOthers, onReveal, onNext }
export default function Assistant({
  copy,
  decision,
  position,
  summary,
  settingIdx,
  flow,
  dev,
  tally,
  noun,
  focusTick,
  actions,
}) {
  const setting = summary.settings[settingIdx];
  const cv = conversationView(decision, setting, flow);
  const stage = !flow.started ? 'start' : cv.asking ? 'ask' : 'pick';
  const item = stage === 'pick' && cv.shownIdx !== null ? decision.candidates[cv.shownIdx] : null;

  // After a button press the buttons go away, so focus moves to the newest message.
  const latestRef = useRef(null);
  useEffect(() => {
    if (focusTick > 0 && latestRef.current) latestRef.current.focus();
  }, [focusTick]);
  let latest = 'start';
  if (stage === 'ask') latest = 'ask';
  else if (stage === 'pick') latest = item ? (flow.confirmed ? 'confirmed' : 'pick') : 'out';
  const attach = (key) => (key === latest ? latestRef : null);

  const others = item
    ? otherOptions(cv.view.probs, cv.shownIdx, flow.rejected)
        .map(({ i, p }) => ({ item: decision.candidates[i], i, p }))
        .filter((o) => o.item)
    : [];
  const ownPickRight = cv.view.pick === decision.answer_idx;
  const reveal = {
    revealed: flow.revealed,
    chose: copy.chose,
    chosenText: chosenName(decision.candidates[decision.answer_idx]),
    wasRight: ownPickRight,
    confidentlyWrong: !ownPickRight && pct(cv.view.confidence) >= 70,
  };

  return (
    <div className="assistant">
      <h1
        className={stage === 'start' ? 'start-title' : 'visually-hidden'}
        data-page-heading="true"
        tabIndex={-1}
      >
        {copy.prompt}
      </h1>

      {stage === 'start' ? (
        <div className="start">
          <button type="button" className="btn primary big" onClick={actions.onStart}>
            {copy.start}
          </button>
          <p className="start-note">
            {checkInNote(settingIdx)}{' '}
            <button type="button" className="link inline" onClick={actions.onChange}>
              Change
            </button>
          </p>
        </div>
      ) : (
        <div className="stack" role="group" aria-label="Conversation with PROXY">
          {cv.willAsk && (
            <div
              className="msg ask"
              role="group"
              ref={attach('ask')}
              tabIndex={-1}
              aria-label="A quick question"
            >
              <p className="msg-lead">{MESSAGES.askLead}</p>
              <p className="question">{cv.question}</p>
              {cv.asking && (
                <>
                  <div className="btn-row">
                    <button type="button" className="btn big" onClick={() => actions.onAnswer('yes')}>
                      {MESSAGES.yes}
                    </button>
                    <button type="button" className="btn big" onClick={() => actions.onAnswer('no')}>
                      {MESSAGES.no}
                    </button>
                    <button type="button" className="btn big" onClick={() => actions.onAnswer('skip')}>
                      {MESSAGES.justPick}
                    </button>
                  </div>
                  {dev && (
                    <div className="link-row">
                      <button type="button" className="link" onClick={actions.onAsPerson}>
                        Answer as this person would
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {cv.willAsk && cv.answered && (
            <p className="bubble">
              <span className="visually-hidden">You said: </span>
              {answerLabel(flow.answer)}
            </p>
          )}

          {item && (
            <>
              {!cv.first && <p className="lead">{MESSAGES.nextBest}</p>}
              <PickCard
                item={item}
                first={cv.first}
                confidence={cv.confidence}
                measured={
                  cv.first
                    ? accuracyLine({
                        answered: cv.yn !== null,
                        confidence: cv.confidence,
                        reliability: summary.reliability,
                        alwaysAskAccuracy: summary.always_ask_accuracy,
                      })
                    : ''
                }
                why={reasonLine(item, (decision.history || []).length, noun)}
                confirmed={flow.confirmed}
                othersOpen={flow.others}
                others={others}
                answered={cv.yn !== null}
                wentIdx={flow.revealed ? decision.answer_idx : null}
                dev={dev}
                reveal={reveal}
                innerRef={attach('pick')}
                onConfirm={actions.onConfirm}
                onReject={actions.onReject}
                onToggleOthers={actions.onToggleOthers}
                onReveal={actions.onReveal}
              />
            </>
          )}

          {stage === 'pick' && !item && (
            <p className="msg" ref={attach('out')} tabIndex={-1}>
              {MESSAGES.outOfIdeas}
            </p>
          )}

          {item && flow.confirmed && (
            <p className="msg ok" ref={attach('confirmed')} tabIndex={-1}>
              {copy.confirmed}
            </p>
          )}

          {stage === 'pick' && (
            <div className="next-row">
              <button type="button" className="btn" onClick={actions.onNext}>
                {copy.next}
              </button>
            </div>
          )}
        </div>
      )}

      {dev && (
        <p className="tally">
          Decision {decision.id} ({position.index + 1} of {position.count}). This person so far: right
          on {tally.right} of {tally.revealed} revealed{' '}
          {plural(tally.revealed, 'choice', 'choices')}, asked {tally.asked}{' '}
          {plural(tally.asked, 'time', 'times')}.
        </p>
      )}
    </div>
  );
}
