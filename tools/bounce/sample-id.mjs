// Sample-ID: which vendored file best matches each reference drum hit?
// Correlates every bank variant against the first reference onset segment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav, toMono } from '../compare-audio/lib/wav.mjs';
import { rms, dbfs, correlation } from '../compare-audio/lib/dsp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC = path.join(here, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(MUSIC, 'public', 'samples', 'strudel.json'), 'utf8'));

function loadMono(file) {
  const w = readWav(file);
  return { data: toMono(w), rate: w.sampleRate };
}
function segAt(mono, rate, t, len) {
  const i0 = Math.floor(t * rate);
  return mono.subarray(i0, Math.min(mono.length, i0 + Math.floor(len * rate)));
}
// first strong onset via threshold on envelope
function firstOnset(mono, rate) {
  const hop = Math.floor(rate / 100);
  const n = Math.ceil(mono.length / hop);
  let max = 0;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < Math.min(mono.length, (i + 1) * hop); j++) s += mono[j] * mono[j];
    env[i] = Math.sqrt(s / hop);
    if (env[i] > max) max = env[i];
  }
  for (let i = 1; i < n; i++) if (env[i - 1] < 0.15 * max && env[i] >= 0.15 * max) return (i * hop) / rate;
  return 0;
}
const jobs = [
  { ref: '_reference/bd.wav', bank: 'ry30_bd', idx: 4, t: null },
  { ref: '_reference/hh.wav', bank: 'ry30_hh', idx: 0, t: null },
  { ref: '_reference/oh.wav', bank: 'ry30_oh', idx: 0, t: null },
  { ref: '_reference/cp.wav', bank: 'ry30_cp', idx: 0, t: null },
];
for (const { ref, bank, idx } of jobs) {
  const r = loadMono(path.join(MUSIC, ref));
  const t0 = firstOnset(r.data, r.rate);
  const rseg = segAt(r.data, r.rate, Math.max(0, t0 - 0.005), 0.25);
  console.log(`\n== ${ref} bank=${bank} claimedIdx=${idx} firstOnset=${t0.toFixed(3)}s`);
  const files = manifest[bank];
  const scored = files.map((f, i) => {
    const v = loadMono(path.join(MUSIC, 'public', 'samples', f));
    // resample variant to ref rate if needed (all 44100? ref 48000)
    let vd = v.data;
    if (v.rate !== r.rate) {
      const ratio = v.rate / r.rate;
      const out = new Float32Array(Math.round(vd.length / ratio));
      for (let k = 0; k < out.length; k++) { const p = k * ratio, i0 = Math.floor(p), fr = p - i0; out[k] = vd[Math.min(i0, vd.length - 1)] * (1 - fr) + vd[Math.min(i0 + 1, vd.length - 1)] * fr; }
      vd = out;
    }
    const len = Math.min(rseg.length, vd.length);
    const a = rseg.subarray(0, len), b = vd.subarray(0, len);
    // least-squares gain + residual
    let num = 0, den = 0;
    for (let k = 0; k < len; k++) { num += a[k] * b[k]; den += b[k] * b[k]; }
    const g = den > 1e-18 ? num / den : 0;
    let res = 0, ref_e = 0;
    for (let k = 0; k < len; k++) { res += (a[k] - b[k] * g) ** 2; ref_e += a[k] * a[k]; }
    const nullDb = 10 * Math.log10(res / Math.max(ref_e, 1e-24));
    return { i, f, corr: correlation(a, b), nullDb, gainDb: 20 * Math.log10(Math.max(1e-9, Math.abs(g))), dur: vd.length / r.rate };
  });
  scored.sort((x, y) => y.corr - x.corr);
  for (const s of scored) console.log(`   [${s.i}] ${s.f} corr=${s.corr.toFixed(4)} null=${s.nullDb.toFixed(1)}dB gain=${s.gainDb.toFixed(1)}dB dur=${s.dur.toFixed(3)}s`);
}
