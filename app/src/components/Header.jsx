import { COPY, DOMAINS, DOMAIN_COPY, personLabel } from '../lib/copy.js';

export default function Header({ domain, onDomain, people, person, onPerson, onSettings, settingsButtonRef, onHome }) {
  const ids = people.length ? people.map((p) => p.id) : [person];
  return (
    <header className="header">
      <div className="header-inner">
        <button type="button" className="wordmark" onClick={onHome}>{COPY.wordmark}</button>
        <div className="header-right">
          <div className="domain-switch" role="group" aria-label={COPY.switchLabel}>
            {DOMAINS.map((d) => (
              <button key={d} type="button" className={d === domain ? 'domain-btn active' : 'domain-btn'} aria-pressed={d === domain} onClick={() => onDomain(d)}>
                {DOMAIN_COPY[d].tab}
              </button>
            ))}
          </div>
          <label className="person-switch">
            <span className="visually-hidden">{COPY.personSwitcherLabel}</span>
            <select value={person} onChange={(e) => onPerson(e.target.value)}>
              {ids.map((id) => (
                <option key={id} value={id}>{personLabel(id)}</option>
              ))}
            </select>
            <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </label>
          <button type="button" className="text-btn header-link" onClick={onSettings} ref={settingsButtonRef}>
            {COPY.settingsLabel}
          </button>
        </div>
      </div>
    </header>
  );
}
