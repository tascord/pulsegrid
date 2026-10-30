// Sample-ID v2: sample-accurate lag search per variant (max correlation over ±50ms).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav, toMono } from '../compare-audio/lib/wav.mjs';
import { correlation } from '../compare-audio/lib/dsp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC = path.join(here, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(MUSIC, 'public', 'samples', 'strudel.json'), 'utf8'));

function loadMono(file, rate) {
  const w = readWav(file);
  let m = toMono(w);
  if (w.sampleRate !== rate) {
    const ratio = w.sampleRate / rate;
    const out = new Float32Array(Math.round(m.length / ratio));
    for (let k = 0; k < out.length; k++) { const p = k * ratio, i0 = Math.floor(p), fr = p - i0; out[k] = m[Math.min(i0, m.length - 1)] * (1 - fr) + m[Math.min(i0 + 1, m.length - 1)] * fr; }
    m = out;
  }
  return m;
}
function xcorrMax(a, b, maxLag) {
  let best = -2, bl = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const a0 = Math.max(0, -lag), b0 = Math.max(0, lag);
    const n = Math.min(a.length - a0, b.length - b0);
    if (n < 64) continue;
    const c = correlation(a.subarray(a0, a0 + n), b.subarray(b0, b0 + n));
    if (c > best) { best = c; bl = lag; }
  }
  return { best, bl };
}
const jobs = [
  { ref: '_reference/bd.wav', bank: 'ry30_bd', t: 0.38, win: 0.30 },
  { ref: '_reference/hh.wav', bank: 'ry30_hh', t: 0.19, win: 0.06 },
  { ref: '_reference/oh.wav', bank: 'ry30_oh', t: 0.19, win: 0.30 },
  { ref: '_reference/cp.wav', bank: 'ry30_cp', t: 1.15, win: 0.25 },
];
for (const { ref, bank, t, win } of jobs) {
  const r = loadMono(path.join(MUSIC, ref), 48000);
  const i0 = Math.floor(t * 48000);
  const rseg = r.subarray(i0, Math.min(r.length, i0 + Math.floor(win * 48000)));
  console.log(`\n== ${ref} bank=${bank} seg@${t}s len=${win}s`);
  for (const [i, f] of manifest[bank].entries()) {
    const v = loadMono(path.join(MUSIC, 'public', 'samples', f), 48000);
    const vseg = v.subarray(0, Math.min(v.length, rseg.length + 2400));
    const { best, bl } = xcorrMax(rseg, vseg, 2400);
    console.log(`   [${i}] ${f} maxcorr=${best.toFixed(4)} @lag=${bl}`);
  }
}
