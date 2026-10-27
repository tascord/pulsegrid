// Strudel ground truth for demo.strudel's pitched + drum patterns.
// Runs in plain node against the vendored sources in strudel-main/.
// Prints one JSON object per line: {part, start, end, value}
// (times in cycles; pitched values carry raw {note, octave} like the log).
import * as core from '../../strudel-main/strudel/packages/core/index.mjs';
import * as mini from '../../strudel-main/strudel/packages/mini/mini.mjs';
import '../../strudel-main/strudel/packages/tonal/tonal.mjs';

mini.miniAllStrings();

// Onsets use whole.begin (unclipped): a held note spanning cycles counts
// once, at its attack — retriggers would show up as separate wholes.
const out = (part, hap) => {
  const toNum = (f) => Math.round(Number(f.n) / Number(f.d) * 10000) / 10000;
  console.log(JSON.stringify({
    part,
    start: toNum(hap.whole.begin),
    end: toNum(hap.whole.end),
    value: hap.value,
  }));
};

const query = (part, pat, from, to) => {
  // Mirror the scheduler (cyclist/neocyclist): only haps whose onset falls
  // inside the query trigger a sound. Held spans sound once, at the attack.
  for (const hap of pat.queryArc(from, to)) {
    if (typeof hap.hasOnset === 'function' && !hap.hasOnset()) continue;
    out(part, hap);
  }
};

// Drums (sample values; :4 selects a bank index, kept in the value).
query('kick', core.sound('<bd:4 bd:4 bd:4 bd:4>'), 0, 6);
query('hats', core.sound('[hh hh hh hh]'), 0, 6);
query('openhat', core.sound('[oh ~ oh ~]'), 0, 6);
query('clap', core.sound('<~ cp ~ cp>'), 0, 6);

// Bass: 3 stacked octave layers, raw MIDI numbers (`.set("D")` is a no-op).
for (const oct of [3, 2, 1]) {
  query(`bass_oct${oct}`, core.note('<6@4 5@3.5 1@8.5>').set('D').oct(oct), 0, 16);
}

// Chords with per-cycle octave rotation.
query('chords', core.note('<[6, 8, 10, 13]@4 [3, 5, 8, 10]@3.5 [1, 3, 5, 8]@8.5>').set('D').oct('<4 5>'), 0, 16);

// Arp: random | flip + slow(2) + octave cycle. 18 cycles = 9 phrases.
// Control chain mirrors demo.strudel (values ride the haps; crush is asserted).
// All of these are pure core controls (no audio modules needed).
query(
  'arp',
  core.note('[ 1*2 [3 5] [6 8] [~ 5] | [8 10] [8 5] [3 5] [1 0] ]').set('D').oct('<4 5 4 6>')
    .gain(0.63).slow(2).distort(0.4).crush('<4 4 4 6>')
    .delay(0.25).delaytime(0.1875).delayfeedback(0.45).att(0.05).vib(0.1),
  0, 18,
);

// Sparkle.
query('sparkle', core.note('[1 ~ 8 ~ 10 ~ 13 ~]').set('D').oct('<5 6 5 6>'), 0, 8);
