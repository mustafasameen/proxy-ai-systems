import { useState } from 'react';
import { COPY, dc, showAll } from '../lib/copy.js';
import { summaryLine } from '../lib/workspace.js';
import MapView from './MapView.jsx';

const RECENT = 8;

function Frequent({ summary }) {
  if (!summary || !summary.length) return null;
  const max = Math.max(...summary.map((s) => s.count));
  return (
    <section className="freq">
      <h3 className="kicker">{COPY.mostFrequent}</h3>
      <ul className="plain-list">
        {summary.map((s) => (
          <li key={s.category}>
            <div className="freq-row"><span>{s.category}</span><span className="num">{s.count}</span></div>
            <div className="bar" aria-hidden="true"><span style={{ width: `${(s.count / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recent({ history, domain }) {
  const [all, setAll] = useState(false);
  if (!history || !history.length) return null;
  const items = all ? history : history.slice(0, RECENT);
  return (
    <section className="recent">
      <h3 className="kicker">{dc(domain).recent}</h3>
      <ul className="plain-list">
        {items.map((h, i) => (
          <li key={`${h.name}-${i}`}>
            <span>{h.name}</span>
            {h.category && <span className="meta"> · {h.category}</span>}
          </li>
        ))}
      </ul>
      {history.length > RECENT && (
        <button type="button" className="text-btn" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? COPY.showFewer : showAll(history.length)}
        </button>
      )}
    </section>
  );
}

export default function Context({ domain, context, rows, outline, outlineFailed, bounds }) {
  if (!context) return null;
  const history = context.history || [];
  return (
    <div className="context">
      <h2 className="kicker">{COPY.contextKicker}</h2>
      <p className="summary">{summaryLine(domain, context.history_total, context.history_summary)}</p>
      {domain === 'places' && (
        <>
          <MapView history={history} rows={rows} outline={outline} bounds={bounds} />
          {outlineFailed && <p className="meta">{COPY.mapUnavailable}</p>}
        </>
      )}
      {domain === 'shopping' && <p className="meta caption">{dc(domain).contextCaption}</p>}
      <Frequent summary={context.history_summary} />
      <Recent key={`${domain}-${history.length}-${history[0] && history[0].name}`} history={history} domain={domain} />
    </div>
  );
}
