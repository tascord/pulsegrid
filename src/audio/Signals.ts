/**
 * Minimal Strudel `sine` signal parity for modulated params.
 * Strudel's `sine` is a cycle-rate signal 0..1 with `.slow()`, `.fast()`
 * and `.range(min, max)`. We evaluate it per-event at schedule time so
 * `pan(sine.slow(0.1).range(0,1))` and `lpf(sine.range(2500,7000).slow(4))`
 * sound without a full pattern engine.
 */

export interface Signal {
  readonly __signalBrand: true;
  /** Absolute cycle (float) -> value. */
  evalAt(cycleFloat: number): number;
  slow(divisor: number): Signal;
  fast(multiplier: number): Signal;
  range(min: number, max: number): Signal;
}

class SineSignal implements Signal {
  readonly __signalBrand = true as const;
  constructor(
    private readonly freq: number = 1, // oscillations per cycle
    private readonly min: number = 0,
    private readonly max: number = 1,
  ) {}

  evalAt(cycleFloat: number): number {
    const uni = (Math.sin(Math.PI * 2 * this.freq * cycleFloat) + 1) / 2; // 0..1
    return this.min + uni * (this.max - this.min);
  }

  slow(divisor: number): Signal {
    const d = isFinite(divisor) && divisor !== 0 ? divisor : 1;
    return new SineSignal(this.freq / d, this.min, this.max);
  }

  fast(multiplier: number): Signal {
    const m = isFinite(multiplier) ? multiplier : 1;
    return new SineSignal(this.freq * m, this.min, this.max);
  }

  range(min: number, max: number): Signal {
    const lo = isFinite(min) ? min : 0;
    const hi = isFinite(max) ? max : 1;
    return new SineSignal(this.freq, lo, hi);
  }
}

export const sine: Signal = new SineSignal();

type WaveKind = 'sine' | 'saw' | 'square' | 'tri' | 'rand' | 'perlin';
const hash01 = (n: number): number => {
  let a = (n | 0) || 0;
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
};

class WaveSignal implements Signal {
  readonly __signalBrand = true as const;
  constructor(
    private kind: WaveKind = 'sine',
    private freq = 1,
    private min = 0,
    private max = 1,
  ) {}
  evalAt(c: number): number {
    const f = isFinite(c) ? c * this.freq : 0;
    let u: number;
    const fr = ((f % 1) + 1) % 1;
    switch (this.kind) {
      case 'saw': u = fr; break;
      case 'square': u = Math.sin(Math.PI * 2 * f) >= 0 ? 1 : 0; break;
      case 'tri': u = fr < 0.5 ? fr * 2 : 2 - fr * 2; break;
      case 'rand': u = hash01(Math.floor(f)); break;
      case 'perlin':
        u =
          0.5 * ((Math.sin(Math.PI * 2 * f) + 1) / 2) +
          0.3 * ((Math.sin(Math.PI * 2 * 2.7 * f + 1.3) + 1) / 2) +
          0.2 * ((Math.sin(Math.PI * 2 * 6.1 * f + 4.1) + 1) / 2);
        break;
      default: u = (Math.sin(Math.PI * 2 * f) + 1) / 2;
    }
    return this.min + u * (this.max - this.min);
  }
  slow(d: number): Signal {
    const q = isFinite(d) && d !== 0 ? d : 1;
    return new WaveSignal(this.kind, this.freq / q, this.min, this.max);
  }
  fast(m: number): Signal {
    return new WaveSignal(this.kind, this.freq * (isFinite(m) ? m : 1), this.min, this.max);
  }
  range(a: number, b: number): Signal {
    return new WaveSignal(this.kind, this.freq, isFinite(a) ? a : 0, isFinite(b) ? b : 1);
  }
}

export const saw: Signal = new WaveSignal('saw');
export const square: Signal = new WaveSignal('square');
export const tri: Signal = new WaveSignal('tri');
export const rand: Signal = new WaveSignal('rand');
export const perlin: Signal = new WaveSignal('perlin');

export function isSignal(v: unknown): v is Signal {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Signal).__signalBrand === true &&
    typeof (v as Signal).evalAt === 'function'
  );
}

/**
 * Rotating numeric pattern like "<4 4 4 6>" or "<4 5>": pick entry by
 * integer cycle (or phrase). Matches the existing `.oct("<4 5>")` convention.
 * Returns null when the string is not a bracket pattern.
 */
export function parseRotatingNumbers(input: string): number[] | null {
  const t = input.trim();
  if (!/^<.*>$/.test(t)) return null;
  const nums = t
    .replace(/^\s*<\s*/, '')
    .replace(/\s*>\s*$/, '')
    .split(/[\s,]+/)
    .map((s) => Number(s))
    .filter((n) => isFinite(n));
  return nums.length > 0 ? nums : null;
}

/** Resolve a param that may be a number, Signal, or rotating "<...>" string. */
export function resolveModParam(
  param: number | string | Signal | null | undefined,
  cycleFloat: number,
  cycleIndex: number,
  fallback: number,
): number {
  if (param === null || param === undefined) return fallback;
  if (typeof param === 'number') return isFinite(param) ? param : fallback;
  if (isSignal(param)) {
    const v = param.evalAt(cycleFloat);
    return isFinite(v) ? v : fallback;
  }
  if (typeof param === 'string') {
    const nums = parseRotatingNumbers(param);
    if (nums) {
      const idx = ((cycleIndex % nums.length) + nums.length) % nums.length;
      return nums[idx];
    }
    const n = Number(param);
    return isFinite(n) ? n : fallback;
  }
  return fallback;
}
