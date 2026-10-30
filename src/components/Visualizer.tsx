import React, { useEffect, useRef } from 'react';
import { Activity, Eye, Layers } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { parseMiniNotation } from '../audio/MiniNotationParser';
import { patternScheduler } from '../audio/PatternScheduler';
import { useTheme } from '../theme/ThemeContext';
import { getThemePalette } from '../theme/themes';
import { tokenLane, tokenToMidi } from './InlineViz';

export type VisualizerMode =
  | 'scope' | 'spectrum' | 'waveform' | 'spectrogram' | 'orbit' | 'particles' | 'levels' | 'steps'
  | 'pianoroll' | 'spiral' | 'pitchwheel';

const MODES: { id: VisualizerMode; label: string }[] = [
  { id: 'scope', label: 'Scope' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'waveform', label: 'Waveform' },
  { id: 'spectrogram', label: 'Spectrogram' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'particles', label: 'Particles' },
  { id: 'levels', label: 'Levels' },
  { id: 'steps', label: 'Steps' },
  { id: 'pianoroll', label: 'Pianoroll' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'pitchwheel', label: 'Pitchwheel' },
];

const OVERLAY_MODES = new Set<VisualizerMode>([
  'scope',
  'spectrum',
  'waveform',
  'spectrogram',
  'orbit',
  'particles',
  'levels',
  'pianoroll',
  'spiral',
  'pitchwheel',
]);

export function supportsVisualizerOverlay(mode: VisualizerMode): boolean {
  return OVERLAY_MODES.has(mode);
}



interface VisualizerCanvasProps {
  mode: VisualizerMode;
  transparent?: boolean;
  opacity?: number;
  className?: string;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  mode,
  transparent = false,
  opacity = 1,
  className = '',
}) => {
  const { themeId } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const currentStepRef = useRef(0);
  const trackRowsRef = useRef<{
    name: string;
    slots: number[];
    events: { offset: number; duration: number; value: string; lane: number; midi: number | null }[];
  }[]>([]);

  useEffect(() => patternScheduler.subscribeStep((step) => {
    currentStepRef.current = step;
  }), []);

  useEffect(() => {
    const updateRows = () => {
      const shared = patternScheduler.getSharedPatterns();
      trackRowsRef.current = patternScheduler.getEvaluatedTracks().slice(0, 7).map((track) => {
        const patternName = track.patternName || '';
        const pattern = shared[patternName.toLowerCase()] || patternName;
        let parsed: { offset: number; duration: number; value: string }[] = [];
        try {
          parsed = parseMiniNotation(pattern);
        } catch {
          parsed = [];
        }
        return {
          name: track.name,
          slots: parsed.map((event) => Math.min(15, Math.floor(event.offset * 16))),
          events: parsed
            .filter((e) => e.value.trim() !== '~' && e.value.trim() !== '-' && e.value.trim() !== '_')
            .map((e) => ({ offset: e.offset, duration: e.duration, value: e.value, lane: tokenLane(e.value), midi: tokenToMidi(e.value) })),
        };
      });
    };
    updateRows();
    return patternScheduler.subscribeTracks(updateRows);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Keep the backing store matched to the displayed size so CSS scaling
    // never stretches the drawing (the editor overlay and monitor have
    // very different aspect ratios from the 640x200 fallback).
    const hasSpectrogramFrameRef = { current: false };
    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        // A resize clears the frame; spectrogram scrolls from scratch.
        hasSpectrogramFrameRef.current = false;
      }
    };
    syncSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    ro?.observe(canvas);

    // Resolved synchronously from the theme id (not a getComputedStyle
    // snapshot) so the colors match the newly selected theme on the same
    // render — child effects run before ThemeProvider writes the new CSS
    // vars, which is what made the monitor lag one theme behind.
    const pal = getThemePalette(themeId);
    const bg = pal.bg;
    const accent = pal.accent;
    const accent2 = pal.accent2;
    const accent3 = pal.accent3;
    const grid = pal.grid;
    let timeData = new Uint8Array(512).fill(128);
    let freqData = new Uint8Array(512);

    const drawGrid = (width: number, height: number) => {
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      for (let i = 1; i < 8; i++) {
        const x = (width / 8) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const render = () => {
      syncSize();
      const width = canvas.width;
      const height = canvas.height;
      const analyser = audioEngine.masterAnalyser;
      if (analyser) {
        if (timeData.length !== analyser.frequencyBinCount) {
          timeData = new Uint8Array(analyser.frequencyBinCount);
          freqData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);
      }

      if (mode === 'spectrogram' && hasSpectrogramFrameRef.current) {
        // Scroll speed in CSS px, scaled to device px so HiDPI + wide
        // canvases scroll at the same visual rate (was a fixed 2 device px,
        // which crawled on large/HiDPI surfaces after the resize fix).
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const shift = Math.max(2, Math.round(2 * dpr));
        if (transparent) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 0.06;
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(canvas, -shift, 0);
        ctx.clearRect(width - shift, 0, shift, height);
      } else {
        ctx.clearRect(0, 0, width, height);
        if (!transparent) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, width, height);
          drawGrid(width, height);
        }
      }

      if (mode === 'scope' || mode === 'waveform') {
        ctx.beginPath();
        for (let i = 0; i < timeData.length; i++) {
          const x = (i / (timeData.length - 1)) * width;
          const y = (timeData[i] / 255) * height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        if (mode === 'waveform') {
          ctx.lineTo(width, height / 2);
          ctx.lineTo(0, height / 2);
          ctx.closePath();
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        for (let i = 0; i < timeData.length; i++) {
          const x = (i / (timeData.length - 1)) * width;
          const y = (timeData[i] / 255) * height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = mode === 'scope' ? 2 : 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
      } else if (mode === 'spectrum') {
        const bands = 64;
        const step = (freqData.length * 0.82) / bands;
        const gap = Math.max(1, width / 480);
        const barWidth = width / bands - gap;
        for (let i = 0; i < bands; i++) {
          const start = Math.floor(Math.pow(i / bands, 2) * freqData.length * 0.82);
          const end = Math.max(start + 1, Math.floor(start + step));
          let total = 0;
          for (let bin = start; bin < end && bin < freqData.length; bin++) total += freqData[bin];
          const magnitude = total / Math.max(1, end - start) / 255;
          const barHeight = Math.max(1, magnitude * (height - 6));
          const x = i * (barWidth + gap);
          const gradient = ctx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, accent);
          gradient.addColorStop(0.65, accent2);
          gradient.addColorStop(1, accent3);
          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        }
      } else if (mode === 'spectrogram') {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const shift = Math.max(2, Math.round(2 * dpr));
        const rowH = Math.max(1, Math.round(dpr));
        for (let y = 0; y < height; y += rowH) {
          const ratio = 1 - y / height;
          const bin = Math.min(freqData.length - 1, Math.floor(ratio * ratio * freqData.length));
          const magnitude = freqData[bin] / 255;
          if (magnitude < 0.025) continue;
          ctx.globalAlpha = Math.min(0.9, magnitude * 1.4);
          ctx.fillStyle = magnitude > 0.62 ? accent2 : magnitude > 0.28 ? accent : accent3;
          ctx.fillRect(width - shift, y, shift, rowH);
        }
        ctx.globalAlpha = 1;
        hasSpectrogramFrameRef.current = true;
      } else if (mode === 'orbit') {
        const radius = Math.min(width, height) * 0.32;
        const cx = width / 2;
        const cy = height / 2;
        ctx.beginPath();
        for (let i = 0; i < timeData.length; i++) {
          const angle = (i / timeData.length) * Math.PI * 2;
          const amplitude = (timeData[i] - 128) / 128;
          const r = radius + amplitude * radius * 0.42;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (mode === 'particles') {
        let energy = 0;
        for (let i = 0; i < Math.min(48, freqData.length); i++) energy += freqData[i] / 255;
        energy /= Math.min(48, freqData.length);
        const time = performance.now() / 1000;
        const cx = width / 2;
        const cy = height / 2;
        for (let i = 0; i < 56; i++) {
          const angle = i * 2.399 + time * (0.12 + energy * 0.8);
          const orbit = Math.min(width, height) * (0.08 + (i % 7) * 0.045 + energy * 0.12);
          const pulse = Math.sin(time * (0.8 + i * 0.025) + i) * 3;
          const x = cx + Math.cos(angle) * (orbit + pulse);
          const y = cy + Math.sin(angle) * (orbit + pulse);
          ctx.globalAlpha = 0.2 + energy * 0.65;
          ctx.fillStyle = i % 5 === 0 ? accent2 : i % 3 === 0 ? accent3 : accent;
          ctx.beginPath();
          ctx.arc(x, y, 1 + energy * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (mode === 'levels') {
        const bands = [
          { label: 'LOW', start: 0, end: 0.08, color: accent },
          { label: 'MID', start: 0.08, end: 0.38, color: accent2 },
          { label: 'HIGH', start: 0.38, end: 0.9, color: accent3 },
        ];
        const margin = 18;
        const gap = 12;
        const bandWidth = (width - margin * 2 - gap * 2) / 3;
        bands.forEach((band, index) => {
          const start = Math.floor(band.start * freqData.length);
          const end = Math.max(start + 1, Math.floor(band.end * freqData.length));
          let total = 0;
          for (let bin = start; bin < end; bin++) total += freqData[bin];
          const level = total / Math.max(1, end - start) / 255;
          const x = margin + index * (bandWidth + gap);
          const barY = height * 0.35;
          const barHeight = Math.max(4, height * 0.26);
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = grid;
          ctx.fillRect(x, barY, bandWidth, barHeight);
          ctx.globalAlpha = 0.86;
          ctx.fillStyle = band.color;
          ctx.fillRect(x, barY, bandWidth * level, barHeight);
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = accent3;
          ctx.font = '11px sans-serif';
          ctx.fillText(band.label, x, barY - 8);
        });
        ctx.globalAlpha = 1;
      } else if (mode === 'steps') {
        const tracks = trackRowsRef.current;
        if (tracks.length === 0) {
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = accent3;
          ctx.font = '12px sans-serif';
          ctx.fillText('Evaluate a track to see its pattern steps', 16, height / 2);
          ctx.globalAlpha = 1;
        }
        const labelWidth = Math.min(112, width * 0.22);
        const rowHeight = (height - 16) / Math.max(1, tracks.length);
        const cellWidth = (width - labelWidth - 12) / 16;
        tracks.forEach((track, row) => {
          const y = 8 + row * rowHeight;
          ctx.fillStyle = accent3;
          ctx.font = '11px sans-serif';
          ctx.globalAlpha = 0.82;
          ctx.fillText(track.name.slice(0, 12), 8, y + Math.min(15, rowHeight * 0.68));
          ctx.globalAlpha = 1;
          for (let step = 0; step < 16; step++) {
            const x = labelWidth + step * cellWidth;
            const activeSlot = track.slots.includes(step);
            ctx.globalAlpha = activeSlot ? 0.78 : 0.12;
            ctx.fillStyle = activeSlot ? accent : grid;
            ctx.fillRect(x, y + 2, Math.max(1, cellWidth - 2), Math.max(4, rowHeight - 5));
            if (step === currentStepRef.current) {
              ctx.globalAlpha = 0.9;
              ctx.strokeStyle = accent2;
              ctx.strokeRect(x, y + 1, Math.max(1, cellWidth - 2), Math.max(5, rowHeight - 3));
            }
          }
          ctx.globalAlpha = 1;
        });
      } else if (mode === 'pianoroll') {
        // Strudel-parity global pianoroll: all tracks' pattern events on a
        // pitch axis, with a cycle playhead.
        const tracks = trackRowsRef.current;
        const playX = (currentStepRef.current + 0.5) / 16;
        let lo = Infinity, hi = -Infinity;
        for (const t of tracks) for (const e of t.events) {
          if (e.lane < lo) lo = e.lane; if (e.lane > hi) hi = e.lane;
        }
        if (!isFinite(lo)) { lo = 36; hi = 60; }
        if (hi === lo) hi = lo + 1;
        ctx.strokeStyle = accent2; ctx.globalAlpha = 0.85; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(playX * width, 0); ctx.lineTo(playX * width, height); ctx.stroke();
        ctx.globalAlpha = 1;
        const palette = [accent, accent2, accent3];
        tracks.forEach((track, ti) => {
          const color = palette[ti % palette.length];
          for (const e of track.events) {
            const frac = (e.lane - lo) / (hi - lo);
            const active = e.offset <= playX && playX < e.offset + Math.max(e.duration, 1 / 32);
            ctx.fillStyle = active ? accent2 : color;
            ctx.globalAlpha = active ? 0.95 : 0.55;
            const x = e.offset * width;
            const w = Math.max(2, e.duration * width);
            const bh = Math.max(3, height / (hi - lo + 1));
            const y = height - frac * height - bh;
            ctx.fillRect(x, y, w - 1, bh - 1);
          }
          ctx.globalAlpha = 1;
        });
        ctx.globalAlpha = 1;
      } else if (mode === 'spiral') {
        // Strudel-parity spiral: pattern events as dots along an Archimedean
        // spiral, rotating with the step playhead.
        const tracks = trackRowsRef.current;
        const playX = (currentStepRef.current + 0.5) / 16;
        const cx = width / 2, cy = height / 2;
        const maxR = Math.min(width, height) / 2 - 6;
        const turns = 3;
        const palette = [accent, accent2, accent3];
        ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath();
        for (let a = 0; a <= turns * Math.PI * 2; a += 0.08) {
          const r = (a / (turns * Math.PI * 2)) * maxR;
          const rot = (currentStepRef.current / 16) * Math.PI * 2;
          const x = cx + Math.cos(a + rot) * r;
          const y = cy + Math.sin(a + rot) * r;
          if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        tracks.forEach((track, ti) => {
          const color = palette[ti % palette.length];
          for (const e of track.events) {
            const a = e.offset * turns * Math.PI * 2 + (currentStepRef.current / 16) * Math.PI * 2;
            const r = maxR * (0.25 + 0.75 * ((e.lane % 36) / 36));
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            const active = e.offset <= playX && playX < e.offset + Math.max(e.duration, 1 / 32);
            ctx.fillStyle = active ? accent2 : color;
            ctx.globalAlpha = active ? 1 : 0.6;
            ctx.beginPath(); ctx.arc(x, y, active ? 3.2 : 2, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        });
        ctx.globalAlpha = 1;
      } else if (mode === 'pitchwheel') {
        // Strudel-parity pitchwheel: pitches on a 12-EDO circle.
        const tracks = trackRowsRef.current;
        const playX = (currentStepRef.current + 0.5) / 16;
        const cx = width / 2, cy = height / 2;
        const radius = Math.min(width, height) / 2 - 10;
        const palette = [accent, accent2, accent3];
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = accent3;
        for (let pc = 0; pc < 12; pc++) {
          const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
          ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        tracks.forEach((track, ti) => {
          const color = palette[ti % palette.length];
          for (const e of track.events) {
            if (e.midi === null) continue;
            const pc = ((e.midi % 12) + 12) % 12;
            const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
            const active = e.offset <= playX && playX < e.offset + Math.max(e.duration, 1 / 32);
            const oct = Math.floor(e.midi / 12);
            const r = radius * (0.45 + 0.55 * ((oct % 4) / 3));
            const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
            ctx.fillStyle = active ? accent2 : color;
            ctx.globalAlpha = active ? 1 : 0.55;
            ctx.beginPath(); ctx.arc(x, y, active ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
            if (active) {
              ctx.strokeStyle = accent2; ctx.globalAlpha = 0.7;
              ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        });
        ctx.globalAlpha = 1;
      }

      frameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      ro?.disconnect();
    };
  }, [mode, transparent, themeId]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={200}
      aria-hidden="true"
      className={className}
      style={transparent ? { opacity } : undefined}
    />
  );
};

interface VisualizerProps {
  mode: VisualizerMode;
  onModeChange: (mode: VisualizerMode) => void;
  overlayEnabled: boolean;
  onOverlayChange: (enabled: boolean) => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (opacity: number) => void;
}

export const Visualizer: React.FC<VisualizerProps> = ({
  mode,
  onModeChange,
  overlayEnabled,
  onOverlayChange,
  overlayOpacity,
  onOverlayOpacityChange,
}) => {
  const overlaySupported = supportsVisualizerOverlay(mode);

  return (
    <div className="relative flex flex-col h-full pg-panel">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 pg-panel-header text-xs">
        <div className="flex items-center gap-2 shrink-0">
          <Activity className="w-3.5 h-3.5" style={{ color: 'var(--pg-accent)' }} />
          <span className="font-medium">Monitor</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <select
            aria-label="Visualizer mode"
            value={mode}
            onChange={(e) => {
              const nextMode = e.target.value as VisualizerMode;
              onModeChange(nextMode);
              if (!supportsVisualizerOverlay(nextMode)) onOverlayChange(false);
            }}
            className="min-w-0 max-w-28 rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--pg-border)', background: 'var(--pg-surface)', color: 'var(--pg-text)' }}
          >
            {MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!overlaySupported}
            aria-pressed={overlayEnabled}
            onClick={() => onOverlayChange(!overlayEnabled)}
            title={overlaySupported ? 'Show this visualizer behind the code editor' : 'Steps view is monitor-only'}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={overlayEnabled
              ? { borderColor: 'var(--pg-accent)', background: 'var(--pg-accent)', color: 'var(--pg-accent-ink)' }
              : { borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
          >
            {overlayEnabled ? <Eye className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
            <span className="hidden xl:inline">Editor</span>
          </button>
          {overlayEnabled && overlaySupported && (
            <input
              type="range"
              aria-label="Editor visualizer opacity"
              min={0.05}
              max={0.45}
              step={0.05}
              value={overlayOpacity}
              onChange={(e) => onOverlayOpacityChange(parseFloat(e.target.value))}
              className="w-14"
            />
          )}
        </div>
      </div>
      <div className="relative flex-1 w-full min-h-0">
        <VisualizerCanvas mode={mode} className="w-full h-full block" />
      </div>
    </div>
  );
};
