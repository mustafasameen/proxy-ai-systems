import { useEffect, useRef, useState } from 'react';
import { binAccuracy, pct } from '../lib/decide.js';
import { isUnnamed, placeName, plural, withArticle } from '../lib/format.js';

// The ask setting control, then PROXY's question or pick, the reveal, and a running tally.
export default function DecisionPanel({
  decision,
  view,
  settings,
  settingIdx,
  onSetting,
  asking,
  answer,
  revealed,
  reliability,
  alwaysAskAccuracy,
  tally,
  onAnswer,
  onAsPerson,
  onSkip,
  onAskInstead,
  onReveal,
  onNext,
}) {
  const setting = settings[settingIdx];
  const question = decision.question;

  // After a button press the buttons change, so move focus to the panel.
  const bodyRef = useRef(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0 && bodyRef.current) bodyRef.current.focus();
  }, [focusTick]);
  const act = (fn) => () => {
    fn();
    setFocusTick((t) => t + 1);
  };

  const confidence = pct(decision.confidence);
  const afterAsking = pct(Math.min(1, decision.confidence + decision.ask_value));

  const pickItem = decision.candidates[view.pick];
  const sureLine = answer
    ? `Across all choices, picks made after one question are right about ${pct(alwaysAskAccuracy)}% of the time.`
    : `When PROXY is this sure, it is right about ${pct(binAccuracy(reliability, view.confidence))}% of the time.`;
  const historyCount = pickItem.history_count;
  const historyLength = decision.history.length;
  const whyLine =
    historyCount > 0
      ? `${historyCount} of your last ${historyLength} places ${plural(historyCount, 'was', 'were')} ${pickItem.category}.`
      : 'None of your recent places were this kind of place, so this pick leans on patterns PROXY learned from other people.';

  const chosen = decision.candidates[decision.answer_idx];
  const wasRight = view.pick === decision.answer_idx;
  const confidentlyWrong = !wasRight && pct(view.confidence) >= 70;

  return (
    <div className="decide">
      <section className="card" aria-labelledby="decision-heading">
        <h2 className="label" id="decision-heading">
          PROXY's decision
        </h2>
        <fieldset className="setting">
          <legend>How often may PROXY ask you a question?</legend>
          <div className="seg">
            {settings.map((s, i) => (
              <label key={s.label} className="seg-item">
                <input
                  type="radio"
                  name="ask-setting"
                  checked={i === settingIdx}
                  onChange={() => onSetting(i)}
                />
                <span className="seg-text">{s.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="setting-line">
          At this setting PROXY asks on about {pct(setting.ask_rate)}% of choices and picks the
          right place about {pct(setting.accuracy)}% of the time.
        </p>
      </section>

      <section
        className={asking ? 'panel ask' : 'panel'}
        ref={bodyRef}
        tabIndex={-1}
        aria-label={asking ? 'One quick question first' : "PROXY's pick"}
      >
        {asking ? (
          <>
            <h3 className="panel-title">One quick question first</h3>
            <p className="question">Are you up for {withArticle(question.category)}?</p>
            <p className="muted">
              Asking here should raise the chance of a right pick from {confidence}% to{' '}
              {afterAsking}%.
            </p>
            <div className="btn-row">
              <button type="button" className="btn big" onClick={act(() => onAnswer('yes'))}>
                Yes
              </button>
              <button type="button" className="btn big" onClick={act(() => onAnswer('no'))}>
                No
              </button>
            </div>
            <div className="link-row">
              <button type="button" className="link" onClick={act(onAsPerson)}>
                Answer as this person would
              </button>
              <button type="button" className="link" onClick={act(onSkip)}>
                Skip and just pick
              </button>
            </div>
          </>
        ) : (
          <>
            {answer && question && (
              <p className="muted asked-line">
                You were asked if you are up for {withArticle(question.category)} and said{' '}
                {answer}.
              </p>
            )}
            <h3 className="panel-title muted-title">PROXY's pick</h3>
            <p className="pick-name">{placeName(pickItem)}</p>
            {!isUnnamed(pickItem) && <p className="pick-cat">{pickItem.category}</p>}
            <div className="meter">
              <p className="meter-line">
                <span className="meter-num">{pct(view.confidence)}%</span> sure
              </p>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${Math.round(view.confidence * 1000) / 10}%` }} />
              </div>
            </div>
            <p className="plain">{sureLine}</p>
            <p className="plain">
              <span className="why-label">Why</span> {whyLine}
            </p>
            {question && !answer && !revealed && (
              <button type="button" className="link" onClick={act(onAskInstead)}>
                Ask me a question instead
              </button>
            )}

            <div className="reveal-zone">
              {!revealed ? (
                <button type="button" className="btn" onClick={act(onReveal)}>
                  Reveal what they chose
                </button>
              ) : (
                <>
                  <p className="reveal-line">
                    They went to {isUnnamed(chosen) ? `an unnamed ${chosen.category}` : chosen.name}.
                  </p>
                  <div className="badges">
                    <span className={wasRight ? 'badge right' : 'badge wrong'}>
                      {wasRight ? 'PROXY was right' : 'PROXY was wrong'}
                    </span>
                    {confidentlyWrong && <span className="badge strong">Confidently wrong</span>}
                  </div>
                  <button type="button" className="btn primary" onClick={act(onNext)}>
                    Next choice
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <p className="tally">
        This person so far: right on {tally.right} of {tally.revealed} revealed{' '}
        {plural(tally.revealed, 'choice', 'choices')}, asked {tally.asked}{' '}
        {plural(tally.asked, 'time', 'times')}.
      </p>
    </div>
  );
}
