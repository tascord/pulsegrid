// Strudel ground-truth event dump for the demo comparison tool.
// Runs the REAL vendored Strudel scheduler (queryArc) over demo.strudel's
// patterns and writes out/strudel-events.json:
//   { source, cpm, cycles, secondsPerCycle, events: [{part,t,dur,midi?,sample?,osc?,gain,pan,cutoff,crush?}] }
// Times are absolute seconds. Effective MIDI = value.note + 12 * value.octave
// (raw-MIDI numbers lifted by .oct(), per the demo's verified semantics).
// Controls (gain/cutoff/pan/crush) ride on hap.value — sampled per event.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../strudel-main/strudel/packages/core/index.mjs';
import * as mini from '../../strudel-main/strudel/packages/mini/mini.mjs';
import '../../strudel-main/strudel/packages/tonal/tonal.mjs';

mini.miniAllStrings();

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const CYCLES = parseInt(getArg('--cycles', '18'), 10);
const OUT = getArg('--out', path.join(here, 'out', 'strudel-events.json'));

const CPM = 158;
const SPC = 60 / CPM; // seconds per cycle
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const num = (v, def) => (typeof v === 'number' && isFinite(v) ? v : def);

const OSCS = new Set(['square', 'saw', 'sawtooth', 'triangle', 'sine']);

function toEvent(part, hap, secPerCycle) {
  const toNum = (f) => Number(f.n) / Number(f.d);
  const t = r6(toNum(hap.whole.begin) * secPerCycle);
  const dur = r6(Math.max(0.02, (toNum(hap.whole.end) - toNum(hap.whole.begin)) * secPerCycle));
  const v = hap.value;
  // Strudel `pan` is 0..1 (0=left, 1=right, default 0.5=center); the neutral
  // schema is -1..1 like PulseGrid voices, so map it (superdough centers 0.5).
  // No-gain default is 0.8 (superdough defaultDefaultValues.gain), not 1.
  const ev = { part, t, dur, gain: num(v?.gain, 0.8), pan: num(v?.pan, 0.5) * 2 - 1, cutoff: num(v?.cutoff, 18000) };
  if (v && typeof v === 'object' && typeof v.note === 'number') {
    ev.midi = v.note + 12 * (num(v.octave, 0) || 0);
    const s = typeof v.s === 'string' ? v.s.toLowerCase() : 'saw';
    ev.osc = OSCS.has(s) ? s.replace('sawtooth', 'saw') : 'saw';
    if (!OSCS.has(s)) ev.approx = `osc:${s}->saw`;
    if (v.crush != null && (typeof v.crush === 'number' || typeof v.crush === 'string')) ev.crush = v.crush;
  } else if (v && typeof v === 'object' && typeof v.s === 'string') {
    ev.sample = v.s.toLowerCase() + (v.n != null && isFinite(Number(v.n)) ? `:${Number(v.n)}` : '');
  } else if (typeof v === 'string') {
    ev.sample = v.toLowerCase();
  } else {
    return null;
  }
  return ev;
}

function query(part, pat, from, to, events) {
  for (const hap of pat.queryArc(from, to)) {
    if (typeof hap.hasOnset === 'function' && !hap.hasOnset()) continue;
    const ev = toEvent(part, hap, SPC);
    if (ev) events.push(ev);
  }
}

const events = [];
const q = (part, pat) => query(part, pat, 0, CYCLES, events);

q('kick', core.sound('<bd:4 bd:4 bd:4 bd:4>').gain(0.9).lpf(1000));
q('hats', core.sound('[hh hh hh hh]').att(0.005).decay(0.15).gain(0.56));
q('openhat', core.sound('[oh ~ oh ~]').att(0.005).decay(0.15).gain(0.25));
q('clap', core.sound('<~ cp ~ cp>').gain(0.75).att(0.05));
for (const [part, oct, s] of [['bass_oct3', 3, 'square'], ['bass_oct2', 2, 'saw'], ['bass_oct1', 1, 'triangle']]) {
  q(part, core.note('<6@4 5@3.5 1@8.5>').set('D').oct(oct).s(s).lpf(2000));
}
q('chords', core.note('<[6, 8, 10, 13]@4 [3, 5, 8, 10]@3.5 [1, 3, 5, 8]@8.5>').set('D').oct('<4 5>').s('saw').lpf(1600).gain(0.35));
q('arp', core.note('[ 1*2 [3 5] [6 8] [~ 5] | [8 10] [8 5] [3 5] [1 0] ]').set('D').oct('<4 5 4 6>').s('wt_digital_bad_day').gain(0.63).slow(2).distort(0.4).crush('<4 4 4 6>').att(0.05).vib(0.1).pan(core.sine.slow(0.1).range(0, 1)));
q('sparkle', core.note('[1 ~ 8 ~ 10 ~ 13 ~]').set('D').oct('<5 6 5 6>').s('saw').gain(0.18).legato(1).release(0.5).pan(core.sine.slow(0.5)).lpf(core.sine.range(2500, 7000).slow(4)));

events.sort((a, b) => a.t - b.t || String(a.part).localeCompare(String(b.part)));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'strudel', cpm: CPM, cycles: CYCLES, secondsPerCycle: SPC, events }, null, 1));
console.log(`wrote ${OUT} (${events.length} events, ${CYCLES} cycles)`);
