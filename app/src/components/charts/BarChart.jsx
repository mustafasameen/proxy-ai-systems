import { pct } from '../../lib/decide.js';

// Horizontal bars on a 0 to 100% scale. Each row has a label, a drawn bar and a value.
// rows: [{ label, value, accent }]
export default function BarChart({ rows, caption }) {
  return (
    <figure className="chart">
      {caption && <figcaption className="chart-caption">{caption}</figcaption>}
      <ul className="bars">
        {rows.map((r) => (
          <li key={r.label} className="bar-row">
            <span className="bar-label">{r.label}</span>
            <svg
              className="bar-svg"
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              <rect className="bar-track" x="0" y="0" width="100" height="10" />
              <rect
                className={r.accent ? 'bar-fill accent' : 'bar-fill'}
                x="0"
                y="0"
                width={Math.max(0, Math.min(1, r.value)) * 100}
                height="10"
              />
            </svg>
            <span className="bar-value">{pct(r.value)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
