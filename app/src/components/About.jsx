import { COPY, dc, evalSentences } from '../lib/copy.js';

export default function About({ domain, config, onBack }) {
  const ev = config && config.evaluation;
  const d = dc(domain);
  return (
    <article className="about">
      <button type="button" className="text-link back" onClick={onBack}>{COPY.back}</button>
      <h1 className="h-start">{COPY.aboutTitle}</h1>
      <section>
        <h2 className="kicker">{COPY.uses}</h2>
        <p>{d.usesBody}</p>
      </section>
      <section>
        <h2 className="kicker">{COPY.evaluated}</h2>
        {ev ? evalSentences(ev).map((s) => <p key={s}>{s}</p>) : <p>{COPY.configFail}</p>}
      </section>
      <section>
        <h2 className="kicker">{COPY.modelHeading}</h2>
        <p>{d.modelBody}</p>
      </section>
      <section>
        <h2 className="kicker">{COPY.limitsHeading}</h2>
        <ul className="plain-list">
          {d.limits.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>
    </article>
  );
}
