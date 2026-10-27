// Self-test for the compare-audio tool (no dependencies, no audio hardware).
// Exercises: WAV round-trip, lag recovery, identical-render null, scale
// detection, arp phrase validation, files-mode report.
// Usage: node test.mjs   (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readWav, writeWav, toMono } from './lib/wav.mjs';
import { renderEvents, RENDER_RATE } from './lib/render.mjs';
import { findLag, applyLag, correlation, rmsEnvelope, rms } from './lib/dsp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-test-'));
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// ---- 1. WAV round-trip (16-bit + float32, stereo, odd chunk) ----
{
  const L = new Float32Array([0, 0.5, -0.5, 0.999, -0.999]);
  const R = new Float32Array([0.1, -0.1, 0.25, -0.25, 0]);
  const f = path.join(tmp, 'rt.wav');
  writeWav(f, [L, R], 44100);
  const back = readWav(f);
  ok(back.sampleRate === 44100 && back.channels === 2 && back.frames === 5, 'wav round-trip header');
  ok(Math.abs(back.data[0][1] - 0.5) < 1 / 32768 + 1e-9 && Math.abs(back.data[1][3] + 0.25) < 1e-4, 'wav round-trip samples');
  const f32 = path.join(tmp, 'rt32.wav');
  writeWav(f32, [L, R], 48000, { float32: true });
  const back32 = readWav(f32);
  ok(back32.sampleRate === 48000 && Math.abs(back32.data[0][3] - 0.999) < 1e-6, 'wav float32 round-trip');
}

// ---- 2. lag recovery on synthetic offset ----
{
  const rate = 44100;
  const a = new Float32Array(rate);
  for (let i = 0; i < a.length; i++) a[i] = Math.sin(2 * Math.PI * 440 * (i / rate)) * (i > 1000 && i < 20000 ? 1 : 0);
  const shift = 1234;
  const b = new Float32Array(rate);
  b.set(a.subarray(0, rate - shift), shift);
  const { lagSamples, score } = findLag(a, b, rate, 0.1);
  ok(lagSamples === shift && score > 0.99, `lag recovery (got ${lagSamples}, score ${score.toFixed(3)})`);
  const [ra, rb] = applyLag(a, b, lagSamples);
  ok(ra.length === rb.length && Math.abs(ra[5000] - rb[5000]) < 1e-9, 'applyLag aligns');
}

// ---- 3. identical renders null deeply ----
{
  const prov = () => null;
  const evs = [
    { t: 0, dur: 0.5, midi: 69, osc: 'saw', gain: 1, pan: 0, cutoff: 18000 },
    { t: 0.5, dur: 0.25, midi: 72, osc: 'square', gain: 0.5, pan: -0.5, cutoff: 2000 },
  ];
  const r1 = renderEvents(evs, { sampleRate: RENDER_RATE, durationSec: 1, sampleProvider: prov });
  const r2 = renderEvents(structuredClone(evs), { sampleRate: RENDER_RATE, durationSec: 1, sampleProvider: prov });
  let num = 0;
  let den = 0;
  for (let i = 0; i < r1.left.length; i++) {
    num += (r1.left[i] - r2.left[i]) ** 2;
    den += r1.left[i] ** 2;
  }
  ok(10 * Math.log10(num / Math.max(den, 1e-24)) < -200, 'identical renders null');
}

// ---- 4. scales + files mode via the real CLI on synthetic events ----
{
  // Two bounces: dut = ref delayed 200 samples and scaled 0.5 (-6.02dB).
  const rate = 44100;
  const ref = new Float32Array(rate * 2);
  for (let i = 0; i < ref.length; i++) {
    const t = i / rate;
    ref[i] = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 2) + 0.3 * Math.sin(2 * Math.PI * 330 * t) * (t > 0.5 && t < 1.2 ? 1 : 0);
  }
  const dut = new Float32Array(rate * 2);
  for (let i = 200; i < dut.length; i++) dut[i] = ref[i - 200] * 0.5;
  const rf = path.join(tmp, 'ref.wav');
  const df = path.join(tmp, 'dut.wav');
  writeWav(rf, [ref, ref], rate);
  writeWav(df, [dut, dut], rate);
  const out = path.join(tmp, 'files-out');
  execFileSync('node', [path.join(here, 'compare.mjs'), 'files', rf, df, '--out', out], { stdio: 'pipe' });
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  ok(Math.abs(rep.lagMs - (200 / rate) * 1000) < 0.5, `files-mode lag (got ${rep.lagMs.toFixed(2)}ms)`);
  ok(Math.abs(rep.gainMatchDb - 6.02) < 0.05, `files-mode level match (got ${rep.gainMatchDb.toFixed(2)}dB)`);
  ok(rep.residualDb < -60, `files-mode null after match (got ${rep.residualDb.toFixed(1)}dBFS)`);
  ok(fs.existsSync(path.join(out, 'diff.wav')) && fs.existsSync(path.join(out, 'report.md')), 'files-mode artifacts');
}

// ---- 5. events-mode smoke: runs both dumpers + full comparison ----
{
  const out = path.join(tmp, 'events-out');
  try {
    execFileSync('node', [path.join(here, 'compare.mjs'), 'events', '--cycles', '4', '--out', out], { stdio: 'pipe' });
    ok(true, 'events-mode completes (exit 0, no DIFFERs)');
  } catch (e) {
    ok(false, `events-mode failed (exit ${e.status})`);
  }
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  // Post-parity-fix expectations: PulseGrid defaults match Strudel (1.0).
  ok(rep.scales && Math.abs(rep.scales.globalDurRatio - 1) < 1e-3, `scales: duration ×${rep.scales?.globalDurRatio}`);
  ok(Math.abs((rep.scales?.globalGainRatio ?? 0) - 1) < 1e-9, `scales: velocity ×${rep.scales?.globalGainRatio}`);
  ok(typeof rep.arpBranches?.strudel === 'string' && typeof rep.arpBranches?.pulsegrid === 'string', 'arp branch report');
  const byName = Object.fromEntries(rep.stems.map((s) => [s.stem, s]));
  ok(byName.drums && byName.drums.lagMs === 0, 'drums zero lag');
  // Per-track exports: 10 tracks x 2 sides, waveform stats, no stale diffs.
  const parts = ['kick', 'hats', 'openhat', 'clap', 'bass_oct3', 'bass_oct2', 'bass_oct1', 'chords', 'arp', 'sparkle'];
  const missing = parts.flatMap((p) => [`${p}-strudel.wav`, `${p}-pulsegrid.wav`].filter((f) => !fs.existsSync(path.join(out, 'tracks', f))));
  ok(missing.length === 0, `track wavs exported${missing.length ? ' (missing ' + missing.join(',') + ')' : ''}`);
  const tByName = Object.fromEntries(rep.tracks.map((t) => [t.part, t]));
  ok(tByName.kick?.verdict === 'MATCH' && !fs.existsSync(path.join(out, 'tracks', 'kick-diff.wav')), 'kick MATCH, no diff wav');
  ok(tByName.sparkle?.verdict === 'MATCH', 'sparkle MATCH (pan convention mapped)');
  // Arp: same random branch -> MATCH/CLOSE, different branches -> validated VARIANT. Never DIFFER.
  ok(!(tByName.arp?.verdict || '').startsWith('DIFFER'), `arp track not DIFFER (got ${tByName.arp?.verdict})`);
  ok(Number.isFinite(tByName.hats?.waveRef?.crestDb) && tByName.hats?.waveRef?.clipped === 0, 'waveform stats present (hats crest, no clipping)');
  void rms;
  void toMono;
  void correlation;
  void rmsEnvelope;
}

console.log(failures === 0 ? '\nALL TESTS PASS' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
