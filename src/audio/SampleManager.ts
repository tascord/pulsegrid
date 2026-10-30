import { SampleItem } from '../types/music';

export interface SampleBankStatus {
  bank: string;
  loaded: number;
  total: number;
  pending: boolean;
  error?: string;
}

class SampleManager {
  private samples: Map<string, SampleItem> = new Map();
  /** Multi-variant banks: base name -> variants in index order (Strudel `bank:n`). */
  private banks: Map<string, SampleItem[]> = new Map();
  /** User-defined aliases: alias -> canonical bank/sample name (Strudel `soundAlias`). */
  private dynamicAliases: Map<string, string> = new Map();
  /** Loading progress per bank for the Samples drawer. */
  private bankStatus: Map<string, SampleBankStatus> = new Map();
  private audioCtx: AudioContext | null = null;
  private listeners: Set<() => void> = new Set();
  /**
   * Gesture-free decode context: `decodeAudioData` works on an
   * OfflineAudioContext with no user gesture, so `samples(...)` in the
   * editor loads banks immediately on eval instead of waiting for the
   * first play press (which boots the realtime AudioContext).
   */
  private offlineCtx: OfflineAudioContext | null = null;

  public init(audioCtx: AudioContext) {
    const firstInit = !this.audioCtx;
    this.audioCtx = audioCtx;
    if (firstInit) this.generateBuiltinSamples();
  }

  /** Realtime context (null until first play), or an offline decode context. */
  public getDecodeContext(): AudioContext | OfflineAudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    try {
      if (typeof OfflineAudioContext !== 'undefined') {
        if (!this.offlineCtx) this.offlineCtx = new OfflineAudioContext(2, 1, 44100);
        return this.offlineCtx;
      }
    } catch {
      /* offline decode unavailable (e.g. bare Node) */
    }
    return null;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  /** Register a `soundAlias(original, alias)` mapping (Strudel parity). */
  public addAlias(alias: string, original: string): void {
    const a = alias.toLowerCase().trim();
    const o = original.toLowerCase().trim();
    if (!a || !o || a === o) return;
    this.dynamicAliases.set(a, o);
    this.notify();
  }

  public getSample(nameOrToken: string, seen?: Set<string>): SampleItem | undefined {
    const lower = nameOrToken.toLowerCase().trim();
    if (!lower) return undefined;
    // Cycle guard for alias chains (alias2 -> alias1 -> bank).
    const visited = seen ?? new Set<string>();
    if (visited.has(lower)) return undefined;
    visited.add(lower);
    // Direct match (covers "amen:0" style single-variant keys too)
    if (this.samples.has(lower)) {
      return this.samples.get(lower);
    }

    // Builtin aliases e.g. "bd" -> "kick_808" (dynamic soundAlias first)
    const aliases: Record<string, string> = {
      bd: 'kick_808',
      kick: 'kick_808',
      sd: 'snare_909',
      snare: 'snare_909',
      hh: 'hat_closed',
      hat: 'hat_closed',
      oh: 'hat_open',
      openhat: 'hat_open',
      cp: 'clap_808',
      clap: 'clap_808',
      rim: 'rimshot',
      cb: 'cowbell',
      tom: 'tom_low',
      perc: 'perc_click',
    };

    const resolveBase = (base: string): SampleItem | undefined => {
      // Follow dynamic alias chains (with cycle guard); bank-qualified
      // alias values (e.g. "casio:2") resolve recursively as full tokens.
      const dyn = this.dynamicAliases.get(base);
      if (dyn) {
        if (dyn.includes(':')) {
          const viaToken = this.getSample(dyn, visited);
          if (viaToken) return viaToken;
        } else {
          const canonical = this.canonicalBankKey(dyn);
          const hit = this.resolveBankOrSample(canonical) ?? this.resolveBankOrSample(dyn);
          if (hit) return hit;
          // Chain further: alias -> alias (single-hop miss above).
          if (this.dynamicAliases.has(dyn)) {
            const chained = this.getSample(dyn, visited);
            if (chained) return chained;
          }
        }
      }
      const bankHit = this.resolveBankOrSample(base);
      if (bankHit) return bankHit;
      const targetKey = aliases[base];
      if (targetKey) {
        const aliased =
          this.resolveBankOrSample(this.canonicalBankKey(targetKey)) ??
          this.resolveBankOrSample(targetKey);
        if (aliased) return aliased;
      }
      return undefined;
    };

    const direct = resolveBase(lower);
    if (direct) return direct;

    // Strudel suffixes, e.g. "bd:4" (bank index), "bd:0:0.3":
    // first numeric segment selects the bank variant (modulo-wrapped).
    if (lower.includes(':')) {
      const parts = lower.split(':');
      const base = parts[0];
      const idx = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
      const baseHit = resolveBase(base);
      if (!isNaN(idx)) {
        // Candidate bank keys: canonical chain, builtin target, its chain.
        const keys: string[] = [this.canonicalBankKey(base), base];
        const builtin = aliases[base];
        if (builtin) keys.push(this.canonicalBankKey(builtin), builtin);
        // Alias value may itself be bank-qualified ("casio:2").
        const dynVal = this.dynamicAliases.get(base);
        if (dynVal && dynVal.includes(':')) {
          const viaToken = this.getSample(dynVal, visited);
          if (viaToken) return viaToken;
        }
        for (const key of keys) {
          const variants = this.banks.get(key);
          if (variants && variants.length > 0) {
            const wrapped = ((idx % variants.length) + variants.length) % variants.length;
            // Sparse-hole fallback: missing/loading variants resolve to the
            // first loaded one so patterns keep sounding while rest fetch.
            if (variants[wrapped]) return variants[wrapped];
            const firstLoaded = variants.find(Boolean);
            if (firstLoaded) return firstLoaded;
          }
        }
      }
      if (baseHit) return baseHit;
    }

    return undefined;
  }

  /** Resolve a bare name to a bank's default variant or a single sample. */
  private resolveBankOrSample(lower: string): SampleItem | undefined {
    const variants = this.banks.get(lower);
    if (variants && variants.length > 0) return variants[0];
    if (this.samples.has(lower)) return this.samples.get(lower);
    return undefined;
  }

  /** Follow dynamic aliases to the canonical bank key. */
  private canonicalBankKey(lower: string): string {
    let key = lower;
    const seen = new Set<string>();
    while (this.dynamicAliases.has(key) && !seen.has(key)) {
      seen.add(key);
      key = this.dynamicAliases.get(key)!;
    }
    return key;
  }

  public getAllSamples(): SampleItem[] {
    return Array.from(this.samples.values());
  }

  public addSample(sample: SampleItem) {
    this.samples.set(sample.name.toLowerCase(), sample);
    this.notify();
  }

  /**
   * Register one decoded buffer as variant `index` of bank `name`.
   * Bank variants are addressable as `name`, `name:index` (modulo-wrapped,
   * Strudel parity). Missing/loading variants resolve to the first loaded
   * one so patterns keep sounding while the rest fetch.
   */
  public registerBankVariant(bank: string, index: number, buffer: AudioBuffer, url: string): SampleItem {
    const key = bank.toLowerCase();
    const list = this.banks.get(key) || [];
    const name = index === 0 ? key : `${key}:${index}`;
    const item: SampleItem = {
      id: `bank_${key}_${index}`,
      name,
      buffer,
      duration: buffer.duration,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 1.0,
      pitch: 0,
      isUserUploaded: true,
    };
    list[index] = item;
    this.banks.set(key, list);
    // Also index the default variant under the bare bank name so the
    // flat sample list / drawer pick it up.
    if (index === 0) this.samples.set(key, item);
    this.notify();
    return item;
  }

  public getBankNames(): string[] {
    return Array.from(this.banks.keys()).sort();
  }

  /** Raw variant list for a bank (sparse while loading; Strudel parity). */
  public getBankVariants(bank: string): (SampleItem | undefined)[] {
    return this.banks.get(bank.toLowerCase()) || [];
  }

  public getBankSize(bank: string): number {
    return this.banks.get(bank.toLowerCase())?.filter(Boolean).length || 0;
  }

  public getBankTotal(bank: string): number {
    return this.bankStatus.get(bank.toLowerCase())?.total || this.getBankSize(bank);
  }

  public getBankStatus(bank: string): SampleBankStatus | undefined {
    return this.bankStatus.get(bank.toLowerCase());
  }

  public getAllBankStatuses(): SampleBankStatus[] {
    return Array.from(this.bankStatus.values()).sort((a, b) => a.bank.localeCompare(b.bank));
  }

  public setBankStatus(bank: string, status: Partial<SampleBankStatus> & { total: number }): void {
    const key = bank.toLowerCase();
    const prev = this.bankStatus.get(key);
    this.bankStatus.set(key, {
      bank: key,
      loaded: status.loaded ?? prev?.loaded ?? 0,
      total: status.total,
      pending: status.pending ?? false,
      error: status.error,
    });
    this.notify();
  }

  public markBankProgress(bank: string, loaded: number): void {
    const key = bank.toLowerCase();
    const prev = this.bankStatus.get(key);
    if (!prev) return;
    prev.loaded = loaded;
    this.notify();
  }

  public markBankDone(bank: string, error?: string): void {
    const key = bank.toLowerCase();
    const prev = this.bankStatus.get(key);
    if (!prev) return;
    prev.pending = false;
    if (error) prev.error = error;
    this.notify();
  }

  public hasBank(bank: string): boolean {
    return (this.banks.get(bank.toLowerCase())?.filter(Boolean).length || 0) > 0;
  }

  public updateSample(id: string, updates: Partial<SampleItem>) {
    for (const [key, item] of this.samples.entries()) {
      if (item.id === id) {
        const newName = updates.name ? updates.name.toLowerCase() : key;
        const updated = { ...item, ...updates, name: updates.name || item.name };
        if (newName !== key) {
          this.samples.delete(key);
          this.samples.set(newName, updated);
        } else {
          this.samples.set(key, updated);
        }
        this.notify();
        return;
      }
    }
    // Bank variants (index > 0) live only in the banks map.
    for (const [bank, list] of this.banks.entries()) {
      const idx = list.findIndex((s) => s && s.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx]!, ...updates };
        if (idx === 0) this.samples.set(bank, list[idx]!);
        this.notify();
        return;
      }
    }
  }

  public removeSample(id: string) {
    for (const [key, item] of this.samples.entries()) {
      if (item.id === id) {
        this.samples.delete(key);
        this.notify();
        return;
      }
    }
    for (const [bank, list] of this.banks.entries()) {
      const idx = list.findIndex((s) => s && s.id === id);
      if (idx >= 0) {
        delete list[idx];
        if (idx === 0) this.samples.delete(bank);
        this.notify();
        return;
      }
    }
  }

  public async importAudioFile(file: File): Promise<SampleItem> {
    if (!this.audioCtx) throw new Error('AudioContext not initialized');

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);

    // Sanitize name without extension
    const baseName = file.name
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');

    let finalName = baseName;
    let counter = 1;
    while (this.samples.has(finalName)) {
      finalName = `${baseName}_${counter++}`;
    }

    const newSample: SampleItem = {
      id: `sample_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: finalName,
      buffer: audioBuffer,
      duration: audioBuffer.duration,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 1.0,
      pitch: 0,
      isUserUploaded: true,
    };

    this.addSample(newSample);
    return newSample;
  }

  // Generate high quality synthetic drums and breakbeat audio buffers
  private generateBuiltinSamples() {
    if (!this.audioCtx) return;
    const sampleRate = this.audioCtx.sampleRate;

    // 1. 808 Kick
    const kickDur = 0.45;
    const kickBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * kickDur), sampleRate);
    const kickData = kickBuf.getChannelData(0);
    for (let i = 0; i < kickData.length; i++) {
      const t = i / sampleRate;
      const freq = 160 * Math.exp(-t * 18) + 42;
      const phase = 2 * Math.PI * freq * t;
      const amp = Math.exp(-t * 6.5);
      // Soft saturation clip
      const raw = Math.sin(phase) * amp * 1.2;
      kickData[i] = Math.tanh(raw);
    }
    this.addSample({
      id: 'samp_kick',
      name: 'kick_808',
      buffer: kickBuf,
      duration: kickDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 1.0,
      pitch: 0,
    });

    // 2. 909 Snare
    const snareDur = 0.28;
    const snareBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * snareDur), sampleRate);
    const snareData = snareBuf.getChannelData(0);
    for (let i = 0; i < snareData.length; i++) {
      const t = i / sampleRate;
      const tone = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 22) * 0.45;
      const tone2 = Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 28) * 0.25;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 14) * 0.65;
      snareData[i] = tone + tone2 + noise;
    }
    this.addSample({
      id: 'samp_snare',
      name: 'snare_909',
      buffer: snareBuf,
      duration: snareDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 0.9,
      pitch: 0,
    });

    // 3. Closed Hat
    const hatDur = 0.08;
    const hatBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * hatDur), sampleRate);
    const hatData = hatBuf.getChannelData(0);
    for (let i = 0; i < hatData.length; i++) {
      const t = i / sampleRate;
      // High-pass metallic noise burst
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 60);
      const metal = Math.sin(2 * Math.PI * 7800 * t) * 0.2;
      hatData[i] = (noise + metal) * 0.8;
    }
    this.addSample({
      id: 'samp_hat_c',
      name: 'hat_closed',
      buffer: hatBuf,
      duration: hatDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 0.7,
      pitch: 0,
    });

    // 4. Open Hat
    const ohDur = 0.35;
    const ohBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * ohDur), sampleRate);
    const ohData = ohBuf.getChannelData(0);
    for (let i = 0; i < ohData.length; i++) {
      const t = i / sampleRate;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 11);
      const metal = Math.sin(2 * Math.PI * 6500 * t) * 0.3;
      ohData[i] = (noise + metal) * 0.75;
    }
    this.addSample({
      id: 'samp_hat_o',
      name: 'hat_open',
      buffer: ohBuf,
      duration: ohDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 0.7,
      pitch: 0,
    });

    // 5. 808 Clap
    const clapDur = 0.24;
    const clapBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * clapDur), sampleRate);
    const clapData = clapBuf.getChannelData(0);
    for (let i = 0; i < clapData.length; i++) {
      const t = i / sampleRate;
      let clapBurst = 0;
      if (t < 0.012) clapBurst = (Math.random() * 2 - 1) * 0.8;
      else if (t < 0.024) clapBurst = (Math.random() * 2 - 1) * 0.9;
      else if (t < 0.036) clapBurst = (Math.random() * 2 - 1) * 1.0;
      else clapBurst = (Math.random() * 2 - 1) * Math.exp(-(t - 0.036) * 16) * 0.9;
      clapData[i] = clapBurst * 0.85;
    }
    this.addSample({
      id: 'samp_clap',
      name: 'clap_808',
      buffer: clapBuf,
      duration: clapDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 0.85,
      pitch: 0,
    });

    // 6. Rimshot
    const rimDur = 0.06;
    const rimBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * rimDur), sampleRate);
    const rimData = rimBuf.getChannelData(0);
    for (let i = 0; i < rimData.length; i++) {
      const t = i / sampleRate;
      const click = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90);
      rimData[i] = click * 0.9;
    }
    this.addSample({
      id: 'samp_rim',
      name: 'rimshot',
      buffer: rimBuf,
      duration: rimDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 0.8,
      pitch: 0,
    });

    // 7. Cowbell
    const cbDur = 0.18;
    const cbBuf = this.audioCtx.createBuffer(1, Math.floor(sampleRate * cbDur), sampleRate);
    const cbData = cbBuf.getChannelData(0);
    for (let i = 0; i < cbData.length; i++) {
      const t = i / sampleRate;
      const f1 = Math.sin(2 * Math.PI * 587 * t) > 0 ? 1 : -1;
      const f2 = Math.sin(2 * Math.PI * 845 * t) > 0 ? 1 : -1;
      const env = Math.exp(-t * 18);
      cbData[i] = (f1 * 0.5 + f2 * 0.5) * env * 0.6;
    }
    this.addSample({
      id: 'samp_cb',
      name: 'cowbell',
      buffer: cbBuf,
      duration: cbDur,
      trimStart: 0,
      trimEnd: 1,
      loop: false,
      gain: 0.75,
      pitch: 0,
    });

    // 8. Sliced Classic Breakbeat (Amen slices: amen:0 to amen:3)
    const sliceDurs = [0.22, 0.22, 0.22, 0.22];
    const sliceTypes = [
      { name: 'amen:0', kick: true, snare: false },
      { name: 'amen:1', kick: false, snare: true },
      { name: 'amen:2', kick: true, snare: false },
      { name: 'amen:3', kick: false, snare: true },
    ];

    sliceTypes.forEach((st, idx) => {
      const dur = sliceDurs[idx];
      const buf = this.audioCtx!.createBuffer(1, Math.floor(sampleRate * dur), sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        let signal = 0;
        // Rhythm ride noise
        signal += (Math.random() * 2 - 1) * Math.exp(-t * 24) * 0.25;
        if (st.kick) {
          const kFreq = 140 * Math.exp(-t * 22) + 50;
          signal += Math.sin(2 * Math.PI * kFreq * t) * Math.exp(-t * 9) * 0.8;
        }
        if (st.snare) {
          signal += Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 20) * 0.4;
          signal += (Math.random() * 2 - 1) * Math.exp(-t * 16) * 0.6;
        }
        data[i] = Math.tanh(signal);
      }
      this.addSample({
        id: `samp_amen_${idx}`,
        name: st.name,
        buffer: buf,
        duration: dur,
        trimStart: 0,
        trimEnd: 1,
        loop: false,
        gain: 0.9,
        pitch: 0,
      });
    });
  }
}

export const sampleManager = new SampleManager();
