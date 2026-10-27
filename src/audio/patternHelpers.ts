/**
 * Top-level pattern helpers (Strudel stack/cat/slowcat parity) + tonal utils.
 * All combinators return parser-native notation strings so they compose with
 * track().pattern(...) without a full Pattern engine.
 */
import { noteToMidi as _n2m, midiToFreq as _m2f } from './MiniNotationParser';

const _s = (p: unknown): string =>
  Array.isArray(p) ? `[${p.map(String).join(', ')}]` : String(p ?? '~').trim() || '~';
const _j = (sep: string) => (...ps: unknown[]): string => ps.map(_s).filter(Boolean).join(sep);

export const stack = (...ps: unknown[]): string => `[${ps.map(_s).filter(Boolean).join(', ')}]`;
export const cat = _j(' ');
export const seq = cat;
export const fastcat = cat;
export const slowcat = (...ps: unknown[]): string => `<${ps.map(_s).filter(Boolean).join(' ')}>`;
export const arrange = slowcat;
export const pure = (x: unknown): string => String(x ?? '~');
export const value = pure;
export const polyrhythm = (...ps: unknown[]): string => stack(...ps);

const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const scale = (n = 'major'): number[] => SCALES[String(n).toLowerCase()] ?? SCALES.major;

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const m2n = (m: number): string => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export const scaleTranspose = (tok: string, steps = 0, sc = 'major'): string => {
  const iv = scale(sc);
  const t = String(tok).trim();
  const m = /^-?\d+$/.test(t) ? parseInt(t, 10) : _n2m(t);
  if (m == null || !isFinite(m)) return tok;
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12);
  const deg = iv.indexOf(pc);
  if (deg < 0) return m2n(m + steps);
  const nd = deg + Math.trunc(steps);
  return m2n((oct + Math.floor(nd / 7)) * 12 + iv[((nd % 7) + 7) % 7]);
};
export const scaleTrans = scaleTranspose;

const CHORDS: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
};

export const chord = (name = 'C'): string[] => {
  const mt = String(name).trim().match(/^([a-gA-G][#b]?)(-?\d)?(.*)$/);
  if (!mt) return [String(name)];
  const rootTok = `${mt[1].toLowerCase()}${mt[2] ?? '3'}`;
  const rm = _n2m(rootTok) ?? 60;
  return (CHORDS[mt[3].toLowerCase()] ?? CHORDS['']).map((i) => m2n(rm + i));
};

export const noteToMidi = _n2m;
export const midiToFreq = _m2f;
