import React, { useState, useEffect } from 'react';
import { Radio, Terminal, Copy, Check, Download, RefreshCw, Activity, X, Zap } from 'lucide-react';
import { vstBridge, BridgePlatform } from '../audio/VstBridge';
import { audioEngine } from '../audio/AudioEngine';
import { patternScheduler } from '../audio/PatternScheduler';
import { TrackChannel } from '../types/music';
import { VstBridgeStatus } from '../types/music';

const LINUX_SETUP = `# Linux quick start (ALSA, no JACK needed)
pip install mido python-rtmidi websockets
python3 bridge/vst-bridge-linux.py --port 8080
# DAW: enable "PulseGrid VST Out" as MIDI input
# No ports? sudo modprobe snd-virmidi midi_devs=1 && aconnect -l`;

const HEADLESS_SETUP = `# Headless Linux rig (one time)
chmod +x bridge/setup-linux-midi.sh
./bridge/setup-linux-midi.sh
# bridge as a service (auto-start on boot):
cp bridge/pulsegrid-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pulsegrid-bridge`;

const MACOS_SETUP = `# macOS quick start
# 1. Audio MIDI Setup → MIDI Studio → enable IAC Driver Bus 1
node bridge/vst-bridge.js --port 8080
# DAW: select "PulseGrid VST Out" / IAC Bus as MIDI input`;

const WINDOWS_SETUP = `# Windows quick start
# 1. Install loopMIDI, create port "PulseGrid VST Out"
node bridge/vst-bridge.js --port 8080
# DAW: select the loopMIDI port as MIDI input`;

export const VstBridgeDrawer: React.FC = () => {
  const [status, setStatus] = useState<VstBridgeStatus>(vstBridge.getStatus());
  const [diag, setDiag] = useState(vstBridge.getDiagnostics());
  const [tracks, setTracks] = useState<TrackChannel[]>(() => patternScheduler.getEvaluatedTracks());
  const [osTab, setOsTab] = useState<BridgePlatform>(
    vstBridge.getDiagnostics().platform === 'unknown' ? 'linux' : vstBridge.getDiagnostics().platform
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [serverInfo, setServerInfo] = useState<any>(null);

  useEffect(() => {
    const unsub = vstBridge.subscribe(() => {
      setStatus(vstBridge.getStatus());
      setDiag(vstBridge.getDiagnostics());
    });
    const unsubTracks = patternScheduler.subscribeTracks(() => {
      setTracks(patternScheduler.getEvaluatedTracks());
    });
    setTracks(patternScheduler.getEvaluatedTracks());
    vstBridge.refreshMidiOutputs().catch(() => {});
    fetch('/api/vst-bridge/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setServerInfo(d))
      .catch(() => {});
    return () => {
      unsub();
      unsubTracks();
    };
  }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const download = (kind: 'linux' | 'node' | 'setup' | 'service' | 'readme') => {
    window.open(`/api/vst-bridge/script/${kind}`, '_blank');
  };

  const handlePing = async () => {
    setPinging(true);
    await vstBridge.ping();
    setPinging(false);
  };

  const handleCalibrate = async () => {
    const ctx = audioEngine.ctx as AudioContext | null;
    const audioMs = ((ctx as any)?.outputLatency ?? (ctx as any)?.baseLatency ?? 0) * 1000 || 0;
    await vstBridge.calibrateLatency(7, audioMs);
  };

  const setupText = osTab === 'linux' ? LINUX_SETUP : osTab === 'macos' ? MACOS_SETUP : WINDOWS_SETUP;
  const daws = ['Serum (External VST3)', 'Vital (External VST3)', 'Diva (External VST)', 'Ardour MIDI Bus', 'Reaper MIDI In', 'Bitwig Note In', 'Carla Rack (Linux)', 'FL Studio MIDI Out'];
  const cal = diag.lastCalibration;

  return (
    <div className="flex flex-col h-full pg-panel">
      <div className="flex items-center justify-between px-3 py-2 pg-panel-header text-xs gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pg-accent)' }} />
          <span className="font-bold truncate">VST Bridge</span>
          <span className="font-mono text-[11px] pg-faint tabular-nums">:{status.port}</span>
          {diag.platform === 'linux' && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-accent)' }}>
              <Terminal className="w-3 h-3" /> linux native
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono shrink-0 border"
          style={{
            borderColor: status.connected ? 'var(--pg-ok)' : 'var(--pg-warn)',
            color: status.connected ? 'var(--pg-ok)' : 'var(--pg-warn)',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.connected ? 'var(--pg-ok)' : 'var(--pg-warn)' }} />
          <span>{status.connected ? 'live' : 'simulated'}</span>
          {diag.lastPingMs != null && <span className="pg-faint">· {diag.lastPingMs}ms</span>}
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs">
        {diag.lastError && (
          <div className="rounded-xl border p-2.5 text-[11px] leading-relaxed" style={{ borderColor: 'var(--pg-warn)', background: 'color-mix(in srgb, var(--pg-warn) 10%, transparent)' }}>
            <span style={{ color: 'var(--pg-warn)' }}>{diag.lastError}</span>
          </div>
        )}

        {/* Global routing defaults */}
        <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}>
          <div className="text-[10px] pg-faint uppercase font-mono font-bold">Global defaults (fallback)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] pg-faint uppercase font-mono block mb-1">Target plugin / DAW bus</label>
              <select
                value={status.activePlugin}
                onChange={(e) => vstBridge.updateConfig({ activePlugin: e.target.value })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-mono bg-transparent focus:outline-none"
                style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
              >
                {daws.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] pg-faint uppercase font-mono block mb-1">
                WebMIDI output (Linux: ALSA / JACK ports appear here)
              </label>
              <div className="flex gap-1.5">
                <select
                  value={diag.selectedMidiOutputId || ''}
                  onChange={(e) => vstBridge.selectMidiOutput(e.target.value || null)}
                  className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-mono bg-transparent focus:outline-none min-w-0"
                  style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
                >
                  <option value="">— in-browser synth fallback —</option>
                  {diag.midiOutputs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => vstBridge.refreshMidiOutputs()}
                  className="px-2 rounded-lg border shrink-0"
                  style={{ borderColor: 'var(--pg-border)' }}
                  title="Rescan MIDI ports"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <div>
              <div className="flex justify-between text-[10px] pg-faint uppercase font-mono mb-1">
                <span>Latency</span>
                <span style={{ color: 'var(--pg-text)' }}>{status.latencyOffsetMs}ms</span>
              </div>
              <input type="range" min={-50} max={150} step={2} value={status.latencyOffsetMs}
                onChange={(e) => vstBridge.updateConfig({ latencyOffsetMs: parseInt(e.target.value, 10) })} className="w-full" />
            </div>
            <div>
              <div className="flex justify-between text-[10px] pg-faint uppercase font-mono mb-1">
                <span>Channel</span>
                <span style={{ color: 'var(--pg-text)' }}>{diag.midiChannel + 1}</span>
              </div>
              <input type="range" min={0} max={15} step={1} value={diag.midiChannel}
                onChange={(e) => vstBridge.setMidiChannel(parseInt(e.target.value, 10))} className="w-full" />
            </div>
            <div>
              <div className="flex justify-between text-[10px] pg-faint uppercase font-mono mb-1"><span>Port</span></div>
              <input type="number" min={1024} max={65535} value={status.port}
                onChange={(e) => vstBridge.updateConfig({ port: parseInt(e.target.value, 10) || 8080 })}
                className="w-full rounded-lg border px-2 py-1 font-mono bg-transparent focus:outline-none"
                style={{ borderColor: 'var(--pg-border)' }} />
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => vstBridge.connectWebSocket(status.port)}
                className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold pg-btn-accent">Connect</button>
              <button onClick={handlePing} disabled={pinging}
                className="px-2 py-1.5 rounded-lg border text-[11px]" style={{ borderColor: 'var(--pg-border)' }}
                title="Ping the local bridge daemon">
                <Activity className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => vstBridge.testNote()}
                className="px-2 py-1.5 rounded-lg border text-[11px] font-bold" style={{ borderColor: 'var(--pg-border)' }}
                title="Send middle-C test note (A4 440)">
                C
              </button>
            </div>
          </div>

          {/* Auto-calibration */}
          <div className="rounded-lg border p-2.5 space-y-1.5" style={{ borderColor: 'var(--pg-border-soft)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold">Latency auto-calibration</span>
              <button
                onClick={handleCalibrate}
                disabled={diag.calibrating}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold pg-btn-accent disabled:opacity-50"
              >
                <Zap className="w-3 h-3" />
                {diag.calibrating ? 'Measuring…' : 'Auto-calibrate'}
              </button>
            </div>
            {cal ? (
              <p className="text-[11px] font-mono pg-muted">
                {cal.sampleCount} pings · RTT {cal.medianRttMs}ms → one-way {cal.oneWayMs}ms + audio {cal.audioMs}ms ={' '}
                <span style={{ color: 'var(--pg-accent)' }}>{cal.suggestedMs}ms applied</span>
              </p>
            ) : (
              <p className="text-[11px] pg-faint">Pings the daemon, halves the round-trip, adds audio output latency, sets the slider.</p>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-[11px] pg-muted">
            <input type="checkbox" checked={status.simulatedMode}
              onChange={(e) => vstBridge.updateConfig({ simulatedMode: e.target.checked })} />
            <span>In-browser fallback audio when the bridge daemon is offline</span>
          </label>
        </div>

        {/* Per-track routes */}
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] pg-faint uppercase font-mono font-bold">Per-track routes (code › override › global)</span>
          </div>
          {tracks.length === 0 ? (
            <p className="text-[11px] pg-faint">No tracks yet — eval some code first.</p>
          ) : (
            <div className="space-y-1.5">
              {tracks.map((t) => {
                const eff = vstBridge.getEffectiveRoute(t.id);
                const manual = vstBridge.getManualRoute(t.id);
                const isVst = t.instrument === 'vst_bridge' || eff.source !== 'global';
                return (
                  <div key={t.id} className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--pg-border-soft)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[12px] truncate" style={{ color: 'var(--pg-text)' }}>{t.name}</span>
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded-full uppercase"
                        style={{
                          background: eff.source === 'code' ? 'color-mix(in srgb, var(--pg-accent) 18%, transparent)' : eff.source === 'manual' ? 'color-mix(in srgb, var(--pg-accent-2) 18%, transparent)' : 'var(--pg-surface-3)',
                          color: eff.source === 'global' ? 'var(--pg-faint)' : 'var(--pg-text)',
                        }}
                        title={eff.source === 'code' ? 'From .vst() in code' : eff.source === 'manual' ? 'Drawer override' : 'Global defaults'}
                      >
                        {eff.source === 'code' ? '.vst()' : eff.source}
                      </span>
                      <span className="pg-faint text-[10px] font-mono ml-auto">ch {eff.channel + 1}</span>
                      <button
                        onClick={() => vstBridge.testNote(69, 0.9, 0.4, { trackId: t.id })}
                        className="px-2 py-1 rounded-lg border text-[10px] font-bold" style={{ borderColor: 'var(--pg-border)' }}
                        title={`Send test note to ${t.name}'s route`}
                      >
                        test
                      </button>
                      {manual && (
                        <button
                          onClick={() => vstBridge.clearManualRoute(t.id)}
                          className="p-1 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}
                          title="Clear drawer override (fall back)"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                      <input
                        value={manual?.plugin ?? (eff.source === 'code' ? eff.plugin : '')}
                        onChange={(e) => vstBridge.setManualRoute(t.id, { plugin: e.target.value })}
                        placeholder={eff.source === 'code' ? `code: ${eff.plugin}` : `global: ${eff.plugin}`}
                        title={eff.source === 'code' ? 'Code owns the plugin — typing here adds an override' : 'Plugin override'}
                        className="rounded-lg border px-2 py-1 text-[11px] font-mono bg-transparent focus:outline-none min-w-0"
                        style={{ borderColor: 'var(--pg-border)' }}
                      />
                      <select
                        value={manual?.channel ?? (eff.source === 'code' ? eff.channel : -1)}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          vstBridge.setManualRoute(t.id, { channel: v < 0 ? undefined : v });
                        }}
                        className="rounded-lg border px-2 py-1 text-[11px] font-mono bg-transparent focus:outline-none"
                        style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
                        title="MIDI channel override (1-16)"
                      >
                        <option value={-1}>{eff.source === 'code' ? `code ch ${eff.channel + 1}` : `global ch ${eff.channel + 1}`}</option>
                        {Array.from({ length: 16 }).map((_, i) => (
                          <option key={i} value={i}>ch {i + 1}</option>
                        ))}
                      </select>
                      <select
                        value={manual?.outputId ?? (eff.source === 'code' ? eff.outputId ?? '' : '')}
                        onChange={(e) => vstBridge.setManualRoute(t.id, { outputId: e.target.value || null })}
                        className="rounded-lg border px-2 py-1 text-[11px] font-mono bg-transparent focus:outline-none min-w-0"
                        style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
                        title="MIDI output override"
                      >
                        <option value="">{eff.source === 'code' ? 'code output' : 'global output'}</option>
                        {diag.midiOutputs.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </div>
                    {!isVst && (
                      <p className="pg-faint text-[10px]">Tip: add <code className="font-mono">.vst("{eff.plugin}")</code> to this track in code — or set an override above.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            onClick={() => {
              const first = tracks[0];
              copy(first ? `track("${first.name}").vst("${vstBridge.getEffectiveRoute(first.name).plugin}").vstChannel(2).pattern("c3 eb3 g3 bb3");` : `track("vst_lead").vst("${status.activePlugin}").pattern("c3 eb3 g3 bb3");`, 'code');
            }}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--pg-border)' }}
          >
            {copied === 'code' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            <span className="font-mono">Copy per-track .vst() snippet</span>
          </button>
        </div>

        {/* OS-specific setup */}
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold">
              <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--pg-accent)' }} />
              <span>Local bridge daemon</span>
            </div>
            <div className="flex gap-1 p-0.5 rounded-full border" style={{ borderColor: 'var(--pg-border-soft)' }}>
              {(['linux', 'macos', 'windows'] as BridgePlatform[]).map((os) => (
                <button key={os} onClick={() => setOsTab(os)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-mono capitalize"
                  style={osTab === os ? { background: 'var(--pg-accent)', color: 'var(--pg-accent-ink)', fontWeight: 700 } : { color: 'var(--pg-muted)' }}>
                  {os === 'macos' ? 'mac' : os}
                </button>
              ))}
            </div>
          </div>
          <pre className="p-2.5 rounded-lg font-mono text-[11px] overflow-x-auto whitespace-pre-wrap"
            style={{ background: 'var(--pg-editor-bg)', border: '1px solid var(--pg-border-soft)', color: 'var(--pg-text)' }}>
            {setupText}
          </pre>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => copy(setupText, 'setup')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              {copied === 'setup' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy setup
            </button>
            <button onClick={() => download('linux')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              <Download className="w-3 h-3" /> vst-bridge-linux.py
            </button>
            <button onClick={() => download('node')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              <Download className="w-3 h-3" /> vst-bridge.js
            </button>
          </div>
          {serverInfo && (
            <p className="pg-faint text-[10px] font-mono">
              server: {serverInfo.serverPlatform} · {serverInfo.protocol} ·{' '}
              {(serverInfo.supportedDAWs || []).slice(0, 4).join(', ')}…
            </p>
          )}
        </div>

        {/* Headless Linux */}
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}>
          <div className="flex items-center gap-1.5 font-bold">
            <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--pg-accent-2)' }} />
            <span>Headless Linux rig</span>
          </div>
          <pre className="p-2.5 rounded-lg font-mono text-[11px] overflow-x-auto whitespace-pre-wrap"
            style={{ background: 'var(--pg-editor-bg)', border: '1px solid var(--pg-border-soft)', color: 'var(--pg-text)' }}>
            {HEADLESS_SETUP}
          </pre>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => copy(HEADLESS_SETUP, 'headless')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              {copied === 'headless' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
            </button>
            <button onClick={() => download('setup')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              <Download className="w-3 h-3" /> setup-linux-midi.sh
            </button>
            <button onClick={() => download('service')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              <Download className="w-3 h-3" /> .service
            </button>
            <button onClick={() => download('readme')}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--pg-border)' }}>
              <Download className="w-3 h-3" /> README
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
