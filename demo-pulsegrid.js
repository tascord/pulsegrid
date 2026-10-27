// Full port of demo.strudel — patterns + FX (Strudel parity).
// Timing/pitch verified against Strudel sources in strudel-main/:
// - `note("6")` numbers are RAW MIDI (freq = midi(note) * 2^octave).
// - Effective MIDI = number + 12 * octave (`.set("D")` is a no-op).
// Synths square/saw/triangle match Strudel superdough: pure oscillators,
// linear ADSR [0.001,0.05,0.6,0.01], gain 0.3, no filter unless .lpf().
setcpm(158);

// Yamaha RY30 one-shots vendored in public/samples (see strudel.json
// manifest; same file order so `:n` indexes match Strudel) + the real
// wt_digital_bad_day wavetable sweep.
import {
  ry30_bd as bd,
  ry30_oh as oh,
  ry30_cp as cp,
  ry30_hh as hh,
  wt_digital_bad_day,
} from 'ry30';

// Bass: raw-MIDI numbers 6/5/1 lifted by .oct() (effective MIDI = n + 12*oct),
// layered square/saw/triangle at octaves 3/2/1 into orbit 2 (ducked by the kick below).
track("bass_sq").note("<6@4 5@3.5 1@8.5>").set("D").oct(3).s("square").lpf(2000).orbit(2);
track("bass_saw").note("<6@4 5@3.5 1@8.5>").set("D").oct(2).s("saw").lpf(2000).orbit(2);
track("bass_tri").note("<6@4 5@3.5 1@8.5>").set("D").oct(1).s("triangle").lpf(2000).orbit(2);

// Drums: four-on-floor kick ducking the bass orbit, hats, open hats, clap.
track("kick").sound("<bd:4 bd:4 bd:4 bd:4>").gain(0.9).lpf(1000).duckorbit(2).duckattack(0.02).duckdepth(1).room(1);
track("hh").sound("[hh hh hh hh]").att(0.005).decay(0.15).gain(0.56).room(1);
track("oh").sound("[oh ~ oh ~]").att(0.005).decay(0.15).gain(0.25).room(1);
track("cp").sound("<~ cp ~ cp>").gain(0.75).att(0.05).room(1);

// Chord stabs: raw-MIDI stacks rotating octaves 4/5 per cycle.
track("lead_chords").note("<[6, 8, 10, 13]@4 [3, 5, 8, 10]@3.5 [1, 3, 5, 8]@8.5>").set("D").oct("<4 5>").s("saw").lpf(1600).gain(0.35).size(0.8).chorus(1.4).delay(0.12).delayfeedback(0.25);

// Wavetable lead: phrase picks a side of the pipe every 2 cycles (.slow(2)).
track("lead_wt").note("[ 1*2 [3 5] [6 8] [~ 5] | [8 10] [8 5] [3 5] [1 0] ]").set("D").oct("<4 5 4 6>").s("wt_digital_bad_day").gain(0.63).slow(2).distort(0.4).crush("<4 4 4 6>").delay(0.25).delaytime(0.1875).delayfeedback(0.45).pan(sine.slow(0.1).range(0, 1)).att(0.05).vib(0.1).color("pink").log();

// High sparkle: raw-MIDI pings wandering octaves 5/6 over an LFO'd filter.
track("lead_top").note("[1 ~ 8 ~ 10 ~ 13 ~]").set("D").oct("<5 6 5 6>").s("saw").gain(0.18).legato(1).release(0.5).chorus(1).pan(sine.slow(0.5)).delay(0.5).delayfeedback(0.65).room(0.8).lpf(sine.range(2500, 7000).slow(4));
