import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASES, buildBeats, beatMs, nouns, pct } from './beats.js';
import { Person, ProxyFace } from './Avatars.jsx';
import './story.css';

const LETTERS = 'ABCDE';
const PERSON_LOOK = { 'question-helps': 0, 'no-question': 1, 'honest-miss': 3, shopping: 2 };

function useStories() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/data/stories.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setData(d); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return { data, failed };
}

function Header({ stories, current, go }) {
  return (
    <header className="s-header">
      <a className="s-wordmark" href="#/">PROXY</a>
      <nav className="s-tabs" aria-label="Stories">
        {stories.map((s) => (
          <a key={s.id} href={`#/story/${s.id}`} className={current === s.id ? 'on' : ''} aria-current={current === s.id ? 'page' : undefined}>{s.tab}</a>
        ))}
      </nav>
      <a className="s-try" href="#/workspace" onClick={() => go && go('workspace')}>Try it yourself</a>
    </header>
  );
}

function Landing({ data }) {
  const e = data.evaluation.places;
  // The hero shows the first story's own question and answer, so the picture is a real exchange, not an invented one.
  const first = data.stories[0];
  const ex = first.policies['When unsure'];
  return (
    <main className="s-landing">
      <div className="s-hero">
        <div>
          <h1>PROXY</h1>
          <p className="s-lede">An assistant that picks a new place for you. When it is unsure, it asks you one yes/no question first.</p>
        </div>
        {ex.asked ? (
          <figure className="s-cast" aria-label={`Example from the first story: PROXY asks "${ex.question.text}" and ${first.person} answers ${ex.answer}.`}>
            <div className="s-cast-row">
              <ProxyFace look={1} size={56} />
              <p className="s-cast-say">{ex.question.text}</p>
            </div>
            <div className="s-cast-row them">
              <p className="s-cast-say them">{ex.answer === 'yes' ? 'Yes.' : 'No.'}</p>
              <Person index={PERSON_LOOK[first.id] ?? 0} mouth="smile" size={60} />
            </div>
          </figure>
        ) : null}
      </div>
      <ul className="s-list">
        {data.stories.map((s) => (
          <li key={s.id}>
            <a href={`#/story/${s.id}`}>
              <span className="s-list-name">{s.tab}</span>
              <span className="s-list-pitch">{s.pitch}</span>
            </a>
          </li>
        ))}
        <li>
          <a href="#/workspace">
            <span className="s-list-name">Try it yourself</span>
            <span className="s-list-pitch">Pick any of 12 people and answer PROXY's question yourself.</span>
          </a>
        </li>
      </ul>
      <div className="s-eval" aria-label="How often PROXY is right">
        <p className="s-eval-head">How often is it right? On {e.rows.toLocaleString()} decisions by {e.people} people it never saw:</p>
        <div className="s-eval-row">
          {data.policies.map((k) => (
            <div key={k} className={`s-eval-cell ${k === 'When unsure' ? 'hi' : ''}`}>
              <span className="s-eval-num">{pct(e.policies[k])}</span>
              <span className="s-eval-lab">{k}{k === 'When unsure' ? ` (asks ${pct(e.ask_rate[k])} of the time)` : ''}</span>
            </div>
          ))}
          <div className="s-eval-cell muted">
            <span className="s-eval-num">{pct(e.chance)}</span>
            <span className="s-eval-lab">Random pick</span>
          </div>
        </div>
      </div>
      <p className="s-fine">Replays of saved decisions from real New York check-ins and Amazon purchases. Scores are a fine-tuned Llama 3.1 8B's saved scores; no model is called here. Answers to PROXY's question are simulated from what each person really chose.</p>
    </main>
  );
}

function Stepper({ phase, skipped }) {
  const at = PHASES.findIndex((p) => p.key === phase);
  return (
    <ol className="s-phases" aria-label="Steps">
      {PHASES.map((p, i) => (
        <li key={p.key} className={`${i === at ? 'on' : ''} ${i < at ? 'done' : ''} ${p.key === 'ask' && skipped ? 'skipped' : ''}`} aria-current={i === at ? 'step' : undefined}>
          <span className="s-phase-num">{i + 1}</span>{p.label}{p.key === 'ask' && skipped ? <span className="s-skip"> skipped</span> : null}
        </li>
      ))}
    </ol>
  );
}

function Bubble({ beat, side }) {
  if (!beat) return null;
  return (
    <div className={`s-bubble ${side}`} key={beat.text} role="status">
      <p className="s-bubble-text">{beat.text}</p>
      {beat.note ? <p className="s-bubble-note">{beat.note}</p> : null}
    </div>
  );
}

function Options({ story, policy, show }) {
  const p = story.policies[policy];
  const probs = show.answered ? p.after : story.options.map((o) => o.prob);
  return (
    <ol className={`s-options ${show.options ? 'in' : ''}`} aria-label="Five options">
      {story.options.map((o, i) => {
        const out = show.answered && p.ruled_out.includes(i);
        const picked = show.pick && i === p.pick;
        const real = show.reveal && i === story.truth;
        return (
          <li key={i} className={`s-opt ${out ? 's-is-out' : ''} ${picked ? 's-is-picked' : ''} ${real ? 's-is-real' : ''}`} style={{ transitionDelay: show.options && !show.bars ? `${i * 120}ms` : '0ms' }}>
            <span className="s-opt-letter">{LETTERS[i]}</span>
            <span className="s-opt-main">
              <span className="s-opt-name">{o.name}</span>
              <span className="s-opt-kind">{o.category}</span>
            </span>
            <span className="s-opt-tags">
              {picked ? <span className="s-tag pick"><i aria-hidden="true" />PROXY's pick</span> : null}
              {real ? <span className="s-tag real"><i aria-hidden="true" />Real choice</span> : null}
              {out ? <span className="s-tag out">ruled out</span> : null}
            </span>
            <span className={`s-bar ${show.bars ? 'in' : ''}`} aria-hidden={!show.bars}>
              <span className="s-bar-fill" style={{ transform: `scaleX(${show.bars ? probs[i] : 0})` }} />
              <span className="s-bar-num">{show.bars ? pct(probs[i]) : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Transport({ step, max, playing, speed, onPlay, onBack, onNext, onSeek, onSpeed, beats }) {
  return (
    <div className="s-transport" role="group" aria-label="Replay controls">
      <button type="button" className="s-btn primary" onClick={onPlay}>{playing ? 'Pause' : step >= max ? 'Replay' : 'Play'}</button>
      <button type="button" className="s-btn" onClick={onBack} disabled={step <= 0}>Back</button>
      <button type="button" className="s-btn" onClick={onNext} disabled={step >= max}>Next</button>
      <div className="s-scrub">
        <div className="s-scrub-line" />
        <div className="s-scrub-fill" style={{ transform: `scaleX(${max ? step / max : 0})` }} />
        <div className="s-scrub-marks" aria-hidden="true">
          {beats.map((b, i) => (i === 0 || beats[i - 1].phase !== b.phase ? <span key={i} style={{ left: `${(max ? i / max : 0) * 100}%` }} /> : null))}
        </div>
        <input type="range" min={0} max={max} step={1} value={step} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Position in replay" aria-valuetext={`Step ${step + 1} of ${max + 1}`} />
      </div>
      <span className="s-pos">{step + 1} / {max + 1}</span>
      <div className="s-seg" role="group" aria-label="Speed">
        {[1, 2].map((s) => <button type="button" key={s} aria-pressed={speed === s} onClick={() => onSpeed(s)}>{s}x</button>)}
      </div>
    </div>
  );
}

function Player({ data, story }) {
  const [policy, setPolicy] = useState('When unsure');
  const beats = useMemo(() => buildBeats(story, policy), [story, policy]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const timer = useRef(null);
  const max = beats.length - 1;
  useEffect(() => { setStep(0); setPlaying(true); }, [story.id, policy]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing) return undefined;
    if (step >= max) { setPlaying(false); return undefined; }
    timer.current = setTimeout(() => setStep((s) => Math.min(max, s + 1)), beatMs(beats[step]) / speed);
    return () => clearTimeout(timer.current);
  }, [playing, step, max, speed, beats]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === ' ' && e.target && /^(button|a)$/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { setPlaying(false); setStep((s) => Math.min(max, s + 1)); }
      if (e.key === 'ArrowLeft') { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }
      if (e.key === ' ') { e.preventDefault(); setPlaying((x) => !x); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [max]);

  const beat = beats[step];
  const show = beat.show;
  const p = story.policies[policy];
  const n = nouns(story.domain);
  const personSpeaks = beat.speaker === 'person';
  const proxySpeaks = beat.speaker === 'proxy';
  const look = PERSON_LOOK[story.id] ?? 0;
  const verdict = show.reveal ? (p.correct ? 'right' : 'wrong') : null;
  let lastProxy = null;
  for (let i = step - 1; i >= 0 && !proxySpeaks; i--) {
    if (beats[i].speaker === 'proxy') { lastProxy = beats[i]; break; }
  }

  return (
    <main className="s-player">
      <div className="s-titlebar">
        <div>
          <h1 className="s-title">{story.title}</h1>
          <p className="s-label">{story.domain === 'places' ? 'New York check-ins' : 'Amazon video-game purchases'} · replay of saved scores · the answer is simulated from the real choice</p>
        </div>
        <div className="s-policy" role="group" aria-label="When PROXY may ask">
          <span className="s-policy-lab">When PROXY may ask</span>
          <div className="s-seg">
            {data.policies.map((k) => (
              <button type="button" key={k} aria-pressed={policy === k} onClick={() => setPolicy(k)}>{k}</button>
            ))}
          </div>
        </div>
      </div>
      <Stepper phase={beat.phase} skipped={!p.asked && PHASES.findIndex((x) => x.key === beat.phase) >= 2} />

      <div className="s-stage">
        <section className={`s-col s-person ${personSpeaks ? 'speaking' : ''}`} aria-label={story.person}>
          <div className="s-who">
            <Person index={look} mouth={personSpeaks ? 'open' : show.reveal && p.correct ? 'smile' : 'neutral'} />
            <div>
              <p className="s-who-name">{story.person}</p>
              <p className="s-who-sub">{story.domain === 'places' ? 'New York' : 'Video games on Amazon'}</p>
            </div>
          </div>
          {personSpeaks ? <Bubble beat={beat} side="from-person" /> : null}
          <div className={`s-history ${show.kinds ? 'in' : ''}`}>
            <p className="s-h-head">Last {story.history_total} {n.history}: most frequent</p>
            <ul className="s-kinds">
              {story.history_kinds.map((k) => <li key={k.category}>{k.category} <b>{k.count}</b></li>)}
            </ul>
            <p className="s-h-head">Most recent</p>
            <ul className="s-recent">
              {story.recent.map((r, i) => <li key={i}><span>{r.name}</span>{r.category && r.category !== r.name ? <em> · {r.category}</em> : null}</li>)}
            </ul>
          </div>
        </section>

        <section className="s-col s-proxy" aria-label="PROXY">
          <div className="s-proxy-head">
            <ProxyFace look={personSpeaks ? -1 : show.options ? 1 : -1} thinking={proxySpeaks && beat.phase === 'options'} />
            {show.reveal ? (
              <div className={`s-reveal ${verdict}`} role="status">
                <p className="s-reveal-head">{beat.text}</p>
                <p className="s-reveal-verdict">
                  <svg className="s-verdict-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <circle cx="9" cy="9" r="9" />
                    {p.correct ? <path d="M5 9.4l2.6 2.6L13 6.6" /> : <path d="M6 6l6 6M12 6l-6 6" />}
                  </svg>
                  {p.correct ? 'PROXY was right.' : 'PROXY was wrong.'}
                </p>
                {beat.note ? <p className="s-reveal-note">{beat.note}</p> : null}
              </div>
            ) : proxySpeaks ? <Bubble beat={beat} side="from-proxy" />
              : lastProxy ? <Bubble beat={lastProxy} side="from-proxy dim" /> : <div className="s-bubble-space" />}
          </div>
          <Options story={story} policy={policy} show={show} />
          {show.reveal ? (
            <div className="s-after">
              <p className="s-reveal-next">
                {policy === 'When unsure' ? 'Try "Never ask" or "Always ask" above to replay this same decision. ' : ''}
                <a href="#/">More stories</a>
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <Transport
        step={step} max={max} playing={playing} speed={speed} beats={beats}
        onPlay={() => { if (step >= max) { setStep(0); setPlaying(true); } else setPlaying((x) => !x); }}
        onBack={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }}
        onNext={() => { setPlaying(false); setStep((s) => Math.min(max, s + 1)); }}
        onSeek={(v) => { setPlaying(false); setStep(v); }}
        onSpeed={setSpeed}
      />
    </main>
  );
}

export default function StoryApp({ route }) {
  const { data, failed } = useStories();
  if (failed) return <main className="s-landing"><p>The stories could not be loaded. Reload the page.</p></main>;
  if (!data) return <main className="s-landing" aria-busy="true" />;
  const story = route.startsWith('story/') ? data.stories.find((s) => s.id === route.slice(6)) : null;
  return (
    <div className="s-app">
      <Header stories={data.stories} current={story ? story.id : null} />
      {story ? <Player key={story.id} data={data} story={story} /> : <Landing data={data} />}
    </div>
  );
}
