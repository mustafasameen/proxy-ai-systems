import { useEffect, useRef } from 'react';
import { COPY, askRateText, pct, settingsNote } from '../lib/copy.js';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function SettingsSheet({ domain, config, setting, devView, onSetting, onDev, onAbout, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const first = node && node.querySelector(FOCUSABLE);
    if (first) first.focus();
    return () => {
      if (previous && previous.focus) previous.focus();
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const ev = config && config.evaluation;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={ref} onKeyDown={onKeyDown}>
        <div className="sheet-head">
          <h2 id="settings-title" className="h-section">{COPY.settingsTitle}</h2>
          <button type="button" className="text-btn" onClick={onClose}>{COPY.close}</button>
        </div>
        {config ? (
          <>
            <fieldset className="radio-list">
              <legend className="visually-hidden">{COPY.settingsTitle}</legend>
              {config.settings.map((s) => (
                <label key={s.label} className="radio-row">
                  <input type="radio" name="setting" value={s.label} checked={setting === s.label} onChange={() => onSetting(s.label)} />
                  <span className="radio-text">
                    <span className="radio-label">{s.label}</span>
                    <span className="meta">{askRateText(s.ask_rate)}</span>
                  </span>
                  <span className="radio-rate num">{pct(s.accuracy)}</span>
                </label>
              ))}
            </fieldset>
            {ev && <p className="note">{settingsNote(ev.report_rows, ev.report_users, domain)}</p>}
          </>
        ) : (
          <p className="note">{COPY.configFail}</p>
        )}
        <div className="sheet-section">
          <button type="button" className="text-link" onClick={onAbout}>{COPY.aboutLink}</button>
        </div>
        <div className="sheet-section sheet-foot">
          <label className="toggle-row">
            <input type="checkbox" checked={devView} onChange={(e) => onDev(e.target.checked)} />
            <span>{COPY.developerToggle}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
