import { ScheduledEvent, TrackChannel, TrackVizType, TrackVizWidget } from '../types/music';
import { audioEngine } from './AudioEngine';
import { midiManager } from './MidiManager';
import { vstBridge } from './VstBridge';
import { parseMiniNotation, ParsedEvent } from './MiniNotationParser';
import { sliderStore } from './SliderStore';
import { isSignal, parseRotatingNumbers, resolveModParam, sine, saw, square, tri, rand, perlin, type Signal } from './Signals';
import {
  stack as stackHelper, cat as catHelper, seq as seqHelper, fastcat as fastcatHelper,
  slowcat as slowcatHelper, arrange as arrangeHelper, pure as pureHelper, value as valueHelper,
  polyrhythm as polyrhythmHelper, scale as scaleHelper, scaleTranspose as scaleTransposeHelper,
  scaleTrans as scaleTransHelper, chord as chordHelper, noteToMidi as noteToMidiHelper,
  midiToFreq as midiToFreqHelper,
} from './patternHelpers';
import { sampleManager } from './SampleManager';
import { loadSamples, pumpPendingBanks, type SampleMapInput } from './SampleLoader';
import { transformSampleImports } from './SampleImports';
import { logger } from './Logger';
import {
  loadMixerState,
  persistTrackMixer,
  removeMixerTracks,
  clearMixerState,
  type TrackMixerState,
} from './MixerStore';

export interface EvaluatedTrack {
  id: string;
  patternSource: string; // pattern name or raw notation
  instrument: string;
  gain: number;
  pan: number | Signal;
  cutoff: number | Signal;
  resonance: number;
  reverbSend: number;
  delaySend: number;
  fast: number;
  slow: number;
  transpose: number;
  /** Octave shift in octaves (relative, may be fractional; rounded to semitones). */
  octaveShift: number;
  /** Per-cycle octave rotation, e.g. from .oct("<4 5>"). Null = no rotation. */
  octPattern: number[] | null;
  muted: boolean;
  solo: boolean;
  isMidiClip?: boolean;
  midiClipName?: string;
  hasScope?: boolean;
  hasMeter?: boolean;
  /** Inline visualization widgets (Strudel `_pianoroll`/`_spiral`/… parity). */
  widgets?: TrackVizWidget[];
  // Per-track VST bridge routing from `.vst()` / `.vstChannel()` / `.vstOutput()`
  vstPlugin?: string;
  vstChannel?: number; // 0-15
  vstOutputId?: string | null;
  // ---- Strudel-parity FX (demo.strudel natives) ----
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  legato?: number;
  room?: number;
  size?: number;
  chorus?: number;
  distort?: number;
  crush?: number | string | Signal;
  /** Per-cycle rotation backing `.crush("<4 4 4 6>")`. Null = static. */
  crushPattern?: number[] | null;
  delayTime?: number;
  delayFeedback?: number;
  vib?: number;
  vibmod?: number;
  orbit?: number;
  duckOrbit?: number | string;
  duckAttack?: number;
  duckDepth?: number;
  duckOnset?: number;
  color?: string;
  // ---- Pattern transforms (Strudel rev/iter/chop/striate/… parity) ----
  rev?: boolean;
  palindrome?: boolean;
  iterN?: number;
  chopN?: number;
  striateN?: number;
  plyN?: number;
  degradeP?: number;
  structPat?: string | null;
  juxOn?: boolean;
  supOn?: boolean;
  supShift?: number;
  stutN?: number;
  stutDecay?: number;
  stutShift?: number;
  hurryMult?: number;
  swingAmt?: number;
  nudge?: number;
  // ---- Extended superdough params ----
  coarse?: number;
  shape?: number;
  vowel?: string;
  drive?: number;
  tremolo?: number;
  phaser?: number;
  phaserDepth?: number;
  leslie?: number;
  postgain?: number;
  overgain?: number;
  dry?: number;
  speed?: number;
  begin?: number;
  end?: number;
  loop?: number | boolean;
  cut?: number | string;
  bank?: string;
  n?: number;
  detune?: number;
  unison?: number;
  spread?: number;
  fshift?: number;
  slide?: number;
  hold?: number;
  dur?: number;
  velocity?: number;
  amp?: number;
  compThreshold?: number;
  compRatio?: number;
  compAttack?: number;
  compRelease?: number;
  fmi?: number;
  wt?: number;
  warp?: number;
}

export type TEvent = ParsedEvent & { pan?: number; gainMul?: number };

function hash01(cycle: number, i: number, salt: number): number {
  let h = ((cycle * 374761393 + i * 668265263 + salt * 1442695041) >>> 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---- Highlight occurrence helpers (must mirror CodeEditor tokenization) ----
// The editor highlights tokens by (normalized value, nth occurrence in the
// literal). The scheduler used to emit occurrences counted only within the
// active cycle's events, so repeated values across slowcat `<a b>` sections
// mismatched (e.g. chord progs like `<[6,8,10,13]@4 [3,5,8,10]@...>` lit only
// 3,5 in the second chord). We emit global occurrences instead:
// preceding (inactive slowcat/choice branches) + per-cycle index.
const HIGHLIGHT_TOKEN_SPLIT =
  /([a-zA-Z0-9_:#]+\(\d+\s*,\s*\d+(?:\s*,\s*\d+)?\)|\[|\]|\*|!|\/|\~|\s+|,)/g;

function normalizeHighlightToken(text: string): string {
  let token = text.trim().toLowerCase().replace(/^[<>]+|[<>]+$/g, '');
  const euclidean = token.match(/^([a-z0-9_:#]+)\(\d+\s*,\s*\d+(?:\s*,\s*\d+)?\)$/);
  if (euclidean) token = euclidean[1];
  return token.replace(/(?:[*!]\d+|@\d*\.?\d+|\/\d*\.?\d+|\?\d*\.?\d+)$/, '');
}

function countHighlightTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tok of text.split(HIGHLIGHT_TOKEN_SPLIT)) {
    if (!tok) continue;
    const clean = normalizeHighlightToken(tok);
    if (!clean) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return counts;
}

function splitBracketAware(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let bracketDepth = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === delimiter && bracketDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unwrapTopSlowcat(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('<')) return null;
  let angle = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '<') angle++;
    else if (trimmed[i] === '>') angle--;
    if (angle === 0) {
      return i === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : null;
    }
  }
  return null;
}

function splitTopChoice(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let square = 0;
  let angle = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '[') square++;
    else if (ch === ']') square = Math.max(0, square - 1);
    else if (ch === '<') angle++;
    else if (ch === '>') angle = Math.max(0, angle - 1);
    if (ch === '|' && square === 0 && angle === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function slowcatSectionWeight(item: string): { value: string; weight: number } {
  let v = item.trim();
  // Trailing `_` elongate (mirror handleUnderscoreWeight).
  let extra = 0;
  if (!/^_+$/.test(v)) {
    const m = v.match(/^(.*?)_+$/);
    if (m && m[1].trim()) {
      extra = v.length - m[1].length;
      v = m[1].trim();
    }
  }
  let weight = 1;
  // Degrade suffix doesn't affect weight; strip for weight parsing.
  // `@w` timeCat weight.
  const wMatch = v.match(/^(.*)@(\d*\.?\d+)$/);
  if (wMatch) {
    const w = parseFloat(wMatch[2]);
    if (isFinite(w) && w > 0) {
      weight = w;
      v = wMatch[1].trim() || '~';
    }
  }
  // `!n` replicate carries weight n.
  const repMatch = v.match(/^(.*)[*!](\d+)$/);
  if (repMatch && repMatch[1].length > 0) {
    const n = parseInt(repMatch[2], 10);
    if (isFinite(n) && n > 1) {
      const isBang = v[v.length - n.toString().length - 1] === '!';
      v = repMatch[1].trim() || '~';
      if (isBang) weight = n;
    }
  }
  return { value: v, weight: weight + extra };
}

function mulberry32Highlight(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counts of each normalized token in slowcat/choice branches skipped this cycle. */
function getHighlightPrecedingCounts(
  notationStr: string,
  cycleIndex: number,
  span: number,
): Map<string, number> {
  const empty = new Map<string, number>();
  if (!notationStr) return empty;
  const addInto = (dst: Map<string, number>, src: Map<string, number>) => {
    src.forEach((c, k) => dst.set(k, (dst.get(k) || 0) + c));
  };
  // Top-level slowcat `<...>` (the chord-prog case).
  const slowInner = unwrapTopSlowcat(notationStr.trim());
  if (slowInner !== null) {
    const rawSections = splitBracketAware(slowInner, ' ').filter((s) => s.length > 0);
    if (rawSections.length === 0) return empty;
    const sections = rawSections.map(slowcatSectionWeight);
    const total = sections.reduce((sum, s) => sum + s.weight, 0);
    if (!(total > 0)) return empty;
    const rel = ((cycleIndex % total) + total) % total;
    let spanStart = 0;
    let firstOverlap = -1;
    for (let i = 0; i < sections.length; i++) {
      const spanEnd = spanStart + sections[i].weight;
      if (spanEnd > rel && spanStart < rel + 1) {
        firstOverlap = i;
        break;
      }
      spanStart = spanEnd;
    }
    if (firstOverlap <= 0) return empty;
    const out = new Map<string, number>();
    for (let i = 0; i < firstOverlap; i++) {
      addInto(out, countHighlightTokens(sections[i].value));
    }
    return out;
  }
  // Top-level random choice `a | b` (stable per phrase).
  const choices = splitTopChoice(notationStr.trim());
  if (choices.length > 1) {
    const safeSpan = span > 0 && isFinite(span) ? span : 1;
    const phrase = Math.floor(Math.max(0, Math.floor(cycleIndex)) / safeSpan);
    const rng = mulberry32Highlight((phrase * 2654435761) >>> 0);
    const picked = Math.floor(rng() * choices.length) % choices.length;
    const out = new Map<string, number>();
    for (let i = 0; i < picked; i++) {
      addInto(out, countHighlightTokens(choices[i]));
    }
    return out;
  }
  return empty;
}

function applyPatternTransforms(evts: ParsedEvent[], cycleIndex: number, t: EvaluatedTrack): TEvent[] {
  let evs: TEvent[] = evts.map((e) => ({ ...e }));
  const len = evs.length;
  if (!len) return evs;
  if (t.structPat) {
    const toks = t.structPat.split(/[\s,|]+/).filter(Boolean);
    const gate = toks.map((s) => /^(t|1|true|x)$/i.test(s));
    if (gate.length) evs = evs.filter((_, i) => gate[i % gate.length]);
  }
  if ((t.degradeP ?? 0) > 0) evs = evs.filter((_, i) => hash01(cycleIndex, i, 7) >= (t.degradeP ?? 0));
  if (!evs.length) return evs;
  const doRev = t.rev || (t.palindrome && Math.abs(cycleIndex % 2) === 1);
  if (doRev) evs = evs.map((e) => ({ ...e, offset: 1 - e.offset - e.duration })).sort((a, b) => a.offset - b.offset);
  if ((t.iterN ?? 0) > 0) {
    const s = [...evs].sort((a, b) => a.offset - b.offset);
    const rot = (cycleIndex * (t.iterN ?? 0)) % s.length;
    const vals = s.map((e) => ({ value: e.value, velocity: e.velocity }));
    const rv = vals.map((_, i) => vals[(i + rot) % vals.length]);
    evs = s.map((e, i) => ({ ...e, value: rv[i].value, velocity: rv[i].velocity }));
  }
  if ((t.hurryMult ?? 1) > 1) {
    const m = t.hurryMult ?? 1;
    evs = evs.map((e) => ({ ...e, offset: e.offset / m, duration: e.duration / m })).filter((e) => e.offset <= 1);
  }
  if ((t.striateN ?? 0) > 1) {
    const n = Math.floor(t.striateN ?? 0);
    const src = [...evs].sort((a, b) => a.offset - b.offset);
    const out: TEvent[] = [];
    for (let i = 0; i < n; i++) {
      const tc = (i + 0.5) / n;
      const s = src.find((e) => tc >= e.offset && tc < e.offset + e.duration) ?? src[src.length - 1];
      out.push({ ...s, offset: i / n, duration: 1 / n });
    }
    evs = out;
  }
  const sub = (t.chopN ?? 0) > 1 ? Math.floor(t.chopN ?? 0) : (t.plyN ?? 0) > 1 ? Math.floor(t.plyN ?? 0) : 0;
  if (sub > 1) {
    evs = evs.flatMap((e) =>
      Array.from({ length: sub }, (_, j) => ({ ...e, offset: e.offset + (j * e.duration) / sub, duration: e.duration / sub })),
    );
  }
  if ((t.swingAmt ?? 0) > 0) {
    evs = evs.map((e) =>
      Math.floor(e.offset * 4 + 1e-9) % 2 === 1 ? { ...e, offset: Math.min(0.999, e.offset + (t.swingAmt ?? 0) * 0.125) } : e,
    );
  }
  if ((t.nudge ?? 0) !== 0) {
    evs = evs
      .map((e) => ({ ...e, offset: (((e.offset + (t.nudge ?? 0)) % 1) + 1) % 1 }))
      .sort((a, b) => a.offset - b.offset);
  }
  if (t.supOn) evs = [...evs, ...evs.map((e) => ({ ...e, offset: e.offset + (t.supShift ?? 1 / 16), gainMul: 0.8 }))].filter((e) => e.offset < 1);
  if ((t.stutN ?? 0) > 1) {
    evs = evs.flatMap((e) =>
      Array.from({ length: Math.floor(t.stutN ?? 0) }, (_, k) => ({
        ...e,
        offset: e.offset + k * (t.stutShift ?? 1 / 16),
        velocity: e.velocity * Math.pow(t.stutDecay ?? 0.5, k),
      })).filter((e) => e.offset < 1),
    );
  }
  if (t.juxOn) {
    const p = Math.abs(cycleIndex % 2) === 0 ? -0.8 : 0.8;
    evs = evs.map((e) => ({ ...e, pan: p }));
  }
  return evs;
}

/**
 * Keep only JSON-safe primitive widget options for the inline renderers.
 * Mirrors the option bags Strudel passes to its canvas widgets
 * (cycles, playhead, labels, size, steady, ...).
 */
function sanitizeVizOptions(opts: unknown): Record<string, number | string | boolean> | undefined {
  if (!opts || typeof opts !== 'object') return undefined;
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 64);
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const KNOWN_SYNTHS = new Set([
  'acid_303', 'sub_bass', 'poly_saw', 'fm_bell', 'pluck', 'chiptune',
  'square', 'saw', 'sawtooth', 'triangle', 'sine', 'drum_kit', 'sampler',
  'vst_bridge', 'wt_digital_bad_day',
]);

interface PatternEventNotice {
  trackId: string;
  value: string;
  notation: string;
  valueOccurrence: number;
  time: number;
  /** Sounding duration in seconds (for sustained-note FX). */
  duration: number;
}

class PatternScheduler {
  // Master clock in cycles per minute: 1 cycle = 60 / cpm seconds.
  // (32 cpm == the old 128 bpm; a cycle is one 4-beat bar.)
  private cpm: number = 32;
  private isPlaying: boolean = false;
  private timerId: number | null = null;
  private lastScheduledCycle: number = -1;
  private cycleStartTime: number = 0;

  // Repository of shared patterns: name -> notation string
  private sharedPatterns: Map<string, string> = new Map();

  // Active evaluated tracks from code
  private evaluatedTracks: Map<string, EvaluatedTrack> = new Map();

  // Scheduled events buffer to prevent re-triggering
  private scheduledKeys: Set<string> = new Set();

  // Active UI listeners
  private stepListeners: Set<(step: number, cycle: number) => void> = new Set();
  private trackChangeListeners: Set<() => void> = new Set();
  private queueListeners: Set<(queued: 'next_beat' | 'next_cycle' | null) => void> = new Set();
  private eventListeners: Set<(event: PatternEventNotice) => void> = new Set();
  private activeBeat: number = 0;
  private lastBeatIndex: number = -1;

  // Queued code evaluation
  private queuedEvaluation: {
    code: string;
    quantize: 'next_beat' | 'next_cycle';
    callback?: (res: { success: boolean; error?: string }) => void;
  } | null = null;

  constructor() {
    this.seedDefaultPatterns();
  }

  public subscribeStep(listener: (step: number, cycle: number) => void) {
    this.stepListeners.add(listener);
    return () => {
      this.stepListeners.delete(listener);
    };
  }

  public subscribeTracks(listener: () => void) {
    this.trackChangeListeners.add(listener);
    return () => {
      this.trackChangeListeners.delete(listener);
    };
  }

  public subscribeQueue(listener: (queued: 'next_beat' | 'next_cycle' | null) => void) {
    this.queueListeners.add(listener);
    return () => {
      this.queueListeners.delete(listener);
    };
  }

  public subscribeEvent(listener: (event: PatternEventNotice) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private notifyTracks() {
    this.trackChangeListeners.forEach((l) => l());
  }

  private notifyQueue() {
    this.queueListeners.forEach((l) => l(this.queuedEvaluation?.quantize || null));
  }

  public getQueuedTarget(): 'next_beat' | 'next_cycle' | null {
    return this.queuedEvaluation?.quantize || null;
  }

  public queueEvaluation(
    code: string,
    quantize: 'next_beat' | 'next_cycle',
    callback?: (res: { success: boolean; error?: string }) => void
  ) {
    if (!this.isPlaying) {
      // If stopped, apply immediately
      const res = this.evaluateCode(code);
      if (callback) callback(res);
      return;
    }

    this.queuedEvaluation = { code, quantize, callback };
    this.notifyQueue();
  }

  public cancelQueue() {
    this.queuedEvaluation = null;
    this.notifyQueue();
  }

  public getCpm(): number {
    return this.cpm;
  }

  public setCpm(newCpm: number) {
    this.cpm = Math.max(5, Math.min(250, newCpm));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getSharedPatterns(): Record<string, string> {
    const obj: Record<string, string> = {};
    this.sharedPatterns.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }

  public setSharedPattern(name: string, notation: string) {
    this.sharedPatterns.set(name.toLowerCase(), notation);
    this.notifyTracks();
  }

  /**
   * Live-tweak a track (mixer, MIDI bindings) in the scheduler's own state,
   * so the per-cycle audio sync keeps it instead of overwriting it.
   * Mixer-relevant fields are mirrored to localStorage so the mix survives
   * reloads and code re-evaluations.
   */
  public setTrackParam(trackId: string, patch: Partial<EvaluatedTrack>): void {
    const track = this.evaluatedTracks.get(trackId);
    if (!track) return;
    Object.assign(track, patch);
    // Mirror mixer-relevant fields to the persisted project mix.
    const mixerPatch: Partial<TrackMixerState> = {};
    if (typeof patch.gain === 'number' && isFinite(patch.gain)) mixerPatch.gain = patch.gain;
    if (patch.pan !== undefined) {
      mixerPatch.pan = typeof patch.pan === 'number' && isFinite(patch.pan) ? patch.pan : null;
    }
    if (patch.cutoff !== undefined) {
      mixerPatch.cutoff = typeof patch.cutoff === 'number' && isFinite(patch.cutoff) ? patch.cutoff : null;
    }
    if (typeof patch.resonance === 'number' && isFinite(patch.resonance)) mixerPatch.resonance = patch.resonance;
    if (typeof patch.reverbSend === 'number' && isFinite(patch.reverbSend)) mixerPatch.reverbSend = patch.reverbSend;
    if (typeof patch.delaySend === 'number' && isFinite(patch.delaySend)) mixerPatch.delaySend = patch.delaySend;
    if (typeof patch.muted === 'boolean') mixerPatch.muted = patch.muted;
    if (typeof patch.solo === 'boolean') mixerPatch.solo = patch.solo;
    if (Object.keys(mixerPatch).length > 0) {
      try {
        persistTrackMixer(trackId, mixerPatch);
      } catch {
        /* persistence is best-effort */
      }
    }
    this.notifyTracks();
  }

  /** Persisted per-track mix (localStorage project state). */
  public getMixerSnapshot(): Record<string, TrackMixerState> {
    try {
      return loadMixerState();
    } catch {
      return {};
    }
  }

  /**
   * Apply a persisted mix onto the live tracks (used when restoring a
   * project from localStorage or the cloud). Unknown ids are ignored.
   */
  public applyMixerSnapshot(snapshot: Record<string, TrackMixerState> | null | undefined): void {
    if (!snapshot || typeof snapshot !== 'object') return;
    let changed = false;
    for (const [id, state] of Object.entries(snapshot)) {
      const track = this.evaluatedTracks.get(id);
      if (!track || !state) continue;
      if (isFinite(state.gain)) track.gain = Math.min(1.5, Math.max(0, state.gain));
      if (state.pan !== null && state.pan !== undefined && isFinite(state.pan)) {
        track.pan = Math.min(1, Math.max(-1, state.pan));
      }
      if (state.cutoff !== null && state.cutoff !== undefined && isFinite(state.cutoff)) {
        track.cutoff = Math.min(18000, Math.max(40, state.cutoff));
      }
      if (isFinite(state.resonance)) track.resonance = Math.min(25, Math.max(0.1, state.resonance));
      if (isFinite(state.reverbSend)) track.reverbSend = Math.min(1, Math.max(0, state.reverbSend));
      if (isFinite(state.delaySend)) track.delaySend = Math.min(1, Math.max(0, state.delaySend));
      if (typeof state.muted === 'boolean') track.muted = state.muted;
      if (typeof state.solo === 'boolean') track.solo = state.solo;
      changed = true;
      try {
        persistTrackMixer(id, state);
      } catch {
        /* ignore */
      }
    }
    if (changed) this.notifyTracks();
  }

  /**
   * Drop persisted mixer overrides and re-evaluate the code so faders snap
   * back to the values written in the track() chains.
   */
  public resetMixerToCodeDefaults(code?: string): void {
    try {
      clearMixerState();
    } catch {
      /* ignore */
    }
    if (typeof code === 'string') {
      this.evaluateCode(code);
    } else {
      this.notifyTracks();
    }
  }

  /**
   * Live slider update (Strudel `sliderValues` parity): push a dragged
   * `slider(...)` value straight into the sounding track params bound at
   * eval time, without re-evaluating the code.
   */
  public applySliderValue(key: string, value: number): void {
    if (!isFinite(value)) return;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const touched = new Map<string, Partial<TrackMixerState>>();
    const mark = (trackId: string, patch: Partial<TrackMixerState>) => {
      const prev = touched.get(trackId) || {};
      touched.set(trackId, { ...prev, ...patch });
    };
    for (const b of sliderStore.bindingKeysFor(key)) {
      if (b.param === 'cpm') {
        this.setCpm(value);
        continue;
      }
      const track = this.evaluatedTracks.get(b.trackId);
      if (!track) continue;
      switch (b.param) {
        case 'gain': track.gain = clamp(value, 0, 2); mark(b.trackId, { gain: track.gain }); break;
        case 'pan': if (typeof track.pan === 'number') { track.pan = clamp(value, -1, 1); mark(b.trackId, { pan: track.pan }); } break;
        case 'cutoff': if (typeof track.cutoff === 'number') { track.cutoff = clamp(value, 40, 18000); mark(b.trackId, { cutoff: track.cutoff }); } break;
        case 'resonance': track.resonance = clamp(value, 0.1, 25); mark(b.trackId, { resonance: track.resonance }); break;
        case 'reverbSend': track.reverbSend = clamp(value, 0, 1); mark(b.trackId, { reverbSend: track.reverbSend }); break;
        case 'delaySend': track.delaySend = clamp(value, 0, 1); mark(b.trackId, { delaySend: track.delaySend }); break;
        case 'transpose': track.transpose = value; break;
        case 'octaveShift': track.octaveShift = value; break;
        case 'fast': if (value > 0) track.fast = value; break;
        case 'slow': if (value > 0) track.slow = value; break;
        case 'attack': track.attack = clamp(value, 0.001, 4); break;
        case 'decay': track.decay = clamp(value, 0.005, 4); break;
        case 'sustain': track.sustain = clamp(value, 0, 1); break;
        case 'release': track.release = clamp(value, 0.01, 8); break;
        case 'legato': track.legato = clamp(value, 0.1, 4); break;
        case 'room': track.room = clamp(value, 0, 1); track.reverbSend = clamp(value, 0, 1); break;
        case 'size': track.size = clamp(value, 0, 1); break;
        case 'chorus': track.chorus = clamp(value, 0, 2); break;
        case 'distort': track.distort = clamp(value, 0, 1); break;
        case 'delayTime': track.delayTime = clamp(value, 0.01, 2); break;
        case 'delayFeedback': track.delayFeedback = clamp(value, 0, 0.98); break;
        case 'vib': track.vib = clamp(value, 0, 40); break;
        case 'tremolo': track.tremolo = clamp(value, 0, 32); break;
        case 'phaser': track.phaser = clamp(value, 0, 16); break;
        case 'phaserDepth': track.phaserDepth = clamp(value, 0, 2400); break;
        case 'shape': track.shape = clamp(value, 0, 1); break;
        case 'drive': track.drive = clamp(value, 0, 2); break;
        case 'coarse': track.coarse = clamp(value, 1, 16); break;
        default: continue;
      }
    }
    if (touched.size > 0) {
      try {
        touched.forEach((patch, trackId) => persistTrackMixer(trackId, patch));
      } catch {
        /* ignore */
      }
    }
    this.notifyTracks();
  }

  public getEvaluatedTracks(): TrackChannel[] {
    return Array.from(this.evaluatedTracks.values()).map((t) => ({
      id: t.id,
      name: t.id,
      patternName: t.patternSource,
      instrument: t.instrument,
      gain: t.gain,
      pan: typeof t.pan === 'number' ? t.pan : 0,
      cutoff: typeof t.cutoff === 'number' ? t.cutoff : 3500,
      panModulated: typeof t.pan !== 'number',
      cutoffModulated: typeof t.cutoff !== 'number',
      resonance: t.resonance,
      reverbSend: t.reverbSend,
      delaySend: t.delaySend,
      muted: t.muted,
      solo: t.solo,
      currentPeak: 0,
      hasScope: t.hasScope,
      hasMeter: t.hasMeter,
      widgets: t.widgets ? [...t.widgets] : undefined,
      vstPlugin: t.vstPlugin,
      vstChannel: t.vstChannel,
      vstOutputId: t.vstOutputId,
      attack: t.attack,
      decay: t.decay,
      sustain: t.sustain,
      release: t.release,
      legato: t.legato,
      room: t.room,
      size: t.size,
      chorus: t.chorus,
      distort: t.distort,
      crush: t.crush,
      delayTime: t.delayTime,
      delayFeedback: t.delayFeedback,
      vib: t.vib,
      vibmod: t.vibmod,
      orbit: t.orbit,
      duckOrbit: t.duckOrbit,
      duckAttack: t.duckAttack,
      duckDepth: t.duckDepth,
      duckOnset: t.duckOnset,
      color: t.color,
      rev: t.rev,
      palindrome: t.palindrome,
      iterN: t.iterN,
      chopN: t.chopN,
      striateN: t.striateN,
      plyN: t.plyN,
      degradeP: t.degradeP,
      structPat: t.structPat,
      swingAmt: t.swingAmt,
      coarse: t.coarse,
      shape: t.shape,
      vowel: t.vowel,
      drive: t.drive,
      tremolo: t.tremolo,
      phaser: t.phaser,
      phaserDepth: t.phaserDepth,
      leslie: t.leslie,
      postgain: t.postgain,
      overgain: t.overgain,
      dry: t.dry,
      speed: t.speed,
      begin: t.begin,
      end: t.end,
      loop: t.loop,
      cut: t.cut,
      bank: t.bank,
      n: t.n,
      detune: t.detune,
      unison: t.unison,
      spread: t.spread,
      fshift: t.fshift,
      slide: t.slide,
      hold: t.hold,
      dur: t.dur,
      velocity: t.velocity,
      amp: t.amp,
      compThreshold: t.compThreshold,
      compRatio: t.compRatio,
      compAttack: t.compAttack,
      compRelease: t.compRelease,
      fmi: t.fmi,
      wt: t.wt,
      warp: t.warp,
    }));
  }

  public start() {
    if (this.isPlaying) return;
    const ctx = audioEngine.init();
    audioEngine.resume();
    // Decode any sample banks queued by samples() calls before boot.
    try {
      pumpPendingBanks();
    } catch {}

    this.isPlaying = true;
    this.cycleStartTime = ctx.currentTime;
    this.lastScheduledCycle = -1;
    this.scheduledKeys.clear();

    // High frequency 25ms lookahead timer
    this.timerId = window.setInterval(() => {
      this.tick();
    }, 25);
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.scheduledKeys.clear();
    this.stepListeners.forEach((l) => l(0, 0));
  }

  private tick() {
    if (!this.isPlaying || !audioEngine.ctx) return;
    const ctx = audioEngine.ctx;
    const currentTime = ctx.currentTime;

    // 1 cycle = 60 / cpm seconds; a beat is a quarter cycle.
    const cycleDuration = 60 / this.cpm;
    const secPerBeat = cycleDuration / 4;
    const elapsed = currentTime - this.cycleStartTime;
    const currentCycle = Math.floor(elapsed / cycleDuration);
    const cycleFraction = (elapsed % cycleDuration) / cycleDuration;
    const currentBeatIndex = Math.floor(elapsed / secPerBeat);

    // Check if we should execute a queued code evaluation
    if (this.queuedEvaluation) {
      const isNewBeat = currentBeatIndex > this.lastBeatIndex && this.lastBeatIndex !== -1;
      const isNewCycle = currentCycle > this.lastScheduledCycle && this.lastScheduledCycle !== -1;

      if (
        (this.queuedEvaluation.quantize === 'next_beat' && isNewBeat) ||
        (this.queuedEvaluation.quantize === 'next_cycle' && isNewCycle)
      ) {
        const item = this.queuedEvaluation;
        this.queuedEvaluation = null;
        this.notifyQueue();
        const res = this.evaluateCode(item.code);
        if (item.callback) item.callback(res);
      }
    }
    this.lastBeatIndex = currentBeatIndex;

    // Current 16th step (0..15)
    const currentStep = Math.floor(cycleFraction * 16) % 16;
    this.activeBeat = currentStep;
    this.stepListeners.forEach((l) => l(currentStep, currentCycle));

    // Schedule ahead horizon: 100ms
    const lookaheadSec = 0.12;
    const scheduleWindowEnd = currentTime + lookaheadSec;

    // Determine cycles that fall inside [currentTime, scheduleWindowEnd]
    const cycleWindowStart = Math.floor((currentTime - this.cycleStartTime) / cycleDuration);
    const cycleWindowEnd = Math.floor((scheduleWindowEnd - this.cycleStartTime) / cycleDuration);

    for (let c = cycleWindowStart; c <= cycleWindowEnd; c++) {
      this.scheduleCycle(c, cycleDuration, currentTime, scheduleWindowEnd);
    }
  }

  private scheduleCycle(cycleIndex: number, cycleDuration: number, currentTime: number, windowEnd: number) {
    if (cycleIndex < 0) return;
    const cycleStartAudioTime = this.cycleStartTime + cycleIndex * cycleDuration;

    // Check solo status
    const hasSolo = Array.from(this.evaluatedTracks.values()).some((t) => t.solo);

    this.evaluatedTracks.forEach((track) => {
      // Make sure audio nodes match track settings first, so mute/solo
      // take effect on the gain node even though no notes are scheduled.
      // Filter/pan live on the strip nodes only as open/center — every voice
      // carries its own event-resolved cutoff/pan (single filter stage,
      // matching Strudel's per-voice chain).
      audioEngine.updateTrackParameters(
        {
          id: track.id,
          name: track.id,
          instrument: track.instrument,
          gain: track.gain,
          pan: 0,
          cutoff: 18000,
          resonance: track.resonance,
          reverbSend: track.room ?? track.reverbSend,
          delaySend: track.delaySend,
          muted: track.muted,
          solo: track.solo,
          currentPeak: 0,
          delayTime: track.delayTime,
          delayFeedback: track.delayFeedback,
          room: track.room,
          size: track.size,
        },
        undefined,
        cycleDuration,
      );
      // Per-track orbit registration for sidechain ducking.
      if (track.orbit != null) {
        audioEngine.setTrackOrbit(track.id, track.orbit);
      }

      if (track.muted) return;
      if (hasSolo && !track.solo) return;

      // 1. If track is driven by a recorded MIDI clip
      if (track.isMidiClip && track.midiClipName) {
        const clip = midiManager.getClip(track.midiClipName);
        if (clip) {
          this.scheduleMidiClip(clip, track, cycleIndex, cycleStartAudioTime, cycleDuration, currentTime, windowEnd);
        }
        return;
      }

      // 2. Standard pattern string (resolve shared pattern alias or use direct notation)
      // NOTE: origin time, not this cycle's start: placements carry absolute
      // span bases (slow() phrases span several cycles).
      const placed = this.computePatternEvents(track, cycleIndex, this.cycleStartTime, cycleDuration, currentTime, windowEnd);

      placed.forEach((event) => {
        const key = `${track.id}_${event.spanBase}_${event.placementIdx}_${event.value}_${event.scheduledTime.toFixed(3)}`;
        if (this.scheduledKeys.has(key)) return;
        this.scheduledKeys.add(key);

        // Clean up old keys periodically
        if (this.scheduledKeys.size > 2000) {
          this.scheduledKeys.clear();
        }

        audioEngine.triggerSound(
          track.id,
          event.finalValue,
          event.scheduledTime,
          event.actualDuration,
          event.velocity,
          track.instrument,
          event.voice,
        );

        // Strudel sidechain: the ducking track dips its target orbit(s).
        if (track.duckOrbit != null) {
          audioEngine.duckOrbit(
            track.duckOrbit,
            event.scheduledTime,
            track.duckOnset ?? 0,
            track.duckAttack ?? 0.1,
            track.duckDepth ?? 1,
          );
        }

        // Notify playhead listeners for real-time token highlighting in code
        const delayMs = Math.max(0, (event.scheduledTime - currentTime) * 1000);
        setTimeout(() => {
          this.eventListeners.forEach((l) => l({
            trackId: track.id,
            value: event.value,
            notation: event.notation,
            valueOccurrence: event.valueOccurrence,
            time: Date.now(),
            duration: event.actualDuration,
          }));
        }, delayMs);
      });
    });
  }

  /**
   * Pure per-track event expansion for one scheduler cycle: parse the pattern
   * (slowcat `<>` follows the absolute cycle, `|` is seeded per phrase),
   * apply octave rotation + transpose, expand fast repeats / slow spans, and
   * keep placements inside [currentTime, windowEnd). No audio side effects,
   * so the parity test tool can call it directly.
   */
  public computePatternEvents(
    track: EvaluatedTrack,
    cycleIndex: number,
    originAudioTime: number,
    cycleDuration: number,
    currentTime: number,
    windowEnd: number
  ): {
    scheduledTime: number;
    finalValue: string;
    actualDuration: number;
    velocity: number;
    value: string;
    valueOccurrence: number;
    notation: string;
    spanBase: number;
    placementIdx: number;
    voice: {
      pan: number;
      cutoff: number;
      attack?: number;
      decay?: number;
      sustain?: number;
      release?: number;
      chorus?: number;
      distort?: number;
      crush?: number;
      delayTime?: number;
      delayFeedback?: number;
      vib?: number;
      vibmod?: number;
      room?: number;
      size?: number;
      coarse?: number;
      shape?: number;
      vowel?: string;
      drive?: number;
      tremolo?: number;
      phaser?: number;
      phaserDepth?: number;
      leslie?: number;
      postgain?: number;
      overgain?: number;
      dry?: number;
      speed?: number;
      begin?: number;
      end?: number;
      loop?: number | boolean;
      detune?: number;
      unison?: number;
      spread?: number;
      fshift?: number;
      slide?: number;
      hold?: number;
      dur?: number;
      cut?: number | string;
      fmi?: number;
      wt?: number;
      warp?: number;
    };
  }[] {
    let notationStr = track.patternSource;
    if (this.sharedPatterns.has(notationStr.toLowerCase())) {
      notationStr = this.sharedPatterns.get(notationStr.toLowerCase())!;
    }

    // Random choices (`|`) stay stable across .slow() phrases: the phrase
    // length in cycles anchors the seeded choice.
    const span = track.slow && track.slow >= 1 ? track.slow : 1;
    const events: TEvent[] = applyPatternTransforms(
      parseMiniNotation(notationStr, cycleIndex, span),
      cycleIndex,
      track,
    );

    // Octave for this cycle: pattern rotation wins over scalar shift.
    // Rotation advances per phrase (a slowed track's phrase spans several
    // cycles) — verified against Strudel hap logs for slow(2) + oct().
    const phrase = Math.floor(cycleIndex / span);
    let octaveShift = track.octaveShift || 0;
    if (track.octPattern && track.octPattern.length > 0) {
      const len = track.octPattern.length;
      octaveShift = track.octPattern[((phrase % len) + len) % len];
    }
    const totalTranspose = (track.transpose || 0) + Math.round(octaveShift * 12);

    // Unified speed: fast repeats the pattern inside the cycle,
    // slow (>1) stretches it across multiple cycles. Stateless: derived
    // from the absolute cycle so re-parses schedule identical times.
    const fast = track.fast && track.fast > 0 ? track.fast : 1;
    const slow = track.slow && track.slow > 0 ? track.slow : 1;
    const speed = fast / slow;

    const out: {
      scheduledTime: number;
      finalValue: string;
      actualDuration: number;
      velocity: number;
      value: string;
      valueOccurrence: number;
      notation: string;
      spanBase: number;
      placementIdx: number;
      voice: {
        pan: number;
        cutoff: number;
        resonance?: number;
        attack?: number;
        decay?: number;
        sustain?: number;
        release?: number;
        chorus?: number;
        distort?: number;
        crush?: number;
        delayTime?: number;
        delayFeedback?: number;
        vib?: number;
        vibmod?: number;
        room?: number;
        size?: number;
        coarse?: number;
        shape?: number;
        vowel?: string;
        drive?: number;
        tremolo?: number;
        phaser?: number;
        phaserDepth?: number;
        leslie?: number;
        postgain?: number;
        overgain?: number;
        dry?: number;
        speed?: number;
        begin?: number;
        end?: number;
        loop?: number | boolean;
        detune?: number;
        unison?: number;
        spread?: number;
        fshift?: number;
        slide?: number;
        hold?: number;
        dur?: number;
        cut?: number | string;
        fmi?: number;
        wt?: number;
        warp?: number;
      };
    }[] = [];
    // Global occurrence = tokens skipped in inactive slowcat/choice branches
    // + index within this cycle's events. Matches the editor's nth-occurrence
    // counting so a whole `[n,n,n,n]` chord lights together.
    const precedingCounts = getHighlightPrecedingCounts(notationStr, cycleIndex, span);
    const valueOccurrences = new Map<string, number>();
    events.forEach((ev) => {
      const normKey = normalizeHighlightToken(ev.value) || ev.value;
      const perCycle = valueOccurrences.get(normKey) || 0;
      valueOccurrences.set(normKey, perCycle + 1);
      const valueOccurrence = (precedingCounts.get(normKey) || 0) + perCycle;

      // Expand each event into concrete cycle-relative placements.
      const placements: { offset: number; dur: number; spanBase: number }[] = [];
      if (speed >= 1) {
        const reps = Math.ceil(speed);
        for (let k = 0; k < reps; k++) {
          const off = (ev.offset + k) / speed;
          if (off > 1.000001) continue;
          placements.push({ offset: off, dur: ev.duration / speed, spanBase: cycleIndex });
        }
      } else {
        const stretch = 1 / speed;
        const base = Math.floor(cycleIndex / stretch) * stretch;
        placements.push({
          offset: ev.offset * stretch,
          dur: ev.duration * stretch,
          spanBase: base,
        });
      }

      placements.forEach((placement, placementIdx) => {
        const scheduledTime =
          originAudioTime + (placement.spanBase + placement.offset) * cycleDuration;

        // Verify falls inside the requested window
        if (scheduledTime < currentTime - 0.005 || scheduledTime >= windowEnd) return;

        // Apply transposition / octave shift + sample index select (.n/.bank).
        // .bank() selects the bank: bare words become bank:(n ?? 0), so
        // `.bank("casio")` + "bd" plays casio:0 instead of "casio:bd".
        let finalValue = ev.value;
        const bankKey = track.bank?.toLowerCase().trim();
        if (bankKey && !finalValue.includes(':') && /^[a-z_][a-z0-9_]*$/i.test(finalValue)) {
          finalValue = `${bankKey}:${track.n ?? 0}`;
        } else if (track.n != null && /^[a-z_][a-z0-9_]*\:\d+$/i.test(finalValue)) {
          finalValue = finalValue.replace(/:\d+$/, `:${track.n}`);
        } else if (bankKey && /^[a-z_][a-z0-9_]*\:\d+$/i.test(finalValue)) {
          // Bank-qualified override: `.bank("casio")` + "bd:2" -> "casio:2".
          finalValue = finalValue.replace(/^[a-z_][a-z0-9_]*(?=\:\d+$)/i, bankKey);
        }
        if (totalTranspose !== 0) {
          finalValue = this.transposeToken(finalValue, totalTranspose);
        }

        // Resolve modulated params at this exact event time.
        const cycleFloat = (scheduledTime - originAudioTime) / cycleDuration;
        let crushVal: number | undefined;
        if (track.crush != null) {
          if (isSignal(track.crush)) {
            crushVal = track.crush.evalAt(cycleFloat);
          } else if (typeof track.crush === 'string') {
            const nums = parseRotatingNumbers(track.crush);
            if (nums) {
              crushVal = nums[((cycleIndex % nums.length) + nums.length) % nums.length];
            } else {
              const n = Number(track.crush);
              if (isFinite(n)) crushVal = n;
            }
          } else if (typeof track.crush === 'number' && isFinite(track.crush)) {
            crushVal = track.crush;
          } else if (track.crushPattern && track.crushPattern.length > 0) {
            const len = track.crushPattern.length;
            crushVal = track.crushPattern[((cycleIndex % len) + len) % len];
          }
        }
        const legatoMul = track.legato != null && isFinite(track.legato) ? Math.max(0.1, Math.min(4, track.legato)) : 1;
        // Strudel `pan` is 0..1 (0=left, 1=right); ours is -1..1. Signal
        // LFOs follow the Strudel convention, so map uni -> bipolar.
        const rawPan = ev.pan ?? resolveModParam(track.pan as number | string | Signal, cycleFloat, cycleIndex, 0);
        const pan = ev.pan != null
          ? Math.max(-1, Math.min(1, ev.pan))
          : isSignal(track.pan)
            ? Math.max(-1, Math.min(1, rawPan * 2 - 1))
            : Math.max(-1, Math.min(1, rawPan));
        const velMul = (ev.gainMul ?? 1) * (track.velocity ?? 1) * (track.amp ?? 1);
        const baseDur = track.dur != null ? track.dur : placement.dur * cycleDuration;
        const heldDur = track.hold != null ? Math.max(baseDur, track.hold) : baseDur;

        out.push({
          scheduledTime,
          finalValue,
          actualDuration: Math.max(0.04, heldDur * legatoMul),
          // Voice gain is note velocity only (Strudel parity: gain *
          // velocity is a single stage). The track fader
          // (updateTrackParameters) carries track.gain — applying it here
          // too would square every .gain() call.
          velocity: ev.velocity * velMul,
          value: ev.value,
          valueOccurrence,
          notation: notationStr,
          spanBase: placement.spanBase,
          placementIdx,
          voice: {
            pan,
            cutoff: resolveModParam(track.cutoff as number | string | Signal, cycleFloat, cycleIndex, 18000),
            resonance: track.resonance,
            attack: track.attack,
            decay: track.decay,
            sustain: track.sustain,
            release: track.release,
            chorus: track.chorus,
            distort: track.distort,
            crush: crushVal,
            delayTime: track.delayTime,
            delayFeedback: track.delayFeedback,
            vib: track.vib,
            vibmod: track.vibmod,
            room: track.room ?? track.reverbSend,
            size: track.size,
            coarse: track.coarse,
            shape: track.shape,
            vowel: track.vowel,
            drive: track.drive,
            tremolo: track.tremolo,
            phaser: track.phaser,
            phaserDepth: track.phaserDepth,
            leslie: track.leslie,
            postgain: track.postgain,
            overgain: track.overgain,
            dry: track.dry,
            speed: track.speed,
            begin: track.begin,
            end: track.end,
            loop: track.loop,
            detune: track.detune,
            unison: track.unison,
            spread: track.spread,
            fshift: track.fshift,
            slide: track.slide,
            hold: track.hold,
            dur: track.dur,
            cut: track.cut,
            fmi: track.fmi,
            wt: track.wt,
            warp: track.warp,
          },
        });
      });
    });
    return out;
  }

  private scheduleMidiClip(
    clip: any,
    track: EvaluatedTrack,
    cycleIndex: number,
    cycleStartTime: number,
    cycleDuration: number,
    currentTime: number,
    windowEnd: number
  ) {
    const beatsPerCycle = 4;
    const secPerBeat = cycleDuration / beatsPerCycle;

    clip.notes.forEach((noteItem: any, idx: number) => {
      const beatOffset = noteItem.startBeat % clip.durationBeats;
      const scheduledTime = cycleStartTime + beatOffset * secPerBeat;

      if (scheduledTime >= currentTime - 0.005 && scheduledTime < windowEnd) {
        const key = `midi_${track.id}_${cycleIndex}_${idx}_${scheduledTime.toFixed(3)}`;
        if (!this.scheduledKeys.has(key)) {
          this.scheduledKeys.add(key);

          let clipOctaveShift = track.octaveShift || 0;
          if (track.octPattern && track.octPattern.length > 0) {
            const len = track.octPattern.length;
            clipOctaveShift = track.octPattern[((cycleIndex % len) + len) % len];
          }
          const finalMidiNote =
            noteItem.note + (track.transpose || 0) + Math.round(clipOctaveShift * 12);
          const durSec = Math.max(0.05, noteItem.durationBeats * secPerBeat);

          audioEngine.triggerSound(
            track.id,
            `n:${finalMidiNote}`,
            scheduledTime,
            durSec * (track.legato ?? 1),
            noteItem.velocity,
            track.instrument,
          {
            pan: typeof track.pan === 'number' ? track.pan : 0,
            cutoff: typeof track.cutoff === 'number' ? track.cutoff : 18000,
            resonance: track.resonance,
              attack: track.attack,
              decay: track.decay,
              sustain: track.sustain,
              release: track.release,
              chorus: track.chorus,
              distort: track.distort,
              crush: typeof track.crush === 'number' ? track.crush : undefined,
              delayTime: track.delayTime,
              delayFeedback: track.delayFeedback,
              vib: track.vib,
              vibmod: track.vibmod,
            },
          );
        }
      }
    });
  }

  private transposeToken(token: string, semitones: number): string {
    const trimmed = token.trim();
    // Raw MIDI numbers (e.g. Strudel-style "42") and n:/note: tokens.
    const nMatch = trimmed.match(/^(n:|note:)?(-?\d+)$/);
    if (nMatch) {
      return `${nMatch[1] || ''}${parseInt(nMatch[2], 10) + semitones}`;
    }
    const match = trimmed.toLowerCase().match(/^([a-g])([#b]?)(-?\d+)$/);
    if (!match) return token;

    const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
    const map: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    let semi = map[match[1]];
    if (match[2] === '#') semi += 1;
    if (match[2] === 'b') semi -= 1;
    const oct = parseInt(match[3], 10);
    const midi = (oct + 1) * 12 + semi + semitones;

    const newOct = Math.floor(midi / 12) - 1;
    const newSemi = ((midi % 12) + 12) % 12;
    return `${noteNames[newSemi]}${newOct}`;
  }

  /**
   * Safe JavaScript DSL evaluator: compiles user live code into tracks and pattern variables
   */
  public evaluateCode(codeString: string): { success: boolean; error?: string } {
    try {
      // `import`-style sample loading: rewrite to samples()/soundAlias()
      // calls before `new Function` (which cannot parse real ESM imports).
      let userCode = codeString;
      try {
        const rewritten = transformSampleImports(codeString);
        for (const err of rewritten.errors) logger.warn('import', err);
        if (rewritten.statements.length > 0 || rewritten.errors.length > 0) {
          userCode = rewritten.prelude
            ? `${rewritten.prelude}\n${rewritten.code}`
            : rewritten.code;
        }
      } catch (err) {
        logger.warn('import', `rewrite failed: ${(err as Error)?.message || err}`);
      }
      const newTracks: Map<string, EvaluatedTrack> = new Map();
      const newSharedPatterns: Map<string, string> = new Map(this.sharedPatterns);

      // Track builder helper fluent chain
      const trackBuilder = (trackId: string) => {
        const tr: EvaluatedTrack = {
          id: trackId,
          patternSource: '~',
          // Default voice/track gain 0.8: superdough parity
          // (superdough defaultDefaultValues.gain = 0.8, velocity = 1).
          instrument: 'acid_303',
          gain: 0.8,
          pan: 0,
          cutoff: 18000,
          resonance: 2,
          reverbSend: 0,
          delaySend: 0,
          fast: 1,
          slow: 1,
          transpose: 0,
          octaveShift: 0,
          octPattern: null,
          muted: false,
          solo: false,
          widgets: [],
        };

        // If the argument just evaluated contained a `slider(...)` call,
        // bind its live key to this track param so editor drags update the
        // sounding voice without re-evaluation (Strudel ref parity).
        // Non-numeric methods pass null to just clear the pending key and
        // avoid misattributing a slider to the next numeric call.
        const bindSlider = (param: string | null) => {
          const key = sliderStore.consumePending();
          if (key && param) sliderStore.addBinding({ key, trackId, param });
        };

        const addViz = (type: TrackVizType, opts?: unknown) => {
          bindSlider(null);
          tr.widgets = tr.widgets || [];
          if (!tr.widgets.some((w) => w.type === type)) {
            tr.widgets.push({ type, options: sanitizeVizOptions(opts) });
          }
          if (type === 'scope') tr.hasScope = true;
          if (type === 'meter') tr.hasMeter = true;
          return chain;
        };

        const chain = {
          pattern: (pNameOrNotation: string) => {
            bindSlider(null);
            tr.patternSource = pNameOrNotation;
            return chain;
          },
          s: (arg: string) => {
            bindSlider(null);
            if (typeof arg === 'string' && KNOWN_SYNTHS.has(arg.toLowerCase())) {
              tr.instrument = arg;
            } else {
              tr.patternSource = arg;
            }
            return chain;
          },
          note: (notation: string) => {
            bindSlider(null);
            tr.patternSource = notation;
            return chain;
          },
          midi: (clipName: string) => {
            bindSlider(null);
            tr.isMidiClip = true;
            tr.midiClipName = clipName;
            return chain;
          },
          synth: (instName: string) => {
            bindSlider(null);
            tr.instrument = instName;
            return chain;
          },
          vst: (pluginName?: string | { plugin?: string; channel?: number; output?: string | null }, opts?: { channel?: number; output?: string | null }) => {
            bindSlider(null);
            tr.instrument = 'vst_bridge';
            if (typeof pluginName === 'string') {
              tr.vstPlugin = pluginName;
            } else if (pluginName && typeof pluginName === 'object') {
              if (pluginName.plugin) tr.vstPlugin = pluginName.plugin;
              if (pluginName.channel != null) {
                tr.vstChannel = Math.max(1, Math.min(16, Math.floor(pluginName.channel))) - 1;
              }
              if (pluginName.output !== undefined) tr.vstOutputId = pluginName.output;
            }
            if (opts?.channel != null) {
              tr.vstChannel = Math.max(1, Math.min(16, Math.floor(opts.channel))) - 1;
            }
            if (opts?.output !== undefined) tr.vstOutputId = opts.output;
            return chain;
          },
          vstChannel: (ch: number) => {
            bindSlider(null);
            tr.instrument = 'vst_bridge';
            tr.vstChannel = Math.max(1, Math.min(16, Math.floor(ch))) - 1;
            return chain;
          },
          vstOutput: (outputId: string | null) => {
            bindSlider(null);
            tr.vstOutputId = outputId;
            return chain;
          },
          gain: (val: number) => {
            tr.gain = Math.max(0, Math.min(2, val));
            bindSlider('gain');
            return chain;
          },
          pan: (val: number | Signal) => {
            if (isSignal(val)) {
              tr.pan = val;
              bindSlider(null);
            } else if (typeof val === 'number' && isFinite(val)) {
              tr.pan = Math.max(-1, Math.min(1, val));
              bindSlider('pan');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          cutoff: (val: number | Signal) => {
            if (isSignal(val)) {
              tr.cutoff = val;
              bindSlider(null);
            } else if (typeof val === 'number' && isFinite(val)) {
              tr.cutoff = Math.max(40, Math.min(18000, val));
              bindSlider('cutoff');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          lpf: (val: number | Signal) => {
            if (isSignal(val)) {
              tr.cutoff = val;
              bindSlider(null);
            } else if (typeof val === 'number' && isFinite(val)) {
              tr.cutoff = Math.max(40, Math.min(18000, val));
              bindSlider('cutoff');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          hpf: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.cutoff = Math.max(40, Math.min(18000, val));
              bindSlider('cutoff');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          res: (val: number) => {
            tr.resonance = Math.max(0.1, Math.min(25, val));
            bindSlider('resonance');
            return chain;
          },
          resonance: (val: number) => {
            tr.resonance = Math.max(0.1, Math.min(25, val));
            bindSlider('resonance');
            return chain;
          },
          reverb: (val: number) => {
            tr.reverbSend = Math.max(0, Math.min(1, val));
            tr.room = tr.reverbSend;
            bindSlider('reverbSend');
            return chain;
          },
          room: (val: number) => {
            tr.reverbSend = Math.max(0, Math.min(1, val));
            tr.room = tr.reverbSend;
            bindSlider('reverbSend');
            return chain;
          },
          size: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.size = Math.max(0, Math.min(1, val));
              bindSlider('size');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          delay: (val: number) => {
            tr.delaySend = Math.max(0, Math.min(1, val));
            bindSlider('delaySend');
            return chain;
          },
          delaytime: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.delayTime = Math.max(0.01, Math.min(2, val));
              bindSlider('delayTime');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          delayfeedback: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.delayFeedback = Math.max(0, Math.min(0.98, val));
              bindSlider('delayFeedback');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          delayfb: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.delayFeedback = Math.max(0, Math.min(0.98, val));
              bindSlider('delayFeedback');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          dfb: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.delayFeedback = Math.max(0, Math.min(0.98, val));
              bindSlider('delayFeedback');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          delayt: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.delayTime = Math.max(0.01, Math.min(2, val));
              bindSlider('delayTime');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          dt: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.delayTime = Math.max(0.01, Math.min(2, val));
              bindSlider('delayTime');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          chorus: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.chorus = Math.max(0, Math.min(2, val));
              bindSlider('chorus');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          distort: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.distort = Math.max(0, Math.min(1, val));
              bindSlider('distort');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          crush: (val: number | string | Signal) => {
            if (isSignal(val)) {
              tr.crush = val;
              tr.crushPattern = null;
              bindSlider(null);
            } else if (typeof val === 'string') {
              const nums = parseRotatingNumbers(val);
              if (nums) {
                tr.crush = val;
                tr.crushPattern = nums;
              } else {
                const n = Number(val);
                if (isFinite(n)) {
                  tr.crush = Math.max(1, Math.min(16, n));
                  tr.crushPattern = null;
                }
              }
              bindSlider(null);
            } else if (typeof val === 'number' && isFinite(val)) {
              tr.crush = Math.max(1, Math.min(16, val));
              tr.crushPattern = null;
              bindSlider(null);
            } else {
              bindSlider(null);
            }
            return chain;
          },
          vib: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.vib = Math.max(0, Math.min(40, val));
              bindSlider('vib');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          vibmod: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.vibmod = Math.max(0, Math.min(12, val));
              bindSlider(null);
            } else {
              bindSlider(null);
            }
            return chain;
          },
          attack: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.attack = Math.max(0.001, Math.min(4, val));
              bindSlider('attack');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          att: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.attack = Math.max(0.001, Math.min(4, val));
              bindSlider('attack');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          decay: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.decay = Math.max(0.005, Math.min(4, val));
              bindSlider('decay');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          dec: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.decay = Math.max(0.005, Math.min(4, val));
              bindSlider('decay');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          sustain: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.sustain = Math.max(0, Math.min(1, val));
              bindSlider('sustain');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          sus: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.sustain = Math.max(0, Math.min(1, val));
              bindSlider('sustain');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          release: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.release = Math.max(0.01, Math.min(8, val));
              bindSlider('release');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          rel: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.release = Math.max(0.01, Math.min(8, val));
              bindSlider('release');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          legato: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.legato = Math.max(0.1, Math.min(4, val));
              bindSlider('legato');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          orbit: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.orbit = Math.max(1, Math.floor(val));
              bindSlider(null);
            } else {
              bindSlider(null);
            }
            return chain;
          },
          duckorbit: (val: number | string) => {
            tr.duckOrbit = val as number | string;
            bindSlider(null);
            return chain;
          },
          duckattack: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.duckAttack = Math.max(0.002, Math.min(2, val));
              bindSlider(null);
            } else {
              bindSlider(null);
            }
            return chain;
          },
          duckdepth: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.duckDepth = Math.max(0, Math.min(1.5, val));
              bindSlider(null);
            } else {
              bindSlider(null);
            }
            return chain;
          },
          duckonset: (val: number) => {
            if (typeof val === 'number' && isFinite(val)) {
              tr.duckOnset = Math.max(0, Math.min(1, val));
              bindSlider(null);
            } else {
              bindSlider(null);
            }
            return chain;
          },
          color: (val: string) => {
            tr.color = String(val).slice(0, 32);
            bindSlider(null);
            return chain;
          },
          log: () => {
            // Strudel `.log()` parity: print the track's pattern to the console.
            try {
              console.log(`[${trackId}]`, tr.patternSource);
            } catch {}
            bindSlider(null);
            return chain;
          },
          // ---- Pattern transforms ----
          rev: (on = true) => { bindSlider(null); tr.rev = !!on; return chain; },
          palindrome: (on = true) => { bindSlider(null); tr.palindrome = !!on; return chain; },
          iter: (n = 1) => { bindSlider(null); tr.iterN = isFinite(n) ? Math.max(0, Math.min(16, Math.floor(n))) : 0; return chain; },
          chop: (n = 2) => { bindSlider(null); tr.chopN = isFinite(n) ? Math.max(0, Math.min(16, Math.floor(n))) : 0; return chain; },
          striate: (n = 4) => { bindSlider(null); tr.striateN = isFinite(n) ? Math.max(0, Math.min(16, Math.floor(n))) : 0; return chain; },
          ply: (n = 2) => { bindSlider(null); tr.plyN = isFinite(n) ? Math.max(0, Math.min(8, Math.floor(n))) : 0; return chain; },
          degrade: (p = 0.5) => { bindSlider(null); tr.degradeP = isFinite(p) ? Math.max(0, Math.min(1, p)) : 0.5; return chain; },
          degradeBy: (p = 0.5) => { bindSlider(null); tr.degradeP = isFinite(p) ? Math.max(0, Math.min(1, p)) : 0.5; return chain; },
          sometimes: () => { bindSlider(null); tr.degradeP = 0.5; return chain; },
          often: () => { bindSlider(null); tr.degradeP = 0.25; return chain; },
          rarely: () => { bindSlider(null); tr.degradeP = 0.75; return chain; },
          struct: (pat: string) => { bindSlider(null); tr.structPat = String(pat ?? '').slice(0, 256) || null; return chain; },
          mask: (pat: string) => { bindSlider(null); tr.structPat = String(pat ?? '').slice(0, 256) || null; return chain; },
          jux: (on = true) => { bindSlider(null); tr.juxOn = !!on; return chain; },
          superimpose: (on = true, shift = 1 / 16) => { bindSlider(null); tr.supOn = !!on; if (isFinite(shift)) tr.supShift = Math.max(0, Math.min(0.5, shift)); return chain; },
          stut: (n = 2, decay = 0.5, shift = 1 / 16) => {
            bindSlider(null);
            tr.stutN = isFinite(n) ? Math.max(0, Math.min(8, Math.floor(n))) : 0;
            if (isFinite(decay)) tr.stutDecay = Math.max(0, Math.min(1, decay));
            if (isFinite(shift)) tr.stutShift = Math.max(0, Math.min(0.5, shift));
            return chain;
          },
          echo: (n = 2, decay = 0.5, shift = 1 / 16) => {
            bindSlider(null);
            tr.stutN = isFinite(n) ? Math.max(0, Math.min(8, Math.floor(n))) : 0;
            if (isFinite(decay)) tr.stutDecay = Math.max(0, Math.min(1, decay));
            if (isFinite(shift)) tr.stutShift = Math.max(0, Math.min(0.5, shift));
            return chain;
          },
          hurry: (m = 1.5) => { bindSlider(null); tr.hurryMult = isFinite(m) && m > 0 ? Math.max(1, Math.min(4, m)) : 1.5; return chain; },
          swing: (a = 0.1) => { bindSlider(null); tr.swingAmt = isFinite(a) ? Math.max(0, Math.min(0.6, a)) : 0; return chain; },
          swingBy: (a = 0.1) => { bindSlider(null); tr.swingAmt = isFinite(a) ? Math.max(0, Math.min(0.6, a)) : 0; return chain; },
          early: (a = 0.02) => { bindSlider(null); if (isFinite(a)) tr.nudge = Math.max(-0.5, Math.min(0.5, (tr.nudge ?? 0) - Math.abs(a))); return chain; },
          late: (a = 0.02) => { bindSlider(null); if (isFinite(a)) tr.nudge = Math.max(-0.5, Math.min(0.5, (tr.nudge ?? 0) + Math.abs(a))); return chain; },
          // ---- Extended superdough params ----
          coarse: (v: number) => { if (isFinite(v)) tr.coarse = Math.max(1, Math.min(16, v)); bindSlider(null); return chain; },
          shape: (v: number) => { if (isFinite(v)) tr.shape = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          vowel: (v: string) => { const s = String(v).toLowerCase()[0]; if ('aeiou'.includes(s)) tr.vowel = s; bindSlider(null); return chain; },
          drive: (v: number) => { if (isFinite(v)) tr.drive = Math.max(0, Math.min(2, v)); bindSlider(null); return chain; },
          tremolo: (v: number) => { if (isFinite(v)) tr.tremolo = Math.max(0, Math.min(32, v)); bindSlider(null); return chain; },
          trem: (v: number) => { if (isFinite(v)) tr.tremolo = Math.max(0, Math.min(32, v)); bindSlider(null); return chain; },
          phaser: (v: number) => { if (isFinite(v)) tr.phaser = Math.max(0, Math.min(16, v)); bindSlider(null); return chain; },
          phaserDepth: (v: number) => { if (isFinite(v)) tr.phaserDepth = Math.max(0, Math.min(2400, v)); bindSlider(null); return chain; },
          phaserdepth: (v: number) => { if (isFinite(v)) tr.phaserDepth = Math.max(0, Math.min(2400, v)); bindSlider(null); return chain; },
          phasedepth: (v: number) => { if (isFinite(v)) tr.phaserDepth = Math.max(0, Math.min(2400, v)); bindSlider(null); return chain; },
          leslie: (v: number) => { if (isFinite(v)) tr.leslie = Math.max(0, Math.min(2, v)); bindSlider(null); return chain; },
          postgain: (v: number) => { if (isFinite(v)) tr.postgain = Math.max(0, Math.min(2, v)); bindSlider(null); return chain; },
          overgain: (v: number) => { if (isFinite(v)) tr.overgain = Math.max(0, Math.min(4, v)); bindSlider(null); return chain; },
          dry: (v: number) => { if (isFinite(v)) tr.dry = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          speed: (v: number) => { if (isFinite(v) && v !== 0) tr.speed = Math.max(-8, Math.min(8, v)); bindSlider(null); return chain; },
          begin: (v: number) => { if (isFinite(v)) tr.begin = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          end: (v: number) => { if (isFinite(v)) tr.end = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          loop: (v: number | boolean) => { tr.loop = typeof v === 'boolean' ? (v ? 1 : 0) : Math.max(0, Math.min(8, v)); bindSlider(null); return chain; },
          loopBegin: (v: number) => { if (isFinite(v)) tr.begin = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          loopEnd: (v: number) => { if (isFinite(v)) tr.end = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          cut: (v: number | string) => { tr.cut = v; bindSlider(null); return chain; },
          bank: (v: string) => { tr.bank = String(v).slice(0, 32); bindSlider(null); return chain; },
          n: (v: number) => { if (isFinite(v)) tr.n = Math.max(0, Math.min(128, Math.floor(v))); bindSlider(null); return chain; },
          detune: (v: number) => { if (isFinite(v)) tr.detune = Math.max(-1200, Math.min(1200, v)); bindSlider(null); return chain; },
          det: (v: number) => { if (isFinite(v)) tr.detune = Math.max(-1200, Math.min(1200, v)); bindSlider(null); return chain; },
          unison: (v: number) => { if (isFinite(v)) tr.unison = Math.max(1, Math.min(8, Math.floor(v))); bindSlider(null); return chain; },
          spread: (v: number) => { if (isFinite(v)) tr.spread = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          fshift: (v: number) => { if (isFinite(v)) tr.fshift = Math.max(-5000, Math.min(5000, v)); bindSlider(null); return chain; },
          slide: (v: number) => { if (isFinite(v)) tr.slide = Math.max(0, Math.min(4, v)); bindSlider(null); return chain; },
          hold: (v: number) => { if (isFinite(v)) tr.hold = Math.max(0, Math.min(8, v)); bindSlider(null); return chain; },
          dur: (v: number) => { if (isFinite(v)) tr.dur = Math.max(0.02, Math.min(16, v)); bindSlider(null); return chain; },
          duration: (v: number) => { if (isFinite(v)) tr.dur = Math.max(0.02, Math.min(16, v)); bindSlider(null); return chain; },
          velocity: (v: number) => { if (isFinite(v)) tr.velocity = Math.max(0, Math.min(2, v)); bindSlider(null); return chain; },
          vel: (v: number) => { if (isFinite(v)) tr.velocity = Math.max(0, Math.min(2, v)); bindSlider(null); return chain; },
          amp: (v: number) => { if (isFinite(v)) tr.amp = Math.max(0, Math.min(2, v)); bindSlider(null); return chain; },
          compressor: (t = -14, r = 4, a = 0.003, rel = 0.2) => {
            tr.compThreshold = Math.max(-60, Math.min(0, t));
            tr.compRatio = Math.max(1, Math.min(20, r));
            tr.compAttack = Math.max(0.001, Math.min(1, a));
            tr.compRelease = Math.max(0.01, Math.min(2, rel));
            bindSlider(null);
            return chain;
          },
          scaleTranspose: (steps: number, _sc?: string) => { if (isFinite(steps)) tr.transpose = (tr.transpose || 0) + Math.round(steps); bindSlider(null); return chain; },
          scaleTrans: (steps: number) => { if (isFinite(steps)) tr.transpose = (tr.transpose || 0) + Math.round(steps); bindSlider(null); return chain; },
          strans: (steps: number) => { if (isFinite(steps)) tr.transpose = (tr.transpose || 0) + Math.round(steps); bindSlider(null); return chain; },
          fmi: (v: number) => { if (isFinite(v)) tr.fmi = Math.max(0, Math.min(32, v)); bindSlider(null); return chain; },
          wt: (v: number) => { if (isFinite(v)) tr.wt = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          warp: (v: number) => { if (isFinite(v)) tr.warp = Math.max(0, Math.min(1, v)); bindSlider(null); return chain; },
          set: (_val?: unknown) => {
            // Parity: real Strudel `.set("D")` leaves numbers as raw MIDI
            // (tools/parity pins this), so this stays a no-op.
            bindSlider(null);
            return chain;
          },
          scale: (_val?: unknown) => {
            bindSlider(null);
            return chain;
          },
          sound: (arg: string) => {
            bindSlider(null);
            if (typeof arg === 'string' && KNOWN_SYNTHS.has(arg.toLowerCase())) {
              tr.instrument = arg;
            } else {
              tr.patternSource = arg;
            }
            return chain;
          },
          fast: (speed: number) => {
            tr.fast = speed;
            bindSlider('fast');
            return chain;
          },
          slow: (speed: number) => {
            tr.slow = speed;
            bindSlider('slow');
            return chain;
          },
          transpose: (semi: number) => {
            tr.transpose = semi;
            bindSlider('transpose');
            return chain;
          },
          oct: (octaves: number | string) => {
            if (typeof octaves === 'string') {
              bindSlider(null);
              const nums = octaves
                .replace(/^\s*<\s*/, '')
                .replace(/\s*>\s*$/, '')
                .split(/[\s,]+/)
                .map((s) => Number(s))
                .filter((n) => isFinite(n));
              if (nums.length > 0) {
                tr.octPattern = nums;
              }
            } else if (typeof octaves === 'number' && isFinite(octaves)) {
              tr.octaveShift = octaves;
              tr.octPattern = null;
              bindSlider('octaveShift');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          octave: (octaves: number | string) => {
            if (typeof octaves === 'string') {
              bindSlider(null);
              const nums = octaves
                .replace(/^\s*<\s*/, '')
                .replace(/\s*>\s*$/, '')
                .split(/[\s,]+/)
                .map((s) => Number(s))
                .filter((n) => isFinite(n));
              if (nums.length > 0) {
                tr.octPattern = nums;
              }
            } else if (typeof octaves === 'number' && isFinite(octaves)) {
              tr.octaveShift = octaves;
              tr.octPattern = null;
              bindSlider('octaveShift');
            } else {
              bindSlider(null);
            }
            return chain;
          },
          mute: (m: boolean = true) => {
            bindSlider(null);
            tr.muted = m;
            return chain;
          },
          solo: (s: boolean = true) => {
            bindSlider(null);
            tr.solo = s;
            return chain;
          },
          scope: (show?: boolean | Record<string, unknown>) => {
            if (show !== undefined && typeof show !== 'boolean') {
              return addViz('scope', show);
            }
            bindSlider(null);
            tr.hasScope = show ?? true;
            if (tr.hasScope) {
              tr.widgets = tr.widgets || [];
              if (!tr.widgets.some((w) => w.type === 'scope')) tr.widgets.push({ type: 'scope' });
            } else if (tr.widgets) {
              tr.widgets = tr.widgets.filter((w) => w.type !== 'scope');
            }
            return chain;
          },
          meter: (show: boolean = true) => {
            bindSlider(null);
            tr.hasMeter = show;
            if (show) {
              tr.widgets = tr.widgets || [];
              if (!tr.widgets.some((w) => w.type === 'meter')) tr.widgets.push({ type: 'meter' });
            } else if (tr.widgets) {
              tr.widgets = tr.widgets.filter((w) => w.type !== 'meter');
            }
            return chain;
          },
          // ---- visualization widgets (Strudel parity) ----
          // Scrolling pianoroll strip for this track's pattern.
          pianoroll: (opts?: Record<string, unknown>) => addViz('pianoroll', opts),
          // Folded (chord-collapsed) pianoroll variant.
          punchcard: (opts?: Record<string, unknown>) => addViz('punchcard', opts),
          // Vertical labeled pianoroll.
          wordfall: (opts?: Record<string, unknown>) => addViz('wordfall', opts),
          // Spiral pattern visual.
          spiral: (opts?: Record<string, unknown>) => addViz('spiral', opts),
          // Scrolling frequency spectrum for this track's voice.
          spectrum: (opts?: Record<string, unknown>) => addViz('spectrum', opts),
          // Frequency-bars scope for this track's voice.
          fscope: (opts?: Record<string, unknown>) => addViz('fscope', opts),
          // Pitch-circle (EDO) visual for this track's notes.
          pitchwheel: (opts?: Record<string, unknown>) => addViz('pitchwheel', opts),
          // Underscore aliases for pasted-Strudel compatibility.
          _pianoroll: (opts?: Record<string, unknown>) => addViz('pianoroll', opts),
          _punchcard: (opts?: Record<string, unknown>) => addViz('punchcard', opts),
          _spiral: (opts?: Record<string, unknown>) => addViz('spiral', opts),
          _scope: (opts?: Record<string, unknown>) => addViz('scope', opts),
          _spectrum: (opts?: Record<string, unknown>) => addViz('spectrum', opts),
          _pitchwheel: (opts?: Record<string, unknown>) => addViz('pitchwheel', opts),
        };

        newTracks.set(trackId, tr);
        return chain;
      };

      const defPatternHelper = (name: string, notation: string) => {
        newSharedPatterns.set(name.toLowerCase(), notation);
      };

      const setCpmHelper = (cpmVal: number) => {
        this.setCpm(cpmVal);
        const key = sliderStore.consumePending();
        if (key) sliderStore.addBinding({ key, trackId: '__master__', param: 'cpm' });
      };
      const setBpmHelper = (bpmVal: number) => {
        // Legacy beats-per-minute: 4 beats per cycle.
        this.setCpm(bpmVal / 4);
        const key = sliderStore.consumePending();
        if (key) sliderStore.addBinding({ key, trackId: '__master__', param: 'cpm' });
      };

      // Fresh slider call counter + bindings for this evaluation.
      sliderStore.beginEval();
      const sliderHelper = (value: number, min = 0, max = 1, step?: number) =>
        sliderStore.slider(value, min, max, step);
      const sliderWithIDHelper = (id: string, value: number, min = 0, max = 1) =>
        sliderStore.sliderWithID(id, value, min, max);

      // Strudel-parity sample loading: async + fire-and-forget so the
      // pattern eval stays synchronous (Node-safe: never throws).
      const samplesHelper = (map: SampleMapInput, baseUrl?: string) => {
        try {
          const p = loadSamples(map, baseUrl || '');
          // Surface failures as eval warnings, not crashes.
          p.then(
            () => {},
            (err) => logger.warn('samples', `load failed: ${err?.message || err}`),
          );
          // In case the AudioContext booted since queuing, pump now.
          try {
            pumpPendingBanks();
          } catch {}
          return p;
        } catch (err: unknown) {
          logger.warn('samples', `load failed: ${(err as Error)?.message || err}`);
          return Promise.resolve([]);
        }
      };
      // Strudel soundAlias(original, alias): alias points at original.
      const soundAliasHelper = (original: string, alias: string) => {
        try {
          sampleManager.addAlias(String(alias), String(original));
        } catch (err) {
          logger.warn('soundAlias', `failed: ${(err as Error)?.message || err}`);
        }
      };

      // Construct evaluation function
      const evalFn = new Function(
        'track',
        'defPattern',
        'def',
        'bpm',
        'cpm',
        'setcpm',
        'setbpm',
        's',
        'note',
        'synth',
        'vst',
        'slider',
        'sliderWithID',
        'samples',
        'soundAlias',
        'sine',
        'saw',
        'square',
        'tri',
        'rand',
        'perlin',
        'stack',
        'cat',
        'seq',
        'fastcat',
        'slowcat',
        'arrange',
        'pure',
        'value',
        'polyrhythm',
        'scale',
        'scaleTranspose',
        'scaleTrans',
        'chord',
        'noteToMidi',
        'midiToFreq',
        'sound',
        userCode
      );

      // Execute safely
      evalFn(
        trackBuilder,
        defPatternHelper,
        defPatternHelper,
        setBpmHelper,
        setCpmHelper,
        setCpmHelper,
        setBpmHelper,
        (notation: string) => notation,
        (notation: string) => notation,
        (instName: string) => instName,
        (plugName: string) => plugName,
        sliderHelper,
        sliderWithIDHelper,
        samplesHelper,
        soundAliasHelper,
        sine,
        saw,
        square,
        tri,
        rand,
        perlin,
        stackHelper,
        catHelper,
        seqHelper,
        fastcatHelper,
        slowcatHelper,
        arrangeHelper,
        pureHelper,
        valueHelper,
        polyrhythmHelper,
        scaleHelper,
        scaleTransposeHelper,
        scaleTransHelper,
        chordHelper,
        noteToMidiHelper,
        midiToFreqHelper,
        (arg: string) => arg,
      );

      // Swap in new tracks and patterns seamlessly
      this.evaluatedTracks = newTracks;
      this.sharedPatterns = newSharedPatterns;

      // Re-apply the persisted project mix so manual fader/Mute/Solo tweaks
      // survive re-evaluation. Tracks that vanished are pruned from storage.
      try {
        const persisted = loadMixerState();
        const ids = new Set(newTracks.keys());
        const stale = Object.keys(persisted).filter((id) => !ids.has(id));
        if (stale.length > 0) removeMixerTracks(stale);
        for (const [id, state] of Object.entries(persisted)) {
          const track = this.evaluatedTracks.get(id);
          if (!track) continue;
          if (Number.isFinite(state.gain)) track.gain = Math.min(1.5, Math.max(0, state.gain));
          if (state.pan !== null && state.pan !== undefined && Number.isFinite(state.pan)) {
            // Only override static pans — a Signal (LFO) from code keeps
            // sounding until the user grabs the fader (which persists a number).
            if (typeof track.pan === 'number') track.pan = Math.min(1, Math.max(-1, state.pan));
            else if (typeof track.pan !== 'object') track.pan = Math.min(1, Math.max(-1, state.pan));
          }
          if (state.cutoff !== null && state.cutoff !== undefined && Number.isFinite(state.cutoff)) {
            if (typeof track.cutoff === 'number') track.cutoff = Math.min(18000, Math.max(40, state.cutoff));
          }
          if (Number.isFinite(state.resonance)) track.resonance = Math.min(25, Math.max(0.1, state.resonance));
          if (Number.isFinite(state.reverbSend)) track.reverbSend = Math.min(1, Math.max(0, state.reverbSend));
          if (Number.isFinite(state.delaySend)) track.delaySend = Math.min(1, Math.max(0, state.delaySend));
          if (typeof state.muted === 'boolean') track.muted = state.muted;
          if (typeof state.solo === 'boolean') track.solo = state.solo;
        }
      } catch {
        /* persistence is best-effort */
      }
      this.notifyTracks();

      // Sync per-track VST routes into the bridge (code wins over manual
      // overrides; tracks without .vst() fall back to manual/global).
      try {
        vstBridge.syncCodeRoutes(
          Array.from(this.evaluatedTracks.entries())
            .filter(([, t]) => t.instrument === 'vst_bridge' || t.vstPlugin != null || t.vstChannel != null || t.vstOutputId != null)
            .map(([id, t]) => ({ trackId: id, plugin: t.vstPlugin, channel: t.vstChannel, outputId: t.vstOutputId }))
        );
      } catch (err) {
        logger.warn('vst', `route sync failed: ${(err as Error)?.message || err}`);
      }

      logger.success('eval', `Evaluated ${newTracks.size} ${newTracks.size === 1 ? 'track' : 'tracks'}`);
      return { success: true };
    } catch (err: any) {
      const message = err?.message || String(err);
      logger.error('eval', message);
      return { success: false, error: message };
    }
  }

  private seedDefaultPatterns() {
    this.sharedPatterns.set('kick_groove', 'bd ~ bd [~ bd]');
    this.sharedPatterns.set('hats', '[~ hh*2] [~ hh] [~ hh*2] [oh ~]');
    this.sharedPatterns.set('clap_snare', '~ cp ~ [cp*2 ~]');
    this.sharedPatterns.set('acid_riff', 'c2 [c2 eb2] g2 [bb2 c3]');
    this.sharedPatterns.set('amen_slices', 'amen:0 [amen:1 amen:2] amen:0 [amen:3 ~]');
  }
}

export const patternScheduler = new PatternScheduler();
