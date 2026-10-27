// Neutral offline renderer: turns an event list into stereo audio with ONE
// shared DSP chain, so Strudel-vs-PulseGrid renders differ ONLY in the events
// (timing, pitch, sample choice, gain, pan, filter) — never in the synth.
//
// Deliberately neutral: no delay/room/chorus/distort/crush/ducking/vibrato.
// Those engine FX are excluded by design; compare real recorded bounces with
// `compare.mjs files` to characterize engine color (see README).
//
// Voice conventions mirror the documented common ground of both engines:
// square/saw/triangle = pure oscillators, linear ADSR [1ms, 50ms, 0.6, 10ms],
// peak 0.3 * velocity; one-shot samples play at unity pitch.

import { biquadLowpass, midiToFreq, oscSample, panGains } from './dsp.mjs';

export const RENDER_RATE = 44100;

function renderOsc(ev, sampleRate) {
  const freq = midiToFreq(ev.midi);
  const peak = 0.3 * (ev.gain ?? 1);
  const attack = 0.001;
  const decay = 0.05;
  const sustain = 0.6;
  const release = 0.01;
  const dur = Math.max(0.02, ev.dur);
  const total = dur + release;
  const n = Math.max(8, Math.ceil(total * sampleRate));
  const out = new Float32Array(n);
  const susVal = 0.001 + sustain * (peak - 0.001);
  let phase = 0;
  const step = freq / sampleRate;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let amp;
    if (t < attack) amp = 0.001 + (peak - 0.001) * (t / Math.max(1e-6, attack));
    else if (t < attack + decay && t < dur) {
      const k = (t - attack) / Math.max(1e-6, decay);
      amp = peak + (susVal - peak) * Math.min(1, k);
    } else if (t < dur) amp = susVal;
    else amp = Math.max(0.001, susVal) * (1 - (t - dur) / release);
    // attack longer than note: partial ramp (mirrors engine behavior)
    if (attack > dur && t < dur) amp = 0.001 + (peak - 0.001) * (t / Math.max(1e-6, attack));
    out[i] = oscSample(ev.osc || 'saw', phase) * amp;
    phase = (phase + step) % 1;
  }
  return out;
}

function renderSample(ev, sampleRate, sampleProvider) {
  const src = sampleProvider(ev.sample);
  if (!src) return new Float32Array(0);
  let data = src.data;
  if (src.rate !== sampleRate) {
    // Cheap linear resample (all vendored samples are 44100; this is a fallback).
    const ratio = src.rate / sampleRate;
    const len = Math.max(1, Math.round(data.length / ratio));
    const rs = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      rs[i] = data[Math.min(i0, data.length - 1)] * (1 - f) + data[Math.min(i0 + 1, data.length - 1)] * f;
    }
    data = rs;
  }
  const playLen = Math.min(data.length, Math.floor(Math.max(0.05, ev.dur * 1.5) * sampleRate));
  const relN = Math.min(Math.floor(0.06 * sampleRate), playLen);
  // Fade the last relN played samples out (linear release, no extra tail).
  const out = new Float32Array(playLen);
  const gain = ev.gain ?? 1;
  const atk = Math.min(Math.floor(0.002 * sampleRate), playLen);
  for (let i = 0; i < playLen; i++) {
    let env = gain;
    if (i < atk) env *= i / Math.max(1, atk);
    const relIdx = i - (playLen - relN);
    if (relIdx >= 0) env *= 1 - relIdx / Math.max(1, relN);
    out[i] = data[i] * env;
  }
  return out;
}

/**
 * @param events [{t, dur, midi?, sample?, osc?, gain?, pan?, cutoff?}]
 * @param opts {sampleRate, durationSec, sampleProvider}
 * @returns {left, right, sampleRate}
 */
export function renderEvents(events, { sampleRate = RENDER_RATE, durationSec, sampleProvider }) {
  const total = Math.ceil(durationSec * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (const ev of events) {
    const start = Math.floor(ev.t * sampleRate);
    if (start >= total) continue;
    let mono;
    if (ev.sample) mono = renderSample(ev, sampleRate, sampleProvider);
    else if (typeof ev.midi === 'number') mono = renderOsc(ev, sampleRate);
    else continue;
    if (mono.length === 0) continue;
    let shaped = mono;
    if (ev.cutoff != null && isFinite(ev.cutoff) && ev.cutoff < 17000) {
      shaped = biquadLowpass(mono, sampleRate, ev.cutoff, 0.8);
    }
    const [gl, gr] = panGains(ev.pan ?? 0);
    const n = Math.min(shaped.length, total - start);
    for (let i = 0; i < n; i++) {
      left[start + i] += shaped[i] * gl;
      right[start + i] += shaped[i] * gr;
    }
  }
  return { left, right, sampleRate };
}
