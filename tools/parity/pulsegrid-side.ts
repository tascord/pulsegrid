// PulseGrid side of the parity check: evaluates the real demos/STRUDEL_DEMO.js
// through the real PatternScheduler (evaluateCode + computePatternEvents)
// and prints one JSON object per line: {track, start, end, value}
// (times in cycles; pitched values as effective MIDI numbers).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patternScheduler } from '../../src/audio/PatternScheduler';
import { noteToMidi } from '../../src/audio/MiniNotationParser';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '../../demos/STRUDEL_DEMO.js'), 'utf8');
const res = patternScheduler.evaluateCode(code);
if (!res.success) {
  console.error('EVAL FAILED: ' + res.error);
  process.exit(1);
}

const cpm = patternScheduler.getCpm();
const T = 60 / cpm; // seconds per cycle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tracks = (patternScheduler as any).evaluatedTracks as Map<string, any>;

function toMidiOrSample(finalValue: string): number | string {
  const t = finalValue.trim();
  const n = t.match(/^(n:|note:)?(-?\d+)$/);
  if (n) return parseInt(n[2], 10);
  const midi = noteToMidi(t);
  if (midi !== null) return midi;
  return t; // sample token, e.g. "bd:4"
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;
for (let c = 0; c < 18; c++) {
  for (const track of tracks.values()) {
    const evs = patternScheduler.computePatternEvents(track, c, 0, T, c * T, (c + 1) * T);
    for (const ev of evs) {
      console.log(JSON.stringify({
        track: track.id,
        start: r4(ev.scheduledTime / T),
        end: r4((ev.scheduledTime + ev.actualDuration) / T),
        value: toMidiOrSample(ev.finalValue),
        crush: (ev as { voice?: { crush?: number } }).voice?.crush ?? null,
      }));
    }
  }
}
