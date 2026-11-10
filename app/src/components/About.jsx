import { COPY, evalSentences } from '../lib/copy.js';

export default function About({ config, onBack }) {
  const ev = config && config.evaluation;
  return (
    <article className="about">
      <button type="button" className="text-link back" onClick={onBack}>{COPY.back}</button>
      <h1 className="h-start">{COPY.aboutTitle}</h1>
      <section>
        <h2 className="kicker">{COPY.uses}</h2>
        <p>{COPY.usesBody}</p>
      </section>
      <section>
        <h2 className="kicker">{COPY.evaluated}</h2>
        {ev ? evalSentences(ev).map((s) => <p key={s}>{s}</p>) : <p>{COPY.configFail}</p>}
      </section>
      <section>
        <h2 className="kicker">{COPY.modelHeading}</h2>
        <p>{COPY.modelBody}</p>
      </section>
      <section>
        <h2 className="kicker">{COPY.limitsHeading}</h2>
        <ul className="plain-list">
          {COPY.limits.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>
    </article>
  );
}
