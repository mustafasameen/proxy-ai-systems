import { useWidth } from './useWidth.js';
import { pct } from '../../lib/decide.js';
import { fmtCount } from '../../lib/format.js';

const TICKS = [0, 0.25, 0.5, 0.75, 1];

// Reliability chart: PROXY's confidence against how often it was right, one dot per bin.
// A dashed diagonal marks a perfectly honest confidence.
export default function ReliabilityChart({ bins }) {
  const [ref, width] = useWidth(520);
  const W = Math.min(width, 560);
  const m = { t: 12, r: 16, b: 48, l: 52 };
  const plotW = Math.max(W - m.l - m.r, 120);
  const plotH = Math.min(Math.round(plotW * 0.8), 320);
  const H = plotH + m.t + m.b;
  const x = (v) => m.l + v * plotW;
  const y = (v) => m.t + (1 - v) * plotH;
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const radius = (n) => 5 + 9 * Math.sqrt(n / maxN);

  return (
    <figure className="chart" ref={ref}>
      <ul className="legend">
        <li>
          <svg width="28" height="10" aria-hidden="true" focusable="false">
            <line className="ch-diag" x1="0" y1="5" x2="28" y2="5" />
          </svg>
          Perfectly honest
        </li>
        <li>
          <svg width="14" height="14" aria-hidden="true" focusable="false">
            <circle className="rel-dot" cx="7" cy="7" r="6" />
          </svg>
          A group of choices with similar confidence, sized by how many
        </li>
      </ul>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Chart of PROXY's confidence against how often it was right, by confidence group"
      >
        {TICKS.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={m.l} x2={m.l + plotW} y1={y(t)} y2={y(t)} />
            <line className="ch-grid" x1={x(t)} x2={x(t)} y1={m.t} y2={m.t + plotH} />
            <text className="ch-tick" x={m.l - 8} y={y(t) + 4} textAnchor="end">
              {pct(t)}%
            </text>
            <text className="ch-tick" x={x(t)} y={m.t + plotH + 18} textAnchor="middle">
              {pct(t)}%
            </text>
          </g>
        ))}
        <line className="ch-axis" x1={m.l} x2={m.l + plotW} y1={m.t + plotH} y2={m.t + plotH} />
        <line className="ch-axis" x1={m.l} x2={m.l} y1={m.t} y2={m.t + plotH} />
        <line className="ch-diag" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
        {bins.map((b) => (
          <circle
            key={b.lo}
            className="rel-dot"
            cx={x(b.confidence)}
            cy={y(b.accuracy)}
            r={radius(b.n)}
          >
            <title>
              {`Sure about ${pct(b.confidence)}%, right ${pct(b.accuracy)}% of the time (${fmtCount(b.n)} choices)`}
            </title>
          </circle>
        ))}
        <text
          className="ch-title"
          x={m.l + plotW / 2}
          y={H - 6}
          textAnchor="middle"
        >
          PROXY's confidence
        </text>
        <text
          className="ch-title"
          transform={`translate(14 ${m.t + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          How often right
        </text>
      </svg>
    </figure>
  );
}
