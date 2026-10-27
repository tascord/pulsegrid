import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { parseMiniNotation } from '../audio/MiniNotationParser';
import { patternScheduler } from '../audio/PatternScheduler';
import { useTheme } from '../theme/ThemeContext';
import { getThemePalette } from '../theme/themes';
import type { TrackVizWidget } from '../types/music';

interface InlineVizProps {
  trackId: string;
  trackName: string;
  widget: TrackVizWidget;
}

/** MIDI pitch for note tokens; null for samples/rests. */
export function tokenToMidi(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === '~' || t === '-' || t === '_') return null;
  const nMatch = t.match(/^(n:|note:)?(-?\d+)$/);
  if (nMatch) {
    const v = parseInt(nMatch[2], 10);
    return isFinite(v) ? v : null;
  }
  const m = t.match(/^([a-g])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let semi = base[m[1]];
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  return (parseInt(m[3], 10) + 1) * 12 + semi;
}

/** Stable lane for non-pitched tokens (samples), kept below piano range. */
export function tokenLane(token: string): number {
  const midi = tokenToMidi(token);
  if (midi !== null) return midi;
  let h = 0;
  const s = token.split(':')[0].toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 24;
  return 24 + h;
}

function resolveNotation(trackId: string): string {
  const track = patternScheduler.getEvaluatedTracks().find((t) => t.id === trackId);
  const source = track?.patternName || '~';
  const shared = patternScheduler.getSharedPatterns();
  return shared[source.toLowerCase()] || source;
}



/**
 * Inline per-track visualization widget (Strudel `_pianoroll` / `_spiral` /
 * `_scope` / `_spectrum` / `_pitchwheel` parity). Renders as a block canvas
 * below the code line, like Strudel's CodeMirror block widgets.
 */
export const InlineViz: React.FC<InlineVizProps> = ({ trackId, trackName, widget }) => {
  const { themeId } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepRef = useRef(0);
  const [, setTrackVersion] = useState(0);

  useEffect(() => patternScheduler.subscribeStep((step) => { stepRef.current = step; }), []);
  useEffect(() => patternScheduler.subscribeTracks(() => setTrackVersion((v) => v + 1)), []);

  const type = widget.type;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Synchronous lookup by theme id — a getComputedStyle snapshot here
    // would read the previous theme (child effects run before ThemeProvider
    // applies the new CSS vars), lagging one theme change behind.
    const pal = getThemePalette(themeId);
    const W = canvas.width;
    const H = canvas.height;
    let raf = 0;
    let timeData = new Uint8Array(128);
    let freqData = new Uint8Array(128);

    const patternEvents = () => {
      try {
        return parseMiniNotation(resolveNotation(trackId), 0, 1);
      } catch {
        return [];
      }
    };

    const render = () => {
      const analyser = audioEngine.getTrackAnalyser(trackId);
      if (analyser) {
        if (timeData.length !== analyser.frequencyBinCount) {
          timeData = new Uint8Array(analyser.frequencyBinCount);
          freqData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);
      }
      const step = stepRef.current;
      const playX = (step + 0.5) / 16;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);

      if (type === 'scope') {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
        if (analyser) {
          ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.2; ctx.beginPath();
          for (let i = 0; i < timeData.length; i++) {
            const x = (i / (timeData.length - 1)) * W;
            const y = ((timeData[i] - 128) / 128) * (H / 2 - 2) + H / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else if (type === 'spectrum' || type === 'fscope') {
        // Scrolling spectrum column (Strudel `spectrum`), static bars for `fscope`.
        if (type === 'spectrum') {
          ctx.drawImage(canvas, -2, 0);
          ctx.clearRect(W - 2, 0, 2, H);
          for (let y = 0; y < H; y++) {
            const ratio = 1 - y / H;
            const bin = Math.min(freqData.length - 1, Math.floor(ratio * ratio * freqData.length));
            const mag = freqData[bin] / 255;
            if (mag < 0.03) continue;
            ctx.globalAlpha = Math.min(0.9, mag * 1.4);
            ctx.fillStyle = mag > 0.62 ? pal.accent2 : mag > 0.28 ? pal.accent : pal.accent3;
            ctx.fillRect(W - 2, y, 2, 1);
          }
          ctx.globalAlpha = 1;
        } else {
          const bands = 48;
          const bw = W / bands;
          for (let i = 0; i < bands; i++) {
            const bin = Math.min(freqData.length - 1, Math.floor(Math.pow(i / bands, 1.6) * freqData.length));
            const mag = freqData[bin] / 255;
            const bh = Math.max(1, mag * (H - 4));
            ctx.fillStyle = mag > 0.62 ? pal.accent2 : pal.accent;
            ctx.fillRect(i * bw + 1, H - bh, Math.max(1, bw - 2), bh);
          }
        }
      } else if (type === 'pianoroll' || type === 'punchcard' || type === 'wordfall') {
        const events = patternEvents().filter((e) => e.value.trim() !== '~' && e.value.trim() !== '-' && e.value.trim() !== '_');
        const vertical = type === 'wordfall';
        const fold = type !== 'pianoroll';
        const lanes = fold
          ? [...new Set(events.map((e) => tokenLane(e.value)))].sort((a, b) => a - b)
          : null;
        let lo = Infinity, hi = -Infinity;
        for (const e of events) {
          const v = tokenLane(e.value);
          if (v < lo) lo = v; if (v > hi) hi = v;
        }
        if (!isFinite(lo)) { lo = 36; hi = 60; }
        if (hi === lo) hi = lo + 1;
        const laneCount = fold ? Math.max(1, lanes!.length) : hi - lo + 1;

        // Playhead
        ctx.strokeStyle = pal.accent2; ctx.globalAlpha = 0.85; ctx.lineWidth = 1;
        ctx.beginPath();
        if (vertical) { ctx.moveTo(0, playX * H); ctx.lineTo(W, playX * H); }
        else { ctx.moveTo(playX * W, 0); ctx.lineTo(playX * W, H); }
        ctx.stroke(); ctx.globalAlpha = 1;

        for (const e of events) {
          const v = tokenLane(e.value);
          const laneIdx = fold ? lanes!.indexOf(v) : v - lo;
          const frac = laneCount <= 1 ? 0.5 : laneIdx / laneCount;
          const active = e.offset <= playX && playX < e.offset + Math.max(e.duration, 1 / 32);
          ctx.fillStyle = active ? pal.accent2 : pal.accent;
          ctx.globalAlpha = active ? 0.95 : 0.55;
          if (vertical) {
            const y = e.offset * H;
            const hh = Math.max(2, e.duration * H);
            const bw = W / Math.max(1, laneCount);
            const x = frac * W;
            ctx.fillRect(x + 1, y, Math.max(2, bw - 2), hh - 1);
            if (widget.options?.labels) {
              ctx.globalAlpha = 0.9; ctx.fillStyle = pal.accent3; ctx.font = '9px monospace';
              ctx.fillText(e.value, x + 3, y + 9);
              ctx.fillStyle = active ? pal.accent2 : pal.accent;
            }
          } else {
            const x = e.offset * W;
            const ww = Math.max(2, e.duration * W);
            const bh = H / Math.max(1, laneCount);
            const y = H - (frac * H) - bh;
            ctx.fillRect(x, y, ww - 1, Math.max(2, bh - 1));
            if (widget.options?.labels) {
              ctx.globalAlpha = 0.9; ctx.fillStyle = pal.accent3; ctx.font = '9px monospace';
              ctx.fillText(e.value, x + 2, y + 9);
            }
          }
          ctx.globalAlpha = 1;
        }
      } else if (type === 'spiral') {
        const events = patternEvents();
        const cx = W / 2, cy = H / 2;
        const maxR = Math.min(W, H) / 2 - 6;
        const turns = 3;
        // Faint spiral guide
        ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.beginPath();
        for (let a = 0; a <= turns * Math.PI * 2; a += 0.1) {
          const r = (a / (turns * Math.PI * 2)) * maxR;
          const rot = (stepRef.current / 16) * Math.PI * 2;
          const x = cx + Math.cos(a + rot) * r;
          const y = cy + Math.sin(a + rot) * r;
          if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Event dots along the spiral
        for (const e of events) {
          const a = e.offset * turns * Math.PI * 2 + (stepRef.current / 16) * Math.PI * 2;
          const v = tokenLane(e.value);
          const r = maxR * (0.25 + 0.75 * ((v % 36) / 36));
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          const active = e.offset <= playX && playX < e.offset + Math.max(e.duration, 1 / 32);
          ctx.fillStyle = active ? pal.accent2 : pal.accent;
          ctx.globalAlpha = active ? 1 : 0.6;
          ctx.beginPath(); ctx.arc(x, y, active ? 3.4 : 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Playhead dot
        {
          const a = playX * turns * Math.PI * 2 + (stepRef.current / 16) * Math.PI * 2;
          const x = cx + Math.cos(a) * maxR, y = cy + Math.sin(a) * maxR;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      } else if (type === 'pitchwheel') {
        const events = patternEvents();
        const cx = W / 2, cy = H / 2;
        const radius = Math.min(W, H) / 2 - 12;
        ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
        // 12 EDO markers
        ctx.fillStyle = pal.accent3; ctx.font = '8px monospace';
        for (let pc = 0; pc < 12; pc++) {
          const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
          ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        for (const e of events) {
          const midi = tokenToMidi(e.value);
          if (midi === null) continue;
          const pc = ((midi % 12) + 12) % 12;
          const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
          const active = e.offset <= playX && playX < e.offset + Math.max(e.duration, 1 / 32);
          const oct = Math.floor(midi / 12);
          const r = radius * (0.45 + 0.55 * ((oct % 4) / 3));
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          ctx.fillStyle = active ? pal.accent2 : pal.accent;
          ctx.globalAlpha = active ? 1 : 0.55;
          ctx.beginPath(); ctx.arc(x, y, active ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
          if (active) {
            ctx.strokeStyle = pal.accent2; ctx.globalAlpha = 0.7;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      } else if (type === 'meter') {
        const peak = audioEngine.getTrackPeak(trackId);
        ctx.fillStyle = pal.grid;
        ctx.fillRect(0, H / 2 - 4, W, 8);
        ctx.fillStyle = peak > 0.85 ? pal.accent2 : pal.accent;
        ctx.fillRect(0, H / 2 - 4, W * Math.min(1, peak), 8);
      }

      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [trackId, type, themeId, JSON.stringify(widget.options)]);

  const isStrip = type !== 'spiral' && type !== 'pitchwheel';
  return (
    <span
      className="pg-inline-viz inline-flex items-center gap-1.5 ml-3 align-middle select-none font-mono text-[10px]"
      style={{ pointerEvents: 'auto' }}
      title={`${trackName} · ${type}${widget.options ? ` ${JSON.stringify(widget.options)}` : ''}`}
    >
      <span className="pg-faint">{type}</span>
      <canvas
        ref={canvasRef}
        width={isStrip ? 320 : 120}
        height={isStrip ? 36 : 120}
        className="block"
        style={{ width: isStrip ? 200 : 72, height: isStrip ? 22 : 72 }}
        aria-hidden="true"
      />
    </span>
  );
};
