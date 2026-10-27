import React, { useEffect, useRef, useState } from 'react';
import { patternScheduler } from '../audio/PatternScheduler';
import { useTheme } from '../theme/ThemeContext';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

interface Streak {
  x: number;
  y: number;
  vx: number;
  life: number;
  maxLife: number;
  len: number;
  width: number;
  color: string;
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  tri: boolean;
}

interface GlitchBar {
  id: number;
  topPct: number;
  heightPx: number;
  color: string;
  shiftPx: number;
}

interface Floater {
  id: number;
  text: string;
  xPct: number;
  yPct: number;
  color: string;
  size: number;
}

interface LineFlash {
  id: number;
  yPct: number;
  hPct: number;
  color: string;
}

interface ComboGhost {
  id: number;
  n: number;
  dx: number;
  dy: number;
  rot: number;
}

interface ComboMilestone {
  n: number;
  key: number;
}

interface Props {
  /** Current editor code, used to locate the line that triggered. */
  code: string;
  /** Called when a beat/step fires and beat-pulse is on (parent flashes frame). */
  onBeatPulse?: () => void;
  /** Called on strong hits when screenFlash/shake are on. */
  onImpact?: (strong: boolean) => void;
}

function readCssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Kicks / bass / low toms count as "strong" hits for flash + shake. */
function isStrongHit(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^(bd|kick|bass|sub|808|boom|dnb|amen)([:_]|$)/.test(v)
    || /^c[0-2][#b]?$/.test(v.replace(/[*@/\d!?.]+$/, ''))
    || /^(bd|kick)/.test(v);
}

/** Hats / snares / clicks get streaks; kicks + bass stay out of the streak lane. */
function isStreakHit(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^(hh|oh|hat|cp|sn|sd|rim|clap|perc|shaker|tick|click)/.test(v);
}

let floaterId = 0;
let lineFlashId = 0;
let glitchId = 0;
let comboGhostId = 0;
const MAX_COMBO_GHOSTS = 3;

/**
 * Milestone interval grows by powers of ten as the streak climbs:
 * every 10 through 2-digit streaks, every 100 through 3-digit, every
 * 1000 beyond that, … — so bursts get rarer and bigger as you go.
 */
function comboMilestoneInterval(n: number): number {
  if (n < 10) return Number.POSITIVE_INFINITY;
  const digits = String(Math.floor(Math.abs(n))).length;
  return Math.pow(10, digits - 1);
}

function isComboMilestone(n: number): boolean {
  if (n < 10) return false;
  const step = comboMilestoneInterval(n);
  return n % step === 0;
}
const MAX_PARTICLES = 900;
const MAX_FLOATERS = 8;
const MAX_RINGS = 24;
const MAX_STREAKS = 32;
const MAX_SHARDS = 180;
const MAX_LINE_FLASHES = 6;

export const EventFxOverlay: React.FC<Props> = ({ code, onBeatPulse, onImpact }) => {
  const { eventFx } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyFillRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const streaksRef = useRef<Streak[]>([]);
  const shardsRef = useRef<Shard[]>([]);
  const energyRef = useRef(0);
  const comboRef = useRef({ count: 0, timer: 0 });
  const milestoneKey = useRef(0);
  const comboAnchorRef = useRef<HTMLDivElement>(null);
  const lastEdgeBeatAt = useRef(0);
  const lastEdgeHitAt = useRef(0);
  const lastGlitchAt = useRef(0);
  const rafRef = useRef(0);
  const codeRef = useRef(code);
  const fxRef = useRef(eventFx);
  // Cached paint values — read once per theme change, never per event
  // (getComputedStyle per trigger forces sync layout on the audio thread).
  const colorsRef = useRef({ accent: '#6cdbb6', accent2: '#e6b96f', accent3: '#a9c8df', lineH: 25 });
  const lastFloaterAt = useRef(0);
  const lastLineFlashAt = useRef(0);
  // Active sustain-emission intervals for held notes (capped; cleared on unmount).
  const sustainTimers = useRef<Set<number>>(new Set());
  const MAX_SUSTAINS = 8;
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [lineFlashes, setLineFlashes] = useState<LineFlash[]>([]);
  const [glitchBars, setGlitchBars] = useState<GlitchBar[]>([]);
  const [combo, setCombo] = useState({ n: 0, key: 0 });
  const [comboGhosts, setComboGhosts] = useState<ComboGhost[]>([]);
  const [milestone, setMilestone] = useState<ComboMilestone | null>(null);
  const [washKey, setWashKey] = useState(0);
  const [bloomKey, setBloomKey] = useState(0);
  const [glitchKey, setGlitchKey] = useState(0);

  codeRef.current = code;
  fxRef.current = eventFx;

  // Refresh cached colors when the theme / fx settings change.
  useEffect(() => {
    colorsRef.current = {
      accent: readCssVar('--pg-accent', '#6cdbb6'),
      accent2: readCssVar('--pg-accent-2', '#e6b96f'),
      accent3: readCssVar('--pg-accent-3', '#a9c8df'),
      lineH: parseFloat(readCssVar('--pg-editor-lh', '25')) || 25,
    };
  }, [eventFx]);

  // Canvas sizing: match displayed size at DPR 1 (DPR 2 doubles fill cost
  // for sparks nobody can tell apart on a code editor).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const fit = () => {
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Energy bar decay: direct DOM writes, no React state per frame.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (energyRef.current <= 0.005) {
        if (energyRef.current !== 0) {
          energyRef.current = 0;
          if (energyFillRef.current) {
            energyFillRef.current.style.transform = 'scaleX(0)';
            energyFillRef.current.style.opacity = '0';
          }
        }
        return;
      }
      energyRef.current *= 0.9;
      if (energyFillRef.current) {
        energyFillRef.current.style.transform = `scaleX(${energyRef.current.toFixed(3)})`;
        energyFillRef.current.style.opacity = energyRef.current > 0.03 ? '1' : '0';
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  const bumpEnergy = (amount: number) => {
    energyRef.current = Math.min(1, energyRef.current + amount);
    if (energyFillRef.current) {
      energyFillRef.current.style.transform = `scaleX(${energyRef.current.toFixed(3)})`;
      energyFillRef.current.style.opacity = '1';
    }
  };

  // On-demand render loop: runs only while particles/rings/streaks are alive,
  // pauses when the tab is hidden. No shadowBlur — plain arcs, no per-frame
  // allocations.
  const ensureLoop = () => {
    if (rafRef.current) return;
    const tick = () => {
      rafRef.current = 0;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const parts = particlesRef.current;
      const rings = ringsRef.current;
      const streaks = streaksRef.current;
      const shards = shardsRef.current;
      if (!canvas || !ctx || (parts.length === 0 && rings.length === 0 && streaks.length === 0 && shards.length === 0)) {
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      if (document.hidden) {
        parts.length = 0;
        rings.length = 0;
        streaks.length = 0;
        shards.length = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= 1 / 60;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035;
        p.vx *= 0.992;
        const t = p.life / p.maxLife;
        ctx.globalAlpha = t < 0.7 ? t / 0.7 : 1;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      // Shockwave rings: expanding stroked circles, ease-out + fade.
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life -= 1 / 60;
        if (r.life <= 0) {
          rings.splice(i, 1);
          continue;
        }
        const t = 1 - r.life / r.maxLife;
        const eased = 1 - (1 - t) * (1 - t);
        const radius = r.r + (r.maxR - r.r) * eased;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(0.6, r.width * (1 - t));
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Light streaks: fast horizontal dashes with fading tails.
      ctx.lineCap = 'round';
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i];
        s.life -= 1 / 60;
        if (s.life <= 0) {
          streaks.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        s.vx *= 0.985;
        const t = s.life / s.maxLife;
        ctx.globalAlpha = Math.min(1, t * 1.6) * 0.9;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(s.x - s.len, s.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      // Shards: spinning diamonds + triangles with gravity tumble.
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= 1 / 60;
        if (s.life <= 0) {
          shards.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.09;
        s.vx *= 0.988;
        s.rot += s.vr;
        const t = s.life / s.maxLife;
        ctx.globalAlpha = Math.min(1, t * 1.8);
        ctx.fillStyle = s.color;
        const r = s.size * (0.5 + t * 0.5);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        if (s.tri) {
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.lineTo(r * 0.9, r * 0.75);
          ctx.lineTo(-r * 0.9, r * 0.75);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.lineTo(r * 0.7, 0);
          ctx.lineTo(0, r);
          ctx.lineTo(-r * 0.7, 0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (parts.length > 0 || rings.length > 0 || streaks.length > 0 || shards.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    sustainTimers.current.forEach((id) => clearInterval(id));
    sustainTimers.current.clear();
  }, []);

  // Keep particles trickling from the token while a long note is held.
  // Chunky by design: several sparks per 90ms tick, capped sustains + ticks.
  const startSustain = (x: number, y: number, palette: string[], strong: boolean, durationSec: number) => {
    if (durationSec < 0.35) return;
    if (sustainTimers.current.size >= MAX_SUSTAINS) return;
    const perTick = strong ? 5 : 2;
    const endAt = performance.now() + Math.min(durationSec, 4) * 1000;
    const id = window.setInterval(() => {
      const fx = fxRef.current;
      if (!fx.enabled || !fx.particles || performance.now() >= endAt) {
        clearInterval(id);
        sustainTimers.current.delete(id);
        return;
      }
      spawnBurst(x, y, palette, perTick, 1.6, 0.5);
    }, 90);
    sustainTimers.current.add(id);
  };

  const spawnBurst = (x: number, y: number, colors: string[], count: number, speed: number, spread = 0.55) => {
    const parts = particlesRef.current;
    const room = Math.max(0, MAX_PARTICLES - parts.length);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      // Upward jet out of the note: narrow cone around straight-up (-Y),
      // not a radial firework. Less spread = tight fountain.
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * spread;
      const v = (0.7 + Math.random() * 1.0) * speed;
      const life = 0.55 + Math.random() * 0.75;
      parts.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 4 - 2,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.4,
        life,
        maxLife: life,
        size: 1.6 + Math.random() * 3.4,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
    if (n > 0) ensureLoop();
  };

  /** Radial explosion: full-circle sparks that stay concentric with rings. */
  const spawnRadial = (x: number, y: number, colors: string[], count: number, speed: number) => {
    const parts = particlesRef.current;
    const room = Math.max(0, MAX_PARTICLES - parts.length);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.5 + Math.random() * 1.0) * speed;
      const life = 0.6 + Math.random() * 0.8;
      parts.push({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        maxLife: life,
        size: 1.6 + Math.random() * 3.2,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
    if (n > 0) ensureLoop();
  };

  const spawnRing = (x: number, y: number, color: string, strong: boolean, amount01: number) => {
    const rings = ringsRef.current;
    if (rings.length >= MAX_RINGS) rings.shift();
    const maxR = (strong ? 64 : 38) * (0.5 + amount01);
    rings.push({
      x, y,
      r: 6,
      maxR,
      life: strong ? 0.55 : 0.42,
      maxLife: strong ? 0.55 : 0.42,
      color,
      width: strong ? 3.2 : 2,
    });
    ensureLoop();
  };

  const spawnStreak = (x: number, y: number, color: string, canvasW: number) => {
    const streaks = streaksRef.current;
    if (streaks.length >= MAX_STREAKS) streaks.shift();
    const dir = Math.random() < 0.5 ? -1 : 1;
    // Start at the token so the dash visibly leaves the note behind.
    streaks.push({
      x, y: y + (Math.random() - 0.5) * 10,
      vx: dir * (7 + Math.random() * 6) * Math.min(1.4, Math.max(0.7, canvasW / 700)),
      life: 0.5 + Math.random() * 0.25,
      maxLife: 0.7,
      len: 46 + Math.random() * 60,
      width: 1.4 + Math.random() * 1.4,
      color,
    });
    ensureLoop();
  };

  const spawnShards = (x: number, y: number, colors: string[], count: number, strong: boolean) => {
    const shards = shardsRef.current;
    const room = Math.max(0, MAX_SHARDS - shards.length);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * (strong ? 1.1 : 0.8);
      const v = (1.2 + Math.random() * 2.2) * (strong ? 1.5 : 1);
      const life = 0.6 + Math.random() * 0.7;
      shards.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        life,
        maxLife: life,
        size: 2.5 + Math.random() * (strong ? 5 : 3.5),
        color: colors[(Math.random() * colors.length) | 0],
        tri: Math.random() < 0.4,
      });
    }
    if (n > 0) ensureLoop();
  };

  /** Inset edge glow via WAAPI: breathe on beats, slam on strong hits. */
  const pulseEdge = (strong: boolean) => {
    const el = edgeRef.current;
    if (!el) return;
    const now = performance.now();
    const throttle = strong ? 80 : 160;
    const last = strong ? lastEdgeHitAt.current : lastEdgeBeatAt.current;
    if (now - last < throttle) return;
    if (strong) lastEdgeHitAt.current = now;
    else lastEdgeBeatAt.current = now;
    const peak = strong ? 0.85 : 0.4;
    el.animate(
      [
        { opacity: '0' },
        { opacity: String(peak) },
        { opacity: '0' },
      ],
      { duration: strong ? 380 : 300, easing: 'ease-out' },
    );
  };

  const fireGlitch = (strong: boolean) => {
    const now = performance.now();
    if (now - lastGlitchAt.current < 110) return;
    lastGlitchAt.current = now;
    const { accent2 } = colorsRef.current;
    const bars: GlitchBar[] = [];
    const n = strong ? 3 : 2;
    for (let i = 0; i < n; i++) {
      bars.push({
        id: ++glitchId,
        topPct: Math.random() * 92,
        heightPx: 2 + Math.random() * (strong ? 9 : 5),
        color: Math.random() < 0.5 ? accent2 : '#f07878',
        shiftPx: (Math.random() - 0.5) * (strong ? 26 : 12),
      });
    }
    setGlitchBars(bars);
    setGlitchKey((k) => k + 1);
    setTimeout(() => setGlitchBars([]), 240);
  };

  /** Big celebration burst for round-number milestones. Scales with tier. */
  const fireComboMilestone = (n: number) => {
    const fx = fxRef.current;
    const { accent, accent2, accent3 } = colorsRef.current;
    const palette = [accent2, accent, accent3];
    const host = canvasRef.current?.parentElement;
    const rect = host?.getBoundingClientRect();
    // Anchor the burst to the readout's real position — never estimated, so
    // rings stay concentric with the badge at any layout or panel size.
    const anchor = comboAnchorRef.current?.getBoundingClientRect();
    let cx: number;
    let cy: number;
    if (anchor && rect && anchor.width > 0) {
      cx = anchor.left - rect.left + anchor.width * 0.35;
      cy = anchor.top - rect.top + anchor.height + 44;
    } else {
      const w = rect?.width || 600;
      const h = rect?.height || 400;
      cx = w - Math.min(190, w * 0.22);
      cy = Math.max(70, h * 0.18);
    }
    const tier = Math.max(1, String(n).length - 1); // 1=tens, 2=hundreds, …
    const scale = Math.min(3, tier);

    // Canvas FX fire even if the user disabled the ambient variants — the
    // milestone is the payoff moment. Respect only the master switch.
    // Radial core keeps sparks concentric with the rings (upward fountains
    // drift off-centre); the small side jets are accents, not the main mass.
    if (!fx.enabled) return;
    spawnRadial(cx, cy, palette, Math.round(60 * scale), 3.4 + scale * 0.8);
    spawnBurst(cx - 46, cy + 20, palette, Math.round(12 * scale), 3.2, 0.9);
    spawnBurst(cx + 46, cy + 20, palette, Math.round(12 * scale), 3.2, 0.9);
    spawnRing(cx, cy, accent2, true, Math.min(1, 0.6 + scale * 0.2));
    spawnRing(cx, cy, accent, true, Math.min(1, 0.5 + scale * 0.15));
    spawnShards(cx, cy, palette, Math.round(16 * scale), true);
    pulseEdge(true);
    setBloomKey((k) => k + 1);
    const key = (milestoneKey.current += 1);
    setMilestone({ n, key });
    window.setTimeout(() => {
      // Clear only if no newer milestone replaced it.
      setMilestone((cur) => (cur && cur.key === key ? null : cur));
    }, 1500);
  };

  const bumpCombo = () => {
    const c = comboRef.current;
    const prev = c.count;
    c.count += 1;
    const next = c.count;
    window.clearTimeout(c.timer);
    c.timer = window.setTimeout(() => {
      c.count = 0;
      setCombo((p) => ({ n: 0, key: p.key }));
      setComboGhosts([]);
      setMilestone(null);
    }, 1400);
    if (next < 2) return;
    // Sonner-style stack: the old number detaches and scatters like a
    // particle while the new one punches in place. Full radial scatter
    // (not one fixed direction) so rapid rolls spray outward and clear the
    // readout instead of piling into a blob. Tight cap for the same reason.
    if (prev >= 2) {
      const id = ++comboGhostId;
      const ang = -Math.PI / 2 + (Math.random() * 2 - 1) * 1.9;
      const dist = 70 + Math.random() * 80;
      const ghost: ComboGhost = {
        id,
        n: prev,
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist,
        rot: (Math.random() - 0.3) * 40,
      };
      setComboGhosts((g) => [...g.slice(-(MAX_COMBO_GHOSTS - 1)), ghost]);
      window.setTimeout(() => {
        setComboGhosts((g) => g.filter((x) => x.id !== id));
      }, 700);
    }
    setCombo((p) => ({ n: next, key: p.key + 1 }));
    if (isComboMilestone(next)) fireComboMilestone(next);
  };

  const addFloater = (text: string, xPct: number, yPct: number, color: string, size: number) => {
    const now = performance.now();
    if (now - lastFloaterAt.current < 90) return;
    lastFloaterAt.current = now;
    const id = ++floaterId;
    const f: Floater = { id, text, xPct, yPct, color, size };
    setFloaters((prev) => [...prev.slice(-(MAX_FLOATERS - 1)), f]);
    setTimeout(() => setFloaters((prev) => prev.filter((p) => p.id !== id)), 900);
  };

  const addLineFlash = (yPct: number, hPct: number, color: string) => {
    const now = performance.now();
    if (now - lastLineFlashAt.current < 45) return;
    lastLineFlashAt.current = now;
    const id = ++lineFlashId;
    const f: LineFlash = { id, yPct, hPct, color };
    setLineFlashes((prev) => [...prev.slice(-(MAX_LINE_FLASHES - 1)), f]);
    setTimeout(() => setLineFlashes((prev) => prev.filter((p) => p.id !== id)), 480);
  };

  // Resolve the on-screen centre of the flashing token that fired this
  // event, in overlay-local coordinates. Prefers the real `.pg-tok-flash`
  // DOM node (exact, scroll-aware via getBoundingClientRect); falls back to
  // a scroll-aware line estimate when the flash hasn't rendered yet.
  const resolveTokenPoint = (ev: { trackId: string; value: string; notation: string }): { x: number; y: number; w: number; h: number } | null => {
    const layer = canvasRef.current?.parentElement;
    if (!layer) return null;
    const overlayRect = layer.getBoundingClientRect();
    const w = overlayRect.width || 600;
    const h = overlayRect.height || 400;
    // Overlay is position:fixed-to-viewport (absolute inset-0 in a
    // non-scrolling box), so viewport-relative rects map directly.
    const scroller = layer.parentElement?.parentElement as HTMLElement | null;
    const highlight = (scroller?.querySelector('.pg-editor-lines') as HTMLElement | null)
      || (document.querySelector('.pg-editor-lines') as HTMLElement | null);
    const want = ev.value.trim().toLowerCase();
    if (highlight) {
      const flashes = highlight.querySelectorAll('.pg-tok-flash');
      for (let i = 0; i < flashes.length; i++) {
        const el = flashes[i] as HTMLElement;
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === want || (want && text.includes(want)) || (text && want.includes(text))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          return {
            x: r.left - overlayRect.left + r.width / 2,
            y: r.top - overlayRect.top + r.height / 2,
            w, h,
          };
        }
      }
      // No text match (flash renders a frame later) — use first visible flash.
      if (flashes.length > 0) {
        const el = flashes[0] as HTMLElement;
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          return {
            x: r.left - overlayRect.left + r.width / 2,
            y: r.top - overlayRect.top + r.height / 2,
            w, h,
          };
        }
      }
    }
    // Fallback: line estimate, corrected for the real scroll offset.
    const { lineH } = colorsRef.current;
    const lines = codeRef.current.split('\n');
    let lineIdx = lines.findIndex((l) => {
      const probe = ev.notation.slice(0, 24);
      return probe ? l.includes(probe) : false;
    });
    if (lineIdx < 0) {
      lineIdx = lines.findIndex((l) => l.includes(`"${ev.trackId}"`) || l.includes(`'${ev.trackId}'`));
    }
    if (lineIdx < 0) lineIdx = Math.floor(lines.length / 2);
    const scrollTop = scroller?.scrollTop || 0;
    return {
      x: w * 0.5,
      y: Math.min(h - 20, Math.max(16, 12 + lineIdx * lineH + lineH / 2 - scrollTop)),
      w, h,
    };
  };

  // Subscribe to live trigger events + step pulse.
  useEffect(() => {
    const unsubEvent = patternScheduler.subscribeEvent((ev) => {
      const fx = fxRef.current;
      if (!fx.enabled) return;
      if (!fx.particles && !fx.floaters && !fx.screenFlash && !fx.shake
        && !fx.shockwaves && !fx.streaks && !fx.lineFlash && !fx.energyBar
        && !fx.shards && !fx.edgeGlow && !fx.bassBloom && !fx.glitchBars && !fx.comboCounter) return;

      const strong = isStrongHit(ev.value);
      if (fx.screenFlash && strong) {
        setWashKey((k) => k + 1);
        onImpact?.(true);
      } else if (fx.shake && strong) {
        onImpact?.(true);
      }
      if (fx.bassBloom && strong) setBloomKey((k) => k + 1);
      if (fx.edgeGlow && strong) pulseEdge(true);
      if (fx.glitchBars && strong) fireGlitch(true);
      else if (fx.glitchBars && Math.random() < 0.06) fireGlitch(false);
      if (fx.energyBar) bumpEnergy(strong ? 0.3 : 0.1);
      if (fx.comboCounter) bumpCombo();
      if (!fx.particles && !fx.floaters && !fx.shockwaves && !fx.streaks && !fx.lineFlash && !fx.shards) return;

      // Defer one frame so the `.pg-tok-flash` span has rendered — then the
      // burst lands exactly on the note text that made it.
      requestAnimationFrame(() => {
        const fxNow = fxRef.current;
        if (!fxNow.enabled) return;
        const pt = resolveTokenPoint(ev);
        if (!pt) return;
        const { accent, accent2, accent3, lineH } = colorsRef.current;
        const colors = [accent, accent2, accent3];
        if (fxNow.particles) {
          const density = fxNow.particleAmount / 100;
          const palette = strong ? [accent2, accent, accent3] : colors;
          // Cranked by design: ~8–12 sparks normally, ~30–50 on kicks at 100%.
          // Jets shoot up out of the note: strong hits faster + slightly wider.
          const count = Math.round((strong ? 28 : 12) * (0.35 + density * 1.65));
          if (count > 0) spawnBurst(pt.x, pt.y, palette, count, strong ? 4.6 : 3.0, strong ? 0.7 : 0.45);
          // Held notes keep erupting for their sounding duration.
          startSustain(pt.x, pt.y, palette, strong, ev.duration || 0);
        }
        if (fxNow.shockwaves && (strong || Math.random() < 0.45)) {
          spawnRing(pt.x, pt.y, strong ? accent2 : accent, strong, fxNow.shockwaveAmount / 100);
        }
        if (fxNow.streaks && (isStreakHit(ev.value) || (!strong && Math.random() < 0.3))) {
          spawnStreak(pt.x, pt.y, strong ? accent2 : accent3, pt.w);
        }
        if (fxNow.shards) {
          const density = fxNow.shardAmount / 100;
          const count = Math.round((strong ? 14 : 6) * (0.35 + density * 1.65));
          if (count > 0 && (strong || Math.random() < 0.5)) {
            spawnShards(pt.x, pt.y, strong ? [accent2, accent, accent3] : colors, count, strong);
          }
        }
        if (fxNow.lineFlash) {
          addLineFlash(
            ((pt.y - lineH / 2) / Math.max(1, pt.h)) * 100,
            (lineH / Math.max(1, pt.h)) * 100,
            strong ? accent2 : accent,
          );
        }
        if (fxNow.floaters) {
          const label = ev.value.length > 12 ? ev.value.slice(0, 12) : ev.value;
          addFloater(label, (pt.x / Math.max(1, pt.w)) * 100, (pt.y / Math.max(1, pt.h)) * 100, strong ? accent2 : accent, strong ? 13 : 11);
        }
      });
    });

    const unsubStep = patternScheduler.subscribeStep(() => {
      const fx = fxRef.current;
      if (!fx.enabled) return;
      if (fx.beatPulse) onBeatPulse?.();
      if (fx.energyBar) bumpEnergy(0.05);
      if (fx.edgeGlow) pulseEdge(false);
    });

    const handlePreview = () => {
      const fx = fxRef.current;
      if (!fx.enabled) return;
      const { accent, accent2, accent3, lineH } = colorsRef.current;
      const host = canvasRef.current?.parentElement;
      const rect = host?.getBoundingClientRect();
      const w = rect?.width || 600;
      const h = rect?.height || 400;
      if (fx.particles) {
        const density = fx.particleAmount / 100;
        spawnBurst(w / 2, h / 2, [accent, accent2, accent3], Math.round(28 * (0.35 + density * 1.65)), 4.2, 0.6);
      }
      if (fx.shockwaves) {
        spawnRing(w / 2, h / 2, accent2, true, fx.shockwaveAmount / 100);
        spawnRing(w / 2, h / 2, accent, false, fx.shockwaveAmount / 100);
      }
      if (fx.streaks) {
        spawnStreak(w / 2, h / 2, accent3, w);
        spawnStreak(w / 2, h / 2 - 12, accent, w);
      }
      if (fx.shards) {
        spawnShards(w / 2, h / 2, [accent, accent2, accent3], Math.round(14 * (0.35 + (fx.shardAmount / 100) * 1.65)), true);
      }
      if (fx.edgeGlow) pulseEdge(true);
      if (fx.bassBloom) setBloomKey((k) => k + 1);
      if (fx.glitchBars) fireGlitch(true);
      if (fx.comboCounter) {
        // Demo the stack + a milestone payoff: roll to ×8, then jump to ×100.
        for (let i = 0; i < 8; i++) bumpCombo();
        comboRef.current.count = 99;
        bumpCombo(); // hits 100 → ghost fly-off + milestone burst + banner
      }
      if (fx.lineFlash) addLineFlash(50 - (lineH / h) * 50, (lineH / h) * 100, accent2);
      if (fx.floaters) addFloater('bd cp hh', 50, 50, accent2, 12);
      if (fx.energyBar) bumpEnergy(0.5);
      if (fx.screenFlash) setWashKey((k) => k + 1);
      if (fx.beatPulse) onBeatPulse?.();
      if (fx.shake || fx.screenFlash) onImpact?.(true);
    };
    window.addEventListener('pg-fx-preview', handlePreview);

    return () => {
      unsubEvent();
      unsubStep();
      window.removeEventListener('pg-fx-preview', handlePreview);
    };
    // onBeatPulse/onImpact are stable callbacks from parent (refs) — keep sub once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fx = eventFx;
  const needsCanvas = fx.particles || fx.shockwaves || fx.streaks || fx.shards;
  const hasDomFx = fx.floaters || fx.screenFlash || fx.lineFlash || fx.energyBar
    || fx.edgeGlow || fx.bassBloom || fx.glitchBars || fx.comboCounter;
  if (!fx.enabled || (!needsCanvas && !hasDomFx)) return null;

  return (
    <div aria-hidden="true" className="pg-fx-layer">
      {needsCanvas ? (
        <canvas ref={canvasRef} className="pg-fx-canvas" />
      ) : (
        // Canvas ref must exist even when canvas FX are off for positioning;
        // render it hidden so resolveTokenPoint + preview still work.
        <canvas ref={canvasRef} className="pg-fx-canvas" style={{ display: 'none' }} />
      )}
      {fx.edgeGlow && <div ref={edgeRef} className="pg-fx-edge" style={{ opacity: 0 }} />}
      {fx.lineFlash &&
        lineFlashes.map((f) => (
          <div
            key={f.id}
            className="pg-fx-line-flash"
            style={{ top: `${f.yPct}%`, height: `${Math.max(1.2, f.hPct)}%`, background: f.color }}
          />
        ))}
      {fx.floaters &&
        floaters.map((f) => (
          <span
            key={f.id}
            className="pg-fx-floater"
            style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, color: f.color, fontSize: f.size }}
          >
            {f.text}
          </span>
        ))}
      {fx.screenFlash && washKey > 0 && <div key={washKey} className="pg-fx-flash-wash" />}
      {fx.bassBloom && bloomKey > 0 && <div key={bloomKey} className="pg-fx-bloom" />}
      {fx.glitchBars && glitchKey > 0 && glitchBars.length > 0 && (
        <div key={glitchKey} className="pg-fx-glitch">
          {glitchBars.map((g) => (
            <span
              key={g.id}
              className="pg-fx-glitch-bar"
              style={{
                top: `${g.topPct}%`,
                height: g.heightPx,
                background: g.color,
                ['--pg-glitch-shift' as string]: `${g.shiftPx.toFixed(1)}px`,
              }}
            />
          ))}
        </div>
      )}
      {fx.comboCounter && combo.n >= 2 && (
        <div
          ref={comboAnchorRef}
          className={[
            'pg-fx-combo',
            combo.n >= 1000 ? 'is-mega' : combo.n >= 100 ? 'is-hot' : combo.n >= 25 ? 'is-warm' : '',
          ].join(' ').trim()}
        >
          <span className="pg-fx-combo-stack">
            {comboGhosts.map((g) => (
              <span
                key={g.id}
                className="pg-fx-combo-ghost"
                style={{
                  ['--pg-ghost-dx' as string]: `${g.dx.toFixed(0)}px`,
                  ['--pg-ghost-dy' as string]: `${g.dy.toFixed(0)}px`,
                  ['--pg-ghost-rot' as string]: `${g.rot.toFixed(0)}deg`,
                }}
              >
                ×{g.n}
              </span>
            ))}
            <span key={combo.key} className="pg-fx-combo-n">
              ×{combo.n}
            </span>
          </span>
          <span className="pg-fx-combo-label">streak</span>
          {milestone && (
            <div key={milestone.key} className="pg-fx-milestone-inline">
              <span className="pg-fx-milestone-inline-n">×{milestone.n}</span>
              <span className="pg-fx-milestone-inline-label">burst</span>
            </div>
          )}
        </div>
      )}
      {fx.energyBar && (
        <div className="pg-fx-energy">
          <div ref={energyFillRef} className="pg-fx-energy-fill" style={{ transform: 'scaleX(0)', opacity: 0 }} />
        </div>
      )}
    </div>
  );
};

/** Fire a synthetic preview burst (used by Settings → Event FX → Preview). */
export function previewEventFxBurst() {
  window.dispatchEvent(new CustomEvent('pg-fx-preview'));
}
