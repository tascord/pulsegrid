import { VstBridgeStatus, VstTrackRoute } from '../types/music';

export interface VstMidiOutputInfo {
  id: string;
  name: string;
}

export type BridgePlatform = 'linux' | 'macos' | 'windows' | 'unknown';

export function detectPlatform(): BridgePlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const p = (navigator as any).userAgentData?.platform || navigator.platform || '';
  const s = p.toLowerCase();
  if (s.includes('linux')) return 'linux';
  if (s.includes('mac')) return 'macos';
  if (s.includes('win')) return 'windows';
  return 'unknown';
}

export interface LatencyCalibration {
  at: number;
  sampleCount: number;
  medianRttMs: number;
  oneWayMs: number;
  audioMs: number;
  suggestedMs: number;
}

export interface EffectiveRoute {
  plugin: string;
  channel: number; // 0-15
  outputId: string | null;
  source: 'code' | 'manual' | 'global';
}

export interface VstBridgeDiagnostics {
  lastPingMs: number | null;
  lastError: string | null;
  reconnectAttempts: number;
  midiOutputs: VstMidiOutputInfo[];
  selectedMidiOutputId: string | null;
  midiChannel: number; // 0-15
  platform: BridgePlatform;
  trackRoutes: VstTrackRoute[];
  lastCalibration: LatencyCalibration | null;
  calibrating: boolean;
}

const ROUTES_STORAGE_KEY = 'pulsegrid-vst-routes-v1';

class VstBridge {
  private status: VstBridgeStatus = {
    enabled: true,
    connected: false,
    port: 8080,
    activePlugin: 'Serum (External VST3)',
    latencyOffsetMs: 12,
    simulatedMode: true,
  };

  private diag: VstBridgeDiagnostics = {
    lastPingMs: null,
    lastError: null,
    reconnectAttempts: 0,
    midiOutputs: [],
    selectedMidiOutputId: null,
    midiChannel: 0,
    platform: typeof navigator !== 'undefined' ? detectPlatform() : 'unknown',
    trackRoutes: [],
    lastCalibration: null,
    calibrating: false,
  };

  // Code-driven routes (synced on every code eval) vs drawer-driven manual
  // overrides (persisted). Effective = code > manual > global defaults.
  private codeRoutes: Map<string, VstTrackRoute> = new Map();
  private manualRoutes: Map<string, VstTrackRoute> = new Map();

  private midiOutput: MIDIOutput | null = null;
  private midiAccess: MIDIAccess | null = null;
  private ws: WebSocket | null = null;
  private listeners: Set<() => void> = new Set();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;

  constructor() {
    this.loadPersistedRoutes();
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

  public getStatus(): VstBridgeStatus {
    return { ...this.status };
  }

  public getDiagnostics(): VstBridgeDiagnostics {
    return { ...this.diag, midiOutputs: [...this.diag.midiOutputs], trackRoutes: [...this.diag.trackRoutes] };
  }

  public updateConfig(updates: Partial<VstBridgeStatus>) {
    this.status = { ...this.status, ...updates };
    this.notify();
  }

  public setMidiChannel(ch: number) {
    this.diag.midiChannel = Math.max(0, Math.min(15, Math.floor(ch)));
    this.persistRoutes();
    this.notify();
  }

  // ── Per-track routing ─────────────────────────────────────────────────
  private refreshTrackRoutesDiag() {
    const all = new Map<string, VstTrackRoute>();
    this.manualRoutes.forEach((r, k) => all.set(k, r));
    this.codeRoutes.forEach((r, k) => all.set(k, r));
    this.diag.trackRoutes = Array.from(all.values());
  }

  /** Replace all code-driven routes (called by PatternScheduler on each eval). */
  public syncCodeRoutes(routes: Array<{ trackId: string; plugin?: string; channel?: number; outputId?: string | null }>) {
    this.codeRoutes.clear();
    for (const r of routes) {
      if (r.plugin == null && r.channel == null && r.outputId == null) continue;
      this.codeRoutes.set(r.trackId, { ...r, source: 'code' });
    }
    this.refreshTrackRoutesDiag();
    this.notify();
  }

  public setManualRoute(trackId: string, patch: { plugin?: string; channel?: number; outputId?: string | null }) {
    const prev = this.manualRoutes.get(trackId);
    const merged: VstTrackRoute = {
      trackId,
      plugin: patch.plugin !== undefined ? (patch.plugin || undefined) : prev?.plugin,
      channel: patch.channel !== undefined ? patch.channel : prev?.channel,
      outputId: patch.outputId !== undefined ? patch.outputId : prev?.outputId,
      source: 'manual',
    };
    if (merged.plugin == null && merged.channel == null && merged.outputId == null) {
      this.manualRoutes.delete(trackId);
    } else {
      this.manualRoutes.set(trackId, merged);
    }
    this.persistRoutes();
    this.refreshTrackRoutesDiag();
    this.notify();
  }

  public clearManualRoute(trackId: string) {
    this.manualRoutes.delete(trackId);
    this.persistRoutes();
    this.refreshTrackRoutesDiag();
    this.notify();
  }

  public getManualRoute(trackId: string): VstTrackRoute | undefined {
    return this.manualRoutes.get(trackId);
  }

  public getEffectiveRoute(trackId: string): EffectiveRoute {
    const code = this.codeRoutes.get(trackId);
    const manual = this.manualRoutes.get(trackId);
    return {
      plugin: code?.plugin ?? manual?.plugin ?? this.status.activePlugin,
      channel: code?.channel ?? manual?.channel ?? this.diag.midiChannel,
      outputId: code?.outputId ?? manual?.outputId ?? this.diag.selectedMidiOutputId,
      source: code ? 'code' : manual ? 'manual' : 'global',
    };
  }

  private persistRoutes() {
    try {
      localStorage.setItem(
        ROUTES_STORAGE_KEY,
        JSON.stringify({
          manual: Array.from(this.manualRoutes.values()),
          selectedMidiOutputId: this.diag.selectedMidiOutputId,
          midiChannel: this.diag.midiChannel,
        })
      );
    } catch {}
  }

  private loadPersistedRoutes() {
    try {
      const raw = localStorage.getItem(ROUTES_STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (Array.isArray(p.manual)) {
        for (const r of p.manual) {
          if (r && typeof r.trackId === 'string') {
            this.manualRoutes.set(r.trackId, { ...r, source: 'manual' });
          }
        }
      }
      if (typeof p.selectedMidiOutputId === 'string') this.diag.selectedMidiOutputId = p.selectedMidiOutputId;
      if (typeof p.midiChannel === 'number') this.diag.midiChannel = Math.max(0, Math.min(15, p.midiChannel));
      this.refreshTrackRoutesDiag();
    } catch {}
  }

  private resolveOutput(outputId?: string | null): MIDIOutput | null {
    if (outputId && this.midiAccess) {
      const out = this.midiAccess.outputs.get(outputId) as MIDIOutput | undefined;
      if (out) return out;
    }
    return this.midiOutput;
  }

  // ── WebMIDI enumeration (works on Linux Chrome via ALSA/JACK) ──────────
  public async refreshMidiOutputs(): Promise<VstMidiOutputInfo[]> {
    try {
      const nav = navigator as any;
      if (!nav.requestMIDIAccess) {
        this.diag.lastError = 'WebMIDI not available in this browser. Use Chrome/Edge on Linux.';
        this.notify();
        return [];
      }
      if (!this.midiAccess) {
        this.midiAccess = await nav.requestMIDIAccess({ sysex: false });
        this.midiAccess!.onstatechange = () => this.syncMidiOutputs();
      }
      this.syncMidiOutputs();
      return this.diag.midiOutputs;
    } catch (err: any) {
      this.diag.lastError = err?.message || 'MIDI access denied';
      this.notify();
      return [];
    }
  }

  private syncMidiOutputs() {
    if (!this.midiAccess) return;
    const outs: VstMidiOutputInfo[] = [];
    this.midiAccess.outputs.forEach((o: MIDIOutput) => {
      outs.push({ id: o.id, name: o.name || `MIDI out ${o.id.slice(0, 6)}` });
    });
    this.diag.midiOutputs = outs;
    // Auto-select bridge virtual port if visible
    if (!this.diag.selectedMidiOutputId) {
      const auto = outs.find((o) =>
        /pulsegrid|loopmidi|iac|virmidi|vst|bridge/i.test(o.name)
      );
      if (auto) this.selectMidiOutput(auto.id);
    } else if (this.diag.selectedMidiOutputId) {
      const stillThere = outs.find((o) => o.id === this.diag.selectedMidiOutputId);
      this.midiOutput = stillThere && this.midiAccess
        ? (this.midiAccess.outputs.get(this.diag.selectedMidiOutputId) as MIDIOutput) || null
        : null;
      this.status.connected = this.status.connected || !!this.midiOutput;
    }
    this.notify();
  }

  public selectMidiOutput(id: string | null) {
    this.diag.selectedMidiOutputId = id;
    if (!id || !this.midiAccess) {
      this.midiOutput = null;
      this.persistRoutes();
      this.notify();
      return;
    }
    const out = this.midiAccess.outputs.get(id) as MIDIOutput | undefined;
    this.midiOutput = out || null;
    if (out) {
      this.status.connected = true;
      this.diag.lastError = null;
    }
    this.persistRoutes();
    this.notify();
  }

  public setMidiOutput(output: MIDIOutput | null) {
    this.midiOutput = output;
    if (output) {
      this.status.connected = true;
      this.diag.selectedMidiOutputId = output.id;
    }
    this.persistRoutes();
    this.notify();
  }

  // ── WebSocket bridge with auto-reconnect + ping ─────────────────────────
  public connectWebSocket(port: number = 8080, autoReconnect = true) {
    try {
      if (this.ws) {
        try { this.ws.close(); } catch {}
      }
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.ws = new WebSocket(`ws://localhost:${port}`);
      this.status.port = port;
      this.ws.onopen = () => {
        this.status.connected = true;
        this.diag.reconnectAttempts = 0;
        this.diag.lastError = null;
        this.notify();
        this.startPingLoop();
      };
      this.ws.onclose = () => {
        this.status.connected = this.midiOutput ? true : false;
        this.stopPingLoop();
        this.notify();
        if (autoReconnect && this.diag.reconnectAttempts < 5) {
          this.diag.reconnectAttempts += 1;
          this.reconnectTimer = window.setTimeout(() => this.connectWebSocket(port, autoReconnect), 2000);
        }
      };
      this.ws.onerror = () => {
        this.diag.lastError =
          this.diag.platform === 'linux'
            ? `No bridge on ws://localhost:${port}. Run: python3 bridge/vst-bridge-linux.py --port ${port}`
            : `No bridge on ws://localhost:${port}. Run the helper script for your OS.`;
        this.status.connected = this.midiOutput ? true : false;
        this.notify();
      };
    } catch (err: any) {
      this.diag.lastError = err?.message || 'WebSocket failed';
      this.status.connected = false;
      this.notify();
    }
  }

  public disconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPingLoop();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.status.connected = !!this.midiOutput;
    this.notify();
  }

  public async ping(): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve(null);
        return;
      }
      const t0 = performance.now();
      const nonce = `ping_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const onMsg = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(String(ev.data));
          if (d?.type === 'pong' && d?.nonce === nonce) {
            const ms = Math.round(performance.now() - t0);
            this.diag.lastPingMs = ms;
            this.notify();
            this.ws?.removeEventListener('message', onMsg);
            resolve(ms);
          }
        } catch {}
      };
      this.ws.addEventListener('message', onMsg);
      this.ws.send(JSON.stringify({ type: 'ping', nonce, timestamp: Date.now() }));
      window.setTimeout(() => {
        this.ws?.removeEventListener('message', onMsg);
        resolve(this.diag.lastPingMs);
      }, 1500);
    });
  }

  /**
   * Auto-calibrate the latency offset: median WS round-trip / 2 (one-way)
   * plus the browser audio output latency, clamped to the slider range.
   * Applies the result to latencyOffsetMs and records the breakdown.
   */
  public async calibrateLatency(samples = 7, audioLatencyMs = 0): Promise<LatencyCalibration | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.diag.lastError = 'Connect the bridge daemon first, then auto-calibrate.';
      this.notify();
      return null;
    }
    this.diag.calibrating = true;
    this.notify();
    const rtts: number[] = [];
    for (let i = 0; i < samples; i++) {
      const r = await this.ping();
      if (r != null) rtts.push(r);
    }
    this.diag.calibrating = false;
    if (rtts.length === 0) {
      this.diag.lastError = 'Calibration failed: no pong replies from the bridge.';
      this.notify();
      return null;
    }
    rtts.sort((a, b) => a - b);
    const medianRttMs = rtts[Math.floor(rtts.length / 2)];
    const oneWayMs = Math.round(medianRttMs / 2);
    const audioMs = Math.max(0, Math.round(audioLatencyMs));
    const suggestedMs = Math.max(-50, Math.min(150, oneWayMs + audioMs));
    this.status.latencyOffsetMs = suggestedMs;
    this.diag.lastCalibration = {
      at: Date.now(),
      sampleCount: rtts.length,
      medianRttMs,
      oneWayMs,
      audioMs,
      suggestedMs,
    };
    this.diag.lastError = null;
    this.notify();
    return this.diag.lastCalibration;
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      this.ping().catch(() => {});
    }, 10000);
  }

  private stopPingLoop() {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public testNote(note = 69, velocity = 0.9, durationSec = 0.4, route?: { trackId?: string }) {
    this.sendNote(note, velocity, durationSec, route);
  }

  public sendNote(
    note: number,
    velocity: number,
    durationSec: number,
    route?: { trackId?: string; plugin?: string; channel?: number; outputId?: string | null }
  ) {
    if (!this.status.enabled) return;
    const eff = route?.trackId ? this.getEffectiveRoute(route.trackId) : null;
    const ch = Math.max(0, Math.min(15, route?.channel ?? eff?.channel ?? this.diag.midiChannel));
    const plugin = route?.plugin ?? eff?.plugin ?? this.status.activePlugin;
    const output = this.resolveOutput(route?.outputId ?? eff?.outputId);
    const status_on = 0x90 + ch;
    const status_off = 0x80 + ch;

    if (output) {
      try {
        const velByte = Math.max(1, Math.min(127, Math.floor(velocity * 127)));
        output.send([status_on, note, velByte]);
        const outRef = output;
        setTimeout(() => {
          try { outRef.send([status_off, note, 0]); } catch {}
        }, Math.max(30, durationSec * 1000 + this.status.latencyOffsetMs));
      } catch (err) {
        console.warn('MIDI Output send error:', err);
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'note',
          plugin,
          channel: ch,
          note,
          velocity,
          duration: durationSec,
          latencyMs: this.status.latencyOffsetMs,
          timestamp: Date.now(),
        })
      );
    }
  }

  public sendCC(
    controllerNumber: number,
    value: number,
    route?: { trackId?: string; plugin?: string; channel?: number; outputId?: string | null }
  ) {
    const eff = route?.trackId ? this.getEffectiveRoute(route.trackId) : null;
    const ch = Math.max(0, Math.min(15, route?.channel ?? eff?.channel ?? this.diag.midiChannel));
    const plugin = route?.plugin ?? eff?.plugin ?? this.status.activePlugin;
    const output = this.resolveOutput(route?.outputId ?? eff?.outputId);
    if (output) {
      try {
        const valByte = Math.max(0, Math.min(127, Math.floor(value * 127)));
        output.send([0xb0 + ch, controllerNumber, valByte]);
      } catch {}
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'cc',
          plugin,
          channel: ch,
          cc: controllerNumber,
          value,
        })
      );
    }
  }
}

export const vstBridge = new VstBridge();
