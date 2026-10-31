import { askRatePhrase, outOfTen, pct } from '../lib/decide.js';
import { RECOMMENDED_IDX } from '../lib/copy.js';
import { fmtCount } from '../lib/format.js';

// The user-facing About page: how often PROXY is right, when it is unsure, what it cannot do yet.
// The three numbers come from the summary of the dataset on screen.
export default function AboutPage({ about, summary, dev, onBack, onEvaluation }) {
  const settings = summary.settings || [];
  const recommended = settings[Math.min(RECOMMENDED_IDX, settings.length - 1)];

  const figures = [
    { key: 'alone', value: summary.act_now_accuracy, caption: 'On its own' },
    { key: 'asked', value: summary.always_ask_accuracy, caption: 'After one question' },
    recommended && {
      key: 'rec',
      value: recommended.accuracy,
      caption: 'At the recommended setting',
    },
  ].filter((f) => f && typeof f.value === 'number');

  const basis =
    about.n_decisions && about.n_people
      ? ` Measured on ${fmtCount(about.n_decisions)} real choices from ${fmtCount(about.n_people)} people, kept aside for testing.`
      : '';
  const guess =
    typeof summary.chance === 'number'
      ? ` A random guess would be right about ${outOfTen(summary.chance)} in 10 times.`
      : '';

  const limits = Array.isArray(about.limitations)
    ? about.limitations.filter((s) => typeof s === 'string' && s.trim()).slice(0, 4)
    : [];

  return (
    <article className="about">
      <button type="button" className="link back" onClick={onBack}>
        <svg className="back-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M7.75 2 3.75 6l4 4" />
        </svg>
        Back
      </button>
      <h1 className="page-title" data-page-heading="true" tabIndex={-1}>
        How well does PROXY work?
      </h1>

      <section className="about-sec" aria-labelledby="about-right">
        <h2 id="about-right">How often is PROXY right?</h2>
        <ul className="big-numbers">
          {figures.map((f) => (
            <li key={f.key} className="big-item">
              <span className="big">{pct(f.value)}%</span>
              <span className="big-cap">{f.caption}</span>
            </li>
          ))}
        </ul>
        <p className="about-note">
          Right means the pick matched what the person actually chose.{basis}
          {guess}
        </p>
      </section>

      <section className="about-sec" aria-labelledby="about-unsure">
        <h2 id="about-unsure">When is it unsure?</h2>
        <p>
          PROXY asks you a quick question when your answer is likely to improve its pick, which at
          the recommended setting is {askRatePhrase(recommended ? recommended.ask_rate : null)}.
        </p>
      </section>

      {limits.length > 0 && (
        <section className="about-sec" aria-labelledby="about-limits">
          <h2 id="about-limits">What it can&apos;t do yet</h2>
          <ul className="limits">
            {limits.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="attrib">Data: {about.data}</p>

      {dev && (
        <div className="about-dev">
          <button type="button" className="btn" onClick={onEvaluation}>
            Detailed evaluation
          </button>
        </div>
      )}
    </article>
  );
}
