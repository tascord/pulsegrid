import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Radio,
  X,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Check,
  AudioWaveform,
} from 'lucide-react';
import { TrackChannel } from '../types/music';
import { audioEngine } from '../audio/AudioEngine';
import { patternScheduler } from '../audio/PatternScheduler';
import { midiManager, MidiLearningTarget } from '../audio/MidiManager';
import { loadMixerState, removeMixerTracks } from '../audio/MixerStore';

/* ---------- helpers ---------- */

const CUTOFF_MIN = 40;
const CUTOFF_MAX = 18000;
const LOG_MIN = Math.log(CUTOFF_MIN);
const LOG_MAX = Math.log(CUTOFF_MAX);

function cutoffToPos(hz: number): number {
  const c = Math.min(CUTOFF_MAX, Math.max(CUTOFF_MIN, hz));
  return (Math.log(c) - LOG_MIN) / (LOG_MAX - LOG_MIN);
}
function posToCutoff(pos: number): number {
  return Math.round(Math.exp(LOG_MIN + Math.min(1, Math.max(0, pos)) * (LOG_MAX - LOG_MIN)));
}
function gainToDb(g: number): string {
  if (g <= 0.001) return '-inf';
  return `${(20 * Math.log10(Math.max(0.001, g))).toFixed(1)}dB`;
}
function fmtPan(p: number): string {
  if (Math.abs(p) < 0.02) return 'C';
  return p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`;
}
function readCodeFromStorage(): string | null {
  try {
    return localStorage.getItem('pulsegrid-code-v1');
  } catch {
    return null;
  }
}

/* ---------- vertical fader (pointer-driven, theme-aware) ---------- */

const VFader: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onReset?: () => void;
  accent?: string;
  height?: number;
  width?: number;
  /** Draws a marker line at this value (e.g. pan center). */
  detent?: number;
  disabled?: boolean;
  label: string;
}> = ({ value, min, max, onChange, onReset, accent = 'var(--pg-accent)', height = 112, width = 36, detent, disabled, label }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const norm = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));

  const setFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pos = 1 - (clientY - rect.top) / Math.max(1, rect.height);
      onChange(min + Math.min(1, Math.max(0, pos)) * (max - min));
    },
    [min, max, onChange],
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = (max - min) / 40;
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(Math.min(max, value + step));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(Math.max(min, value - step));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onChange(max);
        } else if (e.key === 'End') {
          e.preventDefault();
          onChange(min);
        }
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setFromClientY(e.clientY);
      }}
      onPointerMove={(e) => {
        if (dragging.current && !disabled) setFromClientY(e.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onDoubleClick={() => {
        if (!disabled) onReset?.();
      }}
      title={`${label} — drag or arrow keys · double-click resets`}
      style={{
        height,
        width,
        borderRadius: 8,
        background: 'var(--pg-editor-bg)',
        border: '1px solid var(--pg-border-soft)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'ns-resize',
        opacity: disabled ? 0.45 : 1,
        touchAction: 'none',
        overflow: 'hidden',
        outline: 'none',
      }}
    >
      {/* scale ticks */}
      {[0.25, 0.5, 0.75].map((t) => (
        <div
          key={t}
          style={{
            position: 'absolute',
            left: 6,
            right: 6,
            bottom: `${t * 100}%`,
            height: 1,
            background: 'var(--pg-border-soft)',
            opacity: 0.7,
          }}
        />
      ))}
      {/* unity (0dB) line for unipolar ranges that span it */}
      {min >= 0 && min < 1 && max >= 1 && (
        <div
          style={{
            position: 'absolute',
            left: 4,
            right: 4,
            bottom: `${((1 - min) / (max - min)) * 100}%`,
            height: 1,
            background: 'var(--pg-accent-2)',
            opacity: 0.8,
          }}
        />
      )}
      {/* detent marker (e.g. pan center) */}
      {detent !== undefined && detent > min && detent < max && (
        <div
          style={{
            position: 'absolute',
            left: 4,
            right: 4,
            bottom: `${((detent - min) / (max - min)) * 100}%`,
            height: 1,
            background: 'var(--pg-accent-3)',
            opacity: 0.9,
          }}
        />
      )}
      {/* fill */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${norm * 100}%`,
          background: `linear-gradient(to top, color-mix(in srgb, ${accent} 78%, transparent), color-mix(in srgb, ${accent} 38%, transparent))`,
          transition: dragging.current ? 'none' : 'height 60ms linear',
        }}
      />
      {/* thumb */}
      <div
        style={{
          position: 'absolute',
          left: 3,
          right: 3,
          bottom: `calc(${(norm * 100).toFixed(2)}% - 7px)`,
          height: 14,
          borderRadius: 4,
          background: 'var(--pg-text)',
          border: `1px solid ${accent}`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          transition: dragging.current ? 'none' : 'bottom 60ms linear',
        }}
      />
    </div>
  );
};

/* ---------- fader cell: label over a vertical fader, readout below ---------- */

const FaderCell: React.FC<{
  label: string;
  display: string;
  sub?: string;
  title?: string;
  children: React.ReactNode;
}> = ({ label, display, sub, title, children }) => (
  <div className="flex flex-col items-center gap-1 min-w-0" title={title}>
    <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: 'var(--pg-muted)' }}>
      {label}
    </span>
    {children}
    <span className="font-mono tabular-nums text-[9px] leading-tight text-center" style={{ color: 'var(--pg-text)' }}>
      {display}
    </span>
    {sub && (
      <span className="font-mono text-[8px] leading-tight -mt-1" style={{ color: 'var(--pg-faint)' }}>
        {sub}
      </span>
    )}
  </div>
);

/* ---------- main console ---------- */

const CODE_DEFAULTS = { gain: 0.8, pan: 0, cutoff: 18000, resonance: 2, reverbSend: 0, delaySend: 0 };

export const MixerConsole: React.FC = () => {
  const [tracks, setTracks] = useState<TrackChannel[]>(() => patternScheduler.getEvaluatedTracks());
  const [learningTarget, setLearningTarget] = useState<MidiLearningTarget | null>(null);
  const [peaks, setPeaks] = useState<Record<string, number>>({});
  const [masterPeak, setMasterPeak] = useState(0);
  const [masterVolume, setMasterVolume] = useState(() => audioEngine.getMasterVolume());
  const [masterMuted, setMasterMuted] = useState(() => audioEngine.getMuted());
  const [filter, setFilter] = useState('');
  const [savedCount, setSavedCount] = useState(() => Object.keys(loadMixerState()).length);
  const [savedFlash, setSavedFlash] = useState(false);
  const tracksRef = useRef<TrackChannel[]>(tracks);
  tracksRef.current = tracks;
  const saveFlashTimer = useRef<number | null>(null);

  // Subscribe once; peak loop reads via ref so it never goes stale.
  useEffect(() => {
    const unsubScheduler = patternScheduler.subscribeTracks(() => {
      setTracks(patternScheduler.getEvaluatedTracks());
      setSavedCount(Object.keys(loadMixerState()).length);
    });
    const unsubMidi = patternScheduler.subscribeTracks(() => {});
    const unsubLearn = midiManager.subscribe(() => {
      setLearningTarget(midiManager.getLearningTarget());
      setTracks(patternScheduler.getEvaluatedTracks());
    });
    const interval = window.setInterval(() => {
      const next: Record<string, number> = {};
      for (const tr of tracksRef.current) next[tr.id] = audioEngine.getTrackPeak(tr.id);
      setPeaks(next);
      // Master peak from the master analyser (time-domain).
      try {
        const analyser = audioEngine.masterAnalyser;
        if (analyser) {
          const data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data as unknown as Uint8Array<ArrayBuffer>);
          let max = 0;
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128) / 128;
            if (v > max) max = v;
          }
          setMasterPeak(max);
        }
      } catch {
        /* ignore */
      }
    }, 70);
    return () => {
      unsubScheduler();
      unsubMidi();
      unsubLearn();
      window.clearInterval(interval);
    };
  }, []);

  const markSaved = useCallback(() => {
    setSavedCount(Object.keys(loadMixerState()).length);
    setSavedFlash(true);
    if (saveFlashTimer.current) window.clearTimeout(saveFlashTimer.current);
    saveFlashTimer.current = window.setTimeout(() => setSavedFlash(false), 1200);
  }, []);

  const updateParam = useCallback(
    (trackId: string, param: 'gain' | 'pan' | 'cutoff' | 'resonance' | 'reverbSend' | 'delaySend' | 'muted' | 'solo', value: number | boolean) => {
      patternScheduler.setTrackParam(trackId, { [param]: value } as never);
      setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, [param]: value } : t)));
      markSaved();
    },
    [markSaved],
  );

  const handleMidiLearn = (target: MidiLearningTarget) => {
    if (learningTarget && learningTarget.trackId === target.trackId && learningTarget.param === target.param) {
      midiManager.cancelLearn();
    } else {
      midiManager.startLearn(target);
    }
  };

  const getBoundCC = (trackId: string, param: string): number | null => {
    const binding = midiManager.getBindings().find((b) => b.trackId === trackId && b.param === param);
    return binding ? binding.cc : null;
  };

  const handleResetMix = () => {
    const code = readCodeFromStorage();
    if (!code) return;
    if (!confirm('Reset the whole mix to the values in your code? Saved fader positions will be cleared.')) return;
    patternScheduler.resetMixerToCodeDefaults(code);
    markSaved();
  };

  const handleResetTrack = (trackId: string) => {
    const code = readCodeFromStorage();
    removeMixerTracks([trackId]);
    if (code) patternScheduler.evaluateCode(code);
    else patternScheduler.applyMixerSnapshot(null);
    markSaved();
  };

  const handleClearSolosMutes = () => {
    for (const t of tracks) {
      if (t.solo) patternScheduler.setTrackParam(t.id, { solo: false } as never);
      if (t.muted) patternScheduler.setTrackParam(t.id, { muted: false } as never);
    }
    setTracks((prev) => prev.map((t) => ({ ...t, solo: false, muted: false })));
    markSaved();
  };

  const handleMasterVolume = (v: number) => {
    setMasterVolume(v);
    audioEngine.setMasterVolume(v);
  };
  const handleMasterMute = () => {
    const next = !masterMuted;
    setMasterMuted(next);
    audioEngine.setMute(next);
  };

  const anySolo = tracks.some((t) => t.solo);
  const anyMuted = tracks.some((t) => t.muted);
  const q = filter.trim().toLowerCase();
  const visibleTracks = useMemo(
    () => (q ? tracks.filter((t) => t.id.toLowerCase().includes(q) || (t.instrument || '').toLowerCase().includes(q)) : tracks),
    [tracks, q],
  );

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 pg-panel-header text-xs flex-wrap">
        <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--pg-accent)' }} />
        <span className="font-semibold" style={{ color: 'var(--pg-text)' }}>
          Mixer
        </span>
        <span className="font-mono tabular-nums" style={{ color: 'var(--pg-faint)', fontSize: 11 }}>
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
        </span>
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 rounded font-mono"
          title="Mixer positions are auto-saved into the local project (localStorage) and restored on reload / re-eval."
          style={{
            fontSize: 10,
            color: savedFlash ? 'var(--pg-accent-ink)' : 'var(--pg-accent)',
            background: savedFlash ? 'var(--pg-accent)' : 'color-mix(in srgb, var(--pg-accent) 12%, transparent)',
            border: '1px solid var(--pg-border-soft)',
            transition: 'all 200ms ease',
          }}
        >
          {savedFlash ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--pg-accent)' }} />}
          {savedFlash ? 'Saved' : `Auto-save · ${savedCount} saved`}
        </span>

        <div className="flex-1" />

        <div
          className="flex items-center gap-1 rounded-md px-1.5 py-1 border"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-editor-bg)' }}
        >
          <Search className="w-3 h-3" style={{ color: 'var(--pg-faint)' }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tracks…"
            className="bg-transparent text-[11px] w-24 focus:w-32 transition-all"
            style={{ color: 'var(--pg-text)', outline: 'none' }}
          />
          {filter && (
            <button onClick={() => setFilter('')} style={{ color: 'var(--pg-faint)' }} title="Clear filter">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {(anySolo || anyMuted) && (
          <button
            onClick={handleClearSolosMutes}
            className="px-2 py-1 rounded-md text-[10px] font-semibold border hover:opacity-80"
            style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
            title="Clear all solos and unmute everything"
          >
            Clear S/M
          </button>
        )}
        <button
          onClick={handleResetMix}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border hover:opacity-80"
          style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
          title="Clear saved fader positions and re-evaluate the code so the mix matches your track() chains"
        >
          <RotateCcw className="w-3 h-3" />
          Reset to code
        </button>

        {learningTarget && (
          <div
            className="flex items-center gap-2 px-2 py-0.5 rounded text-[11px] animate-pulse border"
            style={{ background: 'color-mix(in srgb, var(--pg-accent) 12%, transparent)', borderColor: 'var(--pg-border)', color: 'var(--pg-accent)' }}
          >
            <Radio className="w-3 h-3" />
            <span>Turn a knob to bind {learningTarget.label}</span>
            <button onClick={() => midiManager.cancelLearn()} className="hover:opacity-70" title="Cancel MIDI learn">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Strips */}
      <div className="flex-1 p-3 overflow-auto">
        <div className="flex gap-3 items-stretch min-h-full">
          {/* Master strip */}
          <section
            aria-label="Master bus"
            className="w-36 shrink-0 rounded-lg p-2.5 flex flex-col gap-2 select-none border"
            style={{ background: 'color-mix(in srgb, var(--pg-accent) 7%, var(--pg-surface))', borderColor: 'var(--pg-border)' }}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-[11px] tracking-wide uppercase" style={{ color: 'var(--pg-text)' }}>
                Master
              </span>
              <button
                onClick={handleMasterMute}
                title={masterMuted ? 'Unmute master' : 'Mute master'}
                className="p-1 rounded-md border"
                style={{
                  borderColor: 'var(--pg-border)',
                  background: masterMuted ? 'var(--pg-danger)' : 'transparent',
                  color: masterMuted ? '#fff' : 'var(--pg-muted)',
                }}
              >
                {masterMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex gap-2 items-stretch justify-center">
              <VFader
                label="Master volume"
                value={masterVolume}
                min={0}
                max={1.2}
                onChange={handleMasterVolume}
                onReset={() => handleMasterVolume(0.85)}
                accent="var(--pg-accent-2)"
                height={128}
              />
              {/* master meter */}
              <div
                className="w-2.5 rounded-sm overflow-hidden flex flex-col justify-end p-0.5 border shrink-0"
                style={{ background: 'var(--pg-editor-bg)', borderColor: 'var(--pg-border-soft)', height: 128 }}
                title={`Master peak ${(masterPeak * 100).toFixed(0)}%`}
              >
                <div
                  className="w-full transition-all duration-75 rounded-xs"
                  style={{
                    height: `${Math.min(100, masterPeak * 150)}%`,
                    backgroundColor: masterPeak > 0.8 ? 'var(--pg-danger)' : masterPeak > 0.5 ? 'var(--pg-warn)' : 'var(--pg-accent)',
                  }}
                />
              </div>
            </div>
            <div className="text-center font-mono tabular-nums text-[11px]" style={{ color: 'var(--pg-text)' }}>
              {Math.round(masterVolume * 100)}%
            </div>
            <div className="text-center font-mono text-[10px]" style={{ color: 'var(--pg-faint)' }}>
              {gainToDb(masterVolume)}
            </div>
            <p className="text-[10px] leading-snug" style={{ color: 'var(--pg-faint)' }}>
              Saved with the project. Double-click a fader to reset it.
            </p>
          </section>

          {/* Channels */}
          {visibleTracks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6" style={{ color: 'var(--pg-faint)' }}>
              {tracks.length === 0 ? (
                <>
                  <AudioWaveform className="w-6 h-6 mb-2 opacity-50" />
                  <p className="text-sm" style={{ color: 'var(--pg-muted)' }}>
                    No tracks yet.
                  </p>
                  <p className="text-xs mt-1">Add a track in the editor, then evaluate the session.</p>
                </>
              ) : (
                <p className="text-xs">No tracks match “{filter}”.</p>
              )}
            </div>
          ) : (
            visibleTracks.map((track, idx) => {
              const peakVal = peaks[track.id] || 0;
              const cutoffCC = getBoundCC(track.id, 'cutoff');
              const gainCC = getBoundCC(track.id, 'gain');
              const isLearningCutoff = learningTarget?.trackId === track.id && learningTarget?.param === 'cutoff';
              const isLearningGain = learningTarget?.trackId === track.id && learningTarget?.param === 'gain';
              const panVal = typeof track.pan === 'number' ? track.pan : 0;
              const cutoffVal = typeof track.cutoff === 'number' ? track.cutoff : 3500;

              return (
                <article
                  key={track.id}
                  aria-label={`Channel ${track.name}`}
                  className="w-60 shrink-0 rounded-lg border p-2.5 flex flex-col gap-2 select-none"
                  style={{
                    background: 'var(--pg-surface)',
                    borderColor: track.solo ? 'var(--pg-warn)' : 'var(--pg-border-soft)',
                    opacity: track.muted ? 0.72 : 1,
                    boxShadow: anySolo && !track.solo ? 'inset 0 0 0 1px rgba(0,0,0,0.35)' : undefined,
                  }}
                >
                  {/* title */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="w-5 h-5 rounded text-[10px] font-bold font-mono flex items-center justify-center shrink-0"
                        style={{ background: 'var(--pg-surface-3)', color: 'var(--pg-muted)' }}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="font-bold text-xs truncate flex-1" style={{ color: 'var(--pg-text)' }} title={track.name}>
                        {track.name}
                      </span>
                      <button
                        onClick={() => handleResetTrack(track.id)}
                        title="Forget saved position for this track and restore its code value"
                        className="p-0.5 rounded hover:opacity-80 shrink-0"
                        style={{ color: 'var(--pg-faint)' }}
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--pg-surface-3)', color: 'var(--pg-accent)' }}
                      >
                        {track.instrument}
                      </span>
                      {track.patternName && (
                        <span className="text-[10px] font-mono truncate" style={{ color: 'var(--pg-faint)' }} title={track.patternName}>
                          {track.patternName}
                        </span>
                      )}
                      {track.vstPlugin && (
                        <span className="text-[10px] font-mono px-1 rounded border" style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-accent-2)' }}>
                          VST
                        </span>
                      )}
                    </div>
                  </div>

                  {/* mute / solo */}
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => updateParam(track.id, 'muted', !track.muted)}
                      aria-pressed={track.muted}
                      className="py-1 text-[10px] font-bold rounded uppercase tracking-wide transition-colors border"
                      style={
                        track.muted
                          ? { background: 'var(--pg-danger)', borderColor: 'var(--pg-danger)', color: '#fff' }
                          : { background: 'transparent', borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }
                      }
                    >
                      Mute
                    </button>
                    <button
                      onClick={() => updateParam(track.id, 'solo', !track.solo)}
                      aria-pressed={track.solo}
                      className="py-1 text-[10px] font-bold rounded uppercase tracking-wide transition-colors border"
                      style={
                        track.solo
                          ? { background: 'var(--pg-warn)', borderColor: 'var(--pg-warn)', color: 'var(--pg-accent-ink)' }
                          : { background: 'transparent', borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }
                      }
                    >
                      Solo
                    </button>
                  </div>

                  {/* fader bank — every control is a vertical fader */}
                  <div className="rounded-md p-2 border" style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-editor-bg)' }}>
                    <div className="flex items-end justify-between gap-1">
                      <FaderCell label="Vol" display={`${Math.round(track.gain * 100)}`} sub={gainToDb(track.gain)}>
                        <VFader
                          label={`${track.name} volume`}
                          value={track.gain}
                          min={0}
                          max={1.5}
                          onChange={(v) => updateParam(track.id, 'gain', Math.round(v * 100) / 100)}
                          onReset={() => updateParam(track.id, 'gain', CODE_DEFAULTS.gain)}
                          height={112}
                          width={34}
                        />
                      </FaderCell>
                      <FaderCell label="Pk" display={`${Math.round(Math.min(1, peakVal) * 100)}`} title={`Peak ${(peakVal * 100).toFixed(0)}%`}>
                        <div
                          className="rounded-sm overflow-hidden flex flex-col justify-end p-0.5 border shrink-0"
                          style={{ background: 'var(--pg-surface)', borderColor: 'var(--pg-border-soft)', height: 112, width: 10 }}
                        >
                          <div
                            className="w-full transition-all duration-75 rounded-xs"
                            style={{
                              height: `${Math.min(100, peakVal * 150)}%`,
                              backgroundColor: peakVal > 0.8 ? 'var(--pg-danger)' : peakVal > 0.5 ? 'var(--pg-warn)' : 'var(--pg-ok)',
                            }}
                          />
                        </div>
                      </FaderCell>
                      <FaderCell label="Pan" display={fmtPan(panVal)} title="Left / center / right — double-click recenters">
                        <VFader
                          label={`${track.name} pan`}
                          value={panVal}
                          min={-1}
                          max={1}
                          detent={0}
                          onChange={(v) => updateParam(track.id, 'pan', Math.round(v * 100) / 100)}
                          onReset={() => updateParam(track.id, 'pan', CODE_DEFAULTS.pan)}
                          accent="var(--pg-accent-3)"
                          height={112}
                          width={26}
                        />
                      </FaderCell>
                      <FaderCell
                        label="Cut"
                        display={cutoffVal >= 1000 ? `${(cutoffVal / 1000).toFixed(1)}k` : `${Math.round(cutoffVal)}`}
                        title={`${Math.round(cutoffVal)}Hz — log sweep, double-click resets`}
                      >
                        <VFader
                          label={`${track.name} cutoff (log sweep)`}
                          value={cutoffToPos(cutoffVal)}
                          min={0}
                          max={1}
                          onChange={(pos) => updateParam(track.id, 'cutoff', posToCutoff(pos))}
                          onReset={() => updateParam(track.id, 'cutoff', CODE_DEFAULTS.cutoff)}
                          height={112}
                          width={26}
                        />
                      </FaderCell>
                      <FaderCell label="Res" display={track.resonance.toFixed(1)} title="Filter resonance — double-click resets">
                        <VFader
                          label={`${track.name} resonance`}
                          value={track.resonance}
                          min={0.1}
                          max={20}
                          onChange={(v) => updateParam(track.id, 'resonance', Math.round(v * 10) / 10)}
                          onReset={() => updateParam(track.id, 'resonance', CODE_DEFAULTS.resonance)}
                          height={112}
                          width={26}
                        />
                      </FaderCell>
                      <FaderCell label="Vrb" display={`${Math.round(track.reverbSend * 100)}`} title="Reverb send — double-click resets">
                        <VFader
                          label={`${track.name} reverb send`}
                          value={track.reverbSend}
                          min={0}
                          max={1}
                          onChange={(v) => updateParam(track.id, 'reverbSend', Math.round(v * 100) / 100)}
                          onReset={() => updateParam(track.id, 'reverbSend', 0)}
                          accent="var(--pg-accent-2)"
                          height={112}
                          width={26}
                        />
                      </FaderCell>
                      <FaderCell label="Dly" display={`${Math.round(track.delaySend * 100)}`} title="Delay send — double-click resets">
                        <VFader
                          label={`${track.name} delay send`}
                          value={track.delaySend}
                          min={0}
                          max={1}
                          onChange={(v) => updateParam(track.id, 'delaySend', Math.round(v * 100) / 100)}
                          onReset={() => updateParam(track.id, 'delaySend', 0)}
                          accent="var(--pg-accent-3)"
                          height={112}
                          width={26}
                        />
                      </FaderCell>
                    </div>

                    {/* MIDI learn */}
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() =>
                          handleMidiLearn({ targetType: 'track', trackId: track.id, param: 'gain', label: `${track.id} Volume` })
                        }
                        className="flex-1 py-0.5 rounded text-[9px] font-mono transition-colors border"
                        style={{
                          borderColor: 'var(--pg-border-soft)',
                          background: isLearningGain ? 'var(--pg-accent)' : gainCC !== null ? 'color-mix(in srgb, var(--pg-accent) 14%, transparent)' : 'transparent',
                          color: isLearningGain ? 'var(--pg-accent-ink)' : gainCC !== null ? 'var(--pg-accent)' : 'var(--pg-faint)',
                          fontWeight: isLearningGain ? 700 : 400,
                        }}
                        title="MIDI Learn volume fader"
                      >
                        {gainCC !== null ? `VOL CC${gainCC}` : 'VOL Learn'}
                      </button>
                      <button
                        onClick={() => handleMidiLearn({ targetType: 'track', trackId: track.id, param: 'cutoff', label: `${track.id} Cutoff` })}
                        className="flex-1 py-0.5 rounded text-[9px] font-mono transition-colors border"
                        style={{
                          borderColor: 'var(--pg-border-soft)',
                          background: isLearningCutoff ? 'var(--pg-accent)' : cutoffCC !== null ? 'color-mix(in srgb, var(--pg-accent) 14%, transparent)' : 'transparent',
                          color: isLearningCutoff ? 'var(--pg-accent-ink)' : cutoffCC !== null ? 'var(--pg-accent)' : 'var(--pg-faint)',
                          fontWeight: isLearningCutoff ? 700 : 400,
                        }}
                        title="MIDI Learn cutoff fader"
                      >
                        {cutoffCC !== null ? `CUT CC${cutoffCC}` : 'CUT Learn'}
                      </button>
                    </div>

                    {(track.panModulated || track.cutoffModulated) && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {track.panModulated && (
                          <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--pg-accent-3) 16%, transparent)', color: 'var(--pg-accent-3)' }} title="Code modulates pan (LFO). Dragging the fader overrides it with a static value.">
                            PAN LFO → drag to override
                          </span>
                        )}
                        {track.cutoffModulated && (
                          <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--pg-accent-3) 16%, transparent)', color: 'var(--pg-accent-3)' }} title="Code modulates cutoff (LFO). Dragging the fader overrides it with a static value.">
                            CUT LFO → drag to override
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {(track.orbit != null || track.duckOrbit != null) && (
                    <div className="flex gap-1 flex-wrap text-[9px] font-mono" style={{ color: 'var(--pg-faint)' }}>
                      {track.orbit != null && <span className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--pg-border-soft)' }}>orbit {String(track.orbit)}</span>}
                      {track.duckOrbit != null && <span className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--pg-border-soft)' }}>duck→{String(track.duckOrbit)}</span>}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
