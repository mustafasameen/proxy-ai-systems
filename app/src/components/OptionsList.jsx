import { isUnnamed, placeName, probLabel } from '../lib/format.js';

// The request and the five new places, with a bar for each option's current probability.
export default function OptionsList({ candidates, probs, topIdx, answered, wentIdx }) {
  return (
    <section className="card" aria-labelledby="options-heading">
      <p className="request">Find me somewhere I haven't been.</p>
      <h2 className="label" id="options-heading">
        Five new places
      </h2>
      <ul className="options">
        {candidates.map((c, i) => {
          const p = probs[i] ?? 0;
          const out = answered && p === 0;
          const classes = ['opt'];
          if (out) classes.push('out');
          if (i === topIdx) classes.push('top');
          return (
            <li key={i} className={classes.join(' ')}>
              <div className="opt-head">
                <span className="opt-name fade">{placeName(c)}</span>
                {wentIdx === i && <span className="marker">They went here</span>}
              </div>
              {!isUnnamed(c) && <div className="opt-cat fade">{c.category}</div>}
              <div className="opt-bar fade">
                <div className="bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(p * 1000) / 10}%` }} />
                </div>
                <span className="pctnum">{probLabel(p)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
