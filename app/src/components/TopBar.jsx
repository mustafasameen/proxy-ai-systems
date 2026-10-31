import AccountMenu from './AccountMenu.jsx';

// Wordmark, the Places and Shopping switch, the demo account chip and the settings button.
// domains is [{ key, label }]. The switch is left out when there is only one domain.
export default function TopBar({
  domains,
  domain,
  onDomain,
  people,
  personIdx,
  onPerson,
  onSettings,
}) {
  return (
    <header className="topbar">
      <div className="column topbar-inner">
        <span className="wordmark">PROXY</span>
        {domains.length > 1 && (
          <div className="domain" role="group" aria-label="What PROXY finds for you">
            {domains.map((d) => (
              <button
                key={d.key}
                type="button"
                className="domain-btn"
                aria-pressed={d.key === domain}
                onClick={() => onDomain(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        <AccountMenu people={people} personIdx={personIdx} onPerson={onPerson} />
        <button type="button" className="icon-btn settings-btn" aria-label="Settings" onClick={onSettings}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M10.73 4.71L11.06 2.04L12.94 2.04L13.27 4.71A7.4 7.4 0 0 1 16.26 5.95L18.37 4.29L19.71 5.63L18.05 7.74A7.4 7.4 0 0 1 19.29 10.73L21.96 11.06L21.96 12.94L19.29 13.27A7.4 7.4 0 0 1 18.05 16.26L19.71 18.37L18.37 19.71L16.26 18.05A7.4 7.4 0 0 1 13.27 19.29L12.94 21.96L11.06 21.96L10.73 19.29A7.4 7.4 0 0 1 7.74 18.05L5.63 19.71L4.29 18.37L5.95 16.26A7.4 7.4 0 0 1 4.71 13.27L2.04 12.94L2.04 11.06L4.71 10.73A7.4 7.4 0 0 1 5.95 7.74L4.29 5.63L5.63 4.29L7.74 5.95A7.4 7.4 0 0 1 10.73 4.71Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  );
}
