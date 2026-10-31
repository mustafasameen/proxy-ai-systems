import { useEffect, useId, useRef, useState } from 'react';
import { tradeoffText } from '../lib/decide.js';
import { settingLabel } from '../lib/copy.js';
import { capitalizeFirst, hasCategory, isUnnamed, placeName } from '../lib/format.js';

const SHOWN = 10;

// The settings sheet: how often PROXY checks with you, what it knows about you, a link to the
// About page, and the developer view switch. A native dialog, so focus stays inside while it is
// open, Escape closes it and focus returns to the button that opened it.
export default function SettingsSheet({
  open,
  onClose,
  settings,
  settingIdx,
  onSetting,
  history,
  historyLabel,
  onAbout,
  dev,
  onDev,
}) {
  const ref = useRef(null);
  const [showAll, setShowAll] = useState(false);
  const titleId = useId();
  const knowId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
      // Start on the chosen option so the keyboard lands somewhere useful.
      const checked = el.querySelector('input[type="radio"]:checked');
      if (checked) checked.focus();
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  const recent = [...(history || [])].reverse();
  const rows = showAll ? recent : recent.slice(0, SHOWN);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the dimmed area outside the sheet closes it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-head">
        <h2 className="sheet-title" id={titleId}>
          When should PROXY check with you?
        </h2>
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="sheet-body">
        <fieldset className="choices">
          <legend className="visually-hidden">How often PROXY checks with you</legend>
          {settings.map((s, i) => (
            <label key={i} className="choice">
              <input
                type="radio"
                name="check-in"
                checked={i === settingIdx}
                onChange={() => onSetting(i)}
              />
              <span className="choice-body">
                <span className="choice-label">{settingLabel(settings, i)}</span>
                <span className="choice-note">{tradeoffText(s)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <section className="sheet-sec" aria-labelledby={knowId}>
          <h3 className="sec-title" id={knowId}>
            What PROXY knows about you
          </h3>
          <h4 className="sub">{capitalizeFirst(historyLabel)}</h4>
          {recent.length === 0 ? (
            <p className="muted small">Nothing here yet.</p>
          ) : (
            <ol className="history">
              {rows.map((p, i) => (
                <li key={i}>
                  <span className="h-name">{placeName(p) || 'Unnamed item'}</span>
                  {!isUnnamed(p) && hasCategory(p) && <span className="h-cat">{p.category}</span>}
                </li>
              ))}
            </ol>
          )}
          {recent.length > SHOWN && (
            <button
              type="button"
              className="link"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show fewer' : `Show all ${recent.length}`}
            </button>
          )}
          <p className="know-note">
            PROXY uses only this list. It never sees your location, contacts or messages.
          </p>
        </section>

        <div className="sheet-sec">
          <button type="button" className="link" onClick={onAbout}>
            How well does PROXY work?
          </button>
        </div>

        <div className="sheet-sec dev-sec">
          <label className="dev-toggle">
            <input type="checkbox" checked={dev} onChange={(e) => onDev(e.target.checked)} />
            <span>Developer view (for evaluation)</span>
          </label>
        </div>
      </div>
    </dialog>
  );
}
