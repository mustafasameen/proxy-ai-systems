import { useState } from 'react';
import { COPY, KIND_HINT, SHOW_ALL_KINDS, dc, evidenceLine, showAll } from '../lib/copy.js';
import { evidence, focusKind, sameKind, summaryLine } from '../lib/workspace.js';
import MapView from './MapView.jsx';

const RECENT = 8;

function Frequent({ summary, kind, picked, onKind }) {
  if (!summary || !summary.length) return null;
  const max = Math.max(...summary.map((s) => s.count));
  return (
    <section className="freq">
      <div className="freq-head">
        <h3 className="kicker">{COPY.mostFrequent}</h3>
        {picked && <button type="button" className="text-btn" onClick={() => onKind(picked)}>{SHOW_ALL_KINDS}</button>}
      </div>
      <ul className="plain-list">
        {summary.map((s) => {
          const on = sameKind(kind, s.category);
          return (
            <li key={s.category}>
              <button type="button" className={on ? 'freq-btn is-on' : 'freq-btn'} aria-pressed={on} onClick={() => onKind(s.category)}>
                <span className="freq-row"><span>{s.category}</span><span className="num">{s.count}</span></span>
                <span className="bar" aria-hidden="true"><span style={{ width: `${(s.count / max) * 100}%` }} /></span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="meta">{KIND_HINT}</p>
    </section>
  );
}

function Evidence({ domain, history, question, kind }) {
  if (!question) return null;
  const ev = evidence(history, question);
  if (!ev) return null;
  const asked = sameKind(kind, question.category);
  return (
    <p className={asked ? 'evidence is-on' : 'evidence'} role="status">{evidenceLine(domain, ev)}</p>
  );
}

function Recent({ history, domain, kind }) {
  const [all, setAll] = useState(false);
  if (!history || !history.length) return null;
  // With a kind in focus, every matching entry is listed, so the evidence for the question is all in view.
  const matching = kind ? history.filter((h) => sameKind(h.category, kind)) : [];
  const items = all ? history : [...history.slice(0, RECENT), ...matching.filter((h) => history.indexOf(h) >= RECENT)];
  return (
    <section className="recent">
      <h3 className="kicker">{dc(domain).recent}</h3>
      <ul className="plain-list">
        {items.map((h, i) => (
          <li key={`${h.name}-${i}`} className={kind && sameKind(h.category, kind) ? 'is-on' : undefined}>
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

export default function Context({
  domain, context, rows, outline, outlineFailed, bounds, state, focus, onKind = () => {}, onOption = () => {},
}) {
  if (!context) return null;
  const history = context.history || [];
  const kind = state ? focusKind(focus, state) : null;
  const question = state && state.phase === 'question' ? state.question : null;
  return (
    <div className="context">
      <h2 className="kicker">{COPY.contextKicker}</h2>
      <p className="summary">{summaryLine(domain, context.history_total, context.history_summary)}</p>
      <Evidence domain={domain} history={history} question={question} kind={kind} />
      {domain === 'places' && (
        <>
          <MapView
            history={history}
            rows={rows}
            outline={outline}
            bounds={bounds}
            kind={kind}
            focusOption={focus ? focus.option : null}
            onOption={onOption}
          />
          {outlineFailed && <p className="meta">{COPY.mapUnavailable}</p>}
        </>
      )}
      {domain === 'shopping' && <p className="meta caption">{dc(domain).contextCaption}</p>}
      <Frequent summary={context.history_summary} kind={kind} picked={focus ? focus.kind : null} onKind={onKind} />
      <Recent key={`${domain}-${history.length}-${history[0] && history[0].name}`} history={history} domain={domain} kind={kind} />
    </div>
  );
}
