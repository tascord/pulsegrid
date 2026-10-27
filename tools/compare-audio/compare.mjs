// Demo audio comparison tool: Strudel vs PulseGrid.
//
//   node compare.mjs events [--cycles 18] [--out out]
//     Arrangement check (headless, deterministic): dumps events from the REAL
//     Strudel scheduler and the REAL PulseGrid scheduler, renders both through
//     one shared neutral DSP chain, and diffs the audio per stem + mix.
//     A deep null here means the arrangements agree; any residual pinpoints
//     the diverging part and cycle.
//
//   node compare.mjs files <ref.wav> <dut.wav> [--out out] [--maxlag 1]
//     Bounce check (real engine outputs): aligns, level-matches, and diffs two
//     recorded bounces (e.g. Strudel REPL tape export vs PulseGrid recording),
//     writing diff.wav + report.md/json. See README for capture recipes.
//
// Exit 0 = all deterministic stems MATCH (events mode) / report written
// (files mode); exit 1 = a deterministic stem DIFFERs.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav, writeWav, resample, toMono, normalizePeak } from './lib/wav.mjs';
import { renderEvents, RENDER_RATE } from './lib/render.mjs';
import {
  rms, peak, dbfs, rmsEnvelope, correlation, findLag, applyLag,
  magnitudeSpectrum, spectralCentroid, bandEnergies,
} from './lib/dsp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC = path.join(here, '..', '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const OUT = path.resolve(getArg('--out', path.join(here, 'out')));
fs.mkdirSync(OUT, { recursive: true });

// ---------- sample provider (vendored RY30 kit) ----------
const manifest = JSON.parse(fs.readFileSync(path.join(MUSIC, 'public', 'samples', 'strudel.json'), 'utf8'));
const PACK_DIR = path.join(MUSIC, 'public', 'samples');
// Aliases established by the demo's `import { ry30_bd as bd, ... } from 'ry30'`.
const ALIAS = { bd: 'ry30_bd', oh: 'ry30_oh', cp: 'ry30_cp', hh: 'ry30_hh' };
const sampleCache = new Map();

function sampleFile(bank, index) {
  const files = manifest[bank];
  if (!files || files.length === 0) return null;
  const wrapped = ((index % files.length) + files.length) % files.length;
  return path.join(PACK_DIR, files[wrapped]);
}

function loadSampleMono(file) {
  if (sampleCache.has(file)) return sampleCache.get(file);
  const wav = readWav(file);
  const entry = { data: toMono(wav), rate: wav.sampleRate };
  sampleCache.set(file, entry);
  return entry;
}

function sampleProvider(token) {
  const [rawBase, rawIdx] = String(token).split(':');
  const base = rawBase.toLowerCase();
  const bank = manifest[base] ? base : ALIAS[base] ? ALIAS[base] : null;
  if (!bank) {
    console.warn(`  [warn] unknown sample "${token}" — rendering silence`);
    return null;
  }
  const idx = rawIdx != null && rawIdx !== '' ? parseInt(rawIdx, 10) : 0;
  const file = sampleFile(bank, isFinite(idx) ? idx : 0);
  if (!file || !fs.existsSync(file)) {
    console.warn(`  [warn] missing file for "${token}" — rendering silence`);
    return null;
  }
  return loadSampleMono(file);
}

// ---------- metrics ----------
function frameCentroids(mono, rate) {
  const N = 4096;
  const hop = 2048;
  const cents = [];
  for (let s = 0; s + N <= mono.length; s += hop) {
    const { mag, n } = magnitudeSpectrum(mono.subarray(s, s + N));
    let e = 0;
    for (let k = 0; k < mag.length; k++) e += mag[k] * mag[k];
    if (e < 1e-10) continue;
    cents.push(spectralCentroid(mag, rate, n));
  }
  return cents;
}

function onsetFrames(mono, rate) {
  const { env } = rmsEnvelope(mono, rate);
  const max = Math.max(1e-9, ...env);
  const th = 0.12 * max;
  const onsets = [];
  for (let i = 1; i < env.length; i++) {
    if (env[i - 1] < th && env[i] >= th) onsets.push(i);
  }
  // Debounce: keep onsets >= 30ms apart.
  const minGap = Math.max(1, Math.floor(0.03 * rate / (rate / 100)));
  return onsets.filter((f, i) => i === 0 || f - onsets[i - 1] >= minGap);
}

function onsetMatch(a, b) {
  // Legato material may never dip below threshold: no onsets on either side
  // (or one side) means "not measurable", not "mismatch".
  if (a.length === 0 || b.length === 0) return null;
  let hits = 0;
  for (const f of a) if (b.some((g) => Math.abs(g - f) <= 1)) hits++;
  return hits / Math.max(a.length, b.length);
}

function compareMonoPair(ref, dut, rate, { gainMatch = false, envHop = null } = {}) {
  const n = Math.min(ref.length, dut.length);
  const r = ref.subarray(0, n);
  let d = dut.subarray(0, n);
  let gainDb = 0;
  if (gainMatch) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += r[i] * d[i];
      den += d[i] * d[i];
    }
    const g = den > 1e-18 ? num / den : 1;
    gainDb = 20 * Math.log10(Math.max(1e-9, Math.abs(g)));
    const scaled = new Float32Array(n);
    for (let i = 0; i < n; i++) scaled[i] = d[i] * g;
    d = scaled;
  }
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = r[i] - d[i];
  const rmsR = rms(r);
  const rmsD = rms(d);
  const resDb = dbfs(rms(res));
  const hop = envHop || Math.floor(rate / 100);
  const { env: eR } = rmsEnvelope(r, rate, hop);
  const { env: eD } = rmsEnvelope(d, rate, hop);
  const envCorr = correlation(eR, eD);
  const cR = frameCentroids(r, rate);
  const cD = frameCentroids(d, rate);
  const m = Math.min(cR.length, cD.length);
  let cDiff = 0;
  for (let i = 0; i < m; i++) cDiff += Math.abs(cR[i] - cD[i]);
  cDiff = m ? cDiff / m : 0;
  const { mag: mR, n: nR } = magnitudeSpectrum(r);
  const { mag: mD } = magnitudeSpectrum(d);
  const bR = bandEnergies(mR, rate, nR);
  const bD = bandEnergies(mD, rate, nR);
  const bandDiff = Math.sqrt(bR.reduce((s, b, i) => s + (b - bD[i]) ** 2, 0));
  const onMatch = onsetMatch(onsetFrames(r, rate), onsetFrames(d, rate));
  return {
    rmsDbRef: dbfs(rmsR), rmsDbDut: dbfs(rmsD), rmsDiffDb: Math.abs(dbfs(rmsR) - dbfs(rmsD)),
    peakDbRef: dbfs(peak(r)), peakDbDut: dbfs(peak(d)),
    residualDb: resDb, envCorr, centroidDiffHz: cDiff, bandDiff, onsetMatch: onMatch,
    gainMatchDb: gainDb, residual: gainMatch ? res : res,
  };
}

/**
 * Time-domain waveform analysis of one stereo render.
 * peak/rms/crest in dBFS, dc offset, zero-crossing rate, clipped-sample
 * count, L/R correlation, side/mid energy ratio, first-attack 10-90% rise
 * time, and mean frame centroid/rolloff.
 */
function analyzeWave(left, right, rate) {
  const n = Math.min(left.length, right.length);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) / 2;
  let peakv = 0;
  let sum = 0;
  let sumSq = 0;
  let zc = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const v = mono[i];
    const a = Math.abs(v);
    if (a > peakv) peakv = a;
    sum += v;
    sumSq += v * v;
    if (a >= 0.999) clipped++;
    if (i > 0 && ((mono[i - 1] < 0) !== (v < 0)) && v !== 0) zc++;
  }
  const dur = n / rate;
  const rmsv = Math.sqrt(sumSq / Math.max(1, n));
  // Stereo image: L/R correlation + side/mid ratio.
  let lMean = 0;
  let rMean = 0;
  for (let i = 0; i < n; i++) {
    lMean += left[i];
    rMean += right[i];
  }
  lMean /= Math.max(1, n);
  rMean /= Math.max(1, n);
  let num = 0;
  let dl = 0;
  let dr = 0;
  let sideSq = 0;
  let midSq = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i] - lMean;
    const r = right[i] - rMean;
    num += l * r;
    dl += l * l;
    dr += r * r;
    const s = (left[i] - right[i]) / 2;
    const m = (left[i] + right[i]) / 2;
    sideSq += s * s;
    midSq += m * m;
  }
  // First attack: 10-90% rise after the first 12%-of-max envelope crossing.
  let attackMs = null;
  {
    const hop = Math.max(1, Math.floor(rate / 100));
    const envLen = Math.ceil(n / hop);
    let max = 0;
    for (let i = 0; i < envLen; i++) {
      let s = 0;
      const to = Math.min(n, (i + 1) * hop);
      for (let j = i * hop; j < to; j++) s += mono[j] * mono[j];
      const e = Math.sqrt(s / Math.max(1, to - i * hop));
      if (e > max) max = e;
    }
    if (max > 1e-9) {
      const th = 0.12 * max;
      let cross = -1;
      for (let i = 0; i < n; i++) {
        if (Math.abs(mono[i]) >= th) {
          cross = i;
          break;
        }
      }
      if (cross >= 0) {
        const win = Math.min(n, cross + Math.floor(rate * 0.05));
        let wmax = 0;
        for (let i = cross; i < win; i++) wmax = Math.max(wmax, Math.abs(mono[i]));
        if (wmax > 1e-9) {
          let t10 = -1;
          let t90 = -1;
          for (let i = cross; i < win; i++) {
            const a = Math.abs(mono[i]) / wmax;
            if (t10 < 0 && a >= 0.1) t10 = i;
            if (a >= 0.9) {
              t90 = i;
              break;
            }
          }
          if (t10 >= 0 && t90 > t10) attackMs = ((t90 - t10) / rate) * 1000;
        }
      }
    }
  }
  const cents = frameCentroids(mono, rate);
  const meanCent = cents.length ? cents.reduce((a, b) => a + b, 0) / cents.length : 0;
  return {
    peakDb: dbfs(peakv),
    rmsDb: dbfs(rmsv),
    crestDb: rmsv > 1e-12 ? 20 * Math.log10(peakv / rmsv) : 0,
    dcOffset: sum / Math.max(1, n),
    zcrPerSec: zc / Math.max(1e-9, dur),
    clipped,
    stereoCorr: num / Math.sqrt(Math.max(1e-24, dl * dr)),
    sideMidRatio: midSq > 1e-24 ? Math.sqrt(sideSq / midSq) : 0,
    attackMs,
    centroidHz: meanCent,
  };
}

function verdictEvents(m, isRandom) {
  const onsetOk = m.onsetMatch == null || m.onsetMatch >= 0.9;
  if (m.residualDb < -60 && Math.abs(m.gainMatchDb) < 0.05) return 'MATCH';
  if (m.residualDb < -40 && Math.abs(m.gainMatchDb) < 0.5) return 'MATCH (level-adjusted)';
  if (m.envCorr > 0.99 && onsetOk) return 'CLOSE';
  if (isRandom && onsetOk && m.envCorr > 0.85) return 'VARIANT (expected `|` randomness)';
  return 'DIFFER';
}

/** Arp phrase validation: every 2-cycle phrase must be variant A or B at the
 *  phrase octave (same grids as tools/parity/check.mjs). Returns branch string
 *  like "ABBA..." or null with a reason. Proves a DIFFER is just `|` randomness. */
function arpPhrases(events, SPC) {
  const A = [1, 1, 3, 5, 6, 8, null, 5];
  const B = [8, 10, 8, 5, 3, 5, 1, 0];
  const OCTS = [4, 5, 4, 6];
  const byPhrase = new Map();
  for (const e of events) {
    if (e.part !== 'arp' || e.midi == null) continue;
    const p = Math.floor(e.t / SPC / 2 + 1e-6);
    if (!byPhrase.has(p)) byPhrase.set(p, []);
    byPhrase.get(p).push(e);
  }
  const r4 = (x) => Math.round(x * 10000) / 10000;
  let branches = '';
  for (const [p, evs] of [...byPhrase.entries()].sort((a, b) => a[0] - b[0])) {
    const oct = OCTS[((p % 4) + 4) % 4];
    const seq = evs.slice().sort((a, b) => a.t - b.t);
    const gotT = seq.map((e) => r4(e.t / SPC - p * 2));
    const gotM = seq.map((e) => e.midi);
    const expA = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.75];
    const expB = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75];
    const isA = gotT.length === 7 && expA.every((t, i) => gotT[i] === t) &&
      A.filter((d) => d !== null).every((d, i) => gotM[i] === d + 12 * oct);
    const isB = gotT.length === 8 && expB.every((t, i) => gotT[i] === t) &&
      B.every((d, i) => gotM[i] === d + 12 * oct);
    if (!isA && !isB) return { ok: false, reason: `phrase ${p}: [${gotM}] @ [${gotT}] matches neither A nor B (oct ${oct})` };
    branches += isA ? 'A' : 'B';
  }
  return { ok: true, branches };
}

/** Onset-matched event pairs (Strudel ref vs PulseGrid): median dur/gain ratios.
 *  Surfaces systematic scheduler scales (e.g. default velocity/duration). */
function analyzeScales(S, P, tolSec = 0.002) {
  const byPartP = new Map();
  for (const e of P.events) {
    if (!byPartP.has(e.part)) byPartP.set(e.part, []);
    byPartP.get(e.part).push(e);
  }
  for (const list of byPartP.values()) list.sort((a, b) => a.t - b.t);
  const perPart = {};
  const allDur = [];
  const allGain = [];
  for (const s of S.events) {
    const list = byPartP.get(s.part);
    if (!list) continue;
    // binary search nearest in time
    let lo = 0;
    let hi = list.length - 1;
    let best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const dt = list[mid].t - s.t;
      if (Math.abs(dt) < tolSec && (list[mid].midi ?? list[mid].sample) === (s.midi ?? s.sample)) {
        best = list[mid];
        break;
      }
      if (dt < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    if (!best) continue;
    const dr = best.dur / s.dur;
    const gr = best.gain / s.gain;
    (perPart[s.part] = perPart[s.part] || { dur: [], gain: [] }).dur.push(dr);
    perPart[s.part].gain.push(gr);
    allDur.push(dr);
    allGain.push(gr);
  }
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const out = { matchedPairs: allDur.length, globalDurRatio: med(allDur), globalGainRatio: med(allGain), perPart: {} };
  for (const [part, v] of Object.entries(perPart)) {
    out.perPart[part] = { pairs: v.dur.length, durRatio: med(v.dur), gainRatio: med(v.gain) };
  }
  return out;
}

// ---------- events mode ----------
const STEMS = [
  ['drums', ['kick', 'hats', 'openhat', 'clap']],
  ['bass', ['bass_oct3', 'bass_oct2', 'bass_oct1']],
  ['chords', ['chords']],
  ['arp', ['arp']],
  ['sparkle', ['sparkle']],
];
const PART_ORDER = ['kick', 'hats', 'openhat', 'clap', 'bass_oct3', 'bass_oct2', 'bass_oct1', 'chords', 'arp', 'sparkle'];

/** Shared headroom: scale both buffers by one factor (pair peak -> 0.89). */
function applyHeadroom(a, b) {
  let pk = 0;
  for (const ch of [a.left, a.right, b.left, b.right]) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > pk) pk = v;
    }
  }
  if (pk > 0.89) {
    const g = 0.89 / pk;
    for (const ch of [a.left, a.right, b.left, b.right]) {
      for (let i = 0; i < ch.length; i++) ch[i] *= g;
    }
  }
}

const toMonoPair = (st) => {
  const m = new Float32Array(st.left.length);
  for (let i = 0; i < m.length; i++) m[i] = (st.left[i] + st.right[i]) / 2;
  return m;
};
const RANDOM_PARTS = new Set(['arp']); // Strudel `|` phrase choice: varies run to run

function runDumper(script, extraArgs) {
  // tsx runs both dumpers (the PulseGrid side imports .ts sources).
  const r = spawnSync('npx', ['tsx', script, ...extraArgs], { cwd: MUSIC, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAILED: ${script}\n${r.stderr}`);
    process.exit(2);
  }
  process.stdout.write(r.stdout);
}

async function eventsMode() {
  const cycles = parseInt(getArg('--cycles', '18'), 10);
  console.log(`dumping events (${cycles} cycles)...`);
  runDumper(path.join(here, 'events-strudel.mjs'), ['--cycles', String(cycles), '--out', path.join(OUT, 'strudel-events.json')]);
  runDumper(path.join(here, 'events-pulsegrid.mjs'), ['--cycles', String(cycles), '--out', path.join(OUT, 'pulsegrid-events.json')]);

  const S = JSON.parse(fs.readFileSync(path.join(OUT, 'strudel-events.json'), 'utf8'));
  const P = JSON.parse(fs.readFileSync(path.join(OUT, 'pulsegrid-events.json'), 'utf8'));
  const dur = Math.max(...S.events.map((e) => e.t + e.dur), ...P.events.map((e) => e.t + e.dur)) + 0.3;

  const byPart = (evs) => {
    const m = new Map();
    for (const e of evs) {
      if (!m.has(e.part)) m.set(e.part, []);
      m.get(e.part).push(e);
    }
    return m;
  };
  const sParts = byPart(S.events);
  const pParts = byPart(P.events);

  const rows = [];
  const stems = [...STEMS.map(([name, parts]) => [name, parts]), ['mix', null]];
  let mixRef = null;
  let mixDut = null;
  for (const [name, parts] of stems) {
    const sEv = parts ? parts.flatMap((p) => sParts.get(p) || []) : S.events;
    const pEv = parts ? parts.flatMap((p) => pParts.get(p) || []) : P.events;
    const ref = renderEvents(sEv, { sampleRate: RENDER_RATE, durationSec: dur, sampleProvider });
    const dut = renderEvents(pEv, { sampleRate: RENDER_RATE, durationSec: dur, sampleProvider });
    applyHeadroom(ref, dut);
    const refMono = toMonoPair(ref);
    const dutMono = toMonoPair(dut);
    const lag = findLag(refMono, dutMono, RENDER_RATE, 0.05);
    // Timing must agree absolutely (lag reported, not corrected); per-stem
    // least-squares level match separates global velocity scales from shape.
    const m = compareMonoPair(refMono, dutMono, RENDER_RATE, { gainMatch: true, envHop: Math.floor(RENDER_RATE / 20) });
    const v = verdictEvents(m, RANDOM_PARTS.has(name));
    rows.push({ stem: name, refEvents: sEv.length, dutEvents: pEv.length, lagMs: lag.lagSamples / RENDER_RATE * 1000, ...m, verdict: v });
    if (name === 'mix') {
      mixRef = ref;
      mixDut = dut;
    }
  }

  // Per-track exports + waveform analysis (every track separately).
  const trackDir = path.join(OUT, 'tracks');
  const skipTracks = args.includes('--no-tracks');
  const trackRows = [];
  if (!skipTracks) {
    fs.rmSync(trackDir, { recursive: true, force: true }); // no stale diffs
    fs.mkdirSync(trackDir, { recursive: true });
    for (const part of PART_ORDER) {
      const sEv = (sParts.get(part) || []).slice().sort((a, b) => a.t - b.t);
      const pEv = (pParts.get(part) || []).slice().sort((a, b) => a.t - b.t);
      const tRef = renderEvents(sEv, { sampleRate: RENDER_RATE, durationSec: dur, sampleProvider });
      const tDut = renderEvents(pEv, { sampleRate: RENDER_RATE, durationSec: dur, sampleProvider });
      applyHeadroom(tRef, tDut);
      const refMono = toMonoPair(tRef);
      const dutMono = toMonoPair(tDut);
      const lag = findLag(refMono, dutMono, RENDER_RATE, 0.05);
      const m = compareMonoPair(refMono, dutMono, RENDER_RATE, { gainMatch: true, envHop: Math.floor(RENDER_RATE / 20) });
      const verdict = verdictEvents(m, RANDOM_PARTS.has(part));
      const wRef = analyzeWave(tRef.left, tRef.right, RENDER_RATE);
      const wDut = analyzeWave(tDut.left, tDut.right, RENDER_RATE);
      writeWav(path.join(trackDir, `${part}-strudel.wav`), [tRef.left, tRef.right], RENDER_RATE);
      writeWav(path.join(trackDir, `${part}-pulsegrid.wav`), [tDut.left, tDut.right], RENDER_RATE);
      let diffFile = null;
      if (!verdict.startsWith('MATCH')) {
        const n = Math.min(tRef.left.length, tDut.left.length);
        const dL = new Float32Array(n);
        const dR = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          dL[i] = tRef.left[i] - tDut.left[i];
          dR[i] = tRef.right[i] - tDut.right[i];
        }
        normalizePeak([dL, dR]);
        diffFile = `${part}-diff.wav`;
        writeWav(path.join(trackDir, diffFile), [dL, dR], RENDER_RATE);
      }
      trackRows.push({
        part, refEvents: sEv.length, dutEvents: pEv.length,
        lagMs: (lag.lagSamples / RENDER_RATE) * 1000,
        gainMatchDb: m.gainMatchDb, residualDb: m.residualDb, envCorr: m.envCorr,
        onsetMatch: m.onsetMatch, centroidDiffHz: m.centroidDiffHz, bandDiff: m.bandDiff,
        rmsDiffDb: m.rmsDiffDb, waveRef: wRef, waveDut: wDut,
        diffFile, verdict,
      });
    }
  }

  // Wav outputs: mixes (shared headroom factor, like the stems) + residual.
  applyHeadroom(mixRef, mixDut);
  writeWav(path.join(OUT, 'strudel-neutral.wav'), [mixRef.left, mixRef.right], RENDER_RATE);
  writeWav(path.join(OUT, 'pulsegrid-neutral.wav'), [mixDut.left, mixDut.right], RENDER_RATE);
  const n = Math.min(mixRef.left.length, mixDut.left.length);
  const diffL = new Float32Array(n);
  const diffR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    diffL[i] = mixRef.left[i] - mixDut.left[i];
    diffR[i] = mixRef.right[i] - mixDut.right[i];
  }
  normalizePeak([diffL, diffR]);
  writeWav(path.join(OUT, 'diff.wav'), [diffL, diffR], RENDER_RATE);

  const scales = analyzeScales(S, P);
  const arpS = arpPhrases(S.events, S.secondsPerCycle);
  const arpP = arpPhrases(P.events, P.secondsPerCycle);
  const arpRow = rows.find((r) => r.stem === 'arp');
  if (arpRow && arpP.ok && arpRow.verdict === 'DIFFER') {
    arpRow.verdict = 'VARIANT (phrase branch differs — expected `|` randomness)';
  }
  const arpTrack = trackRows.find((r) => r.part === 'arp');
  if (arpTrack && arpP.ok && arpTrack.verdict === 'DIFFER') {
    arpTrack.verdict = 'VARIANT (phrase branch differs — expected `|` randomness)';
  }
  const report = {
    mode: 'events', cycles, secondsPerCycle: S.secondsPerCycle, scales,
    arpBranches: { strudel: arpS.ok ? arpS.branches : `INVALID: ${arpS.reason}`, pulsegrid: arpP.ok ? arpP.branches : `INVALID: ${arpP.reason}` },
    stems: rows.map(({ residual, ...r }) => r),
    tracks: trackRows,
  };
  if (!arpP.ok) {
    console.error(`PulseGrid arp INVALID: ${arpP.reason}`);
    process.exitCode = 1;
  }
  if (!arpS.ok) {
    console.error(`Strudel arp INVALID (tool sanity): ${arpS.reason}`);
    process.exitCode = 1;
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT, 'report.md'), eventsMarkdown(report));
  console.log('\n' + eventsMarkdown(report));
  const badStems = rows.filter((r) => r.verdict === 'DIFFER');
  const badTracks = trackRows.filter((r) => r.verdict === 'DIFFER');
  if (badStems.length || badTracks.length) {
    console.error(
      `${badStems.length} stem(s), ${badTracks.length} track(s) DIFFER — see ${path.join(OUT, 'report.md')}`,
    );
    process.exit(1);
  }
  console.log('ARRANGEMENT PARITY OK');
}

function eventsMarkdown(report) {
  const L = [];
  L.push('# Demo audio comparison — arrangement (neutral render)');
  L.push('');
  L.push(`cycles: ${report.cycles} · ${report.secondsPerCycle.toFixed(4)}s/cycle · chain: shared neutral (osc+sample, ADSR, LPF, pan — no FX)`);
  L.push('');
  const sc = report.scales;
  if (sc) {
    const db = 20 * Math.log10(sc.globalGainRatio || 1);
    L.push(`systematic scales (${sc.matchedPairs} onset-matched pairs): duration ×${sc.globalDurRatio?.toFixed(3)} · velocity ×${sc.globalGainRatio?.toFixed(3)} (${db.toFixed(2)}dB).`);
    L.push('Per-stem residuals below are computed AFTER least-squares level match, so these scales never mask shape differences.');
    L.push('');
  }
  L.push('| stem | ref ev | dut ev | lag ms | lvl dB | resid dBFS | envCorr | onset | centroid ΔHz | verdict |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of report.stems) {
    const on = r.onsetMatch == null ? 'n/a' : r.onsetMatch.toFixed(2);
    L.push(`| ${r.stem} | ${r.refEvents} | ${r.dutEvents} | ${r.lagMs.toFixed(2)} | ${r.gainMatchDb.toFixed(2)} | ${r.residualDb.toFixed(1)} | ${r.envCorr.toFixed(4)} | ${on} | ${r.centroidDiffHz.toFixed(0)} | ${r.verdict} |`);
  }
  L.push('');
  if (report.arpBranches) {
    L.push(`arp branches (9 phrases): strudel ${report.arpBranches.strudel} · pulsegrid ${report.arpBranches.pulsegrid}`);
    L.push('');
  }
  L.push('Verdicts: MATCH = sample-identical · CLOSE = same shape, tiny level/timbre drift ·');
  L.push('VARIANT = onset grid agrees but phrase content is the other `|` branch (expected Strudel randomness) · DIFFER = investigate.');
  L.push('Listen: strudel-neutral.wav vs pulsegrid-neutral.wav, diff.wav (residual, peak-normalized).');
  if (report.tracks?.length) {
    L.push('');
    L.push(`## Per-track waveforms (tracks/: ${report.tracks.length} tracks × strudel/pulsegrid, + diff where not MATCH)`);
    L.push('');
    L.push('| track | side | peak dBFS | rms dBFS | crest dB | dc | zcr/s | clipped | L/R corr | side/mid | atk ms | centroid Hz |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
    for (const t of report.tracks) {
      for (const [side, w] of [['S', t.waveRef], ['P', t.waveDut]]) {
        L.push(`| ${t.part} | ${side} | ${f1(w.peakDb)} | ${f1(w.rmsDb)} | ${f1(w.crestDb)} | ${w.dcOffset.toExponential(1)} | ${Math.round(w.zcrPerSec)} | ${w.clipped} | ${w.stereoCorr.toFixed(3)} | ${w.sideMidRatio.toFixed(3)} | ${w.attackMs == null ? 'n/a' : w.attackMs.toFixed(2)} | ${Math.round(w.centroidHz)} |`);
      }
    }
    L.push('');
    L.push('## Per-track comparison');
    L.push('');
    L.push('| track | ref ev | dut ev | lag ms | lvl dB | resid dBFS | envCorr | onset | centroid ΔHz | verdict |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const t of report.tracks) {
      const on = t.onsetMatch == null ? 'n/a' : t.onsetMatch.toFixed(2);
      const res = Number.isFinite(t.residualDb) ? t.residualDb.toFixed(1) : String(t.residualDb);
      L.push(`| ${t.part} | ${t.refEvents} | ${t.dutEvents} | ${t.lagMs.toFixed(2)} | ${t.gainMatchDb.toFixed(2)} | ${res} | ${t.envCorr.toFixed(4)} | ${on} | ${t.centroidDiffHz.toFixed(0)} | ${t.verdict}${t.diffFile ? ` (${t.diffFile})` : ''} |`);
    }
  }
  return L.join('\n');
}

// ---------- files mode ----------
async function filesMode() {
  const [refF, dutF] = args.filter((a) => !a.startsWith('--') && a !== 'files');
  if (!refF || !dutF) {
    console.error('usage: node compare.mjs files <ref.wav> <dut.wav> [--out dir] [--maxlag 1]');
    process.exit(2);
  }
  const maxlag = parseFloat(getArg('--maxlag', '1'));
  const targetRate = RENDER_RATE;
  const loadMono = (f) => {
    const w = readWav(f);
    let m = toMono(w);
    if (w.sampleRate !== targetRate) m = Float32Array.from(resample(m, w.sampleRate, targetRate));
    return m;
  };
  const ref = loadMono(refF);
  const dut = loadMono(dutF);
  const lag = findLag(ref, dut, targetRate, maxlag);
  console.log(`lag: ${(lag.lagSamples / targetRate * 1000).toFixed(1)}ms (score ${lag.score.toFixed(3)})`);
  const [r, d] = applyLag(ref, dut, lag.lagSamples);
  const m = compareMonoPair(r, d, targetRate, { gainMatch: true });
  const v = m.residualDb < -30 ? 'TIGHT' : m.residualDb < -20 ? 'CLOSE' : 'DIFFERENT';

  const diff = Float32Array.from(m.residual);
  const g = normalizePeak([diff]);
  writeWav(path.join(OUT, 'diff.wav'), [diff, diff], targetRate);
  const report = {
    mode: 'files', ref: refF, dut: dutF,
    lagMs: (lag.lagSamples / targetRate) * 1000, lagScore: lag.score,
    rmsDbRef: m.rmsDbRef, rmsDbDut: m.rmsDbDut, gainMatchDb: m.gainMatchDb,
    residualDb: m.residualDb, envCorr: m.envCorr, centroidDiffHz: m.centroidDiffHz,
    bandDiff: m.bandDiff, onsetMatch: m.onsetMatch, verdict: v,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const md = ['# Bounce comparison', '', `ref: ${refF}`, `dut: ${dutF}`, '',
    `lag: ${report.lagMs.toFixed(1)}ms · level match: ${m.gainMatchDb.toFixed(2)}dB applied to dut`, '',
    `| metric | value |`, `| --- | --- |`,
    `| residual (level-matched null) | ${m.residualDb.toFixed(1)} dBFS |`,
    `| envelope correlation | ${m.envCorr.toFixed(4)} |`,
    `| onset agreement | ${m.onsetMatch == null ? 'n/a (legato)' : m.onsetMatch.toFixed(2)} |`,
    `| centroid Δ | ${m.centroidDiffHz.toFixed(0)} Hz |`,
    `| band-balance distance | ${m.bandDiff.toFixed(3)} |`,
    `| verdict | ${v} |`, '',
    `diff.wav: level-matched residual, peak-normalized (gain ${g.toFixed(1)}x).`,
    `TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).`].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log('\n' + md);
}

const mode = args[0];
if (mode === 'events') await eventsMode();
else if (mode === 'files') await filesMode();
else {
  console.error('usage: node compare.mjs events [--cycles N] [--out dir] | files <ref.wav> <dut.wav> [--out dir]');
  process.exit(2);
}
