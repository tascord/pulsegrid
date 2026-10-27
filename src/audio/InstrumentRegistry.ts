import { InstrumentConfig } from '../types/music';

class InstrumentRegistry {
  private instruments: Map<string, InstrumentConfig> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.seedDefaultInstruments();
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

  private seedDefaultInstruments() {
    const defaults: InstrumentConfig[] = [
      {
        id: 'inst_acid_303',
        name: 'acid_303',
        type: 'acid_303',
        oscillatorType: 'sawtooth',
        detune: 0,
        attack: 0.005,
        decay: 0.28,
        sustain: 0.05,
        release: 0.1,
        filterCutoff: 1100,
        filterResonance: 14,
        filterEnvAmount: 3200,
        drive: 0.35,
      },
      {
        id: 'inst_sub_bass',
        name: 'sub_bass',
        type: 'sub_bass',
        oscillatorType: 'sine',
        detune: 0,
        attack: 0.02,
        decay: 0.4,
        sustain: 0.8,
        release: 0.3,
        filterCutoff: 380,
        filterResonance: 2,
        filterEnvAmount: 200,
        drive: 0.15,
      },
      {
        id: 'inst_poly_saw',
        name: 'poly_saw',
        type: 'poly_saw',
        oscillatorType: 'sawtooth',
        detune: 12,
        attack: 0.08,
        decay: 0.6,
        sustain: 0.6,
        release: 0.45,
        filterCutoff: 2400,
        filterResonance: 4,
        filterEnvAmount: 1800,
        drive: 0.1,
      },
      {
        id: 'inst_fm_bell',
        name: 'fm_bell',
        type: 'fm_bell',
        oscillatorType: 'sine',
        detune: 0,
        attack: 0.002,
        decay: 0.9,
        sustain: 0.0,
        release: 0.8,
        filterCutoff: 4000,
        filterResonance: 1,
        filterEnvAmount: 500,
        fmRatio: 2.75,
        fmIndex: 4.5,
      },
      {
        id: 'inst_pluck',
        name: 'pluck',
        type: 'pluck',
        oscillatorType: 'triangle',
        detune: 5,
        attack: 0.003,
        decay: 0.22,
        sustain: 0.0,
        release: 0.15,
        filterCutoff: 2800,
        filterResonance: 6,
        filterEnvAmount: 2200,
        drive: 0.05,
      },
      {
        id: 'inst_chiptune',
        name: 'chiptune',
        type: 'chiptune',
        oscillatorType: 'square',
        detune: 0,
        attack: 0.001,
        decay: 0.15,
        sustain: 0.4,
        release: 0.05,
        filterCutoff: 5000,
        filterResonance: 1,
        filterEnvAmount: 0,
        drive: 0.2,
      },
      {
        id: 'inst_square',
        name: 'square',
        type: 'square',
        oscillatorType: 'square',
        detune: 0,
        attack: 0.001,
        decay: 0.05,
        sustain: 0.6,
        release: 0.01,
        filterCutoff: 18000,
        filterResonance: 1,
        filterEnvAmount: 0,
        drive: 0,
      },
      {
        id: 'inst_saw',
        name: 'saw',
        type: 'saw',
        oscillatorType: 'sawtooth',
        detune: 0,
        attack: 0.001,
        decay: 0.05,
        sustain: 0.6,
        release: 0.01,
        filterCutoff: 18000,
        filterResonance: 1,
        filterEnvAmount: 0,
        drive: 0,
      },
      {
        id: 'inst_triangle',
        name: 'triangle',
        type: 'triangle',
        oscillatorType: 'triangle',
        detune: 0,
        attack: 0.001,
        decay: 0.05,
        sustain: 0.6,
        release: 0.01,
        filterCutoff: 18000,
        filterResonance: 1,
        filterEnvAmount: 0,
        drive: 0,
      },
      {
        id: 'inst_sine',
        name: 'sine',
        type: 'sine',
        oscillatorType: 'sine',
        detune: 0,
        attack: 0.001,
        decay: 0.05,
        sustain: 0.6,
        release: 0.01,
        filterCutoff: 18000,
        filterResonance: 1,
        filterEnvAmount: 0,
        drive: 0,
      },
      {
        id: 'inst_sawtooth',
        name: 'sawtooth',
        type: 'saw',
        oscillatorType: 'sawtooth',
        detune: 0,
        attack: 0.001,
        decay: 0.05,
        sustain: 0.6,
        release: 0.01,
        filterCutoff: 18000,
        filterResonance: 1,
        filterEnvAmount: 0,
        drive: 0,
      },
      {
        id: 'inst_wt_digital_bad_day',
        name: 'wt_digital_bad_day',
        type: 'saw',
        oscillatorType: 'sawtooth',
        detune: 4,
        attack: 0.05,
        decay: 0.3,
        sustain: 0.6,
        release: 0.25,
        filterCutoff: 6000,
        filterResonance: 2,
        filterEnvAmount: 1200,
        drive: 0.1,
      },
      {
        id: 'inst_vst_bridge',
        name: 'vst_bridge',
        type: 'vst_bridge',
        oscillatorType: 'sawtooth',
        detune: 0,
        attack: 0.01,
        decay: 0.3,
        sustain: 0.5,
        release: 0.2,
        filterCutoff: 2000,
        filterResonance: 1,
        filterEnvAmount: 0,
        vstPluginName: 'Serum VST3',
      },
    ];

    defaults.forEach((d) => this.instruments.set(d.name.toLowerCase(), d));
  }

  public get(name: string): InstrumentConfig | undefined {
    return this.instruments.get(name.toLowerCase());
  }

  public getAll(): InstrumentConfig[] {
    return Array.from(this.instruments.values());
  }

  public duplicate(originalName: string, newName?: string): InstrumentConfig {
    const original = this.get(originalName) || this.instruments.get('acid_303')!;
    const cleanName = (newName || `${original.name}_copy`).toLowerCase().replace(/[^a-z0-9_]/g, '_');

    let finalName = cleanName;
    let counter = 1;
    while (this.instruments.has(finalName)) {
      finalName = `${cleanName}_${counter++}`;
    }

    const cloned: InstrumentConfig = {
      ...JSON.parse(JSON.stringify(original)),
      id: `inst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: finalName,
      type: 'custom',
    };

    this.instruments.set(finalName, cloned);
    this.notify();
    return cloned;
  }

  public update(name: string, updates: Partial<InstrumentConfig>) {
    const existing = this.instruments.get(name.toLowerCase());
    if (!existing) return;

    const newName = updates.name ? updates.name.toLowerCase() : existing.name.toLowerCase();
    const updated = { ...existing, ...updates, name: updates.name || existing.name };

    if (newName !== existing.name.toLowerCase()) {
      this.instruments.delete(existing.name.toLowerCase());
      this.instruments.set(newName, updated);
    } else {
      this.instruments.set(newName, updated);
    }

    this.notify();
  }

  public delete(name: string) {
    if (this.instruments.has(name.toLowerCase())) {
      this.instruments.delete(name.toLowerCase());
      this.notify();
    }
  }
}

export const instrumentRegistry = new InstrumentRegistry();
