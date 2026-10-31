import { useEffect, useId, useRef, useState } from 'react';

// The demo account chip. It opens a short list of people to try PROXY as.
// A disclosure with real buttons: Escape, a click outside or tabbing away closes it.
export default function AccountMenu({ people, personIdx, onPerson }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const chipRef = useRef(null);
  const menuId = useId();
  const person = people[personIdx] || people[0];

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => rootRef.current && !rootRef.current.contains(e.target);
    const onPointer = (e) => {
      if (outside(e)) setOpen(false);
    };
    const onFocusIn = (e) => {
      if (outside(e)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (chipRef.current) chipRef.current.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (i) => {
    onPerson(i);
    setOpen(false);
    if (chipRef.current) chipRef.current.focus();
  };

  return (
    <div className="account" ref={rootRef}>
      <button
        type="button"
        className="acct-chip"
        ref={chipRef}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="acct-text">Demo account: {person.id}</span>
        <svg className="acct-caret" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2 4.25 6 8.25l4-4" />
        </svg>
      </button>
      <div className="menu" id={menuId} hidden={!open}>
        <p className="menu-note">Real, anonymized histories. Pick one to try PROXY as that person.</p>
        <div className="person-grid">
          {people.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="person-btn"
              aria-current={i === personIdx ? 'true' : undefined}
              onClick={() => choose(i)}
            >
              {p.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
