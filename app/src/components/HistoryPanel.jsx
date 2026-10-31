import { useState } from 'react';
import { isUnnamed, placeName } from '../lib/format.js';

const SHOWN = 10;

// The person's recent places (most recent first) and the kinds of place they go to most.
export default function HistoryPanel({ history, topCategories }) {
  const [showAll, setShowAll] = useState(false);
  const recent = [...history].reverse();
  const rows = showAll ? recent : recent.slice(0, SHOWN);

  return (
    <section className="card" aria-labelledby="know-heading">
      <h2 className="label" id="know-heading">
        What PROXY knows
      </h2>
      <h3 className="sub">Recent places</h3>
      <ol className="history">
        {rows.map((p, i) => (
          <li key={i}>
            <span className="h-name">{placeName(p)}</span>
            {!isUnnamed(p) && <span className="h-cat">{p.category}</span>}
          </li>
        ))}
      </ol>
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
      <h3 className="sub spaced">Goes most often to</h3>
      <ul className="chips">
        {topCategories.map((c) => (
          <li key={c} className="chip">
            {c}
          </li>
        ))}
      </ul>
      <p className="muted small spaced">
        PROXY sees only this list: no location, no ratings, no other people's data.
      </p>
    </section>
  );
}
