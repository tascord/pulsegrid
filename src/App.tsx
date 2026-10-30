import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { TrackMixerState, MasterMixerState } from './audio/MixerStore';
import { Navbar, DrawerTab } from './components/Navbar';
import { CodeEditor } from './components/CodeEditor';
import { Visualizer, type VisualizerMode } from './components/Visualizer';
import { MixerConsole } from './components/MixerConsole';
import { PatternDrawer } from './components/PatternDrawer';
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
const VIS_MODE_KEY = 'pulsegrid-visualizer-mode-v1';
const VIS_OVERLAY_KEY = 'pulsegrid-visualizer-overlay-v1';
const VIS_OPACITY_KEY = 'pulsegrid-visualizer-opacity-v1';
const VALID_VIS_MODES = ['scope', 'spectrum', 'waveform', 'spectrogram', 'orbit', 'particles', 'levels', 'steps', 'pianoroll', 'spiral', 'pitchwheel'] as const;
const VALID_TABS = ['mixer', 'patterns', 'samples', 'midi', 'logs', 'style', 'docs'] as const;
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

import { parseDemoFile } from './demos';

// Demos are the single source of truth in demos/ (UPPERCASE filenames,
// `_` renders as a space). Vite inlines them as raw text at build time;
// server.ts and tools/ read the same folder with fs.
const demoModules = import.meta.glob<string>('../demos/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const DEMOS = Object.entries(demoModules)
  .map(([file, code]) => parseDemoFile(file, code))
  .sort((a, b) => a.file.localeCompare(b.file));

const DEFAULT_CODE = DEMOS[0]?.code ?? '';
const DEFAULT_CPM = DEMOS[0]?.cpm ?? 132;

const PRESETS = DEMOS.map((d) => ({ name: d.name, cpm: d.cpm ?? 132, code: d.code }));


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

function loadVisualizerMode(): VisualizerMode {
  try {
    const raw = localStorage.getItem(VIS_MODE_KEY);
    if (raw && (VALID_VIS_MODES as readonly string[]).includes(raw)) return raw as VisualizerMode;
  } catch {}
  return 'scope';
}

function loadVisualizerOverlay(): boolean {
  try {
    return localStorage.getItem(VIS_OVERLAY_KEY) === '1';
  } catch {
    return false;
  }
}

function loadVisualizerOpacity(): number {
  try {
    const v = parseFloat(localStorage.getItem(VIS_OPACITY_KEY) || '');
    if (Number.isFinite(v)) return Math.min(0.45, Math.max(0.05, v));
  } catch {}
  return 0.2;
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
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(loadVisualizerMode);
  const [visualizerOverlay, setVisualizerOverlay] = useState<boolean>(() => {
    // Steps view is monitor-only — never restore an overlay with it.
    if (loadVisualizerMode() === 'steps') return false;
    return loadVisualizerOverlay();
  });
  const [visualizerOpacity, setVisualizerOpacity] = useState<number>(loadVisualizerOpacity);

  // Persist the monitor scope status so a reload restores the mode + overlay.
  useEffect(() => {
    try {
      localStorage.setItem(VIS_MODE_KEY, visualizerMode);
      localStorage.setItem(VIS_OVERLAY_KEY, visualizerOverlay ? '1' : '0');
      localStorage.setItem(VIS_OPACITY_KEY, String(visualizerOpacity));
    } catch {}
  }, [visualizerMode, visualizerOverlay, visualizerOpacity]);
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
        {(['mixer', 'patterns', 'samples', 'midi', 'logs', 'style', 'docs'] as const).map((t) => (
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
                if (confirm('Restore the default session patterns?')) handleLoadProject(DEFAULT_CODE, DEFAULT_CPM);
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
