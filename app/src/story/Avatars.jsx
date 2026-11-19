// Drawn characters for the replay, adapted from the LEMMA demo's busts (same drawing, no animation library).
const FEATURE = '#2b2320';
const SKINS = ['#F2CFB0', '#E3AE82', '#C98F63', '#A97248', '#8A5A3B', '#6B4430'];
const HAIR = { black: '#1d1816', dark: '#2f2119', brown: '#5b3b27', auburn: '#7d3f24', blond: '#b98d4d' };
const SHIRTS = ['#E69F00', '#56B4E9', '#009E73', '#CC79A7', '#999999'];
const LOOKS = [
  { skin: 1, shape: 'long', color: 'dark' },
  { skin: 3, shape: 'short', color: 'black' },
  { skin: 4, shape: 'curly', color: 'black' },
  { skin: 0, shape: 'bun', color: 'auburn' },
  { skin: 2, shape: 'sidepart', color: 'blond' },
];

function Hair({ shape, fill }) {
  const edge = { fill, stroke: 'rgba(0,0,0,0.35)', strokeWidth: 1.2, strokeLinejoin: 'round' };
  switch (shape) {
    case 'short':
      return <path {...edge} d="M23 30 C21 9 31 7 40 7 C49 7 59 9 57 30 C54 22 50 19 40 19 C30 19 26 22 23 30 Z" />;
    case 'sidepart':
      return <path {...edge} d="M22 33 C18 9 34 4 45 7 C60 10 61 23 57 33 C56 25 50 17 41 16 C33 20 26 25 22 33 Z" />;
    case 'long':
      return <path {...edge} d="M22 36 C17 8 32 5 40 5 C48 5 63 8 58 36 L60 56 C56 60 52 57 52 52 L52 31 C50 22 46 19 40 19 C34 19 30 22 28 31 L28 52 C28 57 24 60 20 56 Z" />;
    case 'bun':
      return (
        <g>
          <circle {...edge} cx="40" cy="1" r="8" />
          <path {...edge} d="M23 30 C21 9 31 6 40 6 C49 6 59 9 57 30 C54 22 50 19 40 19 C30 19 26 22 23 30 Z" />
        </g>
      );
    case 'curly':
      return (
        <g {...edge}>
          {[[27, 17, 8], [35, 10, 8], [45, 10, 8], [53, 17, 8], [23, 28, 6], [57, 28, 6], [40, 12, 9]].map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} />)}
        </g>
      );
    default:
      return null;
  }
}

const MOUTH = {
  neutral: 'M34 41 Q40 41 46 41',
  smile: 'M33.5 39.5 Q40 46 46.5 39.5',
  open: 'M35 39 Q40 37 45 39 Q40 46 35 39',
};

// One person, the same look every time for the same story person.
export function Person({ index = 0, mouth = 'neutral', size = 84 }) {
  const look = LOOKS[index % LOOKS.length];
  const w = (size * 80) / 84;
  return (
    <svg width={w} height={size} viewBox="0 -8 80 84" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <path d="M6 76 Q6 58 26 54 L35 52 L40 59 L45 52 L54 54 Q74 58 74 76 Z" fill={SHIRTS[index % SHIRTS.length]} />
      <rect x="35" y="44" width="10" height="12" fill={SKINS[look.skin]} />
      <ellipse cx="40" cy="31" rx="16" ry="19" fill={SKINS[look.skin]} />
      <Hair shape={look.shape} fill={HAIR[look.color]} />
      <circle cx="33.5" cy="31" r="2.3" fill={FEATURE} />
      <circle cx="46.5" cy="31" r="2.3" fill={FEATURE} />
      <path d={MOUTH[mouth] || MOUTH.neutral} stroke={FEATURE} strokeWidth="2" strokeLinecap="round" fill={mouth === 'open' ? FEATURE : 'none'} />
    </svg>
  );
}

// PROXY: a blue disc with two eyes that look toward whoever it is attending to.
export function ProxyFace({ look = 0, size = 64, thinking = false }) {
  const dx = look * 3;
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" style={{ display: 'block' }} className={thinking ? 'proxy-face thinking' : 'proxy-face'}>
      <circle cx="36" cy="36" r="36" className="proxy-disc" />
      <circle cx="36" cy="36" r="29" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.5" />
      <g className="proxy-eyes" style={{ transform: `translateX(${dx}px)` }}>
        <circle cx="27" cy="33" r="4" fill="#fff" />
        <circle cx="45" cy="33" r="4" fill="#fff" />
      </g>
    </svg>
  );
}
