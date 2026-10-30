// Diff _reference/*.wav (Strudel bounces) vs tools/bounce/out/*.wav (PulseGrid CLI).
// Uses the compare-audio files-mode metrics (lag, level, null residual,
// envelope correlation, centroid, band distance, onset agreement).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(here, '..', '..', '_reference');
const DUT = path.join(here, 'out');
const STEMS = ['bd', 'hh', 'oh', 'cp', 'sqare', 'saw', 'triangle', 'chords', 'wt', 'sparkle'];

const rows = [];
for (const s of STEMS) {
  const ref = path.join(REF, `${s}.wav`);
  const dut = path.join(DUT, `${s}.wav`);
  if (!fs.existsSync(ref)) { console.log(`${s}: MISSING ref`); continue; }
  if (!fs.existsSync(dut)) { console.log(`${s}: MISSING dut`); continue; }
  const out = path.join(here, 'cmp', s);
  fs.mkdirSync(out, { recursive: true });
  try {
    execFileSync('node', [path.join(here, '..', 'compare-audio', 'compare.mjs'), 'files', ref, dut, '--out', out], { stdio: 'pipe' });
  } catch (e) {
    // files mode exits 0 always; only hard failures throw
    console.error(`${s}: tool failed`, e.message);
    continue;
  }
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  rows.push({ stem: s, ...rep });
  const on = rep.onsetMatch == null ? 'n/a' : rep.onsetMatch.toFixed(2);
  console.log(`${s}: lag=${rep.lagMs.toFixed(1)}ms lvl=${rep.gainMatchDb.toFixed(2)}dB resid=${rep.residualDb.toFixed(1)}dBFS env=${rep.envCorr.toFixed(4)} onset=${on} cent=${rep.centroidDiffHz.toFixed(0)}Hz band=${rep.bandDiff.toFixed(3)} => ${rep.verdict}`);
}
console.log('\nVerdict key: TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains).');
console.log('Violent arrangement bugs (wrong pitch/sample/octave/timing/gain) show as DIFFERENT + low envCorr / lag != 0 / big centroid shift.');
