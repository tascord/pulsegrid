import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { TrackMixerState, MasterMixerState } from './audio/MixerStore';
import { Navbar, DrawerTab } from './components/Navbar';
import { CodeEditor } from './components/CodeEditor';
import { Visualizer, type VisualizerMode } from './components/Visualizer';
import { MixerConsole } from './components/MixerConsole';
import { PatternDrawer } from './components/PatternDrawer';
import { InstrumentDrawer } from './components/InstrumentDrawer';
import { SampleDrawer } from './components/SampleDrawer';
import { MidiDrawer } from './components/MidiDrawer';
import { LogsDrawer } from './components/LogsDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { DocsDrawer } from './components/DocsDrawer';
import { CommunityModal } from './components/CommunityModal';
import { patternScheduler } from './audio/PatternScheduler';
import { audioEngine } from './audio/AudioEngine';
import { midiManager } from './audio/MidiManager';
import { vstBridge } from './audio/VstBridge';
import { Keyboard, Trash2, ExternalLink, X, LogIn } from 'lucide-react';
import { InspectorPopoutWindow } from './components/InspectorPopout';

const CODE_KEY = 'pulsegrid-code-v1';
const CPM_KEY = 'pulsegrid-cpm-v1';
const INSPECTOR_WIDTH_KEY = 'pulsegrid-inspector-width-v1';
const ACTIVE_TAB_KEY = 'pulsegrid-active-tab-v1';
const LAST_ACTIVE_TAB_KEY = 'pulsegrid-last-tab-v1';
const VALID_TABS = ['mixer', 'patterns', 'instruments', 'samples', 'midi', 'logs', 'style', 'docs'] as const;
const INSPECTOR_MIN = 300;
const INSPECTOR_MAX = 1200;
const INSPECTOR_DEFAULT = 420;
const INSPECTOR_WIDE = 900;
// Dragging the separator below this width collapses the sidebar instead of
// clamping. The buffer below INSPECTOR_MIN avoids accidental collapses when
// aiming for the minimum width.
const INSPECTOR_COLLAPSE_BELOW = 240;
// Dragging the collapsed strip this far left expands the sidebar again.
const INSPECTOR_EXPAND_ABOVE = 24;

const DEFAULT_CODE = `// Reusable patterns

defPattern("kick_groove", "bd ~ bd [~ bd]");
defPattern("hats", "[~ hh*2] [~ hh] [~ hh*2] [oh ~]");
defPattern("clap_snare", "~ cp ~ [cp*2 ~]");
defPattern("acid_riff", "c2 [c2 eb2] g2 [bb2 c3]");

track("kick").pattern("kick_groove").gain(0.95).scope();
track("hats").pattern("hats").gain(0.7).pan(0.15);
track("clap").pattern("clap_snare").gain(0.8).reverb(0.25);
track("acid").pattern("acid_riff")
  .synth("acid_303")
  .cutoff(1200)
  .res(12)
  .delay(0.35)
  .gain(0.85)
  .scope();
`;

const PRESETS = [
  { name: 'Acid 303', cpm: 33, code: DEFAULT_CODE },
  {
    name: 'Liquid DnB',
    cpm: 43.5,
    code: `// Liquid drum and bass
defPattern("amen_slices", "amen:0 [amen:1 amen:2] amen:0 [amen:3 ~]");
defPattern("sub_roller", "f1 ~ [f1 ab1] c2");
defPattern("lush_pad", "c3 [eb3 g3] [bb3 ~] d4");

track("drums").pattern("amen_slices").gain(0.9).scope();
track("sub").pattern("sub_roller").synth("sub_bass").lpf(320).gain(0.9);
track("atmosphere").pattern("lush_pad")
  .synth("poly_saw")
  .slow(2)
  .reverb(0.5)
  .delay(0.4)
  .gain(0.65)
  .scope();`,
  },
  {
    name: 'FM Ambient',
    cpm: 22.5,
    code: `// FM ambient
defPattern("chimes", "[c4, eb4, g4] [bb4 d5] [f4, ab4] c5");
defPattern("drone", "c2/2 ~ g2/2 ~");
defPattern("click_perc", "rim(3,8) [~ hh(5,8)]");

track("bells").pattern("chimes")
  .synth("fm_bell")
  .fast(1.5)
  .reverb(0.6)
  .delay(0.3)
  .gain(0.7)
  .scope();
track("bass").pattern("drone").synth("sub_bass").gain(0.75);
track("clicks").pattern("click_perc").gain(0.55).pan(-0.2);`,
  },
  {
    name: 'Euclidean',
    cpm: 31.5,
    code: `// Euclidean rhythm
defPattern("euc_kick", "bd(3,8)");
defPattern("euc_snare", "~ [sd cp] ~ sd");
defPattern("euc_hats", "hh(5,8)");
defPattern("synth_pluck", "c3 [g3 bb3] [f3 ~] eb3");

track("kick").pattern("euc_kick").gain(0.9).scope();
track("snare").pattern("euc_snare").gain(0.85).reverb(0.2);
track("hats").pattern("euc_hats").gain(0.65).pan(0.2);
track("pluck").pattern("synth_pluck").synth("pluck").res(5).cutoff(2200).delay(0.3).gain(0.8).scope();`,
  },
  {
    name: 'Strudel Demo',
    cpm: 158,
    code: `// Full demo.strudel in the track() DSL — all FX live.
// Numbers are raw MIDI (effective MIDI = number + 12 * octave); .set("D") is a parity no-op.
cpm(158);

import {
  ry30_bd as bd,
  ry30_oh as oh,
  ry30_cp as cp,
  ry30_hh as hh,
  wt_digital_bad_day,
} from 'ry30';

track("bass_sq").note("<6@4 5@3.5 1@8.5>").set("D").oct(3).s("square").lpf(2000).orbit(2);
track("bass_saw").note("<6@4 5@3.5 1@8.5>").set("D").oct(2).s("saw").lpf(2000).orbit(2);
track("bass_tri").note("<6@4 5@3.5 1@8.5>").set("D").oct(1).s("triangle").lpf(2000).orbit(2);
track("kick").sound("<bd:4 bd:4 bd:4 bd:4>").gain(0.9).lpf(1000).duckorbit(2).duckattack(0.02).duckdepth(1).room(1);
track("hh").sound("[hh hh hh hh]").att(0.005).decay(0.15).gain(0.56).room(1);
track("oh").sound("[oh ~ oh ~]").att(0.005).decay(0.15).gain(0.25).room(1);
track("cp").sound("<~ cp ~ cp>").gain(0.75).att(0.05).room(1);
track("lead_chords").note("<[6, 8, 10, 13]@4 [3, 5, 8, 10]@3.5 [1, 3, 5, 8]@8.5>").set("D").oct("<4 5>").s("saw").lpf(1600).gain(0.35).size(0.8).chorus(1.4).delay(0.12).delayfeedback(0.25);
track("lead_wt").note("[ 1*2 [3 5] [6 8] [~ 5] | [8 10] [8 5] [3 5] [1 0] ]").set("D").oct("<4 5 4 6>").s("wt_digital_bad_day").gain(0.63).slow(2).distort(0.4).crush("<4 4 4 6>").delay(0.25).delaytime(0.1875).delayfeedback(0.45).pan(sine.slow(0.1).range(0,1)).att(0.05).vib(0.1).color("pink").log();
track("lead_top").note("[1 ~ 8 ~ 10 ~ 13 ~]").set("D").oct("<5 6 5 6>").s("saw").gain(0.18).legato(1).release(0.5).chorus(1).pan(sine.slow(0.5)).delay(0.5).delayfeedback(0.65).room(0.8).lpf(sine.range(2500,7000).slow(4));`,
  },
  {
    name: 'Peak Techno',
    cpm: 34.5,
    code: `// Peak-time techno — pumping sidechain, rolling rumble, LFO hats.
cpm(34.5);

defPattern("k", "bd bd bd bd");
defPattern("rumble", "~ [bd ~] ~ [bd*2 ~]");
defPattern("hats", "[hh hh? hh hh] [oh hh hh hh?]");
defPattern("tops", "[perc perc? cb] [perc cb perc?]");
defPattern("clap", "~ ~ cp ~");
defPattern("bass", "c1 [c1 c1] c1 [c1 g1]");
defPattern("stab", "[eb3, g3, bb3] ~ [f3, ab3, c4] ~");
defPattern("acid", "c2 [c2 eb2] g2 [bb2 c3]");

track("kick").pattern("k").gain(0.95).lpf(900).duckorbit(2).duckattack(0.015).duckdepth(1).room(0.5).scope();
track("rumble").pattern("rumble").gain(0.5).lpf(180).orbit(2).distort(0.35).shape(0.4).scope();
track("hats").pattern("hats").gain(slider(0.6, 0, 1)).pan(sine.slow(8).range(-0.6, 0.6)).att(0.004).decay(0.12).room(0.5).swing(0.06).cut(1);
track("tops").pattern("tops").gain(0.4).pan(saw.slow(4).range(-0.5, 0.5)).decay(0.1).room(0.6).stut(2, 0.4, 0.03).degrade(0.1);
track("clap").pattern("clap").gain(0.8).room(0.4).delay(0.2).delayfeedback(0.3).stut(3, 0.5, 0.04);
track("bass").pattern("bass").synth("sub_bass").gain(0.9).lpf(320).orbit(2).slide(0.05).compressor(-14, 4, 0.003, 0.2).scope();
track("stab").pattern("stab").synth("poly_saw").gain(0.5).lpf(sine.range(900, 3800).slow(4)).res(6).chorus(0.8).delay(0.35).delaytime(0.28).delayfeedback(0.4).jux().pianoroll();
track("acid").pattern("acid").synth("acid_303").gain(0.7).cutoff(sine.range(500, 4500).slow(2)).res(14).drive(0.5).delay(0.25).orbit(2).spectrum();`,
  },
  {
    name: 'Jungle Science',
    cpm: 43,
    code: `// Jungle science — chopped Amen, Reese bass, ragga pressure.
cpm(43);

defPattern("amen_main", "amen:0 [amen:1 amen:2] amen:0 [amen:3 ~]");
defPattern("amen_ghost", "[~ amen:1] [amen:2 ~] [amen:3 amen:1] ~");
defPattern("kick", "bd ~ [~ bd] ~");
defPattern("snare", "~ ~ sd ~");
defPattern("hats", "hh(5,8)");
defPattern("sub", "f1 ~ [~ f1] c2");
defPattern("reese", "[f2, c3] ~ [g2, d3] ~");
defPattern("keys", "[a3, c4, e4] ~ [g3, bb3, d4] ~");

track("break").pattern("amen_main").gain(0.9).lpf(6500).room(0.25).chop(2).scope();
track("ghost").pattern("amen_ghost").gain(0.55).hpf(1200).striate(4).rev().pan(sine.slow(2).range(-0.7, 0.7)).room(0.4);
track("kick").pattern("kick").gain(0.9).lpf(800).duckorbit(2).duckattack(0.01).duckdepth(1);
track("snare").pattern("snare").gain(0.85).room(0.35).delay(0.25).delayfeedback(0.4).stut(2, 0.5, 0.05);
track("hats").pattern("hats").gain(0.55).pan(0.2).att(0.003).decay(0.08).cut(1).iter(2).swing(0.1);
track("sub").pattern("sub").synth("sub_bass").gain(0.95).lpf(300).orbit(2).legato(1.4).slide(0.06).scope();
track("reese").pattern("reese").synth("saw").gain(0.5).lpf(900).res(8).detune(10).unison(2).spread(0.5).vowel("a").distort(0.3).orbit(2).palindrome().pianoroll();
track("keys").pattern("keys").synth("fm_bell").gain(0.5).slow(2).reverb(0.55).delay(0.4).delayfeedback(0.5).chorus(0.7).jux().spectrum();`,
  },
  {
    name: 'Deep House',
    cpm: 30.5,
    code: `// Deep house — warm Rhodes, garage swing, wide night bus.
cpm(30.5);

defPattern("kick", "bd bd bd bd");
defPattern("hats", "[hh hh] [oh hh?]");
defPattern("groove", polyrhythm("hh(5,8)", "perc(3,8)"));
defPattern("snare", "~ [cp sd] ~ [cp ~]");
defPattern("bass", "f1 ~ f1 [~ g1]");
defPattern("arp", "f3 [ab3 c4] [eb4 c4] ab3");

track("kick").pattern("kick").gain(0.92).lpf(750).duckorbit(2).duckattack(0.02).duckdepth(1).room(0.4).scope();
track("hats").pattern("hats").gain(slider(0.55, 0, 1)).pan(sine.slow(8).range(-0.5, 0.5)).decay(0.1).room(0.5).swing(0.12).cut(1);
track("groove").pattern("groove").gain(0.4).room(0.5).delay(0.2).struct("t t f t").degrade(0.15);
track("snare").pattern("snare").gain(0.75).room(0.45).delay(0.3).delayfeedback(0.35).late(0.015);
track("bass").pattern("bass").synth("sub_bass").gain(0.9).lpf(280).orbit(2).slide(0.08).legato(1.3).compressor(-12, 4, 0.005, 0.25).scope();
track("rhodes").note(slowcat(chord("F3m7"), chord("Eb3maj7"), chord("D3m7"), chord("C3m7"))).synth("poly_saw").gain(0.5).lpf(2200).res(3).chorus(0.6).phaser(0.8).phaserDepth(900).leslie(0.5).delay(0.3).reverb(0.4).jux().pianoroll();
track("arp").pattern("arp").synth("pluck").gain(0.45).cutoff(perlin.slow(3).range(1200, 5200)).res(7).delay(0.35).delaytime(0.24).delayfeedback(0.5).tremolo(5).pan(rand.slow(4).range(-0.6, 0.6)).spectrum();
track("vocal").pattern("[~ perc] ~ [cb ~] ~").gain(0.35).room(0.6).delay(0.4).delayfeedback(0.55).stut(3, 0.45, 0.06).superimpose().early(0.02);`,
  },
  {
    name: 'IDM Glitch',
    cpm: 37,
    code: `// IDM glitch — generative percussion, morphing blips, drifting pad.
cpm(37);

defPattern("kick", "bd(3,8)");
defPattern("snare", "~ [sd sd?] ~ [sd ~]");
defPattern("hats", "hh*3 [hh? hh] [~ hh*2] hh?");
defPattern("blips", "[c5 eb5] [g5 ~] [bb4 c5] [d5 ~]");
defPattern("bass", "c2 [~ g1] [c2 ~] [eb2 ~]");
defPattern("pads", "[f3, ab3, c4] [g3, bb3, eb4]");
defPattern("tex", "{bd hh, perc rim}");

track("kick").pattern("kick").gain(0.9).lpf(1000).duckorbit(2).duckattack(0.01).duckdepth(1).struct("t f t t").iter(1).scope();
track("snare").pattern("snare").gain(0.7).room(0.5).delay(0.3).delayfeedback(0.45).degrade(0.2).early(0.03).stut(2, 0.4, 0.02);
track("hats").pattern("hats").gain(0.5).pan(rand.slow(2).range(-0.8, 0.8)).hpf(4000).decay(0.06).cut(1).chop(3).late(0.02);
track("blips").pattern("blips").synth("chiptune").gain(0.45).lpf(perlin.slow(3).range(800, 7000)).crush("<12 8 6 4>").striate(4).rev().delay(0.4).delayfeedback(0.6).pianoroll();
track("bass").pattern("bass").synth("sine").gain(0.85).lpf(400).orbit(2).slide(0.12).legato(1.6).shape(0.3).coarse(10).palindrome().scope();
track("pads").pattern("pads").synth("fm_bell").gain(slider(0.5, 0, 1)).slow(2).reverb(0.6).chorus(0.9).fshift(30).warp(0.4).superimpose().spectrum();
track("tex").pattern("tex").gain(0.3).room(0.7).delay(0.5).delayfeedback(0.6).hurry(1.5).ply(2).jux().spiral();
track("wob").pattern("c3 ~ [eb3 ~]").synth("saw").gain(0.35).cutoff(sine.range(300, 3000).slow(5)).res(10).vib(6).tremolo(7).drive(0.4).phaser(1.2).dry(0.6);`,
  },
  {
    name: 'Trance Euphoria',
    cpm: 35,
    code: `// Trance euphoria — supersaw anthem, gated pads, hands-in-the-air lead.
cpm(35);

defPattern("kick", "bd bd bd bd");
defPattern("offbass", "~ c3 ~ [c3 c3]");
defPattern("hats", "[hh hh hh hh] [oh hh hh hh]");
defPattern("clap", "~ ~ cp ~");
defPattern("prog", slowcat("[c3, eb3, g3]", "[ab2, c3, eb3]", "[f2, ab2, c3]", "[g2, bb2, d3]"));
defPattern("arp", "c4 [eb4 g4] [ab4 g4] [eb4 c4]");
defPattern("spark", "[c6 ~ eb6 ~] [g6 ~ bb6 ~]");

track("kick").pattern("kick").gain(0.95).lpf(850).duckorbit(2).duckattack(0.012).duckdepth(1).room(0.4).scope();
track("offbass").pattern("offbass").synth("sawtooth").gain(0.7).lpf(500).orbit(2).slide(0.04).legato(0.9).compressor(-12, 5, 0.003, 0.2).scope();
track("hats").pattern("hats").gain(0.5).pan(sine.slow(8).range(-0.4, 0.4)).decay(0.09).room(0.45).cut(1).swing(0.05);
track("clap").pattern("clap").gain(0.8).room(0.5).delay(0.28).delayfeedback(0.4).stut(4, 0.5, 0.03);
track("saw").pattern("prog").synth("poly_saw").gain(0.55).lpf(3200).res(4).unison(4).detune(14).spread(0.6).chorus(0.9).delay(0.3).delaytime(0.26).delayfeedback(0.45).reverb(0.4).superimpose().pianoroll();
track("lead").pattern("arp").synth("square").gain(slider(0.5, 0, 1)).oct("<4 5>").legato(1.1).slide(0.07).vib(5).delay(0.4).delayfeedback(0.55).chorus(0.7).room(0.5).spectrum();
track("pad").pattern("prog").synth("saw").gain(0.35).slow(2).lpf(sine.range(600, 2800).slow(4)).attack(0.4).release(1.2).chorus(1).reverb(0.6).jux().spiral();
track("pluck").pattern("spark").synth("pluck").gain(0.4).fast(1.5).cutoff(perlin.slow(2).range(2000, 8000)).delay(0.45).delayfeedback(0.6).room(0.6).sometimes().wordfall();`,
  },
  {
    name: 'LoFi Boom-Bap',
    cpm: 21.5,
    code: `// LoFi boom-bap — dusty drums, sleepy Rhodes, tape wobble.
cpm(21.5);

defPattern("kick", "bd ~ [bd ~] ~");
defPattern("snare", "~ ~ sd [~ sd?]");
defPattern("hats", "hh(5,8)");
defPattern("crackle", "[perc? rim?] [~ perc?] [cb? ~] [perc ~]");
defPattern("rhodes", slowcat(chord("C3maj7"), chord("A2m7"), chord("D3m7"), chord("G3m7")));
defPattern("bass", "c2 ~ [~ a1] d2");
defPattern("lick", "e4 [~ d4] [c4 ~] [a3 ~]");

track("kick").pattern("kick").gain(0.9).lpf(600).room(0.3).late(0.01).scope();
track("snare").pattern("snare").gain(0.8).room(0.5).delay(0.25).delayfeedback(0.35).degrade(0.1).swing(0.2);
track("hats").pattern("hats").gain(0.5).lpf(5000).decay(0.12).swing(0.28).cut(1).degrade(0.2).pan(rand.slow(8).range(-0.4, 0.4));
track("crackle").pattern("crackle").gain(0.3).hpf(3000).coarse(10).room(0.6).degrade(0.4).sometimes();
track("rhodes").pattern("rhodes").synth("fm_bell").gain(slider(0.6, 0, 1)).lpf(2400).tremolo(3).chorus(0.5).leslie(0.4).delay(0.35).reverb(0.5).slow(2).pianoroll();
track("bass").pattern("bass").synth("sub_bass").gain(0.85).lpf(260).legato(1.8).slide(0.1).vowel("o").scope();
track("lick").pattern("lick").synth("pluck").gain(0.45).cutoff(2800).res(5).delay(0.4).delayfeedback(0.5).room(0.5).vib(4).late(0.02).stut(2, 0.4, 0.05).spectrum();
track("pad").pattern("[c3, g3] ~ [a2, e3] ~").synth("sine").gain(0.3).slow(2).attack(0.5).release(1.5).reverb(0.6).chorus(0.8).jux();`,
  },
];

function loadInitialCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) || DEFAULT_CODE;
  } catch {
    return DEFAULT_CODE;
  }
}

function loadInspectorWidth(): number {
  try {
    const stored = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, stored));
  } catch {}
  return INSPECTOR_DEFAULT;
}

function loadInitialTab(): DrawerTab {
  try {
    const raw = localStorage.getItem(ACTIVE_TAB_KEY);
    if (raw === null) return 'mixer';
    if (raw === 'null' || raw === '') return null;
    if ((VALID_TABS as readonly string[]).includes(raw)) return raw as DrawerTab;
  } catch {}
  return 'mixer';
}

function loadLastTab(): Exclude<DrawerTab, null> {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_TAB_KEY);
    if (raw && (VALID_TABS as readonly string[]).includes(raw)) return raw as Exclude<DrawerTab, null>;
  } catch {}
  return 'mixer';
}

function AppInner() {
  const [code, setCode] = useState<string>(loadInitialCode);
  const [activeTab, setActiveTab] = useState<DrawerTab>(loadInitialTab);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [evalFlash, setEvalFlash] = useState<boolean>(false);
  const [queuedTarget, setQueuedTarget] = useState<'next_beat' | 'next_cycle' | null>(null);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [isCommunityOpen, setIsCommunityOpen] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);
  const [bridgeDot, setBridgeDot] = useState(false);

  // Persist code + cpm (debounced)
  useEffect(() => {
    const h = setTimeout(() => {
      try {
        localStorage.setItem(CODE_KEY, code);
        localStorage.setItem(CPM_KEY, String(patternScheduler.getCpm()));
      } catch {}
    }, 400);
    return () => clearTimeout(h);
  }, [code]);

  // Restore session + cpm
  useEffect(() => {
    try {
      const savedCpm = parseFloat(localStorage.getItem(CPM_KEY) || '');
      if (!isNaN(savedCpm)) patternScheduler.setCpm(savedCpm);
    } catch {}
    const token = localStorage.getItem('pulsegrid_token');
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.authenticated && data.user) setUser(data.user);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unsubQueue = patternScheduler.subscribeQueue((target) => setQueuedTarget(target));
    const unsubBridge = vstBridge.subscribe(() => setBridgeDot(vstBridge.getStatus().connected));
    setBridgeDot(vstBridge.getStatus().connected);
    return () => {
      unsubQueue();
      unsubBridge();
    };
  }, []);

  useEffect(() => {
    midiManager.onParamChange((binding, normalizedVal) => {
      if (binding.targetType === 'track' && binding.trackId) {
        const val = binding.min + normalizedVal * (binding.max - binding.min);
        patternScheduler.setTrackParam(binding.trackId, { [binding.param]: val } as any);
      } else if (binding.targetType === 'master') {
        if (binding.param === 'cpm' || (binding.param as string) === 'bpm') {
          // 'bpm' accepted for bindings stored before the cpm clock switch.
          patternScheduler.setCpm(Math.round(binding.min + normalizedVal * (binding.max - binding.min)));
        } else if (binding.param === 'gain') {
          audioEngine.setMasterVolume(normalizedVal * 1.2);
        }
      }
    });
  }, []);

  const handleEval = useCallback(() => {
    const result = patternScheduler.evaluateCode(code);
    if (result.success) {
      setErrorMessage(null);
      setEvalFlash(true);
      setTimeout(() => setEvalFlash(false), 300);
    } else {
      setErrorMessage(result.error || 'Evaluation failed');
    }
  }, [code]);

  const handleEvalNextBeat = useCallback(() => {
    patternScheduler.queueEvaluation(code, 'next_beat', (res) => {
      if (res.success) {
        setErrorMessage(null);
        setEvalFlash(true);
        setTimeout(() => setEvalFlash(false), 300);
      } else {
        setErrorMessage(res.error || 'Evaluation failed');
      }
    });
  }, [code]);

  useEffect(() => {
    patternScheduler.evaluateCode(loadInitialCode());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (patternScheduler.getIsPlaying()) patternScheduler.stop();
        else patternScheduler.start();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const handleLoadProject = (
    newCode: string,
    newCpm: number,
    newPatterns?: Record<string, string>,
    newMixer?: Record<string, TrackMixerState> | null,
    newMaster?: MasterMixerState | null,
  ) => {
    setCode(newCode);
    patternScheduler.setCpm(newCpm);
    if (newPatterns) {
      Object.entries(newPatterns).forEach(([k, v]) => patternScheduler.setSharedPattern(k, v));
    }
    if (newMixer === null) {
      // Explicit reset (preset buttons): drop saved fader positions so the
      // incoming code's own mix is what you hear.
      patternScheduler.resetMixerToCodeDefaults(newCode);
      return;
    }
    patternScheduler.evaluateCode(newCode);
    // Mixer + master travel with the project: apply after eval (eval already
    // re-applied whatever was in localStorage; the incoming project wins and
    // is then persisted by applyMixerSnapshot / the audio engine).
    if (newMixer && typeof newMixer === 'object') {
      patternScheduler.applyMixerSnapshot(newMixer);
    }
    if (newMaster && typeof newMaster === 'object') {
      if (typeof newMaster.volume === 'number' && isFinite(newMaster.volume)) {
        audioEngine.setMasterVolume(newMaster.volume);
      }
      if (typeof newMaster.muted === 'boolean') {
        audioEngine.setMute(newMaster.muted);
      }
    }
  };

  const [trackCount, setTrackCount] = useState<number>(() => patternScheduler.getEvaluatedTracks().length);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('scope');
  const [visualizerOverlay, setVisualizerOverlay] = useState(false);
  const [visualizerOpacity, setVisualizerOpacity] = useState(0.2);
  const [inspectorWidth, setInspectorWidth] = useState<number>(loadInspectorWidth);
  const [isPoppedOut, setIsPoppedOut] = useState<boolean>(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  // Remembers the last open section so expanding restores it.
  // Initialized from the persisted active tab (or its persisted predecessor
  // when the panel was left collapsed) so a reload restores both.
  const lastActiveTab = useRef<Exclude<DrawerTab, null>>(
    activeTab ?? loadLastTab(),
  );

  useEffect(() => {
    if (activeTab !== null) lastActiveTab.current = activeTab;
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, activeTab ?? 'null');
      localStorage.setItem(LAST_ACTIVE_TAB_KEY, lastActiveTab.current);
    } catch {}
  }, [activeTab]);

  const collapseInspector = useCallback(() => {
    setActiveTab(null);
    setIsPoppedOut(false);
    resizeStart.current = null;
  }, []);

  const expandInspector = useCallback(() => {
    setActiveTab(lastActiveTab.current ?? 'mixer');
  }, []);

  const popOutInspector = useCallback(() => {
    if (activeTab === null) expandInspector();
    setIsPoppedOut(true);
  }, [activeTab, expandInspector]);

  const dockInspector = useCallback(() => {
    setIsPoppedOut(false);
  }, []);

  // Toggling the tab off while popped out docks back inline (collapsed).
  useEffect(() => {
    if (activeTab === null && isPoppedOut) setIsPoppedOut(false);
  }, [activeTab, isPoppedOut]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
      } catch {}
    }, 180);
    return () => clearTimeout(timer);
  }, [inspectorWidth]);

  const startInspectorResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // When collapsed the strip starts at width 0, so dragging left grows the
    // panel from the cursor distance. The separator stays mounted either way,
    // so pointer capture survives expanding/collapsing mid-drag.
    resizeStart.current = { x: event.clientX, width: activeTab === null ? 0 : inspectorWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const viewportMaxWidth = () => {
    if (typeof window === 'undefined') return INSPECTOR_MAX;
    // Keep at least ~380px for the code editor so a wide panel can't push it
    // off-screen on smaller displays.
    return Math.max(INSPECTOR_MIN + 40, Math.min(INSPECTOR_MAX, window.innerWidth - 380));
  };

  const clampInspectorWidth = (next: number) =>
    Math.max(INSPECTOR_MIN, Math.min(viewportMaxWidth(), Math.round(next)));

  const moveInspectorResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const next = resizeStart.current.width + resizeStart.current.x - event.clientX;
    if (resizeStart.current.width === 0) {
      if (next < INSPECTOR_EXPAND_ABOVE) return;
      setInspectorWidth(clampInspectorWidth(next));
      setActiveTab(lastActiveTab.current ?? 'mixer');
      return;
    }
    if (next < INSPECTOR_COLLAPSE_BELOW) {
      collapseInspector();
      return;
    }
    setInspectorWidth(clampInspectorWidth(next));
  };

  const stopInspectorResize = () => {
    resizeStart.current = null;
  };

  const handleInspectorResizeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (activeTab === null) {
      if (event.key === 'ArrowLeft' || event.key === 'Enter' || event.key === ' ') expandInspector();
      else return;
      event.preventDefault();
      return;
    }
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') setInspectorWidth((width) => clampInspectorWidth(width + step));
    else if (event.key === 'ArrowRight') {
      if (inspectorWidth <= INSPECTOR_MIN + step) {
        collapseInspector();
        event.preventDefault();
        return;
      }
      setInspectorWidth((width) => Math.max(INSPECTOR_MIN, width - step));
    }
    else if (event.key === 'Home') setInspectorWidth(INSPECTOR_MIN);
    else if (event.key === 'End') setInspectorWidth(viewportMaxWidth());
    else if (event.key === 'Escape') collapseInspector();
    else return;
    event.preventDefault();
  };

  useEffect(() => {
    const unsubTracks = patternScheduler.subscribeTracks(() => {
      setTrackCount(patternScheduler.getEvaluatedTracks().length);
    });
    setTrackCount(patternScheduler.getEvaluatedTracks().length);
    return unsubTracks;
  }, []);

  return (
    <div className="pg-workstation relative flex flex-col h-screen w-screen overflow-hidden" style={{ color: 'var(--pg-text)' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenCommunity={() => setIsCommunityOpen(true)}
        user={user}
      />

      {/* mobile tab strip */}
      <div className="md:hidden flex gap-1.5 px-3 py-1.5 overflow-x-auto text-[11px]" style={{ background: 'var(--pg-header-bg)' }}>
        {(['mixer', 'patterns', 'instruments', 'samples', 'midi', 'logs', 'style', 'docs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(activeTab === t ? null : t)}
            className="px-2.5 py-1 rounded-md border whitespace-nowrap capitalize"
            style={{
              borderColor: 'var(--pg-border)',
              background: activeTab === t ? 'var(--pg-accent)' : 'transparent',
              color: activeTab === t ? 'var(--pg-accent-ink)' : 'var(--pg-muted)',
              fontWeight: activeTab === t ? 700 : 400,
            }}
          >
            {t === 'style' ? 'settings' : t}
          </button>
        ))}
      </div>

      <main
        className="pg-workspace-resizable relative z-10 flex-1 flex flex-col lg:flex-row overflow-hidden p-2 gap-2 min-h-0"
        style={{ '--pg-inspector-width': `${inspectorWidth}px` } as React.CSSProperties}
      >
        <section className="flex-1 flex flex-col h-full min-h-[320px] overflow-hidden min-w-0">
          {/* Session presets */}
          <div className="flex items-center gap-1.5 px-1 pb-2 text-[11px] overflow-x-auto shrink-0 select-none">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => handleLoadProject(p.code, p.cpm)}
                className="px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors font-medium border"
                style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface)', color: 'var(--pg-text)' }}
              >
                <span>{p.name}</span> <span className="pg-faint font-mono tabular-nums">{p.cpm} CPM</span>
              </button>
            ))}
            <button
              onClick={() => {
                if (confirm('Restore the default session patterns?')) handleLoadProject(DEFAULT_CODE, 132);
              }}
              className="px-2 py-1.5 rounded-md pg-faint hover:opacity-80"
              title="Reset session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-hidden min-h-0">
            <CodeEditor
              code={code}
              onChange={setCode}
              onEval={handleEval}
              onEvalNextBeat={handleEvalNextBeat}
              queuedTarget={queuedTarget}
              errorMessage={errorMessage}
              evalFlash={evalFlash}
              visualizerMode={visualizerMode}
              visualizerOverlay={visualizerOverlay}
              visualizerOpacity={visualizerOpacity}
            />
          </div>
        </section>

        <div
          role="separator"
          aria-label={
            activeTab === null
              ? 'Expand monitor and tools panel. Drag left to expand.'
              : 'Resize monitor and tools panel. Drag past the minimum to collapse.'
          }
          aria-orientation="vertical"
          aria-valuemin={INSPECTOR_MIN}
          aria-valuemax={INSPECTOR_MAX}
          aria-valuenow={activeTab === null ? INSPECTOR_MIN : inspectorWidth}
          aria-valuetext={activeTab === null ? 'collapsed' : `${inspectorWidth} pixels`}
          tabIndex={0}
          title={
            activeTab === null
              ? 'Drag left to expand the panel.'
              : 'Drag to resize (drag past minimum to collapse). Arrow keys adjust, Esc collapses, double-click resets.'
          }
          onPointerDown={startInspectorResize}
          onPointerMove={moveInspectorResize}
          onPointerUp={stopInspectorResize}
          onPointerCancel={stopInspectorResize}
          onKeyDown={handleInspectorResizeKey}
          onDoubleClick={() => {
            if (activeTab === null) expandInspector();
            else setInspectorWidth(INSPECTOR_DEFAULT);
          }}
          className={`pg-workspace-resize-handle hidden lg:flex ${isPoppedOut ? '!hidden' : ''}`}
          aria-hidden={isPoppedOut}
        />

        {activeTab !== null && !isPoppedOut && (
          <section className="pg-inspector flex flex-1 flex-col h-full min-h-[300px] gap-2 overflow-hidden min-w-0">
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-md border shrink-0 text-[11px] select-none"
              style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface)' }}
            >
              <span className="font-semibold capitalize px-1" style={{ color: 'var(--pg-text)' }}>
                {activeTab === 'style' ? 'settings' : activeTab}
              </span>
              <span className="pg-faint font-mono tabular-nums">{inspectorWidth}px</span>
              <div className="flex-1" />
              <div className="hidden xl:flex items-center gap-1" role="group" aria-label="Panel width presets">
                {[
                  { label: 'S', width: INSPECTOR_DEFAULT, title: `Narrow (${INSPECTOR_DEFAULT}px)` },
                  { label: 'M', width: 760, title: 'Medium (760px)' },
                  { label: 'L', width: INSPECTOR_WIDE, title: `Wide (${INSPECTOR_WIDE}px)` },
                  { label: 'XL', width: INSPECTOR_MAX, title: `Max (${INSPECTOR_MAX}px)` },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setInspectorWidth(clampInspectorWidth(p.width))}
                    title={p.title}
                    aria-label={`Set panel width ${p.title}`}
                    aria-pressed={Math.abs(inspectorWidth - p.width) < 8}
                    className="px-1.5 py-0.5 rounded border font-mono"
                    style={
                      Math.abs(inspectorWidth - p.width) < 8
                        ? { borderColor: 'var(--pg-accent)', background: 'var(--pg-accent)', color: 'var(--pg-accent-ink)', fontWeight: 700 }
                        : { borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={popOutInspector}
                title="Pop out to its own window"
                aria-label="Pop out panel to its own window"
                className="p-1 rounded-md border hover:opacity-80"
                style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={collapseInspector}
                title="Close panel (Esc)"
                aria-label="Close panel"
                className="p-1 rounded-md border hover:opacity-80"
                style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="h-36 shrink-0 overflow-hidden">
              <Visualizer
                mode={visualizerMode}
                onModeChange={setVisualizerMode}
                overlayEnabled={visualizerOverlay}
                onOverlayChange={setVisualizerOverlay}
                overlayOpacity={visualizerOpacity}
                onOverlayOpacityChange={setVisualizerOpacity}
              />
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              {activeTab === 'mixer' && <MixerConsole />}
              {activeTab === 'patterns' && <PatternDrawer />}
              {activeTab === 'instruments' && <InstrumentDrawer />}
              {activeTab === 'samples' && <SampleDrawer />}
              {activeTab === 'midi' && <MidiDrawer />}
              {activeTab === 'logs' && <LogsDrawer />}
              {activeTab === 'style' && <SettingsDrawer />}
              {activeTab === 'docs' && <DocsDrawer />}
            </div>
          </section>
        )}

        {activeTab !== null && isPoppedOut && (
          <section
            className="hidden lg:flex flex-1 flex-col items-center justify-center gap-2 h-full min-h-[300px] rounded-lg border border-dashed p-4 text-center"
            style={{ borderColor: 'var(--pg-border)', background: 'var(--pg-surface)' }}
          >
            <p className="text-xs font-semibold capitalize" style={{ color: 'var(--pg-text)' }}>
              {activeTab === 'style' ? 'settings' : activeTab} popped out
            </p>
            <p className="text-[11px] pg-muted">The panel is living in its own window.</p>
            <button
              onClick={dockInspector}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold pg-btn-accent"
            >
              <LogIn className="w-3.5 h-3.5" /> Dock back
            </button>
          </section>
        )}

        {activeTab !== null && isPoppedOut && (
          <InspectorPopoutWindow
            title={`PulseGrid — ${activeTab === 'style' ? 'settings' : activeTab}`}
            onClose={dockInspector}
          >
            <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b text-xs" style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}>
              <span className="font-semibold capitalize" style={{ color: 'var(--pg-text)' }}>
                {activeTab === 'style' ? 'settings' : activeTab}
              </span>
              <span className="pg-faint">popped out · live</span>
              <div className="flex-1" />
              <button
                onClick={dockInspector}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold pg-btn-accent"
              >
                <LogIn className="w-3.5 h-3.5" /> Dock back
              </button>
            </div>
            <div className="flex-1 flex flex-col gap-2 p-2 min-h-0">
              <div className="h-44 shrink-0 overflow-hidden">
                <Visualizer
                  mode={visualizerMode}
                  onModeChange={setVisualizerMode}
                  overlayEnabled={visualizerOverlay}
                  onOverlayChange={setVisualizerOverlay}
                  overlayOpacity={visualizerOpacity}
                  onOverlayOpacityChange={setVisualizerOpacity}
                />
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                {activeTab === 'mixer' && <MixerConsole />}
                {activeTab === 'patterns' && <PatternDrawer />}
                {activeTab === 'instruments' && <InstrumentDrawer />}
                {activeTab === 'samples' && <SampleDrawer />}
                {activeTab === 'midi' && <MidiDrawer />}
                {activeTab === 'logs' && <LogsDrawer />}
                {activeTab === 'style' && <SettingsDrawer />}
                {activeTab === 'docs' && <DocsDrawer />}
              </div>
            </div>
          </InspectorPopoutWindow>
        )}
      </main>

      {/* Footer status bar */}
      <footer
        className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs shrink-0"
        style={{ borderTop: '1px solid var(--pg-border-soft)', background: 'var(--pg-header-bg)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ background: bridgeDot ? 'var(--pg-ok)' : 'var(--pg-warn)' }}
              title={bridgeDot ? 'VST bridge connected' : 'VST bridge simulated'}
            />
            <span className="pg-muted">VST {bridgeDot ? 'connected' : 'simulated'}</span>
          </span>
          <span className="pg-faint hidden sm:inline">{trackCount} {trackCount === 1 ? 'track' : 'tracks'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="pg-faint hidden md:inline">Space: play · Ctrl+Enter: evaluate · Ctrl+Shift+F: format · Ctrl+/: comment · Ctrl+D: multicursor</span>
          <button
            onClick={() => setShowShortcuts((s) => !s)}
            title="Keyboard shortcuts (Ctrl+.)"
            className="flex items-center gap-1 px-2 py-1 rounded-md border pg-muted hover:opacity-80"
            style={{ borderColor: 'var(--pg-border)' }}
          >
            <Keyboard className="w-3 h-3" /> Shortcuts
          </button>
        </div>
      </footer>

      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowShortcuts(false)}>
          <div className="pg-panel max-w-md w-full p-4 text-xs space-y-2" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-sm">Keyboard shortcuts</h2>
            <ShortcutRow keys="Space" desc="Play / stop" />
            <ShortcutRow keys="Ctrl + Enter" desc="Evaluate now" />
            <ShortcutRow keys="Alt + Enter" desc="Queue eval on next beat" />
            <ShortcutRow keys="Ctrl + Shift + F" desc="Format track chains" />
            <ShortcutRow keys="Ctrl + Z / Ctrl + Y" desc="Undo / redo in editor" />
            <ShortcutRow keys="Tab / ↑↓ + Enter" desc="Accept autocomplete suggestion" />
            <ShortcutRow keys="Ctrl + /" desc="Toggle line comments" />
            <ShortcutRow keys="Ctrl + D" desc="Select word / add next occurrence (multicursor)" />
            <ShortcutRow keys="Ctrl + Shift + ↑/↓" desc="Add cursor above / below" />
            <ShortcutRow keys="Alt + Click" desc="Add cursor at click" />
            <ShortcutRow keys="Esc" desc="Exit multicursor" />
            <ShortcutRow keys="Ctrl + ." desc="Toggle this panel" />
            <button onClick={() => setShowShortcuts(false)} className="mt-2 px-3 py-1.5 rounded-md text-xs font-semibold pg-btn-accent">
              Close
            </button>
          </div>
        </div>
      )}

      <CommunityModal
        isOpen={isCommunityOpen}
        onClose={() => setIsCommunityOpen(false)}
        user={user}
        setUser={setUser}
        currentCode={code}
        onLoadProject={handleLoadProject}
      />
    </div>
  );
}

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <kbd className="pg-kbd whitespace-nowrap">{keys}</kbd>
      <span className="pg-muted">{desc}</span>
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
