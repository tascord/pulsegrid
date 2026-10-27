import { InstrumentConfig, TrackChannel } from '../types/music';
import { instrumentRegistry } from './InstrumentRegistry';
import { sampleManager } from './SampleManager';
import { vstBridge } from './VstBridge';

interface TrackAudioNodes {
  inputGain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  outputGain: GainNode;
  /** Sidechain duck stage: updateTrackParameters never touches this node. */
  duckGain: GainNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  analyser: AnalyserNode;
  /** Per-track ping-pong echo (Strudel delay/delaytime/delayfeedback). */
  delayL: DelayNode;
  delayR: DelayNode;
  delayFb: GainNode;
  delayDamp: BiquadFilterNode;
  delayReturn: GainNode;
  /** Per-track dynamics (Strudel compressor*). Created lazily. */
  comp?: DynamicsCompressorNode;
}

/** Per-event voice FX resolved by the scheduler (Strudel parity). */
export interface VoiceFx {
  pan?: number;
  cutoff?: number;
  resonance?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  chorus?: number;
  distort?: number;
  crush?: number;
  delayTime?: number;
  delayFeedback?: number;
  vib?: number;
  vibmod?: number;
  room?: number;
  size?: number;
  coarse?: number;
  shape?: number;
  vowel?: string;
  drive?: number;
  tremolo?: number;
  phaser?: number;
  phaserDepth?: number;
  leslie?: number;
  postgain?: number;
  overgain?: number;
  dry?: number;
  speed?: number;
  begin?: number;
  end?: number;
  loop?: number | boolean;
  detune?: number;
  unison?: number;
  spread?: number;
  fshift?: number;
  slide?: number;
  hold?: number;
  dur?: number;
  cut?: number | string;
  fmi?: number;
  wt?: number;
  warp?: number;
}

class AudioEngine {
  public ctx: AudioContext | null = null;
  public masterGain: GainNode | null = null;
  public masterCompressor: DynamicsCompressorNode | null = null;
  public masterAnalyser: AnalyserNode | null = null;

  // Sends
  private reverbNode: ConvolverNode | null = null;
  private reverbReturn: GainNode | null = null;

  private tracks: Map<string, TrackAudioNodes> = new Map();
  private distortionCurve: Float32Array | null = null;
  private isMuted: boolean = false;
  private masterVolume: number = 0.85;
  // Strudel `orbit` groups: trackId -> orbit number, for sidechain ducking.
  private trackOrbits: Map<string, number> = new Map();
  // Strudel `cut` choke groups: group key -> active scheduled sources.
  private chokeGroups: Map<string, AudioScheduledSourceNode[]> = new Map();

  public init(): AudioContext {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });

    // Master Compressor
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
    this.masterCompressor.knee.setValueAtTime(8, this.ctx.currentTime);
    this.masterCompressor.ratio.setValueAtTime(4, this.ctx.currentTime);
    this.masterCompressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.masterCompressor.release.setValueAtTime(0.2, this.ctx.currentTime);

    // Master Analyser (Time domain & FFT)
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterAnalyser.smoothingTimeConstant = 0.85;

    // Master Gain — restore the persisted project volume (best-effort).
    let savedVolume = 0.85;
    let savedMuted = false;
    try {
      const raw = localStorage.getItem('pulsegrid-mixer-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as { master?: { volume?: unknown; muted?: unknown } };
        if (parsed?.master) {
          if (typeof parsed.master.volume === 'number' && isFinite(parsed.master.volume)) {
            savedVolume = Math.max(0, Math.min(1.2, parsed.master.volume));
          }
          savedMuted = parsed.master.muted === true;
        }
      } else {
        const legacy = localStorage.getItem('pulsegrid-master-v1');
        if (legacy) {
          const parsedLegacy = JSON.parse(legacy) as { volume?: unknown; muted?: unknown };
          if (typeof parsedLegacy.volume === 'number' && isFinite(parsedLegacy.volume)) {
            savedVolume = Math.max(0, Math.min(1.2, parsedLegacy.volume));
          }
          savedMuted = parsedLegacy.muted === true;
        }
      }
    } catch {
      /* ignore — fall back to defaults */
    }
    this.masterVolume = savedVolume;
    this.isMuted = savedMuted;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(savedMuted ? 0 : savedVolume, this.ctx.currentTime);

    // Master routing
    this.masterCompressor.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Setup FX Sends
    this.setupReverbSend();

    // Init Sample Manager
    sampleManager.init(this.ctx);

    // Precalculate waveshaper curve for analog drive
    this.distortionCurve = this.makeDistortionCurve(25);

    return this.ctx;
  }

  public async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  private persistMaster(): void {
    try {
      const payload = JSON.stringify({ volume: this.masterVolume, muted: this.isMuted });
      localStorage.setItem('pulsegrid-master-v1', payload);
      // Mirror into the unified mixer blob so the whole mix travels as one project.
      const raw = localStorage.getItem('pulsegrid-mixer-v1');
      let tracks: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { tracks?: Record<string, unknown> };
          if (parsed?.tracks && typeof parsed.tracks === 'object') tracks = parsed.tracks;
        } catch {
          /* keep empty tracks */
        }
      }
      localStorage.setItem(
        'pulsegrid-mixer-v1',
        JSON.stringify({ tracks, master: { volume: this.masterVolume, muted: this.isMuted }, updatedAt: Date.now() }),
      );
    } catch {
      /* best-effort */
    }
  }

  public setMasterVolume(val: number) {
    const clamped = Math.max(0, Math.min(1.2, val));
    this.masterVolume = clamped;
    this.persistMaster();
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : clamped, this.ctx.currentTime, 0.03);
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    this.persistMaster();
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.03);
  }

  public ensureTrack(track: TrackChannel): TrackAudioNodes {
    if (!this.ctx || !this.masterCompressor) {
      this.init();
    }

    if (this.tracks.has(track.id)) {
      const nodes = this.tracks.get(track.id)!;
      this.updateTrackParameters(track, nodes);
      return nodes;
    }

    const ctx = this.ctx!;

    const inputGain = ctx.createGain();
    // Track filter stays wide open: tone filtering happens once per voice
    // (voiceFilter with the event-resolved cutoff), so tracks without .lpf()
    // are bright and tracks with .lpf() are filtered exactly once.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(18000, ctx.currentTime);
    filter.Q.setValueAtTime(0.5, ctx.currentTime);

    // Track panner stays centered: pan (static or LFO) is applied per voice.
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : (ctx.createGain() as any);
    if (panner.pan) {
      panner.pan.setValueAtTime(0, ctx.currentTime);
    }

    const outputGain = ctx.createGain();
    outputGain.gain.setValueAtTime(track.muted ? 0 : track.gain || 0.8, ctx.currentTime);

    // Duck stage sits after the fader so sidechain dips never fight the
    // per-tick updateTrackParameters gain writes.
    const duckGain = ctx.createGain();
    duckGain.gain.setValueAtTime(1, ctx.currentTime);

    // Sends
    const reverbSend = ctx.createGain();
    reverbSend.gain.setValueAtTime(track.reverbSend || 0, ctx.currentTime);

    const delaySend = ctx.createGain();
    delaySend.gain.setValueAtTime(track.delaySend || 0, ctx.currentTime);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // Per-track ping-pong echo (cross-coupled pair + damping).
    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    const delayFb = ctx.createGain();
    const delayDamp = ctx.createBiquadFilter();
    const delayReturn = ctx.createGain();
    delayL.delayTime.setValueAtTime(0.28, ctx.currentTime);
    delayR.delayTime.setValueAtTime(0.38, ctx.currentTime);
    delayFb.gain.setValueAtTime(0.42, ctx.currentTime);
    delayDamp.type = 'lowpass';
    delayDamp.frequency.setValueAtTime(2600, ctx.currentTime);
    delayReturn.gain.setValueAtTime(0.5, ctx.currentTime);
    delayL.connect(delayDamp);
    delayDamp.connect(delayFb);
    delayFb.connect(delayR);
    delayR.connect(delayL);
    delayL.connect(delayReturn);
    delayR.connect(delayReturn);

    // Connections
    inputGain.connect(filter);
    filter.connect(panner);
    panner.connect(outputGain);
    outputGain.connect(duckGain);

    // Per-track compressor sits after the duck stage so sidechain dips
    // hit the detector like Strudel's channel strip.
    const comp = ctx.createDynamicsCompressor();
    try {
      comp.threshold.setValueAtTime(-18, ctx.currentTime);
      comp.ratio.setValueAtTime(3, ctx.currentTime);
      comp.attack.setValueAtTime(0.004, ctx.currentTime);
      comp.release.setValueAtTime(0.18, ctx.currentTime);
    } catch {}
    duckGain.connect(comp);

    if (this.masterCompressor) {
      comp.connect(this.masterCompressor);
      delayReturn.connect(this.masterCompressor);
    }
    duckGain.connect(analyser);

    if (this.reverbNode) {
      panner.connect(reverbSend);
      reverbSend.connect(this.reverbNode);
    }

    panner.connect(delaySend);
    delaySend.connect(delayL);

    const nodes: TrackAudioNodes = {
      inputGain,
      filter,
      panner,
      outputGain,
      duckGain,
      reverbSend,
      delaySend,
      analyser,
      delayL,
      delayR,
      delayFb,
      delayDamp,
      delayReturn,
      comp,
    };

    this.tracks.set(track.id, nodes);
    this.updateTrackParameters(track, nodes);
    return nodes;
  }

  public setTrackOrbit(trackId: string, orbit: number): void {
    if (isFinite(orbit)) this.trackOrbits.set(trackId, Math.max(1, Math.floor(orbit)));
  }

  /** Strudel `cut` parity: stop prior voices in the choke group. */
  private choke(groupKey: string, atTime: number): void {
    const prior = this.chokeGroups.get(groupKey);
    if (!prior?.length) return;
    for (const s of prior) {
      try {
        s.stop(atTime);
      } catch {}
    }
    this.chokeGroups.set(groupKey, []);
  }

  /** Choke the group, then register new voices with ended-cleanup. */
  private trackChoke(groupKey: string, voices: AudioScheduledSourceNode[], atTime: number): void {
    this.choke(groupKey, atTime);
    const list = this.chokeGroups.get(groupKey) ?? [];
    for (const v of voices) {
      list.push(v);
      v.addEventListener('ended', () => {
        const cur = this.chokeGroups.get(groupKey);
        if (!cur) return;
        const i = cur.indexOf(v);
        if (i >= 0) cur.splice(i, 1);
      });
    }
    this.chokeGroups.set(groupKey, list);
  }

  /** Per-track dynamics (Strudel compressor/threshold/ratio/attack/release). */
  public setTrackCompressor(trackId: string, threshold: number, ratio: number, attack: number, release: number): void {
    if (!this.ctx) return;
    let nodes = this.tracks.get(trackId);
    if (!nodes) return;
    // Lazily create the comp node for tracks built before this feature,
    // re-wiring duckGain -> comp -> master.
    if (!nodes.comp) {
      try {
        const comp = this.ctx.createDynamicsCompressor();
        nodes.duckGain.disconnect();
        nodes.duckGain.connect(comp);
        if (this.masterCompressor) comp.connect(this.masterCompressor);
        nodes.comp = comp;
      } catch {
        return;
      }
    }
    const t = this.ctx.currentTime;
    try {
      nodes.comp.threshold.setTargetAtTime(threshold, t, 0.02);
      nodes.comp.ratio.setTargetAtTime(ratio, t, 0.02);
      nodes.comp.attack.setTargetAtTime(attack, t, 0.02);
      nodes.comp.release.setTargetAtTime(release, t, 0.02);
    } catch {}
  }

  /**
   * Strudel `duckorbit` parity: the triggering (ducker) track dips the
   * output gain of every track on the target orbit(s). Depth 1 = full duck
   * (matches superdough `1 - sqrt(depth)` curve). `onset` = time to reach
   * the dip, `attack` = time to recover back to unity (NOT a fixed tail).
   *
   * Mirrors superdough's Orbit.duck: the automation mutation is deferred
   * until ~10ms before the kick so `param.value` is sampled near the event
   * (accurate when the scheduler runs up to 120ms ahead) and prior recovery
   * ramps aren't truncated early by a stale future hold point.
   */
  public duckOrbit(
    targets: number | string | (number | string)[],
    atTime: number,
    onset = 0,
    attack = 0.1,
    depth = 1,
  ): void {
    if (!this.ctx) return;
    const list = (Array.isArray(targets) ? targets : [targets])
      .flatMap((t) => String(t).split(':'))
      .map((s) => parseInt(s, 10))
      .filter((n) => isFinite(n));
    if (list.length === 0) return;
    const ctx = this.ctx;
    // Duck stage sits after the fader: per-tick updateTrackParameters gain
    // writes never fight these dips, so held notes pump for their full
    // sustain instead of snapping back within one tick.
    const ducked: { param: AudioParam }[] = [];
    for (const [trackId, orbit] of this.trackOrbits) {
      if (!list.includes(orbit)) continue;
      const nodes = this.tracks.get(trackId);
      if (!nodes) continue;
      ducked.push({ param: nodes.duckGain.gain });
    }
    if (ducked.length === 0) return;
    const atk = Math.max(0.002, attack);
    const ons = Math.max(0, onset);
    const depthClamped = Math.max(0, depth);
    // Defer like superdough's webAudioTimeout(..., t - 0.01): run the
    // cancel/sample/ramp sequence just before the kick lands.
    const delayMs = Math.max(0, (atTime - 0.01 - ctx.currentTime) * 1000);
    globalThis.setTimeout(() => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const t0 = Math.max(atTime, now);
      for (const { param } of ducked) {
        try {
          // cancelScheduledValues + setValueAtTime emulates
          // cancelAndHoldAtTime on browsers lacking it.
          const currVal = Math.max(0.001, param.value);
          param.cancelScheduledValues(now);
          param.setValueAtTime(currVal, now);
          const duckedVal = Math.min(currVal, Math.max(0.01, 1 - Math.sqrt(depthClamped)));
          param.exponentialRampToValueAtTime(Math.max(0.01, duckedVal), t0 + ons);
          param.exponentialRampToValueAtTime(1.0, t0 + ons + atk);
        } catch {
          // ignore scheduling races
        }
      }
    }, delayMs);
  }

  /**
   * Sync fader/sends/echo to the scheduler state. Filter + pan stay fixed
   * open/center on the strip — voices carry the event-resolved values.
   * cycleDuration (one cycle in seconds) backs the Strudel default echo
   * time of 3/16 cycle when the track sets no .delaytime().
   */
  public updateTrackParameters(track: TrackChannel, nodes?: TrackAudioNodes, cycleDuration?: number) {
    if (!this.ctx) return;
    const target = nodes || this.tracks.get(track.id);
    if (!target) return;

    const time = this.ctx.currentTime;
      target.outputGain.gain.setTargetAtTime(track.muted ? 0 : track.gain, time, 0.02);
    const roomSend = (track as { room?: number }).room ?? track.reverbSend;
    target.reverbSend.gain.setTargetAtTime(Math.max(0, Math.min(1, roomSend)), time, 0.02);
    target.delaySend.gain.setTargetAtTime(Math.max(0, Math.min(1, track.delaySend)), time, 0.02);
    // Per-track echo time: explicit .delaytime() or Strudel's 3/16-cycle default.
    const dt = (track as { delayTime?: number }).delayTime;
    const echoTime =
      typeof dt === 'number' && isFinite(dt)
        ? Math.max(0.01, Math.min(2, dt))
        : cycleDuration && isFinite(cycleDuration) && cycleDuration > 0
          ? Math.max(0.01, Math.min(2, (cycleDuration * 3) / 16))
          : 0.28;
    target.delayL.delayTime.setTargetAtTime(echoTime, time, 0.03);
    target.delayR.delayTime.setTargetAtTime(Math.min(2, echoTime * 1.35), time, 0.03);
    const dfb = (track as { delayFeedback?: number }).delayFeedback;
    target.delayFb.gain.setTargetAtTime(
      typeof dfb === 'number' && isFinite(dfb) ? Math.max(0, Math.min(0.98, dfb)) : 0.42,
      time,
      0.03,
    );
    // Room size nudges the global reverb return — but only for tracks that
    // actually send to the verb (Strudel: size without room is a no-op).
    const size = (track as { size?: number }).size;
    if (typeof size === 'number' && isFinite(size) && this.reverbReturn && roomSend > 0.01) {
      this.reverbReturn.gain.setTargetAtTime(0.45 + Math.max(0, Math.min(1, size)) * 0.45, time, 0.05);
    }
    // Per-track compressor (Strudel compressor*): stored by the scheduler,
    // applied here so mixer/code tweaks take effect without re-eval.
    const th = (track as { compThreshold?: number }).compThreshold;
    const ra = (track as { compRatio?: number }).compRatio;
    if (th != null || ra != null) {
      const at = (track as { compAttack?: number }).compAttack ?? 0.004;
      const rel = (track as { compRelease?: number }).compRelease ?? 0.18;
      this.setTrackCompressor(track.id, th ?? -18, ra ?? 3, at, rel);
    }
  }

  public getTrackAnalyser(trackId: string): AnalyserNode | null {
    return this.tracks.get(trackId)?.analyser || null;
  }

  public getTrackPeak(trackId: string): number {
    const nodes = this.tracks.get(trackId);
    if (!nodes) return 0;
    const data = new Uint8Array(nodes.analyser.frequencyBinCount);
    nodes.analyser.getByteTimeDomainData(data);
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const val = Math.abs(data[i] - 128) / 128;
      if (val > max) max = val;
    }
    return max;
  }

  /**
   * Trigger note or sample on a specific track channel
   */
  public triggerSound(
    trackId: string,
    token: string,
    time: number,
    duration: number,
    velocity: number,
    instName?: string,
    fx?: VoiceFx,
  ) {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    const scheduledTime = Math.max(ctx.currentTime, time);

    let nodes = this.tracks.get(trackId);
    if (!nodes) {
      nodes = this.ensureTrack({
        id: trackId,
        name: trackId,
        instrument: instName || 'acid_303',
        gain: 0.8,
        pan: 0,
        cutoff: 18000,
        resonance: 2,
        reverbSend: 0,
        delaySend: 0,
        muted: false,
        solo: false,
        currentPeak: 0,
      });
    }

    // 1. Check if token matches a Sample (e.g. bd, sd, amen:0, custom sample)
    const sample = sampleManager.getSample(token);
    if (sample && sample.buffer) {
      this.playSampleBuffer(nodes.inputGain, sample.buffer, scheduledTime, duration, velocity, sample, fx);
      return;
    }

    // 2. Check if token is a musical pitch note (c3, eb4, etc.) or midi note
    // Unknown wavetable names (e.g. wt_digital_bad_day) fall back to saw.
    const instConfig =
      instrumentRegistry.get(instName || 'acid_303') ||
      instrumentRegistry.get('saw') ||
      instrumentRegistry.get('acid_303');
    const noteMidi = this.parseTokenPitch(token);

    if (noteMidi !== null && instConfig) {
      this.playSynthNote(nodes.inputGain, noteMidi, scheduledTime, duration, velocity, instConfig, trackId, fx);
      return;
    }

    // 3. Fallback: drum voice emulation by token
    this.playSynthesizedDrumFallback(nodes.inputGain, token, scheduledTime, velocity);
  }

  private parseTokenPitch(token: string): number | null {
    if (token.startsWith('n:') || token.startsWith('note:')) {
      const parsed = parseInt(token.split(':')[1], 10);
      return isNaN(parsed) ? null : parsed;
    }
    // Raw MIDI numbers (Strudel `note("6")` style): interpret directly.
    if (/^-?\d+$/.test(token.trim())) {
      return parseInt(token.trim(), 10);
    }
    const match = token.trim().toLowerCase().match(/^([a-g])([#b]?)(-?\d+)$/);
    if (!match) return null;

    const noteMap: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    let semi = noteMap[match[1]];
    if (match[2] === '#') semi += 1;
    if (match[2] === 'b') semi -= 1;
    const oct = parseInt(match[3], 10);
    return (oct + 1) * 12 + semi;
  }

  private playSampleBuffer(
    dest: GainNode,
    buffer: AudioBuffer,
    startTime: number,
    duration: number,
    velocity: number,
    sampleMeta: any,
    fx?: VoiceFx,
  ) {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Pitch transposition
    if (sampleMeta.pitch) {
      source.playbackRate.setValueAtTime(Math.pow(2, sampleMeta.pitch / 12), startTime);
    }
    if (fx?.speed != null && isFinite(fx.speed) && fx.speed !== 0) {
      try {
        source.playbackRate.setValueAtTime(Math.max(-8, Math.min(8, fx.speed)), startTime);
      } catch {}
    }

    if (fx?.loop) source.loop = true;
    else source.loop = sampleMeta.loop || false;

    // Per-voice chain: source -> overgain -> crush/coarse -> distort/shape/drive -> filter -> vowel -> chorus/phaser -> gain -> tremolo -> pan -> postgain -> dest
    let head: AudioNode = source;
    if (fx?.overgain != null && fx.overgain > 0) {
      const pre = ctx.createGain();
      pre.gain.setValueAtTime(1 + Math.max(0, Math.min(4, fx.overgain)) * 3, startTime);
      head.connect(pre);
      head = pre;
    }
    const crushBits = fx?.coarse ?? fx?.crush;
    if (crushBits != null && isFinite(crushBits)) {
      head = this.insertCrush(head, crushBits, startTime);
    }
    if (fx?.distort != null && fx.distort > 0) {
      head = this.insertDistort(head, fx.distort);
    }
    if (fx?.shape != null && fx.shape > 0) {
      head = this.insertDistort(head, fx.shape);
    }
    if (fx?.drive != null && fx.drive > 0) {
      head = this.insertDistort(head, Math.min(1, fx.drive * 0.5));
    }
    if (fx?.cutoff != null && isFinite(fx.cutoff) && fx.cutoff < 17000) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(Math.max(40, Math.min(18000, fx.cutoff)), startTime);
      filt.Q.setValueAtTime(
        fx?.resonance != null && isFinite(fx.resonance) ? Math.max(0.1, Math.min(24, fx.resonance)) : 0.8,
        startTime,
      );
      head.connect(filt);
      head = filt;
    }
    // NOTE: superdough implements no chorus effect — `.chorus()` is a
    // registered control with no audio node behind it. Applying our own
    // chorus here is what made chords/leads wobble vs Strudel, so the
    // control is parsed (DSL compat) but intentionally produces no sound.
    if (fx?.vowel) {
      head = this.insertVowel(head, fx.vowel, startTime);
    }
    if (fx?.phaser != null && fx.phaser > 0) {
      const wet = this.insertPhaser(head, fx.phaser, startTime, Math.max(0.05, duration), fx.phaserDepth ?? 1200);
      head = fx?.dry != null ? this.applyDry(head, wet, fx.dry, startTime) : wet;
    }
    if (fx?.leslie != null && fx.leslie > 0) {
      const wet = this.insertLeslie(head, Math.min(1.5, fx.leslie), startTime, Math.max(0.05, duration));
      head = fx?.dry != null ? this.applyDry(head, wet, fx.dry, startTime) : wet;
    }
    if (fx?.fshift != null && isFinite(fx.fshift) && fx.fshift !== 0) {
      head = this.insertFshift(head, fx.fshift, startTime);
    }
    if ((fx?.wt != null && fx.wt > 0) || (fx?.warp != null && fx.warp > 0)) {
      head = this.insertWarp(head, fx.wt ?? 0, fx.warp ?? 0, startTime, Math.max(0.05, duration));
    }

    // Gain envelope: Strudel sampler parity — linear ADSR via getADSRValues
    // fallback (att-only means full sustain, no decay), NOT exponential.
    // Exponential ramps stay near silence most of the attack (e.g. att(0.05)
    // is ~1% of peak at 25ms), which flams the clap audibly late behind the
    // kick; linear is ~50% by then, matching superdough's 'linear' curve.
    const hasAnyAdsr =
      fx?.attack != null || fx?.decay != null || fx?.sustain != null || fx?.release != null;
    let attack: number;
    let decay: number;
    let sustainLevel: number;
    let release: number;
    if (!hasAnyAdsr) {
      attack = 0.001;
      decay = 0.001;
      sustainLevel = 1;
      release = 0.01;
    } else {
      const a = fx?.attack;
      const d = fx?.decay;
      const s = fx?.sustain;
      const r = fx?.release;
      sustainLevel = s != null && isFinite(s) ? Math.max(0, Math.min(1, s))
        : (a != null && d == null) || (a == null && d == null) ? 1 : 0.001;
      attack = Math.max(a ?? 0, 0.001);
      decay = Math.max(d ?? 0, 0.001);
      release = Math.max(r ?? 0, 0.01);
    }
    const voiceGain = ctx.createGain();
    const effectiveGain = (sampleMeta.gain || 1.0) * velocity;
    // Slice bounds first: superdough plays the FULL sample slice when the
    // user doesn't take control (no clip/loop/release) — the event duration
    // never truncates one-shots.
    const trimOffset = (sampleMeta.trimStart || 0) * buffer.duration;
    const trimLen = Math.max(0.01, (sampleMeta.trimEnd ?? 1.0) * buffer.duration - trimOffset);
    let sliceB = 0;
    let sliceE = 1;
    if ((fx?.begin != null || fx?.end != null) && buffer.duration > 0) {
      sliceB = fx?.begin != null && isFinite(fx.begin) ? Math.max(0, Math.min(1, fx.begin)) : 0;
      sliceE = fx?.end != null && isFinite(fx.end) ? Math.max(0, Math.min(1, fx.end)) : 1;
    }
    const sliceOffset = trimOffset + sliceB * trimLen;
    const sliceLen = Math.max(0.01, (sliceE - sliceB) * trimLen);
    const takesControl = fx?.release != null || fx?.loop;
    const holdDur = takesControl ? Math.max(attack + 0.01, duration) : sliceLen;
    const holdEnd = startTime + holdDur;
    const peakGain = Math.max(0.0002, effectiveGain);
    const susGain = Math.max(0, effectiveGain * sustainLevel);
    const envDur = Math.max(0.001, holdEnd - startTime);
    // Linear segments mirroring superdough getParamADSR(..., 'linear').
    voiceGain.gain.setValueAtTime(0, startTime);
    const valAt = (t: number): number =>
      t < attack ? (t / Math.max(0.0001, attack)) * peakGain
        : peakGain + ((t - attack) / Math.max(0.0001, decay)) * (susGain - peakGain);
    if (attack > envDur) {
      voiceGain.gain.linearRampToValueAtTime(valAt(envDur), holdEnd);
    } else if (attack + decay > envDur) {
      voiceGain.gain.linearRampToValueAtTime(peakGain, startTime + attack);
      voiceGain.gain.linearRampToValueAtTime(valAt(envDur), holdEnd);
    } else {
      voiceGain.gain.linearRampToValueAtTime(peakGain, startTime + attack);
      voiceGain.gain.linearRampToValueAtTime(susGain, startTime + attack + decay);
      voiceGain.gain.setValueAtTime(susGain, holdEnd);
    }
    voiceGain.gain.linearRampToValueAtTime(0, holdEnd + release);
    head.connect(voiceGain);
    let tail: AudioNode = voiceGain;
    if (fx?.tremolo != null && fx.tremolo > 0) {
      tail = this.insertTremolo(tail, fx.tremolo, startTime, Math.max(0.05, duration));
    }
    if (fx?.pan != null && isFinite(fx.pan) && Math.abs(fx.pan) > 0.001) {
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : (ctx.createGain() as unknown as StereoPannerNode);
      if ((p as StereoPannerNode).pan) {
        (p as StereoPannerNode).pan!.setValueAtTime(Math.max(-1, Math.min(1, fx.pan)), startTime);
      }
      tail.connect(p);
      tail = p;
    }
    if (fx?.postgain != null && isFinite(fx.postgain)) {
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(Math.max(0, Math.min(2, fx.postgain)), startTime);
      tail.connect(pg);
      tail = pg;
    }
    tail.connect(dest);

    // Strudel `cut`: choke prior voices in the group, then register this one.
    if (fx?.cut != null) {
      try {
        this.trackChoke(String(fx.cut), [source], startTime);
      } catch {}
    }

    source.start(startTime, sliceOffset, sliceLen);
    try {
      source.stop(holdEnd + release + 0.05);
    } catch {}
  }

  private playSynthNote(
    dest: GainNode,
    midiNote: number,
    startTime: number,
    duration: number,
    velocity: number,
    config: InstrumentConfig,
    trackId?: string,
    fx?: VoiceFx,
  ) {
    const ctx = this.ctx!;
    const baseFreq = 440 * Math.pow(2, (midiNote - 69) / 12);

    // If VST Bridge instrument — route per-track (code > manual > global)
    if (config.type === 'vst_bridge') {
      vstBridge.sendNote(midiNote, velocity, duration, trackId ? { trackId } : undefined);
      if (!vstBridge.getStatus().simulatedMode) {
        return; // Routed purely externally
      }
    }

    const voiceGain = ctx.createGain();
    const voiceFilter = ctx.createBiquadFilter();
    voiceFilter.type = 'lowpass';

    // Strudel basic synths (square/saw/triangle/sine) are pure oscillators
    // with linear ADSR [0.001,0.05,0.6,0.01] and gain 0.3 — no filter
    // envelope. Filter only applies when .lpf() is set (static cutoff).
    const isBasicSynth =
      config.type === 'square' ||
      config.type === 'saw' ||
      config.type === 'triangle' ||
      config.type === 'sine' ||
      config.name === 'sawtooth' ||
      config.name === 'square' ||
      config.name === 'triangle' ||
      config.name === 'sine';
    const lpfCutoff =
      fx?.cutoff != null && isFinite(fx.cutoff) ? fx.cutoff : undefined;
    const useStaticFilter =
      lpfCutoff != null && lpfCutoff < 17000;

    if (useStaticFilter) {
      voiceFilter.frequency.setValueAtTime(
        Math.max(40, Math.min(18000, lpfCutoff!)),
        startTime,
      );
      voiceFilter.Q.setValueAtTime(
        fx?.resonance != null && isFinite(fx.resonance)
          ? Math.max(0.1, Math.min(24, fx.resonance))
          : 1,
        startTime,
      );
    } else if (!isBasicSynth) {
      // Custom instruments (acid_303, etc.) keep their filter envelope.
      const baseCutoff = Math.max(
        60,
        fx?.cutoff != null && isFinite(fx.cutoff) ? fx.cutoff : config.filterCutoff || 1800,
      );
      const envAmt = config.filterEnvAmount || 0;
      const atkForFilter = fx?.attack ?? config.attack ?? 0.01;
      const decForFilter = fx?.decay ?? config.decay ?? 0.25;
      voiceFilter.frequency.setValueAtTime(baseCutoff, startTime);
      if (envAmt > 0) {
        voiceFilter.frequency.exponentialRampToValueAtTime(
          Math.max(80, baseCutoff + envAmt * velocity),
          startTime + Math.max(0.002, atkForFilter)
        );
        voiceFilter.frequency.exponentialRampToValueAtTime(
          Math.max(60, baseCutoff + envAmt * 0.2),
          startTime + Math.max(0.01, atkForFilter + decForFilter),
        );
      }
      voiceFilter.Q.setValueAtTime(
        fx?.resonance != null && isFinite(fx.resonance)
          ? Math.max(0.1, Math.min(24, fx.resonance))
          : config.filterResonance || 3,
        startTime,
      );
    } else {
      // Basic synth, no lpf: park wide open (bypassed in wiring below).
      voiceFilter.frequency.setValueAtTime(18000, startTime);
      voiceFilter.Q.setValueAtTime(0.5, startTime);
    }

    // Strudel ADSR (linear): defaults [0.001,0.05,0.6,0.01]. When the user
    // specifies any of att/dec/sus/rel, unspecified values fall back to
    // Strudel's minima (not the instrument preset) — e.g. .att(0.05) alone
    // means attack 0.05, decay 0.001, sustain 1, release 0.01.
    const hasAnyAdsr =
      fx?.attack != null || fx?.decay != null || fx?.sustain != null || fx?.release != null;
    let attack: number;
    let decay: number;
    let sustain: number;
    let release: number;
    if (!hasAnyAdsr) {
      attack = Math.max(0.001, config.attack ?? 0.001);
      decay = Math.max(0.001, config.decay ?? 0.05);
      sustain = Math.max(0, Math.min(1, config.sustain ?? 0.6));
      release = Math.max(0.01, config.release ?? 0.01);
    } else {
      const a = fx?.attack;
      const d = fx?.decay;
      const s = fx?.sustain;
      const r = fx?.release;
      sustain = s != null && isFinite(s) ? Math.max(0, Math.min(1, s))
        : (a != null && d == null) || (a == null && d == null) ? 1 : 0.001;
      attack = Math.max(a ?? 0, 0.001);
      decay = Math.max(d ?? 0, 0.001);
      release = Math.max(r ?? 0, 0.01);
    }
    const peakGain = 0.3 * velocity;

    const noteEndTime = startTime + duration;
    // Linear ramps like Strudel's getParamADSR(..., 'linear', ...).
    voiceGain.gain.setValueAtTime(0.001, startTime);
    if (attack > duration) {
      voiceGain.gain.linearRampToValueAtTime(
        0.001 + (peakGain - 0.001) * (duration / Math.max(0.0001, attack)),
        noteEndTime,
      );
    } else {
      voiceGain.gain.linearRampToValueAtTime(peakGain, startTime + attack);
      const susVal = 0.001 + sustain * (peakGain - 0.001);
      if (attack + decay > duration) {
        const t = (duration - attack) / Math.max(0.0001, decay);
        voiceGain.gain.linearRampToValueAtTime(
          peakGain + (susVal - peakGain) * Math.max(0, Math.min(1, t)),
          noteEndTime,
        );
      } else {
        voiceGain.gain.linearRampToValueAtTime(susVal, startTime + attack + decay);
        voiceGain.gain.setValueAtTime(susVal, noteEndTime);
      }
    }
    voiceGain.gain.linearRampToValueAtTime(0.001, noteEndTime + release);

    // Post-gain insert chain shared by all voices:
    // voiceGain -> overgain -> crush/coarse -> distort/shape/drive -> chorus/vowel/phaser/leslie -> tremolo -> pan -> postgain -> dest
    let voiceTail: AudioNode = voiceGain;
    if (fx?.overgain != null && fx.overgain > 0) {
      const pre = ctx.createGain();
      pre.gain.setValueAtTime(1 + Math.max(0, Math.min(4, fx.overgain)) * 2, startTime);
      const prev = voiceTail;
      voiceTail = pre;
      prev.connect(pre);
    }
    const synthCrush = fx?.coarse ?? fx?.crush;
    if (synthCrush != null && isFinite(synthCrush)) {
      voiceTail = this.insertCrush(voiceTail, synthCrush, startTime);
    }
    if (fx?.distort != null && fx.distort > 0) {
      voiceTail = this.insertDistort(voiceTail, fx.distort);
    }
    if (fx?.shape != null && fx.shape > 0) {
      voiceTail = this.insertDistort(voiceTail, fx.shape);
    }
    if (fx?.drive != null && fx.drive > 0) {
      voiceTail = this.insertDistort(voiceTail, Math.min(1, fx.drive * 0.5));
    }
    // NOTE: no chorus — superdough ignores the control (see sample path).
    if (fx?.vowel) {
      voiceTail = this.insertVowel(voiceTail, fx.vowel, startTime);
    }
    if (fx?.phaser != null && fx.phaser > 0) {
      const wet = this.insertPhaser(voiceTail, fx.phaser, startTime, noteEndTime + release - startTime, fx.phaserDepth ?? 1200);
      voiceTail = fx?.dry != null ? this.applyDry(voiceTail, wet, fx.dry, startTime) : wet;
    }
    if (fx?.leslie != null && fx.leslie > 0) {
      const wet = this.insertLeslie(voiceTail, Math.min(1.5, fx.leslie), startTime, noteEndTime + release - startTime);
      voiceTail = fx?.dry != null ? this.applyDry(voiceTail, wet, fx.dry, startTime) : wet;
    }
    if (fx?.fshift != null && isFinite(fx.fshift) && fx.fshift !== 0) {
      voiceTail = this.insertFshift(voiceTail, fx.fshift, startTime);
    }
    if ((fx?.wt != null && fx.wt > 0) || (fx?.warp != null && fx.warp > 0)) {
      voiceTail = this.insertWarp(voiceTail, fx.wt ?? 0, fx.warp ?? 0, startTime, noteEndTime + release - startTime);
    }
    if (fx?.tremolo != null && fx.tremolo > 0) {
      voiceTail = this.insertTremolo(voiceTail, fx.tremolo, startTime, noteEndTime + release - startTime);
    }
    if (fx?.pan != null && isFinite(fx.pan) && Math.abs(fx.pan) > 0.001) {
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : (ctx.createGain() as unknown as StereoPannerNode);
      if ((p as StereoPannerNode).pan) {
        (p as StereoPannerNode).pan!.setValueAtTime(Math.max(-1, Math.min(1, fx.pan)), startTime);
      }
      voiceTail.connect(p);
      voiceTail = p;
    }
    if (fx?.postgain != null && isFinite(fx.postgain)) {
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(Math.max(0, Math.min(2, fx.postgain)), startTime);
      voiceTail.connect(pg);
      voiceTail = pg;
    }
    voiceTail.connect(dest);

    // Vibrato LFO targets (Strudel `vib` rate in Hz, `vibmod` depth semitones).
    const vibRate = fx?.vib != null && isFinite(fx.vib) ? fx.vib : 0;
    const vibDepthSt = fx?.vibmod != null && isFinite(fx.vibmod) ? fx.vibmod : 0.5;
    const vibTargets: AudioParam[] = [];
    const stopAt = noteEndTime + release + 0.05;
    // Strudel `cut` choke group: collect scheduled sources per branch.
    const cutVoices: AudioScheduledSourceNode[] = [];

    // Wavetable voice: when the instrument name resolves to a loaded long
    // single-file bank (e.g. wt_digital_bad_day), loop one zero-crossing
    // cycle from its middle at the note pitch (Strudel wavetable parity,
    // minus position morphing).
    const wtCycle = this.getWavetableCycle(config.name);
    if (wtCycle) {
      const src = ctx.createBufferSource();
      src.buffer = wtCycle;
      src.loop = true;
      src.playbackRate.setValueAtTime(Math.max(0.01, baseFreq * wtCycle.duration), startTime);
      vibTargets.push(src.detune);
      if (useStaticFilter) {
        src.connect(voiceFilter);
        voiceFilter.connect(voiceGain);
      } else {
        src.connect(voiceGain);
      }
      src.start(startTime);
      src.stop(stopAt);
      cutVoices.push(src);
    } else if (config.name === 'wt_digital_bad_day' || (config.type as string) === 'wt_digital') {
      // Wavetable morph fallback (no loaded cycle buffer): frame blend by
      // .wt with warp spread ±50c, then the shared warp tail adds grit.
      const wt = fx?.wt != null && isFinite(fx.wt) ? Math.max(0, Math.min(1, fx.wt)) : 0.5;
      const warp = fx?.warp != null && isFinite(fx.warp) ? Math.max(0, Math.min(1, fx.warp)) : 0;
      const morphed = this.buildWavetableVoice(baseFreq, wt, warp, startTime, stopAt, vibTargets, cutVoices);
      if (useStaticFilter) {
        morphed.connect(voiceFilter);
        voiceFilter.connect(voiceGain);
      } else {
        morphed.connect(voiceGain);
      }
    } else if (config.type === 'acid_303') {
      const osc = ctx.createOscillator();
      osc.type = config.oscillatorType || 'sawtooth';
      osc.frequency.setValueAtTime(baseFreq, startTime);
      vibTargets.push(osc.detune);

      // Waveshaper drive for classic TB-303 grit
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.distortionCurve as any;
      shaper.oversample = '2x';

      osc.connect(voiceFilter);
      voiceFilter.connect(shaper);
      shaper.connect(voiceGain);

      osc.start(startTime);
      osc.stop(stopAt);
      cutVoices.push(osc);
    } else if (config.type === 'fm_bell') {
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(baseFreq, startTime);
      vibTargets.push(carrier.detune);

      const modulator = ctx.createOscillator();
      modulator.type = 'sine';
      const modRatio = config.fmRatio || 2.75;
      modulator.frequency.setValueAtTime(baseFreq * modRatio, startTime);

      const modGain = ctx.createGain();
      // Strudel `fmi`: FM index override (0..32), else instrument default.
      const fmIdx = fx?.fmi != null && isFinite(fx.fmi) ? Math.max(0, Math.min(32, fx.fmi)) : config.fmIndex || 4;
      modGain.gain.setValueAtTime(baseFreq * fmIdx * velocity, startTime);
      modGain.gain.exponentialRampToValueAtTime(1, noteEndTime);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      carrier.connect(voiceFilter);
      voiceFilter.connect(voiceGain);

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(stopAt);
      carrier.stop(stopAt);
      cutVoices.push(carrier, modulator);
    } else if (config.type === 'poly_saw') {
      // Detuned saw stack; unison/spread widens the fan, detune shifts cents.
      const baseDet = (fx?.detune ?? 0) + (config.detune || 0);
      const uni = fx?.unison != null ? Math.max(1, Math.min(8, Math.floor(fx.unison))) : 3;
      const spreadCents = fx?.spread != null ? Math.max(0, Math.min(1, fx.spread)) * 50 : 12;
      const detunes = Array.from({ length: uni }, (_, i) =>
        uni === 1 ? baseDet : baseDet + (i - (uni - 1) / 2) * (spreadCents * 2 / Math.max(1, uni - 1)),
      );
      if (uni === 3 && fx?.unison == null && fx?.spread == null) detunes.splice(0, detunes.length, -12, 0, 12);
      detunes.forEach((detuneAmt) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(baseFreq, startTime);
        if (fx?.slide) {
          try {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq * 0.5), startTime + Math.min(0.05, fx.slide / 4));
            osc.frequency.exponentialRampToValueAtTime(baseFreq, startTime + Math.max(0.02, fx.slide));
          } catch {}
        }
        osc.detune.setValueAtTime(detuneAmt, startTime);
        vibTargets.push(osc.detune);
        osc.connect(voiceFilter);
        osc.start(startTime);
        osc.stop(stopAt);
        cutVoices.push(osc);
      });

      voiceFilter.connect(voiceGain);
    } else {
      // General subtractive / basic Strudel waveforms with unison fan.
      // Basic synths bypass the filter entirely unless .lpf() is set —
      // Strudel has no filter envelope on square/saw/triangle/sine.
      const bypassFilter = isBasicSynth && !useStaticFilter;
      const N = Math.max(1, Math.min(8, Math.floor(fx?.unison ?? 1)));
      const baseDet = (config.detune || 0) + (fx?.detune ?? 0);
      const spread = (fx?.spread ?? (N > 1 ? 0.25 : 0)) * 100; // ± cents
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(1 / Math.sqrt(N), startTime);
      if (bypassFilter) {
        bus.connect(voiceGain);
      } else {
        bus.connect(voiceFilter);
      }
      for (let i = 0; i < N; i++) {
        const osc = ctx.createOscillator();
        osc.type = config.oscillatorType || 'sawtooth';
        osc.frequency.setValueAtTime(baseFreq, startTime);
        if (fx?.slide) {
          try {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq * 0.5), startTime + Math.min(0.05, fx.slide / 4));
            osc.frequency.exponentialRampToValueAtTime(baseFreq, startTime + Math.max(0.02, fx.slide));
          } catch {}
        }
        const off = N === 1 ? 0 : (i - (N - 1) / 2) * (2 * spread / Math.max(1, N - 1));
        osc.detune.setValueAtTime(baseDet + off, startTime);
        vibTargets.push(osc.detune);
        if (N === 1) {
          osc.connect(bus);
        } else {
          const p = ctx.createStereoPanner ? ctx.createStereoPanner() : (ctx.createGain() as unknown as StereoPannerNode);
          if ((p as StereoPannerNode).pan) {
            (p as StereoPannerNode).pan!.setValueAtTime(
              (i % 2 ? 1 : -1) * Math.min(0.8, 0.25 + spread / 150),
              startTime,
            );
          }
          osc.connect(p);
          p.connect(bus);
        }
        osc.start(startTime);
        osc.stop(stopAt);
        cutVoices.push(osc);
      }

      if (!isBasicSynth || useStaticFilter) {
        voiceFilter.connect(voiceGain);
      }
    }

    // Register choke group after all voices are created.
    if (fx?.cut != null && cutVoices.length > 0) {
      try {
        this.trackChoke(String(fx.cut), cutVoices, startTime);
      } catch {}
    }

    if (vibRate > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(vibRate, startTime);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(vibDepthSt * 100, startTime); // semitones -> cents
      lfo.connect(depth);
      for (const param of vibTargets) {
        try {
          depth.connect(param);
        } catch {}
      }
      lfo.start(startTime);
      lfo.stop(stopAt);
    }
  }

  private playSynthesizedDrumFallback(dest: GainNode, token: string, startTime: number, velocity: number) {
    const ctx = this.ctx!;
    const lower = token.toLowerCase();

    if (lower.includes('bd') || lower.includes('kick')) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(150, startTime);
      osc.frequency.exponentialRampToValueAtTime(45, startTime + 0.08);
      gain.gain.setValueAtTime(velocity * 0.9, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    } else if (lower.includes('sd') || lower.includes('snare')) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(220, startTime);
      gain.gain.setValueAtTime(velocity * 0.6, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(startTime);
      osc.stop(startTime + 0.2);
    }
  }

  // Algorithmic Reverb Send Setup
  /**
   * Generated-IR room (superdough `createReverb`/`reverbGen` parity):
   * stereo noise decaying to -60dB at `decayTime` (default 2s, running 1.5x
   * longer to -90dB), 0.1s fade-in, and a gradual lowpass sweep 15kHz->1kHz
   * across the tail (one-pole, exponentially swept, applied at build time).
   */
  private setupReverbSend() {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const decayTime = 2;
    const fadeIn = 0.1;
    const lpStart = 15000;
    const lpEnd = 1000;
    const total = 1.5 * decayTime;
    const len = Math.floor(sampleRate * total);
    const buffer = this.ctx.createBuffer(2, len, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    // -60dB amplitude (1/1000) at decayTime, like reverbGen's decayBase.
    const decayBase = Math.pow(1 / 1000, 1 / (decayTime * sampleRate));
    const fadeLen = Math.floor(fadeIn * sampleRate);
    for (let i = 0; i < len; i++) {
      const amp = Math.pow(decayBase, i) * (i < fadeLen ? i / Math.max(1, fadeLen) : 1);
      left[i] = (Math.random() * 2 - 1) * amp;
      right[i] = (Math.random() * 2 - 1) * amp;
    }
    // Gradual lowpass: one-pole cutoff sweeping lpStart -> lpEnd.
    for (let c = 0; c < 2; c++) {
      const ch = buffer.getChannelData(c);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const fc = lpStart * Math.pow(lpEnd / lpStart, i / Math.max(1, len - 1));
        const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
        y += a * (ch[i] - y);
        ch[i] = y;
      }
    }

    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = buffer;

    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.setValueAtTime(0.65, this.ctx.currentTime);

    this.reverbNode.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterCompressor!);
  }

  private wtCycleCache = new Map<string, AudioBuffer>();

  /**
   * Extract one loopable 2048-sample cycle from a long single-file bank
   * (wavetable sweep, e.g. wt_digital_bad_day). Superdough splits the file
   * into 2048-sample frames and plays `position` (default 0 = FIRST frame)
   * when no `.wt()` is given — so the cycle comes from the head of the
   * file, starting at an upward zero crossing, with the tail crossfaded
   * into the head value so the loop seam is click-free. Returns null when
   * the instrument has no such bank loaded (yet).
   */
  private getWavetableCycle(name: string): AudioBuffer | null {
    if (!this.ctx) return null;
    const hit = this.wtCycleCache.get(name);
    if (hit) return hit;
    const variants = sampleManager.getBankVariants(name);
    const item = variants.find((v) => v && v.buffer && v.buffer.duration > 1.0);
    const buf = item?.buffer;
    if (!buf) return null;
    const N = 2048;
    const XF = 64;
    const src = buf.getChannelData(0);
    const total = src.length;
    // First frame raw (superdough default position 0 plays file[0..2048)
    // as-is; wavetable frames are authored seamless, so no search — just a
    // short tail crossfade as click insurance.
    const start = 0;
    const cycle = this.ctx.createBuffer(1, N, this.ctx.sampleRate);
    const out = cycle.getChannelData(0);
    for (let i = 0; i < N; i++) out[i] = src[(start + i) % total] ?? 0;
    const head = out[0];
    for (let i = 0; i < XF; i++) {
      const t = i / XF;
      out[N - XF + i] = out[N - XF + i] * (1 - t) + head * t;
    }
    out[N - 1] = head;
    this.wtCycleCache.set(name, cycle);
    return cycle;
  }

  /**
   * Superdough `distort` parity: the default `scurve` waveshaper
   * (helpers.mjs `distort-processor`, algorithm index 0):
   *   y = ((1+k)*x) / (1+k*|x|),  k = expm1(clamp01(distort))
   * distortvol/distorttype default to 1/0 (postgain 1), so the waveshaper
   * alone is the whole effect.
   */
  private makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const k = Math.expm1(Math.max(0, Math.min(1, amount)));
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  private makeCrushCurve(bits: number): Float32Array<ArrayBuffer> {
    const levels = Math.pow(2, Math.max(1, Math.min(16, Math.round(bits)) - 1));
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    return curve;
  }

  /** Bit-crush insert (Strudel `crush` worklet parity via staircase waveshaper). */
  private insertCrush(input: AudioNode, bits: number, _atTime: number): AudioNode {
    if (!this.ctx) return input;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.makeCrushCurve(bits);
    shaper.oversample = 'none';
    input.connect(shaper);
    return shaper;
  }

  /** Waveshape drive insert (Strudel `distort` parity). Amount 0..1. */
  private insertDistort(input: AudioNode, amount: number): AudioNode {
    if (!this.ctx) return input;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.makeDistortionCurve(amount);
    shaper.oversample = 'none';
    input.connect(shaper);
    return shaper;
  }

  /**
   * Frequency shifter approx (Strudel `fshift` parity) via ring modulation:
   * sine carrier at |hz| into a ring gain, wet + dry so pitch stays
   * intelligible. Negative hz flips the carrier phase.
   */
  private insertFshift(input: AudioNode, hz: number, startTime: number): AudioNode {
    if (!this.ctx) return input;
    if (!isFinite(hz) || hz === 0) return input;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(Math.min(5000, Math.abs(hz)), startTime);
    const flip = ctx.createGain();
    flip.gain.setValueAtTime(hz < 0 ? -1 : 1, startTime);
    const ring = ctx.createGain();
    ring.gain.setValueAtTime(0, startTime);
    input.connect(ring);
    osc.connect(flip);
    try {
      flip.connect(ring.gain);
    } catch {}
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(0.7, startTime);
    const dry = ctx.createGain();
    dry.gain.setValueAtTime(0.7, startTime);
    const out = ctx.createGain();
    ring.connect(wet);
    wet.connect(out);
    input.connect(dry);
    dry.connect(out);
    // Scheduler voices are short; 10s covers the longest held note.
    osc.start(startTime);
    try {
      osc.stop(startTime + 10);
    } catch {}
    return out;
  }

  /**
   * Rotary speaker approx (Strudel `leslie` parity): 800 Hz crossover,
   * 5 Hz AM on the drum (low) + 7 Hz delay wobble on the horn (high).
   */
  private insertLeslie(input: AudioNode, mix: number, startTime: number, holdDur: number): AudioNode {
    if (!this.ctx) return input;
    const ctx = this.ctx;
    const m = Math.max(0, Math.min(1.5, mix));
    if (m <= 0.001) return input;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(800, startTime);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.setValueAtTime(800, startTime);
    input.connect(low);
    input.connect(high);
    const lowWob = this.insertTremolo(low, 5, startTime, holdDur);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.setValueAtTime(0.012, startTime);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(7, startTime);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0.0025, startTime);
    lfo.connect(lg);
    try {
      lg.connect(delay.delayTime);
    } catch {}
    high.connect(delay);
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(Math.min(0.6, m * 0.5), startTime);
    const dry = ctx.createGain();
    dry.gain.setValueAtTime(1 - Math.min(0.5, m * 0.3), startTime);
    const out = ctx.createGain();
    lowWob.connect(out);
    delay.connect(wet);
    wet.connect(out);
    input.connect(dry);
    dry.connect(out);
    const stopAt = startTime + Math.max(0.1, holdDur) + 0.1;
    lfo.start(startTime);
    try {
      lfo.stop(stopAt);
    } catch {}
    return out;
  }

  /**
   * Wavetable/warp tail (Strudel `wt`/`warp` parity): wt blends a
   * waveshaper curve, warp adds chorus depth. The oscillator-side morph
   * lives in buildWavetableVoice for `wt_digital` instruments.
   */
  private insertWarp(input: AudioNode, wt: number, warp: number, t: number, dur: number): AudioNode {
    const w = Math.max(0, Math.min(1, wt));
    const r = Math.max(0, Math.min(1, warp));
    return this.insertChorus(this.insertDistort(input, Math.min(1, w * 0.4 + r * 0.5)), 0.2 + r * 1.1, t, dur);
  }

  private wtBank: PeriodicWave[] | null = null;

  /** 5-frame morph bank: sine -> triangle -> saw -> square -> harsh. */
  private getWtBank(): PeriodicWave[] {
    if (this.wtBank) return this.wtBank;
    const ctx = this.ctx!;
    const N = 24;
    const mk = (fn: (k: number) => number): PeriodicWave => {
      const real = new Float32Array(N + 1);
      const imag = new Float32Array(N + 1);
      for (let k = 1; k <= N; k++) imag[k] = fn(k);
      return ctx.createPeriodicWave(real, imag);
    };
    try {
      this.wtBank = [
        mk((k) => (k === 1 ? 1 : 0)),
        mk((k) => (k % 2 === 1 ? (k % 4 === 1 ? 1 : -1) / (k * k) : 0)),
        mk(() => 0) /* placeholder, replaced below */,
        mk((k) => (k % 2 === 1 ? 1 / k : 0)),
        mk((k) => (k % 2 === 1 ? 1 : -0.7) / Math.sqrt(k)),
      ];
      // Saw frame needs all harmonics: rebuild index 2 properly.
      const real = new Float32Array(N + 1);
      const imag = new Float32Array(N + 1);
      for (let k = 1; k <= N; k++) imag[k] = 1 / k;
      this.wtBank[2] = ctx.createPeriodicWave(real, imag);
    } catch {
      this.wtBank = [mk((k) => (k === 1 ? 1 : 0)), mk((k) => 1 / k)];
    }
    return this.wtBank;
  }

  /**
   * Morphing wavetable voice: two oscillators on adjacent frames with an
   * equal-power crossfade. Warp spreads ±50c detune; shaper/chorus tail
   * stays in insertWarp. Routes into the shared voiceFilter.
   */
  private buildWavetableVoice(
    freq: number,
    wt: number,
    warp: number,
    startTime: number,
    stopAt: number,
    vibTargets: AudioParam[],
    cutVoices: AudioScheduledSourceNode[],
  ): GainNode {
    const ctx = this.ctx!;
    const w = Math.max(0, Math.min(1, wt));
    const r = Math.max(0, Math.min(1, warp));
    const bank = this.getWtBank();
    const pos = w * (bank.length - 1);
    const i0 = Math.min(bank.length - 1, Math.floor(pos));
    const i1 = Math.min(bank.length - 1, i0 + 1);
    const frac = pos - i0;
    const g = (f: number): number => (f <= 0 ? 1 : f >= 1 ? 0 : Math.cos((f * Math.PI) / 2));
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    try {
      oscA.setPeriodicWave(bank[i0]);
    } catch {}
    try {
      oscB.setPeriodicWave(bank[i1]);
    } catch {}
    oscA.frequency.setValueAtTime(Math.max(20, freq), startTime);
    oscB.frequency.setValueAtTime(Math.max(20, freq), startTime);
    oscA.detune.setValueAtTime(-r * 50, startTime);
    oscB.detune.setValueAtTime(r * 50, startTime);
    const gA = ctx.createGain();
    gA.gain.setValueAtTime(g(frac), startTime);
    const gB = ctx.createGain();
    gB.gain.setValueAtTime(g(1 - frac), startTime);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.9, startTime);
    oscA.connect(gA);
    gA.connect(out);
    oscB.connect(gB);
    gB.connect(out);
    vibTargets.push(oscA.detune, oscB.detune);
    cutVoices.push(oscA, oscB);
    try {
      oscA.start(startTime);
      oscB.start(startTime);
    } catch {}
    try {
      oscA.stop(stopAt);
      oscB.stop(stopAt);
    } catch {}
    return out;
  }

  /**
   * Strudel `dry` 0..1 crossfade between the pre-effect node and the wet
   * node. Call as `head = applyDry(head, insertX(head, ...), dry, t)`.
   */
  private applyDry(input: AudioNode, wetNode: AudioNode, dry: number, startTime: number): AudioNode {
    if (!this.ctx) return wetNode;
    const ctx = this.ctx;
    const d = Math.max(0, Math.min(1, isFinite(dry) ? dry : 0));
    if (d <= 0.001) return wetNode;
    if (d >= 0.999) return input;
    const out = ctx.createGain();
    const dryG = ctx.createGain();
    const wetG = ctx.createGain();
    dryG.gain.setValueAtTime(d, startTime);
    wetG.gain.setValueAtTime(1 - d, startTime);
    input.connect(dryG);
    dryG.connect(out);
    wetNode.connect(wetG);
    wetG.connect(out);
    return out;
  }

  /** Formant vowel filter (Strudel `vowel` parity): two parallel bandpass peaks. */
  private insertVowel(input: AudioNode, vowel: string, atTime: number): AudioNode {
    if (!this.ctx) return input;
    const ctx = this.ctx;
    const FORMANTS: Record<string, [number, number]> = {
      a: [800, 1150], e: [500, 1700], i: [350, 2300], o: [500, 900], u: [350, 700],
    };
    const pair = FORMANTS[String(vowel).toLowerCase()[0]] || FORMANTS.a;
    const out = ctx.createGain();
    out.gain.setValueAtTime(1.2, atTime);
    pair.forEach((freq) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq, atTime);
      bp.Q.setValueAtTime(6, atTime);
      input.connect(bp);
      bp.connect(out);
    });
    return out;
  }

  /** Amplitude LFO (Strudel `tremolo` rate in Hz, fixed 0.5 depth). */
  private insertTremolo(input: AudioNode, rate: number, startTime: number, holdDur: number): AudioNode {
    if (!this.ctx) return input;
    const ctx = this.ctx;
    const r = Math.max(0.1, Math.min(32, rate));
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0.5, startTime);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(r, startTime);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.4, startTime);
    lfo.connect(lfoGain);
    const tremGain = ctx.createGain();
    tremGain.gain.setValueAtTime(0.7, startTime);
    try {
      lfoGain.connect(tremGain.gain);
    } catch {}
    input.connect(tremGain);
    const stopAt = startTime + Math.max(0.1, holdDur) + 0.1;
    lfo.start(startTime);
    lfo.stop(stopAt);
    void depth;
    return tremGain;
  }

  /** 4-stage allpass phaser (Strudel `phaser` rate Hz + depth cents). Wet-only; mix via applyDry. */
  private insertPhaser(input: AudioNode, rate: number, startTime: number, holdDur: number, depthCents = 1200): AudioNode {
    if (!this.ctx) return input;
    const ctx = this.ctx;
    const r = Math.max(0.05, Math.min(16, rate));
    const depth = Math.max(0, Math.min(2400, isFinite(depthCents) ? depthCents : 1200));
    const sum = ctx.createGain();
    input.connect(sum);
    const bases = [400, 900, 1800, 3600];
    let head: AudioNode = sum;
    const stages: BiquadFilterNode[] = [];
    for (const f of bases) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.setValueAtTime(f, startTime);
      ap.Q.setValueAtTime(1.5, startTime);
      head.connect(ap);
      head = ap;
      stages.push(ap);
    }
    // Feedback sets resonance without self-oscillation.
    const fb = ctx.createGain();
    fb.gain.setValueAtTime(0.35, startTime);
    head.connect(fb);
    fb.connect(sum);
    // One shared LFO sweeps all stages in cents (musical across the spread).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(r, startTime);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(depth, startTime);
    lfo.connect(dg);
    for (const ap of stages) {
      try {
        dg.connect(ap.detune);
      } catch {}
    }
    const stopAt = startTime + Math.max(0.1, holdDur) + 0.1;
    lfo.start(startTime);
    try {
      lfo.stop(stopAt);
    } catch {}
    return head;
  }

  /**
   * Simple chorus insert (modulated short delay mixed with dry).
   * Mix 0..1.5; delay 18ms, LFO 1.4Hz, depth 3.5ms.
   */
  private insertChorus(input: AudioNode, mix: number, startTime: number, holdDur: number): AudioNode {    if (!this.ctx) return input;
    const ctx = this.ctx;
    const m = Math.max(0, Math.min(1.5, mix));
    if (m <= 0.001) return input;
    const wetAmt = Math.min(0.6, m * 0.5);
    const dryAmt = 1 - Math.min(0.5, m * 0.3);
    const dry = ctx.createGain();
    dry.gain.setValueAtTime(dryAmt, startTime);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.setValueAtTime(0.018, startTime);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(1.4, startTime);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.0035, startTime);
    lfo.connect(lfoGain);
    try {
      lfoGain.connect(delay.delayTime);
    } catch {}
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(wetAmt, startTime);
    const out = ctx.createGain();
    input.connect(dry);
    dry.connect(out);
    input.connect(delay);
    delay.connect(wet);
    wet.connect(out);
    const stopAt = startTime + Math.max(0.1, holdDur) + 0.1;
    lfo.start(startTime);
    lfo.stop(stopAt);
    return out;
  }
}

export const audioEngine = new AudioEngine();
