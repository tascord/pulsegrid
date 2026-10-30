// Zero-lag diagnostic: ref vs dut at fixed lag 0 (both start at cycle 0).
// Reports level, null residual, env correlation, onset times, and dominant
// pitch per voiced segment — no lag search to confuse periodic material.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav, toMono } from '../compare-audio/lib/wav.mjs';
import { rms, peak, dbfs, rmsEnvelope, correlation, spectralCentroid, magnitudeSpectrum } from '../compare-audio/lib/dsp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(here, '..', '..', '_reference');
const DUT = path.join(here, 'out');
const STEMS = ['bd', 'hh', 'oh', 'cp', 'sqare', 'saw', 'triangle', 'chords', 'wt', 'sparkle'];

function onsets(mono, rate) {
  const { env } = rmsEnvelope(mono, rate);
  const max = Math.max(1e-9, ...env);
  const th = 0.15 * max;
  const out = [];
  for (let i = 1; i < env.length; i++) if (env[i - 1] < th && env[i] >= th) out.push(i * (env.length > 0 ? (mono.length / env.length) : 0) / rate);
  // debounce 40ms
  return out.filter((t, i) => i === 0 || t - out[i - 1] > 0.04);
}
function pitchAC(seg, rate) {
  // autocorrelation fundamental in 40..2000Hz
  const n = seg.length;
  let bestLag = 0, best = 0;
  const minLag = Math.floor(rate / 2000), maxLag = Math.floor(rate / 40);
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += seg[i] * seg[i];
  if (e0 < 1e-12) return 0;
  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i += 2) s += seg[i] * seg[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag ? rate / bestLag : 0;
}
for (const s of STEMS) {
  const r = readWav(path.join(REF, `${s}.wav`));
  const d = readWav(path.join(DUT, `${s}.wav`));
  const rm = toMono(r), dm = toMono(d);
  const n = Math.min(rm.length, dm.length);
  const rr = rm.subarray(0, n), dd = dm.subarray(0, n);
  // level match (least squares) + residual at lag 0
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += rr[i] * dd[i]; den += dd[i] * dd[i]; }
  const g = den > 1e-18 ? num / den : 1;
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = rr[i] - dd[i] * g;
  const { env: eR } = rmsEnvelope(rr, r.sampleRate);
  const { env: eD } = rmsEnvelope(dd, d.sampleRate);
  const ro = onsets(rr, r.sampleRate), doo = onsets(dd, d.sampleRate);
  console.log(`\n== ${s} (rate ${r.sampleRate}/${d.sampleRate}, ${n / r.sampleRate}s)`);
  console.log(`   level: ref rms ${dbfs(rms(rr)).toFixed(1)}dB peak ${dbfs(peak(rr)).toFixed(1)}dB | dut rms ${dbfs(rms(dd)).toFixed(1)}dB peak ${dbfs(peak(dd)).toFixed(1)}dB | match ${ (20 * Math.log10(Math.max(1e-9, Math.abs(g)))).toFixed(2)}dB`);
  console.log(`   zero-lag: resid ${dbfs(rms(res)).toFixed(1)}dBFS envCorr ${correlation(eR, eD).toFixed(4)}`);
  console.log(`   onsets ref[${ro.length}]: ${ro.map(t => t.toFixed(3)).join(' ')}`);
  console.log(`   onsets dut[${doo.length}]: ${doo.map(t => t.toFixed(3)).join(' ')}`);
  // pitched stems: pitch at 3 probe times
  if (['sqare', 'saw', 'triangle', 'chords', 'wt', 'sparkle'].includes(s)) {
    for (const t of [0.1, 0.5, 0.9, 1.3]) {
      const i0 = Math.floor(t * r.sampleRate), L = Math.floor(0.08 * r.sampleRate);
      const pr = pitchAC(rr.subarray(i0, i0 + L), r.sampleRate);
      const pd = pitchAC(dd.subarray(i0, i0 + L), d.sampleRate);
      console.log(`   pitch@${t}s: ref ${pr.toFixed(1)}Hz dut ${pd.toFixed(1)}Hz`);
    }
  }
}
