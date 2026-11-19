// Turns one saved decision (from stories.json) into the replay's beats under one question policy.
// A beat is one thing happening on screen: who speaks, what they say, and which parts of the stage are visible.

export const PHASES = [
  { key: 'context', label: 'Context' },
  { key: 'options', label: 'Options' },
  { key: 'ask', label: 'Ask' },
  { key: 'pick', label: 'Pick' },
  { key: 'reveal', label: 'Reveal' },
];

const NOUNS = {
  places: { next: 'a new place to go', history: 'places', option: 'places', never: 'has never been to', did: 'went to' },
  shopping: { next: 'the next thing to buy', history: 'purchases', option: 'products', never: 'has never bought', did: 'bought' },
};

export const pct = (x) => `${Math.round(x * 100)}%`;
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const end = (s) => (/[.…!?]$/.test(s) ? s : `${s}.`);
const pts = (x) => Math.round(x * 100);

export function nouns(domain) {
  return NOUNS[domain] || NOUNS.places;
}

export function buildBeats(story, policyName) {
  const p = story.policies[policyName];
  const n = nouns(story.domain);
  const who = story.person;
  const opt = (i) => story.options[i].name;
  const order = story.options.map((o, i) => i).sort((a, b) => story.options[b].prob - story.options[a].prob);
  const lean = p.lean;
  const second = order.find((i) => i !== lean);
  const beats = [];
  const add = (phase, speaker, text, note, show) => beats.push({ phase, speaker, text, note: note || null, show });

  const base = { kinds: false, options: false, bars: false, answered: false, pick: false, reveal: false };
  add('context', 'proxy', `I'm PROXY. I'll pick ${n.next} for ${who}.`, null, { ...base });
  add('context', 'proxy', `I can see ${who}'s last ${story.history_total} ${n.history}.`,
    story.domain === 'places'
      ? 'Only the names and kinds of places. No locations, no times, no map.'
      : 'Only product names and brands.',
    { ...base, kinds: true });
  add('options', 'proxy', `Here are five ${n.option} ${who} ${n.never}.`, null, { ...base, kinds: true, options: true });

  const close = story.options[lean].prob - story.options[second].prob < 0.15;
  add('options', 'proxy',
    `My first guess is ${opt(lean)} (${pct(story.options[lean].prob)}).${close ? ` ${opt(second)} is close behind (${pct(story.options[second].prob)}).` : ''}`,
    'The bars show how likely PROXY thinks each option is.',
    { ...base, kinds: true, options: true, bars: true });

  const shown = { ...base, kinds: true, options: true, bars: true };
  if (!p.asked) {
    if (policyName === 'Never ask') {
      add('ask', 'proxy', 'This setting never lets me ask, so I pick right away.', null, shown);
    } else {
      add('ask', 'proxy', `I'm sure enough, so I won't bother ${who} with a question.`,
        p.gain == null ? null : `I expect a question to raise my chance of being right by only ${pts(p.gain)} points. "When unsure" asks when it would add ${pts(p.tau)} or more.`,
        shown);
    }
  } else {
    add('ask', 'proxy', p.ask_all
      ? `This setting always lets me ask, so I'll ask one question first: "${p.question.text}"`
      : `I'm not sure, so I'll ask one question first: "${p.question.text}"`,
    p.ask_all ? null
      : `I expect the answer to raise my chance of being right by ${pts(p.gain)} points. "When unsure" asks when it would add ${pts(p.tau)} or more.`,
    shown);
    add('ask', 'person', p.answer === 'yes' ? 'Yes.' : 'No.',
      `Simulated: the answer that matches what ${who} really chose.`, shown);
    const k = p.ruled_out.length;
    add('ask', 'proxy', `That rules out ${WORDS[k]} of the five. ${p.left === 1 ? 'One is left.' : `${cap(WORDS[p.left])} are left.`}`, null,
      { ...shown, answered: true });
  }

  const after = { ...shown, answered: p.asked };
  const track = p.track ? ` Picks at this confidence were right about ${p.track.out_of_10} in 10 times for people PROXY never saw.` : '';
  add('pick', 'proxy', end(`I pick ${opt(p.pick)}`), `${story.options[p.pick].reason || ''}${track}`.trim(), { ...after, pick: true });

  let compare = null;
  if (p.asked && lean !== p.pick) {
    compare = `Without the question, PROXY would have picked ${opt(lean)}, which was ${lean === story.truth ? 'also right' : 'wrong'}.`;
  } else if (!p.asked && policyName !== 'Always ask') {
    const a = story.policies['Always ask'];
    compare = a.pick !== p.pick
      ? `With "Always ask", PROXY would have asked "${a.question.text}" and picked ${opt(a.pick)}, which was ${a.correct ? 'right' : 'also wrong'}.`
      : `With "Always ask", PROXY would have asked "${a.question.text}" and still picked ${opt(a.pick)}.`;
  }
  if (!p.correct && p.track) {
    compare = `${compare ? `${compare} ` : ''}Picks at this confidence are right about ${p.track.out_of_10} in 10 times. This was one of the other ${10 - p.track.out_of_10}.`;
  }
  add('reveal', null, `What ${who} actually ${n.did}: ${opt(story.truth)}`, compare, { ...after, pick: true, reveal: true });
  return beats;
}

// How long a beat stays on screen at 1x: long enough to read it.
export function beatMs(beat) {
  const chars = (beat.text || '').length + (beat.note || '').length * 0.6;
  return Math.max(2600, Math.min(6500, 1400 + chars * 38));
}
