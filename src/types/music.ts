export type SynthType =
  | 'acid_303'
  | 'sub_bass'
  | 'poly_saw'
  | 'fm_bell'
  | 'pluck'
  | 'chiptune'
  | 'square'
  | 'saw'
  | 'sine'
  | 'triangle'
  | 'drum_kit'
  | 'sampler'
  | 'vst_bridge'
  | 'wt_digital'
  | 'custom';

export interface InstrumentConfig {
  id: string;
  name: string;
  type: SynthType;
  oscillatorType: OscillatorType;
  detune: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterCutoff: number;
  filterResonance: number;
  filterEnvAmount: number;
  fmRatio?: number;
  fmIndex?: number;
  drive?: number;
  vstPluginName?: string;
}

export interface SampleItem {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  duration: number;
  trimStart: number; // 0 to 1
  trimEnd: number; // 0 to 1
  loop: boolean;
  gain: number;
  pitch: number; // semitones (-24 to +24)
  isUserUploaded?: boolean;
}

export interface ScheduledEvent {
  time: number; // AudioContext absolute time in seconds
  cycleTime: number; // 0 to 1 fraction within cycle
  duration: number; // duration in seconds
  value: string; // token e.g. "bd", "c3", "amen:2"
  type: 'sample' | 'note' | 'midi';
  midiNote?: number;
  velocity: number;
  trackId: string;
  instrumentId?: string;
}

/**
 * Per-track inline visualization widgets, mirroring Strudel's widget
 * methods (`_pianoroll`, `_spiral`, `_scope`, `_spectrum`, `_pitchwheel`,
 * ...) from @strudel/codemirror `widget.mjs` + @strudel/draw + @strudel/webaudio.
 * The underscore aliases (`_pianoroll(...)`) are accepted as well for
 * pasted-Strudel compatibility; they behave identically.
 */
export type TrackVizType =
  | 'scope'
  | 'meter'
  | 'pianoroll'
  | 'punchcard'
  | 'wordfall'
  | 'spiral'
  | 'spectrum'
  | 'fscope'
  | 'pitchwheel';

export interface TrackVizWidget {
  type: TrackVizType;
  /** JSON-safe primitive options (cycles, size, playhead, labels, ...). */
  options?: Record<string, number | string | boolean>;
}

/** A numeric track param that may be modulated per-event (LFO or rotating pattern). */
export type ModParam = number | string | import('../audio/Signals').Signal;

export interface TrackChannel {
  id: string;
  name: string;
  patternName?: string;
  patternCode?: string;
  instrument: string;
  gain: number;
  pan: number | import('../audio/Signals').Signal;
  cutoff: number | import('../audio/Signals').Signal;
  /** True when the code drives this param with a Signal (LFO/pattern). */
  panModulated?: boolean;
  cutoffModulated?: boolean;
  resonance: number;
  reverbSend: number;
  delaySend: number;
  muted: boolean;
  solo: boolean;
  currentPeak: number;
  hasScope?: boolean;
  hasMeter?: boolean;
  /** Inline visualization widgets requested via track chain methods. */
  widgets?: TrackVizWidget[];
  // Per-track VST bridge routing (undefined = fall back to global bridge defaults)
  vstPlugin?: string;
  vstChannel?: number; // 0-15
  vstOutputId?: string | null;
  // ---- Strudel-parity FX (all optional so old sessions still load) ----
  /** Amplitude envelope overrides (seconds / level). Undefined = instrument default. */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Duration multiplier (Strudel `legato`). 1 = hold full step. */
  legato?: number;
  /** Reverb mix alias (`room`) — mirrors reverbSend. */
  room?: number;
  /** Reverb room size 0..1 (`size`). */
  size?: number;
  /** Chorus mix 0..2 (`chorus`). */
  chorus?: number;
  /** Waveshape drive 0..1 (`distort`). */
  distort?: number;
  /** Bit-crush depth (`crush`), e.g. 4 = 16 levels. Accepts rotating "<4 4 4 6>". */
  crush?: ModParam;
  /** Per-track echo time in seconds (`delaytime`). */
  delayTime?: number;
  /** Per-track echo feedback 0..0.98 (`delayfeedback`). */
  delayFeedback?: number;
  /** Vibrato rate in Hz (`vib`). Depth defaults to 0.5 semitones (`vibmod`). */
  vib?: number;
  vibmod?: number;
  /** Output bus number (`orbit`). */
  orbit?: number;
  /** Sidechain duck targets (`duckorbit`), e.g. 2 or "2:3". */
  duckOrbit?: number | string;
  duckAttack?: number;
  duckDepth?: number;
  duckOnset?: number;
  /** Display tint (`color`) — no audio effect. */
  color?: string;
  // ---- Pattern transforms (display/state parity; audio applied in scheduler) ----
  rev?: boolean;
  palindrome?: boolean;
  iterN?: number;
  chopN?: number;
  striateN?: number;
  plyN?: number;
  degradeP?: number;
  structPat?: string | null;
  swingAmt?: number;
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

// A per-track VST route. Partial: undefined fields fall back to the
// manual override, then to the global bridge defaults at send time.
export interface VstTrackRoute {
  trackId: string;
  plugin?: string;
  channel?: number; // 0-15
  outputId?: string | null;
  source: 'code' | 'manual';
}

export interface SharedThemeData {
  themeId: string;
  fontId: string;
  customFontStack: string;
  fontSize: number;
  customCss: string;
}

export interface PatternDefinition {
  name: string;
  notation: string;
  source: 'code' | 'midi' | 'imported';
  rawEvents?: ScheduledEvent[];
  updatedAt: number;
}

export interface MidiBinding {
  id: string;
  cc: number;
  channel: number;
  targetType: 'track' | 'master' | 'send';
  trackId?: string;
  param: 'gain' | 'pan' | 'cutoff' | 'resonance' | 'reverbSend' | 'delaySend' | 'cpm';
  min: number;
  max: number;
  label: string;
}

export interface MidiRecordedClip {
  id: string;
  name: string;
  durationBeats: number;
  notes: {
    note: number;
    velocity: number;
    startBeat: number;
    durationBeats: number;
  }[];
}

export interface VstBridgeStatus {
  enabled: boolean;
  connected: boolean;
  port: number;
  activePlugin: string;
  latencyOffsetMs: number;
  simulatedMode: boolean;
}

export interface PerformanceProject {
  id: string;
  title: string;
  cpm: number;
  code: string;
  patterns: Record<string, string>;
  customInstruments: InstrumentConfig[];
  midiBindings: MidiBinding[];
  updatedAt: number;
}
