# compare-audio — Strudel vs PulseGrid demo audio comparison

Compares what the two demo projects **sound like**, not just which notes they
schedule. Complements `tools/parity/check.mjs` (event onsets/pitches) by
rendering audio and diffing it per stem.

## Quickstart

```bash
# Arrangement check: real schedulers -> shared neutral render -> per-stem diff
node tools/compare-audio/compare.mjs events --cycles 18 --out tools/compare-audio/out
# or
npm run compare:demo

# Self-test (no audio hardware needed)
node tools/compare-audio/test.mjs

# Bounce check: diff two recorded bounces (see "Real bounces" below)
node tools/compare-audio/compare.mjs files strudel-bounce.wav pulsegrid-bounce.wav --out tools/compare-audio/out
```

## How it works

**`events` mode** (headless, deterministic):

1. `events-strudel.mjs` queries the **real vendored Strudel scheduler**
   (`queryArc`, same ground truth as the parity tool) over `demo.strudel`'s
   patterns — including per-event controls (`gain`, `cutoff`, `pan`, `s`, `n`).
2. `events-pulsegrid.mjs` evaluates the **real `demos/STRUDEL_DEMO.js`** through the
   **real `PatternScheduler`** (`evaluateCode` + `computePatternEvents`).
3. Both event lists are rendered through **one shared neutral DSP chain**
   (`lib/render.mjs`: pure osc / sample playback, linear ADSR, static LPF,
   equal-power pan — the documented common ground of both engines).
4. Renders are compared per stem (drums / bass / chords / arp / sparkle / mix):
   sample-accurate lag, least-squares level match, null-test residual,
   envelope correlation, onset agreement, spectral centroid + band balance.

Because the render chain is identical for both sides, any residual comes
**only from the events** (timing, pitch, sample choice, gain, filter) — never
from synth implementation differences. Both sides share one headroom factor
(pair peak → 0.89), so additive clipping can never pollute the null test.

**`files` mode**: aligns (cross-correlation + fine search), level-matches
(least squares), and null-tests any two recorded bounces. Use it to
characterize **engine color** (reverb/delay/chorus/ducking implementations).

## Outputs (`--out`, default `tools/compare-audio/out/`)

| file | contents |
| --- | --- |
| `report.md` / `report.json` | stem table, systematic scales, arp branches, per-track tables, verdicts |
| `strudel-neutral.wav` / `pulsegrid-neutral.wav` | the two neutral renders (listen!) |
| `diff.wav` | null residual, peak-normalized (what's left after cancellation) |
| `strudel-events.json` / `pulsegrid-events.json` | the dumped event lists (audit trail) |
| `tracks/<part>-strudel.wav` / `<part>-pulsegrid.wav` | every track exported separately (10 tracks × 2 sides) |
| `tracks/<part>-diff.wav` | per-track residual, only where the track isn't MATCH |

`--no-tracks` skips the per-track exports (stems + mix only).

Exit code: `0` = no stem `DIFFER`s (events mode) / report written (files mode);
`1` = a deterministic stem diverges — investigate.

## Reading the report

- **systematic scales** — median PulseGrid÷Strudel ratios over onset-matched
  pairs. Both are `×1.000` since the parity fix (full-step durations, unity
  velocity in `src/audio/MiniNotationParser.ts`, default track gain 1.0 in
  `PatternScheduler`/`AudioEngine`/`MixerStore`/`MixerConsole`). If a
  regression reintroduces a scale (e.g. `duration ×0.900`), it shows up here
  *and* as `DIFFER` residuals on sustained stems (early-release gaps) — the
  residuals are computed **after** per-stem level match, so scales never mask
  shape differences; they are reported, not forgiven.
- **lag ms** — must be `0.00` in events mode (same clock). Any nonzero lag is a
  scheduling bug.
- **VARIANT (arp)** — the `[ A | B ]` phrase choice is random per engine run,
  so the two renders legitimately pick different branches. The report prints
  both branch sequences (e.g. `ABBAAABAB` vs `ABBABAABB`); every phrase is
  validated note-by-note against the A/B grids (same grids as
  `tools/parity/check.mjs`), so a broken arp still fails loudly instead of
  hiding behind VARIANT.
- **Per-track waveforms** — each track's render is analyzed in the time
  domain: peak/RMS/crest (dBFS), DC offset, zero-crossing rate, clipped-sample
  count, L/R correlation, side/mid ratio, first-attack 10–90% rise time, and
  mean spectral centroid. The S/P rows must agree; this is how the pan
  convention bug was caught (Strudel 0..1 pans rendered off-center until the
  dump mapped them to the -1..1 neutral schema).
- **CLOSE (drums/sparkle)** — same shape, residual only from the 0.9×
  truncation tails (samples cut at `dur*1.5`) and per-event LFO sampling.
- **onset `n/a`** — legato material never dips below the detection threshold;
  agreement is "not measurable", not a mismatch.

## Real bounces (engine color)

The neutral render deliberately excludes FX: delay/room/chorus/distort/crush,
ducking sidechain, vibrato, wavetable morphing, and the `wt_digital_bad_day`
oscillator (rendered as saw, flagged `approx` in the event JSONs). To compare
the **actual engine outputs**:

1. **Strudel**: open `demo.strudel` in the Strudel REPL, press play, capture
   with the REPL tape / export, or record the tab with an OS recorder.
   Record from cycle 0 for easiest alignment (the tool aligns ±1s by default,
   `--maxlag` overrides).
2. **PulseGrid**: load the `Strudel Demo` preset, press play, record the master
   output (OS recorder on the tab, or cable the master gain to a
   `MediaStreamDestination` — see `AudioEngine`; a one-click bounce export is
   planned).
3. Run `compare.mjs files strudel.wav pulsegrid.wav`. Expect `DIFFERENT` at
   mix level (different FX implementations) — use the per-metric breakdown
   (residual dBFS, envelope correlation, centroid Δ, band distance) and
   `diff.wav` listening to localize which engine stage colors the sound.

Pan convention note: Strudel `pan` is 0..1 (0.5 = center) while PulseGrid
voices are -1..1 — the Strudel event dump maps `pan*2-1` so both sides render
centered identically. Raw out-of-range signals (e.g. unranged `sine` fed to
`pan`) follow each engine's own clamp behavior and are compared as-resolved.

## Files

```
tools/compare-audio/
  compare.mjs            CLI: `events` | `files`
  events-strudel.mjs     Strudel event dump (vendored scheduler)
  events-pulsegrid.mjs   PulseGrid event dump (real PatternScheduler)
  test.mjs               self-test (wav IO, alignment, null, scales, CLI smoke)
  lib/wav.mjs            WAV read/write (chunk-scanning, int+float), resample
  lib/dsp.mjs            FFT, spectra, alignment, biquad, osc, pan
  lib/render.mjs         shared neutral renderer (the "same chain")
  out/                   generated reports + wavs (not source)
```

No dependencies beyond what's already in the repo (`tsx` for the TS side).
