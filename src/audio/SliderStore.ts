/**
 * Inline slider state, mirroring Strudel's `slider()` widget
 * (strudel-main/strudel/packages/codemirror/slider.mjs +
 * packages/transpiler/plugin-widgets.mjs).
 *
 * In Strudel, `slider(value, min?, max?, step?)` renders an inline range
 * input in the editor. Dragging it rewrites the numeric literal in the code
 * (so code stays in sync) AND updates a live `sliderValues` ref, so the
 * sounding pattern changes immediately without re-evaluation.
 *
 * PulseGrid follows the same contract:
 * - `sliderStore.beginEval()` resets the per-evaluation call counter.
 * - `slider(value, min, max, step)` called during `evaluateCode` registers
 *   the call ordinal as its stable key, syncs code->state (like Strudel's
 *   `sliderWithID`, which assigns on every eval), and marks the key as
 *   pending so the enclosing track method can bind it for live updates.
 * - `setByIndex()` (from the editor widget) updates the live value and lets
 *   `PatternScheduler.applySliderValue()` push it straight into the sounding
 *   track params — no re-eval glitch.
 * - `scanSliderCalls(code)` finds `slider(...)` calls outside comments and
 *   string literals, in source order. Both the editor widgets and the eval
 *   counter use this order, so widget index === eval ordinal.
 */

export interface SliderCallSite {
  /** Ordinal of the call in source order (matches eval counter). */
  index: number;
  /** Offset of the first (value) argument in the source. */
  valueStart: number;
  /** End offset (exclusive) of the first argument. */
  valueEnd: number;
  value: number;
  min: number;
  max: number;
  step: number | undefined;
  lineIdx: number;
}

export interface SliderBinding {
  key: string;
  trackId: string;
  /** Track param name, or 'cpm' for the master clock. */
  param: string;
}

const clampNum = (v: number, lo: number, hi: number): number => {
  if (!isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
};

function isIdentChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Scan `slider(...)` call sites in source order, skipping `//` comments and
 * `"..."` / `'...'` string literals (pattern strings may contain the word
 * "slider" as a sample/token name). Also skips `.slider(` method calls —
 * Strudel's slider is a global function.
 */
export function scanSliderCalls(code: string): SliderCallSite[] {
  const sites: SliderCallSite[] = [];
  const lineOfOffset: number[] = [];
  {
    let line = 0;
    for (let i = 0; i <= code.length; i++) {
      lineOfOffset[i] = line;
      if (code[i] === '\n') line++;
    }
  }

  let i = 0;
  let inLineComment = false;
  let quote = '';
  while (i < code.length) {
    const ch = code[i];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (
      code.startsWith('slider', i) &&
      !isIdentChar(code[i - 1]) &&
      code[i - 1] !== '.' &&
      !isIdentChar(code[i + 6])
    ) {
      let j = i + 6;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (code[j] === '(') {
        const parsed = parseSliderArgs(code, j);
        if (parsed) {
          sites.push({
            index: sites.length,
            valueStart: parsed.valueStart,
            valueEnd: parsed.valueEnd,
            value: parsed.value,
            min: parsed.min,
            max: parsed.max,
            step: parsed.step,
            lineIdx: lineOfOffset[i],
          });
          i = parsed.closeParen + 1;
          continue;
        }
      }
    }
    i++;
  }
  return sites;
}

function parseNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const v = Number(trimmed);
  return isFinite(v) ? v : null;
}

/** Parse the `(value, min?, max?, step?)` arg list starting at the `(`. */
function parseSliderArgs(
  code: string,
  openParen: number
): {
  valueStart: number;
  valueEnd: number;
  value: number;
  min: number;
  max: number;
  step: number | undefined;
  closeParen: number;
} | null {
  // Collect top-level comma-separated arg spans until the matching `)`.
  // Args are plain numeric literals, so no nesting is expected, but track
  // depth anyway for safety.
  const args: { start: number; end: number; raw: string }[] = [];
  let depth = 0;
  let quote = '';
  let argStart = openParen + 1;
  let j = openParen + 1;
  for (; j < code.length; j++) {
    const ch = code[j];
    if (quote) {
      if (ch === '\\') {
        j++;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push({ start: argStart, end: j, raw: code.slice(argStart, j) });
      argStart = j + 1;
    }
  }
  if (j >= code.length || code[j] !== ')') return null;
  args.push({ start: argStart, end: j, raw: code.slice(argStart, j) });
  if (args.length === 0) return null;

  const value = parseNum(args[0].raw);
  if (value === null) return null;
  const min = args.length > 1 ? parseNum(args[1].raw) : 0;
  const max = args.length > 2 ? parseNum(args[2].raw) : 1;
  const step = args.length > 3 ? parseNum(args[3].raw) : null;
  return {
    valueStart: args[0].start,
    valueEnd: args[0].end,
    value,
    min: min ?? 0,
    max: max ?? 1,
    step: step ?? undefined,
    closeParen: j,
  };
}

class SliderStore {
  private liveByIndex = new Map<number, number>();
  private liveIdValues = new Map<string, number>();
  private bindings: SliderBinding[] = [];
  private pendingKey: string | null = null;
  private counter = 0;

  /** Reset per-evaluation state. Called at the top of `evaluateCode`. */
  public beginEval(): void {
    this.counter = 0;
    this.bindings = [];
    this.pendingKey = null;
  }

  /**
   * Global `slider(value, min = 0, max = 1, step?)` for the DSL.
   * Returns the live value (code->state sync on eval, like Strudel's
   * `sliderWithID`), and marks the call ordinal pending so the enclosing
   * track method (`gain(slider(...))`, ...) can bind it for live updates.
   */
  public slider(value: number, min = 0, max = 1, step?: number): number {
    const index = this.counter;
    this.counter++;
    const key = `n${index}`;
    const lo = isFinite(min) ? min : 0;
    const hi = isFinite(max) ? max : 1;
    const synced = clampNum(Number(value), Math.min(lo, hi), Math.max(lo, hi));
    // Code wins on eval (matches Strudel); the editor rewrites the literal
    // on drag so this converges to the dragged value.
    this.liveByIndex.set(index, synced);
    this.pendingKey = key;
    void step;
    return synced;
  }

  /**
   * Strudel-transpiler-compatible `sliderWithID(id, value, min?, max?)`.
   * Accepts pasted Strudel output that was already rewritten by its
   * transpiler plugin.
   */
  public sliderWithID(id: string, value: number, min = 0, max = 1): number {
    const lo = isFinite(min) ? min : 0;
    const hi = isFinite(max) ? max : 1;
    const synced = clampNum(Number(value), Math.min(lo, hi), Math.max(lo, hi));
    this.liveIdValues.set(id, synced);
    this.pendingKey = `id:${id}`;
    return synced;
  }

  /** Take (and clear) the pending slider key after a track-method call. */
  public consumePending(): string | null {
    const key = this.pendingKey;
    this.pendingKey = null;
    return key;
  }

  public addBinding(binding: SliderBinding): void {
    if (!this.bindings.some((b) => b.key === binding.key && b.trackId === binding.trackId && b.param === binding.param)) {
      this.bindings.push(binding);
    }
  }

  public getBindings(): SliderBinding[] {
    return [...this.bindings];
  }

  /** Live value update from the editor widget (no re-eval needed). */
  public setByIndex(index: number, value: number): void {
    this.liveByIndex.set(index, value);
  }

  public getByIndex(index: number, fallback: number): number {
    const v = this.liveByIndex.get(index);
    return v === undefined ? fallback : v;
  }

  public setById(id: string, value: number): void {
    this.liveIdValues.set(id, value);
  }

  public bindingKeysFor(key: string): SliderBinding[] {
    return this.bindings.filter((b) => b.key === key);
  }
}

export const sliderStore = new SliderStore();
