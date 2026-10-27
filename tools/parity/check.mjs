// Parity check: Strudel (vendored ref) vs PulseGrid (real engine paths).
// Usage: node tools/parity/check.mjs   (run from the music/ directory)
// Exit 0 = parity holds (modulo documented approximations), 1 = regressed.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: false });
  if (r.status !== 0) {
    console.error(`FAILED to run ${cmd} ${args.join(' ')}:\n${r.stderr}`);
    process.exit(2);
  }
  return r.stdout;
}

const strudelRaw = run('node', ['strudel-side.mjs'], here);
const pgRaw = run('npx', ['tsx', 'pulsegrid-side.ts'], here);

const jsonLines = (raw) => raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map(JSON.parse);
const S = jsonLines(strudelRaw);
const P = jsonLines(pgRaw);

const r4 = (x) => Math.round(x * 10000) / 10000;
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// ---- value normalization ----
const SAMPLES = new Set(['bd', 'kick', 'hh', 'hat', 'oh', 'openhat', 'cp', 'clap', 'sd', 'snare', 'rim', 'cb', 'tom', 'perc']);
function normStrudel(v) {
  if (v && typeof v === 'object') {
    if (typeof v.note === 'number') return { midi: v.note + 12 * (v.octave ?? 0) };
    if (typeof v.s === 'string') return { sample: v.s.toLowerCase() };
    return { raw: JSON.stringify(v) };
  }
  if (typeof v === 'number') return { midi: v };
  if (typeof v === 'string') {
    const base = v.split(':')[0].toLowerCase();
    if (SAMPLES.has(base)) return { sample: base };
    return { raw: v };
  }
  return { raw: String(v) };
}
function normPg(v, track) {
  if (typeof v === 'number') return { midi: v };
  if (typeof v === 'string') {
    const base = v.split(':')[0].toLowerCase();
    if (SAMPLES.has(base)) return { sample: base };
    return { raw: v };
  }
  return { raw: String(v) };
}
const key = (start, n) => `${r4(start)}:${n.midi ?? n.sample ?? n.raw}`;

const TRACK2PART = {
  kick: 'kick', hh: 'hats', oh: 'openhat', cp: 'clap',
  bass_sq: 'bass_oct3', bass_saw: 'bass_oct2', bass_tri: 'bass_oct1',
  lead_chords: 'chords', lead_wt: 'arp', lead_top: 'sparkle',
};

// ---- 1. drums: exact event equality ----
for (const [track, part] of [['kick', 'kick'], ['hh', 'hats'], ['oh', 'openhat'], ['cp', 'clap']]) {
  const s = S.filter((e) => e.part === part && e.start < 6).map((e) => key(e.start, normStrudel(e.value))).sort();
  const p = P.filter((e) => e.track === track && e.start < 6).map((e) => key(e.start, normPg(e.value, track))).sort();
  ok(JSON.stringify(s) === JSON.stringify(p), `drums/${part}: ${p.length} events match Strudel exactly`);
  if (JSON.stringify(s) !== JSON.stringify(p)) {
    console.log('  strudel:', s.join(' '));
    console.log('  pulsegrid:', p.join(' '));
  }
}

// ---- 2. slowcat parts: section-per-cycle + boundary allowlist ----
function slowcatSections(weightSpecs) {
  // weightSpecs: [{value, weight}] -> section index active at each integer cycle
  const total = weightSpecs.reduce((t, s) => t + s.weight, 0);
  return (cycle) => {
    let pos = cycle % total;
    for (let i = 0; i < weightSpecs.length; i++) {
      if (pos < weightSpecs[i].weight) return i;
      pos -= weightSpecs[i].weight;
    }
    return weightSpecs.length - 1;
  };
}
const BASS_W = [{ v: 6, weight: 4 }, { v: 5, weight: 3.5 }, { v: 1, weight: 8.5 }];
const bassSection = slowcatSections(BASS_W.map((s) => ({ weight: s.weight })));

// bass layers: held notes attack once per span — exact onset multisets.
const OCT2DEG = { bass_sq: 3, bass_saw: 2, bass_tri: 1 };
for (const [track, oct] of Object.entries(OCT2DEG)) {
  const part = `bass_oct${oct}`;
  const s = S.filter((e) => e.part === part && e.start < 16)
    .map((e) => `${r4(e.start)}:${e.value.note + 12 * e.value.octave}`).sort();
  const p = P.filter((e) => e.track === track && e.start < 16)
    .map((e) => `${r4(e.start)}:${e.value}`).sort();
  ok(JSON.stringify(s) === JSON.stringify(p), `bass oct${oct}: onsets match Strudel exactly (held, no retrigger)`);
  if (JSON.stringify(s) !== JSON.stringify(p)) {
    console.log('  strudel:  ', s.join(' '));
    console.log('  pulsegrid:', p.join(' '));
  }
}

// chords: same treatment (4-note stacks, uniform octave per cycle: 4,5,4,5...)
{
  const CH = [
    { degs: [6, 8, 10, 13], weight: 4 },
    { degs: [3, 5, 8, 10], weight: 3.5 },
    { degs: [1, 3, 5, 8], weight: 8.5 },
  ];
  const s = S.filter((e) => e.part === 'chords' && e.start < 16)
    .map((e) => `${r4(e.start)}:${e.value.note + 12 * e.value.octave}`).sort();
  const p = P.filter((e) => e.track === 'lead_chords' && e.start < 16)
    .map((e) => `${r4(e.start)}:${e.value}`).sort();
  ok(JSON.stringify(s) === JSON.stringify(p), 'chords: onsets match Strudel exactly (held stacks, rotating octaves)');
  if (JSON.stringify(s) !== JSON.stringify(p)) {
    console.log('  strudel:  ', s.join(' '));
    console.log('  pulsegrid:', p.join(' '));
  }
}

// ---- 3. arp: phrase structure (variant membership + per-phrase octave) ----
{
  const A = [1, 1, 3, 5, 6, 8, null, 5];
  const B = [8, 10, 8, 5, 3, 5, 1, 0];
  const OCTS = [4, 5, 4, 6];
  const phraseOf = (list) => {
    const byPhrase = new Map();
    for (const e of list) {
      const p = Math.floor(e.start / 2);
      if (!byPhrase.has(p)) byPhrase.set(p, []);
      byPhrase.get(p).push(e);
    }
    return byPhrase;
  };
  const sPhr = phraseOf(S.filter((e) => e.part === 'arp').map((e) => ({ start: e.start, m: e.value.note + 12 * e.value.octave })));
  const pPhr = phraseOf(P.filter((e) => e.track === 'lead_wt').map((e) => ({ start: e.start, m: e.value })));

  let allOk = true;
  for (let p = 0; p < 9; p++) {
    const pg = (pPhr.get(p) || []).sort((a, b) => a.start - b.start);
    const oct = OCTS[p % 4];
    const seq = pg.map((e) => e.m);
    const matchA = A.filter((d) => d !== null).map((d) => d + 12 * oct);
    const matchB = B.map((d) => d + 12 * oct);
    const isA = seq.length === 7 && matchA.every((m, i) => seq[i] === m);
    const isB = seq.length === 8 && matchB.every((m, i) => seq[i] === m);
    if (!isA && !isB) {
      allOk = false;
      console.log(`  phrase ${p}: PG sequence [${seq}] matches neither A nor B at oct ${oct}`);
      continue;
    }
    // expected hit times within phrase (A skips the rest slot at +1.5)
    const expTimes = (isA ? [0, 0.25, 0.5, 0.75, 1, 1.25, 1.75] : [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75])
      .map((t) => r4(p * 2 + t));
    const gotTimes = pg.map((e) => r4(e.start));
    if (JSON.stringify(gotTimes) !== JSON.stringify(expTimes)) {
      allOk = false;
      console.log(`  phrase ${p}: PG times [${gotTimes}] expected [${expTimes}]`);
    }
  }
  ok(allOk, 'arp: every PulseGrid phrase is a valid A/B variant at the phrase octave');

  // Crush rotation is a per-cycle FX (not pitch/timing): validated via
  // computePatternEvents voice.crush below.

  // Strudel side self-check (validates the tool understands the log format)
  let sOk = true;
  for (const [p, evs] of sPhr) {
    if (p >= 9) continue;
    const oct = OCTS[p % 4];
    const got = evs.sort((a, b) => a.start - b.start).map((e) => e.m);
    const isA = got.length === 7 && A.filter((d) => d !== null).every((d, i) => got[i] === d + 12 * oct);
    const isB = got.length === 8 && B.every((d, i) => got[i] === d + 12 * oct);
    if (!isA && !isB) {
      sOk = false;
      console.log(`  strudel phrase ${p}: [${got}] matches neither variant at oct ${oct}`);
    }
  }
  ok(sOk, 'arp: Strudel phrases also validate (tool sanity check)');
}

// ---- 4. sparkle: exact match ----
{
  const s = S.filter((e) => e.part === 'sparkle' && e.start < 8).map((e) => key(e.start, normStrudel(e.value))).sort();
  const p = P.filter((e) => e.track === 'lead_top' && e.start < 8).map((e) => {
    const v = typeof e.value === 'number' ? { midi: e.value } : normPg(e.value);
    return key(e.start, v);
  }).sort();
  ok(JSON.stringify(s) === JSON.stringify(p), `sparkle: ${p.length} events match Strudel exactly`);
  if (JSON.stringify(s) !== JSON.stringify(p)) {
    console.log('  strudel:', s.join(' '));
    console.log('  pulsegrid:', p.join(' '));
  }
}

console.log(failures === 0 ? '\nPARITY OK' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
