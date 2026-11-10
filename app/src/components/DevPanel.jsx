import { COPY, pct } from '../lib/copy.js';

// Charts use only numbers from /api/config.
function AccuracyBars({ ev }) {
  const rows = [
    { label: COPY.chartPickNow, value: ev.act_now_accuracy, ci: ev.act_now_ci, blue: true },
    { label: COPY.chartAlwaysAsk, value: ev.always_ask_accuracy, ci: ev.always_ask_ci, blue: true },
  ];
  return (
    <figure className="chart">
      <figcaption className="meta">{COPY.chartBarsCaption}</figcaption>
      <svg viewBox="0 0 320 70" role="img" aria-label={COPY.chartBarsLabel}>
        {rows.map((r, i) => {
          const y = 8 + i * 30;
          const lo = Array.isArray(r.ci) ? r.ci[0] : null;
          const hi = Array.isArray(r.ci) ? r.ci[1] : null;
          return (
            <g key={r.label}>
              <rect x="120" y={y} width="190" height="14" className="chart-track" />
              <rect x="120" y={y} width={190 * r.value} height="14" className="chart-blue" />
              {lo !== null && <line x1={120 + 190 * lo} x2={120 + 190 * hi} y1={y + 7} y2={y + 7} className="chart-ci" />}
              <text x="114" y={y + 11} textAnchor="end" className="chart-text">{r.label}</text>
              <text x={120 + 190 * (hi !== null ? hi : r.value) + 4} y={y + 11} className="chart-text">{pct(r.value)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function SettingsCurve({ settings }) {
  const pts = [...settings].sort((a, b) => a.ask_rate - b.ask_rate);
  const x = (v) => 30 + v * 270;
  const y = (v) => 110 - v * 100;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ask_rate)} ${y(p.accuracy)}`).join(' ');
  return (
    <figure className="chart">
      <figcaption className="meta">{COPY.chartCurveCaption}</figcaption>
      <svg viewBox="0 0 320 130" role="img" aria-label={COPY.chartCurveLabel}>
        <line x1="30" x2="300" y1="110" y2="110" className="chart-axis" />
        <line x1="30" x2="30" y1="10" y2="110" className="chart-axis" />
        <path d={path} className="chart-line" fill="none" />
        {pts.map((p) => (
          <g key={p.label}>
            <circle cx={x(p.ask_rate)} cy={y(p.accuracy)} r="3" className="chart-blue" />
            <text x={x(p.ask_rate)} y={y(p.accuracy) - 7} textAnchor="middle" className="chart-text">{pct(p.accuracy)}</text>
          </g>
        ))}
        <text x="30" y="125" className="chart-text">{COPY.chartAsksLess}</text>
        <text x="300" y="125" textAnchor="end" className="chart-text">{COPY.chartAsksMore}</text>
      </svg>
    </figure>
  );
}

export default function DevPanel({ response, setting, config, revealed, onReveal }) {
  const ev = config && config.evaluation;
  const lat = ev && ev.latency_s;
  return (
    <section className="dev" aria-label={COPY.devHeading}>
      <h2 className="kicker">{COPY.devHeading}</h2>
      {response && (
        <dl className="mono">
          <div><dt>request id</dt><dd>{response.request_id}</dd></div>
          <div><dt>model</dt><dd>{response.model}</dd></div>
          <div><dt>model latency</dt><dd>{Number(response.model_latency_s).toFixed(2)} s</dd></div>
          <div><dt>cached</dt><dd>{String(response.cached)}</dd></div>
          <div><dt>setting</dt><dd>{setting}</dd></div>
          {revealed && <div><dt>real choice</dt><dd>{revealed.name}</dd></div>}
        </dl>
      )}
      {response && !revealed && (
        <button type="button" className="secondary-btn" onClick={onReveal}>{COPY.revealButton}</button>
      )}
      {ev && (
        <>
          <h3 className="kicker dev-sub">{COPY.trustHeading}</h3>
          <AccuracyBars ev={ev} />
          {config.settings.length > 1 && <SettingsCurve settings={config.settings} />}
          <dl className="mono">
            {typeof ev.ece === 'number' && <div><dt>calibration error</dt><dd>{ev.ece.toFixed(3)}</dd></div>}
            {lat && (
              <div>
                <dt>latency p50, p90, max</dt>
                <dd>{Number(lat.p50).toFixed(2)}, {Number(lat.p90).toFixed(2)}, {Number(lat.max).toFixed(2)} s over {lat.n} calls</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </section>
  );
}
