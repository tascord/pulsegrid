// PulseGrid event dump for the demo comparison tool.
// Evaluates the REAL demo-pulsegrid.js through the REAL PatternScheduler
// (evaluateCode + computePatternEvents) and writes out/pulsegrid-events.json
// in the same schema as events-strudel.mjs (absolute seconds, effective MIDI,
// per-event gain/pan/cutoff). Track ids are mapped to the canonical part
// names used on the Strudel side.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patternScheduler } from '../../src/audio/PatternScheduler';
import { noteToMidi } from '../../src/audio/MiniNotationParser';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const CYCLES = parseInt(getArg('--cycles', '18'), 10);
const OUT = getArg('--out', path.join(here, 'out', 'pulsegrid-events.json'));

const TRACK2PART = {
  kick: 'kick',
  hh: 'hats',
  oh: 'openhat',
  cp: 'clap',
  bass_sq: 'bass_oct3',
  bass_saw: 'bass_oct2',
  bass_tri: 'bass_oct1',
  lead_chords: 'chords',
  lead_wt: 'arp',
  lead_top: 'sparkle',
};

const code = fs.readFileSync(path.join(here, '../../demo-pulsegrid.js'), 'utf8');
const res = patternScheduler.evaluateCode(code);
if (!res.success) {
  console.error('EVAL FAILED: ' + res.error);
  process.exit(1);
}
const cpm = patternScheduler.getCpm();
const SPC = 60 / cpm; // seconds per cycle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tracks = patternScheduler.evaluatedTracks;

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function toMidiOrSample(finalValue) {
  const t = finalValue.trim();
  const n = t.match(/^(n:|note:)?(-?\d+)$/);
  if (n) return { midi: parseInt(n[2], 10) };
  const midi = noteToMidi(t);
  if (midi !== null) return { midi };
  return { sample: t.toLowerCase() };
}

const events = [];
for (let c = 0; c < CYCLES; c++) {
  for (const track of tracks.values()) {
    const evs = patternScheduler.computePatternEvents(track, c, 0, SPC, c * SPC, (c + 1) * SPC);
    for (const ev of evs) {
      const conv = toMidiOrSample(ev.finalValue);
      const part = TRACK2PART[track.id] || track.id;
      // The engine applies track.gain once, at the strip fader. The neutral
      // render has no fader stage, so fold it into the event gain here.
      const base = {
        part,
        t: r6(ev.scheduledTime),
        dur: r6(Math.max(0.02, ev.actualDuration)),
        gain: r6(ev.velocity * track.gain),
        pan: r6(ev.voice?.pan ?? 0),
        cutoff: ev.voice?.cutoff ?? 18000,
      };
      if (conv.midi != null) {
        const inst = (track.instrument || 'saw').toLowerCase();
        const osc = inst === 'square' ? 'square' : inst === 'triangle' ? 'triangle' : inst === 'sine' ? 'sine' : 'saw';
        events.push({ ...base, midi: conv.midi, osc, ...(osc === 'saw' && !['saw', 'sawtooth'].includes(inst) ? { approx: `osc:${inst}->saw` } : {}) });
      } else {
        events.push({ ...base, sample: conv.sample });
      }
    }
  }
}

events.sort((a, b) => a.t - b.t || String(a.part).localeCompare(String(b.part)));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'pulsegrid', cpm, cycles: CYCLES, secondsPerCycle: SPC, events }, null, 1));
console.log(`wrote ${OUT} (${events.length} events, ${CYCLES} cycles, cpm=${cpm})`);
