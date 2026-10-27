/**
 * Strudel / TidalCycles Mini-Notation Parser & Evaluator
 */

export interface ParsedEvent {
  offset: number; // 0.0 to 1.0 within a single cycle
  duration: number; // fraction of cycle
  value: string; // e.g. "bd", "c3", "amen:2"
  velocity: number;
}

// Convert pitch names (c3, eb4, f#2, etc.) to MIDI note numbers
export function noteToMidi(noteStr: string): number | null {
  const match = noteStr.trim().toLowerCase().match(/^([a-g])([#b]?)(-?\d+)$/);
  if (!match) return null;

  const noteNames: Record<string, number> = {
    c: 0,
    d: 2,
    e: 4,
    f: 5,
    g: 7,
    a: 9,
    b: 11,
  };

  let semitone = noteNames[match[1]];
  if (semitone === undefined) return null;

  if (match[2] === '#') semitone += 1;
  else if (match[2] === 'b') semitone -= 1;

  const octave = parseInt(match[3], 10);
  return (octave + 1) * 12 + semitone;
}

export function midiToFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// Bjorklund algorithm for Euclidean rhythms: e.g. (3, 8) -> [1, 0, 0, 1, 0, 0, 1, 0]
export function bjorklund(k: number, n: number): boolean[] {
  if (k <= 0) return new Array(n).fill(false);
  if (k >= n) return new Array(n).fill(true);

  let pattern: number[][] = [];
  for (let i = 0; i < n; i++) {
    pattern.push([i < k ? 1 : 0]);
  }

  while (true) {
    const countZeros = pattern.filter((item) => item[0] === 0).length;
    const countOnes = pattern.filter((item) => item[0] === 1).length;
    if (countZeros <= 1 || countOnes <= 1) break;

    const min = Math.min(countZeros, countOnes);
    const newPattern: number[][] = [];
    for (let i = 0; i < min; i++) {
      newPattern.push([...pattern[i], ...pattern[pattern.length - 1 - i]]);
    }
    const remaining = pattern.slice(min, pattern.length - min);
    pattern = [...newPattern, ...remaining];
  }

  const result: boolean[] = [];
  for (const group of pattern) {
    for (const val of group) {
      result.push(val === 1);
    }
  }
  return result;
}

/**
 * Tokenize and parse mini-notation string into time-aligned cycle events
 */
export interface ParseContext {
  /** Absolute cycle index: drives `< >` rotation and seeds `|` / `?`. */
  cycle: number;
  /**
   * Cycles per phrase for random choices (`|` / `?`): the choice stays stable
   * across `span` cycles (used with track-level .slow()). Slowcat `< >`
   * always follows the absolute cycle.
   */
  span: number;
}

export function parseMiniNotation(patternStr: string, cycle = 0, span = 1): ParsedEvent[] {
  if (!patternStr || !patternStr.trim()) return [];

  const cleaned = patternStr.trim();
  const safeSpan = span > 0 && isFinite(span) ? span : 1;
  const ctx: ParseContext = {
    cycle: Math.max(0, Math.floor(cycle)),
    span: safeSpan,
  };
  return parseGroup(cleaned, 0, 1, ctx);
}

// Deterministic PRNG so `|` / `?` are stable when the same cycle is
// re-parsed (the scheduler re-parses every tick inside its lookahead).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(cycle: number, span: number): () => number {
  const phrase = Math.floor(cycle / span);
  return mulberry32((phrase * 2654435761) >>> 0);
}

// ---- Strudel mini additions: polymeter {}, feet dots, tail colon, range .. ----
export function stripStepMarks(s: string): string {
  return s.replace(/\^/g, '');
}

function splitAll(s: string, delim: ' ' | ','): string[] {
  const parts: string[] = [];
  let cur = '';
  let dSq = 0, dCu = 0, dAn = 0, dPa = 0;
  for (const ch of s) {
    if (ch === '[') dSq++;
    else if (ch === ']') dSq = Math.max(0, dSq - 1);
    else if (ch === '{') dCu++;
    else if (ch === '}') dCu = Math.max(0, dCu - 1);
    else if (ch === '<') dAn++;
    else if (ch === '>') dAn = Math.max(0, dAn - 1);
    else if (ch === '(') dPa++;
    else if (ch === ')') dPa = Math.max(0, dPa - 1);
    const isDelim = delim === ' ' ? ch === ' ' || ch === '\t' || ch === '\n' : ch === ',';
    if (isDelim && !dSq && !dCu && !dAn && !dPa) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function expandRange(token: string): string {
  const m = token.match(/^(-?\d+)\.\.(-?\d+)$/);
  if (!m) return token;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const out: string[] = [];
  const step = a <= b ? 1 : -1;
  for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
    out.push(String(i));
    if (out.length > 128) break;
  }
  return out.join(' ');
}

function expandRangesInSeq(seq: string): string {
  return splitAll(seq, ' ')
    .map((tok) => {
      if (tok.includes('..') && !tok.startsWith('[') && !tok.startsWith('<') && !tok.startsWith('{'))
        return expandRange(tok);
      return tok;
    })
    .join(' ');
}

export function desugarFeetDots(seq: string): string {
  return splitAll(seq, ' ')
    .map((tok) => {
      if (!tok.includes('.') || tok.includes('..')) return tok;
      if (/\d\.\d/.test(tok)) return tok;
      if (tok.startsWith('[') || tok.startsWith('<') || tok.startsWith('{')) return tok;
      if (/^[.?~\-_^|,!]+$/.test(tok)) return tok;
      const feet = tok.split('.').map((f) => f.trim()).filter(Boolean);
      return feet.length > 1 ? `[${feet.join(' ')}]` : tok;
    })
    .join(' ');
}

/** Tail colon `a:b` -> chord stack. Keeps sample index `amen:2` intact. */
export function splitTailColon(val: string): string[] | null {
  if (!val.includes(':')) return null;
  if (/^\S+:\d+$/.test(val)) return null;
  const parts = val.split(':').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

export function unwrapPolymeter(s: string): { inner: string } | null {
  const t = s.trim().replace(/\}\s*%\s*\d+\s*$/, '}');
  if (!t.startsWith('{')) return null;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') {
      depth--;
      if (depth === 0) return i === t.length - 1 ? { inner: t.slice(1, -1).trim() } : null;
    }
  }
  return null;
}

export function handleUnderscoreWeight(item: string): { value: string; extra: number } {
  if (/^_+$/.test(item.trim())) return { value: item.trim(), extra: 0 };
  const m = item.match(/^(.*?)_+$/);
  if (!m || !m[1].trim()) return { value: item, extra: 0 };
  return { value: m[1].trim(), extra: item.length - m[1].length };
}

// Split on `|` only at the top level (outside [...] and <...>).
function splitChoice(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let square = 0;
  let angle = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '[') square++;
    else if (char === ']') square = Math.max(0, square - 1);
    else if (char === '<') angle++;
    else if (char === '>') angle = Math.max(0, angle - 1);
    if (char === '|' && square === 0 && angle === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// If the whole string is wrapped in <...>, return the inner content.
function unwrapSlowcat(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('<')) return null;
  let angle = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '<') angle++;
    else if (trimmed[i] === '>') angle--;
    if (angle === 0) {
      return i === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : null;
    }
  }
  return null;
}

// Split off Strudel suffix operators (applied innermost-last):
// `x?p` degrade (maybe silence), `x@w` timeCat weight,
// `x*n` fast repeat, `x!n` replicate (weight n + n hits), `x/n` slow (longer).
function extractSuffixes(item: string): {
  value: string;
  weight: number;
  hits: number;
  durMul: number;
  degrade: number | null;
} {
  let value = item;
  let weight = 1;
  let hits = 1;
  let durMul = 1;
  let degrade: number | null = null;

  const degradeMatch = value.match(/^(.*)\?(\d*\.?\d+)?$/);
  if (degradeMatch && degradeMatch[1].length > 0) {
    const p = degradeMatch[2] === undefined || degradeMatch[2] === '' ? 0.5 : parseFloat(degradeMatch[2]);
    if (isFinite(p) && p >= 0) {
      degrade = Math.min(1, p);
      value = degradeMatch[1].trim() || '~';
    }
  }

  const weightMatch = value.match(/^(.*)@(\d*\.?\d+)$/);
  if (weightMatch) {
    const w = parseFloat(weightMatch[2]);
    if (isFinite(w) && w > 0) {
      weight = w;
      value = weightMatch[1].trim() || '~';
    }
  }

  const repMatch = value.match(/^(.*)[*!](\d+)$/);
  if (repMatch && repMatch[1].length > 0) {
    const n = parseInt(repMatch[2], 10);
    if (isFinite(n) && n > 1) {
      const replicate = value[repMatch[0].length - n.toString().length - 1] === '!';
      value = repMatch[1].trim() || '~';
      hits = n;
      if (replicate) weight = n;
    }
  }

  const slowMatch = value.match(/^(.*)\/(\d*\.?\d+)$/);
  if (slowMatch && slowMatch[1].length > 0) {
    const d = parseFloat(slowMatch[2]);
    if (isFinite(d) && d > 0) {
      durMul = d;
      value = slowMatch[1].trim() || '~';
    }
  }

  return { value, weight, hits, durMul, degrade };
}

function extractWeight(item: string): { value: string; weight: number } {
  const { value, weight } = extractSuffixes(item);
  return { value, weight };
}

function parseGroup(input: string, startOffset: number, totalDuration: number, ctx: ParseContext): ParsedEvent[] {
  const pre = expandRangesInSeq(desugarFeetDots(stripStepMarks(input.trim())));
  if (!pre) return [];
  // Polymeter {a b, c d}: stack lanes, each fits 1 cycle.
  const pm = unwrapPolymeter(pre);
  if (pm) {
    if (!pm.inner) return [];
    const lanes = splitAll(pm.inner, ',').map((l) => l.trim()).filter(Boolean);
    if (lanes.length === 0) return [];
    return lanes.flatMap((lane) => parseGroup(lane, startOffset, totalDuration, ctx));
  }
  const trimmed = pre;
  if (!trimmed) return [];
  const rand = rngFor(ctx.cycle, ctx.span);

  // Random choice: `a b | c d` plays one side per phrase (Strudel `|`).
  const alternatives = splitChoice(trimmed);
  if (alternatives.length > 1) {
    const picked = alternatives[Math.floor(rand() * alternatives.length) % alternatives.length];
    return parseGroup(picked, startOffset, totalDuration, ctx);
  }

  // Slowcat: `<a@2 b@1>` stretches weighted sections across cycles
  // (Strudel timeCat). Top-level: each section occupies its span in absolute
  // cycles, and this cycle renders only the overlap window — so a held note
  // attacks once at its span start instead of retriggering every cycle.
  // Nested slowcat has no absolute alignment: deterministic pick instead.
  const slowcat = unwrapSlowcat(trimmed);
  if (slowcat !== null) {
    const sections = splitTopLevel(slowcat, ' ')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(extractWeight);
    if (sections.length === 0) return [];
    if (startOffset !== 0 || totalDuration !== 1) {
      const total = sections.reduce((sum, s) => sum + s.weight, 0);
      let position = ctx.cycle % total;
      for (const section of sections) {
        if (position < section.weight) {
          return parseGroup(section.value, startOffset, totalDuration, ctx);
        }
        position -= section.weight;
      }
      return parseGroup(sections[sections.length - 1].value, startOffset, totalDuration, ctx);
    }
    const total = sections.reduce((sum, s) => sum + s.weight, 0);
    const rel = ctx.cycle % total;
    const out: ParsedEvent[] = [];
    let spanStart = 0;
    for (const section of sections) {
      const spanEnd = spanStart + section.weight;
      // Overlap of [spanStart, spanEnd) with this cycle [rel, rel + 1).
      // A single held note emits once (at its span start); a subdivided
      // section emits whichever sub-events land inside this cycle.
      if (spanEnd > rel && spanStart < rel + 1) {
        const sub = parseGroup(section.value, 0, section.weight, ctx);
        for (const ev of sub) {
          const abs = spanStart + ev.offset;
          if (abs >= rel && abs < rel + 1) {
            out.push({
              ...ev,
              offset: startOffset + (abs - rel) * totalDuration,
              duration: ev.duration * totalDuration,
            });
          }
        }
      }
      spanStart = spanEnd;
    }
    return out;
  }

  const rawItems = splitTopLevel(trimmed, ' ');
  if (rawItems.length === 0) return [];

  // Resolve weights first so durations stay proportional (Strudel timeCat).
  // Trailing `_` elongates: each `_` adds +1 weight (Strudel elongate).
  const items = rawItems
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      // Tolerate stray slowcat brackets left over from splitting.
      if (item.startsWith('<')) item = item.slice(1).trim() || '~';
      if (item.endsWith('>')) item = item.slice(0, -1).trim() || '~';
      // Tolerate stray polymeter braces left over from splitting.
      if (item.startsWith('{')) item = item.slice(1).trim() || '~';
      if (item.endsWith('}')) item = item.slice(0, -1).trim() || '~';
      const uw = handleUnderscoreWeight(item);
      const parsed = extractSuffixes(uw.value);
      return { ...parsed, weight: parsed.weight + uw.extra };
    });
  if (items.length === 0) return [];

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const events: ParsedEvent[] = [];
  let cursor = startOffset;

  for (let i = 0; i < items.length; i++) {
    const { value: item, weight, hits, durMul, degrade } = items[i];

    // Degrade: `x?` / `x?0.3` randomly silences the step (seeded per phrase).
    if (degrade !== null && rand() < degrade) {
      cursor += (totalDuration * weight) / totalWeight;
      continue;
    }

    const stepDuration = (totalDuration * weight) / totalWeight;
    const currentOffset = cursor;
    cursor += stepDuration;

    // Handle euclidean rhythm first: bd(3,8) contains commas but is one atom.
    // e.g. bd(3,8) with optional rotation bd(3,8,2)
    const eucMatch = item.match(/^([a-zA-Z0-9_:#]+)\((\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\)$/);
    if (eucMatch) {
      const sound = eucMatch[1];
      const hits = parseInt(eucMatch[2], 10);
      const totalSteps = parseInt(eucMatch[3], 10);
      const rotation = eucMatch[4] ? parseInt(eucMatch[4], 10) : 0;
      let mask = bjorklund(hits, totalSteps);
      if (rotation !== 0 && mask.length > 0) {
        const shift = ((rotation % mask.length) + mask.length) % mask.length;
        mask = [...mask.slice(shift), ...mask.slice(0, shift)];
      }
      const eucStepDur = stepDuration / totalSteps;

      mask.forEach((isHit, stepIdx) => {
        if (isHit) {
          events.push({
            offset: currentOffset + stepIdx * eucStepDur,
            duration: eucStepDur * durMul,
            value: sound,
            velocity: 1,
          });
        }
      });
      continue;
    }

    // Handle polyphony: [a, b, c] inside brackets or separated by commas
    // Tail colon `a:b:c` -> chord stack (sample slots like amen:2 handled earlier).
    const tail = splitTailColon(item);
    if (tail) {
      for (const part of tail) {
        events.push(...parseGroup(part.trim(), currentOffset, stepDuration, ctx));
      }
      continue;
    }
    if (item.includes(',')) {
      const parallelParts = splitTopLevel(stripBrackets(item), ',');
      for (const part of parallelParts) {
        events.push(...parseGroup(part.trim(), currentOffset, stepDuration, ctx));
      }
      continue;
    }

    // Handle brackets: [a b c]
    if (item.startsWith('[') && item.endsWith(']')) {
      const inner = item.slice(1, -1).trim();
      events.push(...parseGroup(inner, currentOffset, stepDuration, ctx));
      continue;
    }

    // Handle repeats: `hh*4` fast repeat, `bd!2` replicate (n hits in slot)
    if (hits > 1) {
      const subDur = stepDuration / hits;
      for (let k = 0; k < hits; k++) {
        if (item !== '~' && item !== '-') {
          events.push({
            offset: currentOffset + k * subDur,
            duration: subDur * durMul,
            value: item,
            velocity: 1,
          });
        }
      }
      continue;
    }

    // Handle rest
    if (item === '~' || item === '-' || item === '_') {
      continue;
    }

    // Normal single token (`/n` extends duration, e.g. c2/2).
    // Full step duration + unity velocity: Strudel parity (superdough
    // defaults velocity 1, gain 1, and sounds notes for the whole duration).
    events.push({
      offset: currentOffset,
      duration: stepDuration * durMul,
      value: item,
      velocity: 1,
    });
  }

  return events;
}

function stripBrackets(str: string): string {
  const trimmed = str.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitTopLevel(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (char === delimiter && bracketDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
