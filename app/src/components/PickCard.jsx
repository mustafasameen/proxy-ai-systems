import { useId } from 'react';
import { confidenceWords } from '../lib/decide.js';
import { hasCategory, isUnnamed, placeName, probLabel } from '../lib/format.js';

const barWidth = (p) => `${Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10}%`;

// One option: the name, its category (when there is one) and one plain reason, then how sure
// PROXY is and what the measurements say, then the actions.
//   first       the card shows PROXY's own pick rather than a next best
//   others      [{ item, i, p }] shown under "Show other options"
//   dev         developer view: adds the reveal of what the person actually chose
export default function PickCard({
  item,
  first,
  confidence,
  measured,
  why,
  confirmed,
  othersOpen,
  others,
  answered,
  wentIdx,
  dev,
  reveal,
  innerRef,
  onConfirm,
  onReject,
  onToggleOthers,
  onReveal,
}) {
  const listId = useId();
  const name = placeName(item) || 'This option';
  const kicker = first ? 'My pick' : 'My next best';

  return (
    <div
      className={confirmed ? 'msg pick confirmed' : 'msg pick'}
      role="group"
      ref={innerRef}
      tabIndex={-1}
      aria-label={`${kicker}: ${name}`}
    >
      <p className="kicker">{kicker}</p>
      <h2 className="pick-name">{name}</h2>
      {!isUnnamed(item) && hasCategory(item) && <p className="pick-cat">{item.category}</p>}
      {why && <p className="pick-why">{why}</p>}

      <div className="sure">
        <p className="sure-words">{confidenceWords(confidence)}</p>
        <div className="bar" aria-hidden="true">
          <span style={{ width: barWidth(confidence) }} />
        </div>
      </div>
      {measured && <p className="pick-measured">{measured}</p>}

      <div className="pick-actions">
        {!confirmed && (
          <button type="button" className="btn primary" onClick={onConfirm}>
            Go with this
          </button>
        )}
        {others.length > 0 && (
          <button
            type="button"
            className="btn"
            aria-expanded={othersOpen}
            aria-controls={othersOpen ? listId : undefined}
            onClick={onToggleOthers}
          >
            {othersOpen ? 'Hide other options' : 'Show other options'}
          </button>
        )}
        {!confirmed && (
          <button type="button" className="btn" onClick={onReject}>
            Not for me
          </button>
        )}
      </div>

      {othersOpen && others.length > 0 && (
        <ul className="others" id={listId} aria-label="Other options">
          {others.map(({ item: o, i, p }) => (
            <li key={i} className={answered && p === 0 ? 'other out' : 'other'}>
              <div className="other-head">
                <span className="other-name">{placeName(o) || 'This option'}</span>
                {dev && wentIdx === i && <span className="marker">They went here</span>}
              </div>
              {!isUnnamed(o) && hasCategory(o) && <p className="other-cat">{o.category}</p>}
              <div className="other-bar">
                <div className="bar" aria-hidden="true">
                  <span style={{ width: barWidth(p) }} />
                </div>
                <span className="pctnum">{probLabel(p)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dev && (
        <div className="dev-zone">
          <p className="dev-label">Developer view</p>
          {!reveal.revealed ? (
            <button type="button" className="btn small" onClick={onReveal}>
              Reveal what this person actually chose
            </button>
          ) : (
            <>
              <p className="reveal-line">
                {reveal.chose} {reveal.chosenText}.
              </p>
              <div className="badges">
                <span className={reveal.wasRight ? 'badge right' : 'badge wrong'}>
                  {reveal.wasRight ? 'PROXY was right' : 'PROXY was wrong'}
                </span>
                {reveal.confidentlyWrong && <span className="badge strong">Confidently wrong</span>}
              </div>
              {!first && <p className="dev-note">Judged on PROXY&apos;s first pick.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
