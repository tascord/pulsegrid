import React, { useRef, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { useTheme } from '../theme/ThemeContext';
import { getThemePalette } from '../theme/themes';

interface InlineScopeProps {
  trackId: string;
  trackName: string;
}

export const InlineScope: React.FC<InlineScopeProps> = ({
  trackId,
  trackName,
}) => {
  const { themeId } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Synchronous lookup by theme id — a getComputedStyle snapshot here
    // would read the previous theme (child effects run before ThemeProvider
    // applies the new CSS vars), lagging one theme change behind.
    const pal = getThemePalette(themeId);
    const editorBg = pal.bg;
    const accent = pal.accent;
    let timeData = new Uint8Array(128);

    const render = () => {
      const analyser = audioEngine.getTrackAnalyser(trackId);
      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = editorBg;
      ctx.fillRect(0, 0, width, height);

      // Center guide line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      if (analyser) {
        if (timeData.length !== analyser.frequencyBinCount) {
          timeData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteTimeDomainData(timeData);

        ctx.lineWidth = 1;
        ctx.strokeStyle = accent;

        ctx.beginPath();
        const sliceWidth = width / timeData.length;
        let x = 0;

        for (let i = 0; i < timeData.length; i++) {
          const v = timeData[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);

          x += sliceWidth;
        }

        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [trackId, themeId]);

  return (
    <span className="pg-inline-scope inline-flex h-4 w-44 max-w-[35vw] items-center gap-1.5 ml-3 align-middle select-none font-mono text-[10px]">
      <Activity className="w-3 h-3 shrink-0" style={{ color: 'var(--pg-accent)' }} />
      <span className="max-w-14 truncate text-neutral-400">{trackName}</span>
      <canvas ref={canvasRef} width={160} height={16} className="min-w-0 flex-1 h-4 block" aria-hidden="true" />
    </span>
  );
};
