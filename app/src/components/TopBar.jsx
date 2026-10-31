const TABS = [
  { id: 'choose', label: 'Choose for me' },
  { id: 'trust', label: 'Can I trust it?' },
];

// Wordmark, section tabs, and the replay control for stepping through choices.
export default function TopBar({
  tab,
  onTab,
  people,
  personIdx,
  onPerson,
  decisionIdx,
  decisionCount,
  onStep,
}) {
  // Arrow keys move between tabs.
  const onTabKey = (e, i) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    onTab(TABS[next].id);
    const el = document.getElementById(`tab-${TABS[next].id}`);
    if (el) el.focus();
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="wordmark">PROXY</span>
        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="main-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => onTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'choose' && (
          <div className="replay">
            <button
              type="button"
              className="btn small"
              onClick={() => onStep(-1)}
              aria-label="Previous choice"
            >
              Previous
            </button>
            <label className="visually-hidden" htmlFor="person-select">
              Person
            </label>
            <select
              id="person-select"
              className="select"
              value={personIdx}
              onChange={(e) => onPerson(Number(e.target.value))}
            >
              {people.map((p, i) => (
                <option key={p.id} value={i}>
                  {p.id}
                </option>
              ))}
            </select>
            <span className="replay-count">
              choice {decisionIdx + 1} of {decisionCount}
            </span>
            <button
              type="button"
              className="btn small"
              onClick={() => onStep(1)}
              aria-label="Next choice"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
