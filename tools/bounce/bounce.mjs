// PulseGrid offline bounce (CLI version of the engine).
//
// Renders demos/STRUDEL_DEMO.js to per-track WAVs with the REAL PatternScheduler
// events + a pure-JS port of the AudioEngine voice chain, so `npm run`
//-less validation doesn't need a browser.
//
//   node tools/bounce/bounce.mjs [--cycles 4] [--rate 48000] [--out tools/bounce/out]
//
// What is faithful (bugs here would be violent):
//   - event timing/pitch/velocity from PatternScheduler.computePatternEvents
//   - sample slice selection (bd:4 etc, bank wrap), full-slice playback
//   - linear ADSR envelopes (both sample + synth paths, incl. att-only => sus 1)
//   - static per-voice lowpass (biquad RBJ, Q 0.8 sample / 1.0 synth)
//   - distort scurve y=((1+k)x)/(1+k|x|), k=expm1(clamp01) + crush staircase
//   - osc pitch incl. vib FM (vib Hz, vibmod semitones->cents, default 0.5st)
//   - wt_digital_bad_day: first 2048-sample frame looped (superdough default
//     position 0), pitched by baseFreq*cycle.duration
//   - track fader gain (velocity * track.gain), equal-power pan
//   - duckorbit dip 1-sqrt(depth) with onset/attack recovery on orbit tracks
//   - per-track echo time (explicit .delaytime() or SPC*3/16 default), stereo
//     ping-pong taps with 2600Hz damping + 0.5 return, scaled by .delay() send
//
// Approximations (engine COLOR, not arrangement — expect CLOSE not null):
//   - oscillators are naive (aliasing) vs browser bandlimited OscillatorNode
//   - reverb is a deterministic Freeverb-ish comb/allpass network, not the
//     engine's generated-IR convolver (which uses Math.random anyway)
//   - no master compressor, no chorus/phaser/leslie/vowel/fshift/warp inserts
//     (chorus is a no-op in the engine too; others unused by STRUDEL_DEMO)
//   - delay damping uses one-pole 2600Hz instead of the engine biquad
//
// Exit 0 always (it is a renderer); validation lives in compare-refs.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patternScheduler } from '../../src/audio/PatternScheduler.ts';
import { noteToMidi } from '../../src/audio/MiniNotationParser.ts';
import { readWav, writeWav } from '../compare-audio/lib/wav.mjs';
import { lowpassCoeffs, midiToFreq, panGains } from '../compare-audio/lib/dsp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC = path.join(here, '..', '..');
const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const CYCLES = parseInt(getArg('--cycles', '4'), 10);
const RATE = parseInt(getArg('--rate', '48000'), 10);
const OUT = path.resolve(getArg('--out', path.join(here, 'out')));
fs.mkdirSync(OUT, { recursive: true });

// ---------- samples ----------
const manifest = JSON.parse(fs.readFileSync(path.join(MUSIC, 'public', 'samples', 'strudel.json'), 'utf8'));
const PACK_DIR = path.join(MUSIC, 'public', 'samples');
const sampleCache = new Map();
function sampleFile(bank, index) {
  const files = manifest[bank];
  if (!files?.length) return null;
  const w = ((index % files.length) + files.length) % files.length;
  return path.join(PACK_DIR, files[w]);
}
function loadSampleMono(file, rate) {
  const key = file + '@' + rate;
  if (sampleCache.has(key)) return sampleCache.get(key);
  const wav = readWav(file);
  // mono mix
  let mono = new Float32Array(wav.frames);
  for (let c = 0; c < wav.channels; c++) for (let i = 0; i < wav.frames; i++) mono[i] += wav.data[c][i] / wav.channels;
  if (wav.sampleRate !== rate) {
    const ratio = wav.sampleRate / rate;
    const out = new Float32Array(Math.max(1, Math.round(mono.length / ratio)));
    for (let i = 0; i < out.length; i++) {
      const p = i * ratio, i0 = Math.floor(p), f = p - i0;
      out[i] = mono[Math.min(i0, mono.length - 1)] * (1 - f) + mono[Math.min(i0 + 1, mono.length - 1)] * f;
    }
    mono = out;
  }
  const e = { data: mono, rate };
  sampleCache.set(key, e);
  return e;
}
// alias map from demo `import { ry30_bd as bd ... }`
const ALIAS = { bd: 'ry30_bd', oh: 'ry30_oh', cp: 'ry30_cp', hh: 'ry30_hh' };
function resolveSample(token) {
  const [rawBase, rawIdx] = String(token).split(':');
  const base = rawBase.toLowerCase();
  const bank = manifest[base] ? base : ALIAS[base] ? ALIAS[base] : null;
  if (!bank) return null;
  const idx = rawIdx != null && rawIdx !== '' ? parseInt(rawIdx, 10) : 0;
  const file = sampleFile(bank, isFinite(idx) ? idx : 0);
  if (!file || !fs.existsSync(file)) return null;
  return loadSampleMono(file, RATE);
}
// wavetable cycle: first 2048-sample frame of the long bank file
let wtCycle = null;
function getWtCycle() {
  if (wtCycle) return wtCycle;
  const files = manifest['wt_digital_bad_day'] || [];
  if (!files.length) return null;
  const wav = readWav(path.join(PACK_DIR, files[0]));
  let mono = new Float32Array(wav.frames);
  for (let c = 0; c < wav.channels; c++) for (let i = 0; i < wav.frames; i++) mono[i] += wav.data[c][i] / wav.channels;
  const N = 2048, XF = 64;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = mono[i % mono.length] ?? 0;
  const head = out[0];
  for (let i = 0; i < XF; i++) { const t = i / XF; out[N - XF + i] = out[N - XF + i] * (1 - t) + head * t; }
  out[N - 1] = head;
  wtCycle = out;
  return out;
}

// ---------- DSP helpers (AudioEngine ports) ----------
function distortCurve(amount) {
  const k = Math.expm1(Math.max(0, Math.min(1, amount)));
  return (x) => ((1 + k) * x) / (1 + k * Math.abs(x));
}
function crushCurve(bits) {
  const levels = Math.pow(2, Math.max(1, Math.min(16, Math.round(bits))) - 1);
  return (x) => Math.round(x * levels) / levels;
}
function oscSample(type, phase) {
  const p = phase % 1;
  if (type === 'square') return p < 0.5 ? 1 : -1;
  if (type === 'triangle') return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  if (type === 'sine') return Math.sin(2 * Math.PI * p);
  return 2 * p - 1; // saw default
}
function applyBiquadLowpass(x, freq, Q) {
  const { b0, b1, b2, a1, a2 } = lowpassCoeffs(RATE, freq, Q);
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y0 = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y0;
  }
  return out;
}
// one-pole lowpass for delay damping (cheap approx of engine biquad @2600)
function dampOnce(x, cutoff = 2600) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); out[i] = y; }
  return out;
}

// voice render -> mono Float32Array (includes ADSR, filter, distort/crush, vib)
function renderVoiceMono(ev, track) {
  const fx = ev.voice || {};
  const isSample = ev.sample != null;
  const hasAdsr = fx.attack != null || fx.decay != null || fx.sustain != null || fx.release != null;
  let attack, decay, sustain, release;
  if (!hasAdsr) {
    if (isSample) { attack = 0.001; decay = 0.001; sustain = 1; release = 0.01; }
    else {
      // instrument defaults for basic synths
      attack = 0.001; decay = 0.05; sustain = 0.6; release = 0.01;
    }
  } else {
    const a = fx.attack, d = fx.decay, s = fx.sustain, r = fx.release;
    sustain = s != null && isFinite(s) ? Math.max(0, Math.min(1, s))
      : ((a != null && d == null) || (a == null && d == null) ? 1 : 0.001);
    attack = Math.max(a ?? 0, 0.001); decay = Math.max(d ?? 0, 0.001); release = Math.max(r ?? 0, 0.01);
  }
  const vibRate = fx.vib != null && isFinite(fx.vib) ? fx.vib : 0;
  const vibCents = 100 * (0.5); // engine default vibmod 0.5 st; demo never sets vibmod
  let mono;
  let holdDur;
  if (isSample) {
    const src = resolveSample(ev.sample);
    if (!src) return new Float32Array(0);
    const buf = src.data;
    const sliceLen = buf.length; // full slice (no begin/end in demo)
    holdDur = Math.max(attack + 0.01, ev.dur);
    const total = Math.ceil((holdDur + release) * RATE);
    mono = new Float32Array(total);
    const peak = ev.gain, sus = ev.gain * sustain;
    for (let i = 0; i < total; i++) {
      const t = i / RATE;
      const s = buf[Math.min(i, sliceLen - 1)] ?? 0; // engine plays slice from offset, not looped
      // linear ADSR matching engine sample path
      let env;
      const envDur = holdDur;
      if (t >= envDur + release) env = 0;
      else if (t >= envDur) env = sus * (1 - (t - envDur) / release);
      else if (attack > envDur && t < envDur) env = (t / Math.max(1e-4, attack)) * peak;
      else if (t < attack) env = (t / Math.max(1e-4, attack)) * peak;
      else if (attack + decay > envDur && t < envDur) {
        const k2 = (t - attack) / Math.max(1e-4, decay);
        env = peak + (sus - peak) * Math.min(1, Math.max(0, k2));
      } else if (t < attack + decay) {
        const k2 = (t - attack) / Math.max(1e-4, decay);
        env = peak + (sus - peak) * Math.min(1, Math.max(0, k2));
      } else env = sus;
      mono[i] = (i < sliceLen ? s : 0) * env;
    }
  } else {
    const freq = midiToFreq(ev.midi);
    const osc = ['square', 'triangle', 'sine'].includes(ev.osc) ? ev.osc : 'saw';
    const dur = Math.max(0.02, ev.dur);
    const total = Math.ceil((dur + release) * RATE);
    mono = new Float32Array(total);
    const peak = 0.3 * ev.gain;
    const susVal = 0.001 + sustain * (peak - 0.001);
    let phase = 0;
    const cyc = getWtCycle();
    const useWt = /wt_digital/i.test(track.instrument || '') || ev.approxOsc === 'wt';
    for (let i = 0; i < total; i++) {
      const t = i / RATE;
      let amp;
      if (t >= dur + release) amp = 0;
      else if (t >= dur) amp = Math.max(0.001, susVal) * (1 - (t - dur) / release);
      else if (attack > dur && t < dur) amp = 0.001 + (peak - 0.001) * (t / Math.max(1e-4, attack));
      else if (t < attack) amp = 0.001 + (peak - 0.001) * (t / Math.max(1e-4, attack));
      else if (attack + decay > dur && t < dur) {
        const k2 = (t - attack) / Math.max(1e-4, decay);
        amp = peak + (susVal - peak) * Math.min(1, Math.max(0, k2));
      } else if (t < attack + decay) {
        const k2 = (t - attack) / Math.max(1e-4, decay);
        amp = peak + (susVal - peak) * Math.min(1, Math.max(0, k2));
      } else amp = susVal;
      // vib FM
      let f = freq;
      if (vibRate > 0) f = freq * Math.pow(2, (Math.sin(2 * Math.PI * vibRate * t) * vibCents) / 1200);
      let s;
      if (useWt && cyc) {
        const pos = phase * cyc.length;
        const i0 = Math.floor(pos) % cyc.length, i1 = (i0 + 1) % cyc.length, fr = pos - Math.floor(pos);
        s = cyc[i0] * (1 - fr) + cyc[i1] * fr;
      } else s = oscSample(osc, phase);
      mono[i] = s * amp;
      phase = (phase + f / RATE) % 1;
    }
  }
  // inserts: crush -> distort (engine order)
  const crushBits = fx.crush ?? fx.coarse;
  if (crushBits != null && isFinite(crushBits)) {
    const fn = crushCurve(crushBits);
    for (let i = 0; i < mono.length; i++) mono[i] = fn(mono[i]);
  }
  for (const key of ['distort', 'shape', 'drive']) {
    const v = fx[key];
    if (v != null && v > 0) {
      const amt = key === 'drive' ? Math.min(1, v * 0.5) : v;
      const fn = distortCurve(amt);
      for (let i = 0; i < mono.length; i++) mono[i] = fn(mono[i]);
    }
  }
  // static lowpass
  if (fx.cutoff != null && isFinite(fx.cutoff) && fx.cutoff < 17000) {
    mono = applyBiquadLowpass(mono, Math.max(40, Math.min(18000, fx.cutoff)), isSample ? 0.8 : 1);
  }
  return mono;
}

// ---------- evaluate code ----------
const code = fs.readFileSync(path.join(MUSIC, 'demos/STRUDEL_DEMO.js'), 'utf8');
const res = patternScheduler.evaluateCode(code);
if (!res.success) { console.error('EVAL FAILED: ' + res.error); process.exit(1); }
const cpm = patternScheduler.getCpm();
const SPC = 60 / cpm;
const tracks = [...patternScheduler.evaluatedTracks.values()];
console.log(`cpm=${cpm} spc=${SPC.toFixed(4)}s tracks=${tracks.map(t=>t.id).join(',')}`);

const toMidiOrSample = (v) => {
  const t = v.trim();
  const n = t.match(/^(n:|note:)?(-?\d+)$/);
  if (n) return { midi: parseInt(n[2], 10) };
  const m = noteToMidi(t);
  if (m !== null) return { midi: m };
  return { sample: t.toLowerCase() };
};

// collect events per track over [0, CYCLES)
const dur = CYCLES * SPC + 2.5; // + tail for delay/reverb
const total = Math.ceil(dur * RATE);
const trackBufs = new Map(); // id -> {left,right}
for (const t of tracks) trackBufs.set(t.id, { left: new Float32Array(total), right: new Float32Array(total), track: t });

const allDuckTriggers = []; // {t, targets:[orbit], onset, attack, depth}
for (const track of tracks) {
  const buf = trackBufs.get(track.id);
  for (let c = 0; c < CYCLES; c++) {
    const evs = patternScheduler.computePatternEvents(track, c, 0, SPC, c * SPC, (c + 1) * SPC);
    for (const ev of evs) {
      const conv = toMidiOrSample(ev.finalValue);
      const voice = ev.voice || {};
      const isBasicOsc = ['square','saw','sawtooth','triangle','sine'].includes((track.instrument||'').toLowerCase()) || conv.midi != null;
      const osc = (track.instrument || 'saw').toLowerCase();
      const e = {
        t: ev.scheduledTime, dur: Math.max(0.02, ev.actualDuration),
        gain: ev.velocity * track.gain, // fader applied once (engine parity)
        pan: voice.pan ?? 0, cutoff: voice.cutoff ?? 18000,
        ...conv, osc,
        approxOsc: /wt/i.test(track.instrument||'') ? 'wt' : undefined,
        voice,
      };
      const mono = renderVoiceMono(e, track);
      if (!mono.length) continue;
      const [gl, gr] = panGains(e.pan);
      const start = Math.floor(e.t * RATE);
      for (let i = 0; i < mono.length && start + i < total; i++) {
        buf.left[start + i] += mono[i] * gl;
        buf.right[start + i] += mono[i] * gr;
      }
      if (track.duckOrbit != null) {
        allDuckTriggers.push({ t: e.t, targets: String(track.duckOrbit).split(':').map(Number).filter(isFinite), onset: track.duckOnset ?? 0, attack: track.duckAttack ?? 0.1, depth: track.duckDepth ?? 1 });
      }
    }
  }
}
// ducking: multiplicative envelope on orbit tracks
const orbitOf = new Map(tracks.map(t => [t.id, t.orbit]));
for (const [id, buf] of trackBufs) {
  const orb = orbitOf.get(id);
  if (orb == null) continue;
  const hits = allDuckTriggers.filter(h => h.targets.includes(orb));
  if (!hits.length) continue;
  const env = new Float32Array(total).fill(1);
  for (const h of hits) {
    const duckedVal = Math.min(1, Math.max(0.01, 1 - Math.sqrt(Math.max(0, h.depth))));
    const t0 = Math.floor(h.t * RATE);
    const onsN = Math.max(1, Math.floor(Math.max(0, h.ons) * RATE));
    const atkN = Math.max(2, Math.floor(Math.max(0.002, h.attack) * RATE));
    // dip
    for (let i = 0; i < onsN && t0 + i < total; i++) {
      const k = (i + 1) / onsN;
      env[t0 + i] = Math.min(env[t0 + i], 1 + (duckedVal - 1) * k);
    }
    // recover exponential-ish
    for (let i = 0; i < atkN && t0 + onsN + i < total; i++) {
      const k = (i + 1) / atkN;
      const v = duckedVal + (1 - duckedVal) * (1 - Math.exp(-4 * k)) / (1 - Math.exp(-4));
      const idx = t0 + onsN + i;
      env[idx] = Math.min(env[idx], v);
    }
  }
  for (let i = 0; i < total; i++) { buf.left[i] *= env[i]; buf.right[i] *= env[i]; }
}
// per-track ping-pong echo (feedforward taps, damped)
for (const [id, buf] of trackBufs) {
  const t = buf.track;
  const send = t.delaySend ?? 0;
  if (!(send > 0.001)) continue;
  const echo = (typeof t.delayTime === 'number' && isFinite(t.delayTime)) ? Math.max(0.01, Math.min(2, t.delayTime)) : Math.max(0.01, Math.min(2, (SPC * 3) / 16));
  const fb = typeof t.delayFeedback === 'number' && isFinite(t.delayFeedback) ? Math.max(0, Math.min(0.98, t.delayFeedback)) : 0.42;
  const echoR = Math.min(2, echo * 1.35);
  let tapL = Float32Array.from(buf.left), tapR = Float32Array.from(buf.right);
  for (let k = 1; k <= 8; k++) {
    const g = send * Math.pow(fb, k) * 0.5;
    if (g < 0.001) break;
    const dL = Math.floor(echo * RATE * (k % 2 === 1 ? 1 : 1) + (k > 1 ? 0 : 0));
    // alternate ping-pong: odd taps cross to other channel
    const offL = Math.floor((k % 2 === 1 ? echo : echoR) * 0 + (k * echo) * RATE);
    const off = Math.floor(k * echo * RATE);
    if (off >= total) break;
    let seg = new Float32Array(total);
    for (let i = 0; i + off < total; i++) seg[i + off] = (tapL[i] + tapR[i]) / 2;
    seg = dampOnce(seg); // progressive damping approx (re-damped each tap)
    for (let pass = 1; pass < k; pass++) seg = dampOnce(seg);
    for (let i = off; i < total; i++) {
      if (k % 2 === 1) { buf.left[i] += seg[i] * g; buf.right[i] += seg[i] * g * 0.7; }
      else { buf.right[i] += seg[i] * g; buf.left[i] += seg[i] * g * 0.7; }
    }
    void dL; void offL;
  }
}
// cheap deterministic room (Freeverb-ish): 4 combs + 2 allpass, mono-ized send
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function applyRoom(left, right, send, size) {
  if (!(send > 0.001)) return;
  const combDelays = [1116, 1188, 1277, 1356].map(d => Math.floor(d * RATE / 44100));
  const combFb = 0.84;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
  const wet = new Float32Array(left.length);
  const rnd = mulberry(1234);
  for (const d of combDelays) {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < mono.length; i++) {
      const v = mono[i] + line[idx] * combFb;
      line[idx] = v;
      wet[i] += v * 0.25;
      idx = (idx + 1) % d;
    }
  }
  // two allpass
  for (const d of [Math.floor(353 * RATE / 44100), Math.floor(109 * RATE / 44100)]) {
    const line = new Float32Array(d).fill(0);
    let idx = 0;
    for (let i = 0; i < wet.length; i++) {
      const bufOut = line[idx];
      const v = wet[i] + bufOut * 0.5;
      line[idx] = v;
      wet[i] = bufOut - wet[i] * 0.5;
      idx = (idx + 1) % d;
    }
  }
  const g = send * (0.45 + Math.max(0, Math.min(1, size ?? 0.5)) * 0.2);
  for (let i = 0; i < left.length; i++) { left[i] += wet[i] * g; right[i] += wet[i] * g * (rnd() > 0.5 ? 0.9 : 1.0); }
}
for (const [, buf] of trackBufs) applyRoom(buf.left, buf.right, buf.track.room ?? buf.track.reverbSend ?? 0, buf.track.size);

// write stems (trim to cycles + 1.5s tail? reference is exactly 4 cycles = 72911 @48k; keep full then trim)
const keepFrames = Math.floor(CYCLES * SPC * RATE);
const REFMAP = { kick: 'bd', hh: 'hh', oh: 'oh', cp: 'cp', bass_sq: 'sqare', bass_saw: 'saw', bass_tri: 'triangle', lead_chords: 'chords', lead_wt: 'wt', lead_top: 'sparkle' };
const mixL = new Float32Array(total), mixR = new Float32Array(total);
for (const [id, buf] of trackBufs) {
  const name = REFMAP[id] || id;
  writeWav(path.join(OUT, `${name}.wav`), [buf.left.subarray(0, keepFrames), buf.right.subarray(0, keepFrames)], RATE);
  for (let i = 0; i < total; i++) { mixL[i] += buf.left[i]; mixR[i] += buf.right[i]; }
  console.log(`wrote ${name}.wav (${id}) peak=${Math.max(...Array.from({length: 2000}, (_, i) => Math.abs(buf.left[Math.floor(i * keepFrames / 2000)]))).toFixed(3)}`);
}
writeWav(path.join(OUT, `mix.wav`), [mixL.subarray(0, keepFrames), mixR.subarray(0, keepFrames)], RATE);
console.log(`wrote mix.wav frames=${keepFrames} rate=${RATE}`);
