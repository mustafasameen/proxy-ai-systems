import { useWidth } from './useWidth.js';
import { pct } from '../../lib/decide.js';

const XTICKS = [0, 0.25, 0.5, 0.75, 1];

const LINES = [
  { key: 'random', label: 'At random', cls: 'ch-line random' },
  { key: 'confidence', label: 'When PROXY is least sure', cls: 'ch-line grey' },
  { key: 'voi', label: "When the question helps most (PROXY's rule)", cls: 'ch-line accent' },
];

// Right picks against the share of choices where PROXY asks, for three ways of choosing when to ask.
// The five ask settings are marked on PROXY's line and the selected one is highlighted.
export default function CurveChart({ curves, settings, selectedIdx }) {
  const [ref, width] = useWidth(640);
  const W = Math.min(width, 720);
  const m = { t: 32, r: 24, b: 48, l: 52 };
  const plotW = Math.max(W - m.l - m.r, 120);
  const plotH = Math.min(Math.max(Math.round(plotW * 0.5), 220), 300);
  const H = plotH + m.t + m.b;

  const all = LINES.flatMap((l) => curves[l.key].map((p) => p.accuracy));
  const lo = Math.floor(Math.min(...all) * 20) / 20;
  const hi = Math.ceil(Math.max(...all) * 20) / 20;
  const yTicks = [];
  for (let k = Math.round(lo * 20); k <= Math.round(hi * 20); k += 1) yTicks.push(k / 20);

  const x = (v) => m.l + v * plotW;
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const path = (pts) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ask_rate).toFixed(1)} ${y(p.accuracy).toFixed(1)}`).join(' ');

  const lastIdx = settings.length - 1;

  return (
    <figure className="chart" ref={ref}>
      <ul className="legend">
        {[...LINES].reverse().map((l) => (
          <li key={l.key}>
            <svg width="28" height="10" aria-hidden="true" focusable="false">
              <line className={l.cls} x1="0" y1="5" x2="28" y2="5" />
            </svg>
            {l.label}
          </li>
        ))}
      </ul>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Chart of right picks against the share of choices where PROXY asks, for three ways of deciding when to ask"
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={m.l} x2={m.l + plotW} y1={y(t)} y2={y(t)} />
            <text className="ch-tick" x={m.l - 8} y={y(t) + 4} textAnchor="end">
              {pct(t)}%
            </text>
          </g>
        ))}
        {XTICKS.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={x(t)} x2={x(t)} y1={m.t} y2={m.t + plotH} />
            <text className="ch-tick" x={x(t)} y={m.t + plotH + 18} textAnchor="middle">
              {pct(t)}%
            </text>
          </g>
        ))}
        <line className="ch-axis" x1={m.l} x2={m.l + plotW} y1={m.t + plotH} y2={m.t + plotH} />
        <line className="ch-axis" x1={m.l} x2={m.l} y1={m.t} y2={m.t + plotH} />
        {LINES.map((l) => (
          <path key={l.key} className={l.cls} d={path(curves[l.key])} fill="none" />
        ))}
        {settings.map((s, i) => {
          const selected = i === selectedIdx;
          const cx = x(s.ask_rate);
          const cy = y(s.accuracy);
          return (
            <g key={s.label}>
              <circle className={selected ? 'set-dot selected' : 'set-dot'} cx={cx} cy={cy} r={selected ? 6 : 4}>
                <title>{`${s.label}: asks on about ${pct(s.ask_rate)}% of choices, right ${pct(s.accuracy)}% of the time`}</title>
              </circle>
              {selected && (
                <text
                  className="set-label"
                  x={cx}
                  y={cy - 12}
                  textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
                >
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        <text className="ch-title" x={m.l + plotW / 2} y={H - 6} textAnchor="middle">
          Share of choices where PROXY asks
        </text>
        <text
          className="ch-title"
          transform={`translate(14 ${m.t + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Right picks
        </text>
      </svg>
    </figure>
  );
}
