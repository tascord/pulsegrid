import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  AlertCircle,
  Copy,
  Check,
  Clock,
  RotateCcw,
  RotateCw,
  Code2,
} from 'lucide-react';
import { patternScheduler } from '../audio/PatternScheduler';
import { instrumentRegistry } from '../audio/InstrumentRegistry';
import { sampleManager } from '../audio/SampleManager';
import { midiManager } from '../audio/MidiManager';
import { vstBridge } from '../audio/VstBridge';
import { formatCode } from '../formatCode';
import { useTheme } from '../theme/ThemeContext';
import { InlineScope } from './InlineScope';
import { InlineViz } from './InlineViz';
import { EventFxOverlay } from './EventFxOverlay';
import { VisualizerCanvas, type VisualizerMode } from './Visualizer';
import {
  KEYWORD_SUGGESTIONS,
  METHOD_SUGGESTIONS,
  type Suggestion,
} from '../audio/language';
import { scanSliderCalls, sliderStore, type SliderCallSite } from '../audio/SliderStore';
import type { TrackVizType, TrackVizWidget } from '../types/music';

/** Chain methods that render an inline visualization widget (Strudel parity). */
const VIZ_METHODS: Record<string, TrackVizType> = {
  scope: 'scope',
  meter: 'meter',
  pianoroll: 'pianoroll',
  punchcard: 'punchcard',
  wordfall: 'wordfall',
  spiral: 'spiral',
  spectrum: 'spectrum',
  fscope: 'fscope',
  pitchwheel: 'pitchwheel',
  _pianoroll: 'pianoroll',
  _punchcard: 'punchcard',
  _spiral: 'spiral',
  _scope: 'scope',
  _spectrum: 'spectrum',
  _pitchwheel: 'pitchwheel',
};

const VIZ_CALL_RE = /\.(_?[a-zA-Z]+)\s*\(/g;

/** Viz widget types requested on one code line (`.scope()` and friends). */
function vizTypesInLine(line: string): TrackVizType[] {
  const found: TrackVizType[] = [];
  VIZ_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VIZ_CALL_RE.exec(line)) !== null) {
    const t = VIZ_METHODS[m[1]];
    if (t && !found.includes(t)) found.push(t);
  }
  return found;
}

function formatSliderValue(site: SliderCallSite, v: number): string {
  const clamped = Math.min(site.max, Math.max(site.min, v));
  if (site.step != null && site.step >= 1) return String(Math.round(clamped));
  if (Number.isInteger(site.min) && Number.isInteger(site.max) && site.max - site.min > 32) {
    return String(Math.round(clamped * 100) / 100);
  }
  return String(Math.round(clamped * 1000) / 1000);
}

interface ActivePatternEvent {
  value: string;
  notation: string;
  valueOccurrence: number;
  time: number;
  /** When the highlight may clear (held notes stay lit for their duration). */
  expiresAt: number;
}

const MINI_TOKEN_SPLIT = /([a-zA-Z0-9_:#]+\(\d+\s*,\s*\d+(?:\s*,\s*\d+)?\)|\[|\]|\*|!|\/|\~|\s+|,)/g;

function countMiniTokenOccurrences(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tok of text.split(MINI_TOKEN_SPLIT)) {
    if (!tok) continue;
    const clean = normalizeEventToken(tok);
    if (!clean) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return counts;
}

function normalizeNotation(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeEventToken(text: string): string {
  let token = text.trim().toLowerCase().replace(/^[<>]+|[<>]+$/g, '');
  const euclidean = token.match(/^([a-z0-9_:#]+)\(\d+\s*,\s*\d+(?:\s*,\s*\d+)?\)$/);
  if (euclidean) token = euclidean[1];
  return token.replace(/(?:[*!]\d+|@\d*\.?\d+|\/\d*\.?\d+|\?\d*\.?\d+)$/, '');
}

interface ConcatFragment {
  lineIdx: number;
  nthOnLine: number;
  inner: string;
  startOffset: number;
  endOffset: number;
}

interface ConcatChainInfo {
  full: string;
  precedingCounts: Map<string, number>;
}

/**
 * Find `"..."` / `'...'` literals joined by `+` (including across lines,
 * as produced by formatCode's wrapLongString) and map each fragment to its
 * full logical string plus the token-occurrence offset of preceding fragments.
 * This keeps event-note flashing working on formatted lines.
 */
function buildConcatChainMap(code: string): Map<string, ConcatChainInfo> {
  const fragments: ConcatFragment[] = [];
  const lineOfOffset: number[] = [];
  {
    let line = 0;
    for (let i = 0; i <= code.length; i++) {
      lineOfOffset[i] = line;
      if (code[i] === '\n') line++;
    }
  }
  const nthPerLine = new Map<number, number>();

  let i = 0;
  let inLineComment = false;
  while (i < code.length) {
    const ch = code[i];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      // Only treat as comment when outside a string (we are outside here).
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      const lineIdx = lineOfOffset[start];
      let j = i + 1;
      let escaped = false;
      while (j < code.length) {
        const c = code[j];
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) break;
        else if (c === '\n') break; // single-line strings only; bail on newline
        j++;
      }
      if (j < code.length && code[j] === quote) {
        const end = j + 1;
        const literal = code.slice(start, end);
        const inner = literal.slice(1, -1);
        const nth = nthPerLine.get(lineIdx) || 0;
        nthPerLine.set(lineIdx, nth + 1);
        fragments.push({ lineIdx, nthOnLine: nth, inner, startOffset: start, endOffset: end });
        i = end;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }

  const map = new Map<string, ConcatChainInfo>();
  let chain: ConcatFragment[] = [];
  const flush = () => {
    if (chain.length > 1) {
      const full = chain.map((f) => f.inner).join('');
      let precedingText = '';
      for (const frag of chain) {
        const info: ConcatChainInfo = {
          full,
          precedingCounts: countMiniTokenOccurrences(precedingText),
        };
        map.set(`${frag.lineIdx}:${frag.nthOnLine}`, info);
        precedingText += frag.inner;
      }
    }
    chain = [];
  };

  for (let k = 0; k < fragments.length; k++) {
    const frag = fragments[k];
    if (chain.length === 0) {
      chain.push(frag);
    } else {
      const prev = chain[chain.length - 1];
      const between = code.slice(prev.endOffset, frag.startOffset);
      if (/^\s*\+\s*$/.test(between)) {
        chain.push(frag);
      } else {
        flush();
        chain.push(frag);
      }
    }
  }
  flush();
  return map;
}

function isStringLiteralPart(part: string): boolean {
  return (
    part.length >= 2 &&
    ((part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'")))
  );
}

/** A secondary cursor/selection. The primary selection stays native to the
 *  textarea; extras are painted on an overlay layer and applied on edits. */
interface MultiCursor {
  anchor: number;
  head: number;
}

const MULTI_CURSOR_CAP = 200;
const MULTI_TAB_SIZE = 2;

function isMultiWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$:#]/.test(ch);
}

/** Word under (or right after) `pos`, VSCode-style for Ctrl+D seeding. */
function getWordAt(
  text: string,
  pos: number
): { start: number; end: number; text: string } | null {
  const p = Math.max(0, Math.min(text.length, pos));
  const after = p < text.length && isMultiWordChar(text[p]);
  const before = p > 0 && isMultiWordChar(text[p - 1]);
  if (!after && !before) return null;
  let s = p;
  while (s > 0 && isMultiWordChar(text[s - 1])) s--;
  let e = p;
  while (e < text.length && isMultiWordChar(text[e])) e++;
  if (s === e) return null;
  return { start: s, end: e, text: text.slice(s, e) };
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(text.length, offset));
  const before = text.slice(0, clamped);
  const line = (before.match(/\n/g) || []).length;
  return { line, col: clamped - (before.lastIndexOf('\n') + 1) };
}

function lineStartOffset(lines: string[], line: number): number {
  let o = 0;
  for (let i = 0; i < line; i++) o += lines[i].length + 1;
  return o;
}

function lineColToOffset(lines: string[], line: number, col: number): number {
  const l = Math.max(0, Math.min(lines.length - 1, line));
  const c = Math.max(0, Math.min(lines[l].length, col));
  return lineStartOffset(lines, l) + c;
}

/** Visual column with tabs expanded (matches `tab-size: 2` on .pg-editor). */
function visualCol(lineText: string, col: number): number {
  let v = 0;
  const n = Math.max(0, Math.min(lineText.length, col));
  for (let i = 0; i < n; i++) v += lineText[i] === '\t' ? MULTI_TAB_SIZE : 1;
  return v;
}

/** Monospace advance in px for the editor font (canvas-measured). */
function measureCharWidth(): number {
  try {
    const cs = getComputedStyle(document.documentElement);
    const size = parseFloat(cs.getPropertyValue('--pg-editor-size')) || 14;
    const family = cs.getPropertyValue('--pg-editor-font').trim() || 'monospace';
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) return size * 0.6;
    ctx.font = `${size}px ${family}`;
    const w = ctx.measureText('MMMMMMMMMM').width / 10;
    if (!isFinite(w) || w <= 0) return size * 0.6;
    return w + size * 0.005; // letter-spacing: 0.005em
  } catch {
    return 8.4;
  }
}



interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  onEval: () => void;
  onEvalNextBeat: () => void;
  queuedTarget: 'next_beat' | 'next_cycle' | null;
  errorMessage: string | null;
  evalFlash: boolean;
  visualizerMode: VisualizerMode;
  visualizerOverlay: boolean;
  visualizerOpacity: number;
}

function readEditorLineHeight(): number {
  try {
    const v = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--pg-editor-lh')
    );
    return isNaN(v) ? 25 : v;
  } catch {
    return 25;
  }
}

function getAutocompletePosition(
  textarea: HTMLTextAreaElement | null,
  lineIndex: number,
  column: number
): { top: number; left: number } {
  const lineHeight = readEditorLineHeight();
  const viewportHeight = textarea?.clientHeight || 600;
  const viewportWidth = textarea?.clientWidth || 800;
  const lineTop = (lineIndex + 1) * lineHeight - (textarea?.scrollTop || 0);
  const menuHeight = 220;
  const top = lineTop + menuHeight > viewportHeight
    ? Math.max(8, lineTop - menuHeight)
    : Math.max(8, lineTop + 4);
  const fontSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pg-editor-size')) || 14;
  const left = column * fontSize * 0.6 + 12 - (textarea?.scrollLeft || 0);

  return {
    top,
    left: Math.max(8, Math.min(viewportWidth - 328, left)),
  };
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  code,
  onChange,
  onEval,
  onEvalNextBeat,
  queuedTarget,
  errorMessage,
  evalFlash,
  visualizerMode,
  visualizerOverlay,
  visualizerOpacity,
}) => {
  const { formatWidth, wallpaperImage, eventFx } = useTheme();
  const fxFrameRef = useRef<HTMLDivElement>(null);
  const fxInnerRef = useRef<HTMLDivElement>(null);
  const fxLastBeatAt = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const sliderLayerInnerRef = useRef<HTMLDivElement>(null);
  const multiLayerRef = useRef<HTMLDivElement>(null);
  // VSCode-style secondary cursors (primary selection stays native).
  const [extraCursors, setExtraCursors] = useState<MultiCursor[]>([]);
  const multiSearchRef = useRef<string>('');
  const mouseDownSelRef = useRef<{ start: number; end: number } | null>(null);
  // True while echoing our own multicursor commit back through onChange.
  const isMultiCommitRef = useRef<boolean>(false);
  const lastCodeRef = useRef<string>(code);
  const [copied, setCopied] = useState(false);
  const [activeEvents, setActiveEvents] = useState<Map<string, ActivePatternEvent>>(new Map());
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 0, col: 0 });

  // Autocomplete / IntelliSense state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [autoIndex, setAutoIndex] = useState<number>(0);
  const [autoPosition, setAutoPosition] = useState<{ top: number; left: number } | null>(null);
  const [replaceRange, setReplaceRange] = useState<{ start: number; end: number } | null>(null);

  const syncEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    // Keep the floating slider pills aligned with the code lines.
    if (sliderLayerInnerRef.current) {
      sliderLayerInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }
    // Secondary multicursor selections scroll with the highlight layer.
    if (multiLayerRef.current) {
      multiLayerRef.current.scrollTop = scrollTop;
      multiLayerRef.current.scrollLeft = scrollLeft;
    }
    const position = getAutocompletePosition(e.currentTarget, cursorPos.line, cursorPos.col);
    setAutoPosition((current) => current ? position : null);
  };

  // Undo / Redo history stack
  const [history, setHistory] = useState<string[]>([code]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const isUndoRedoRef = useRef<boolean>(false);
  const lastPushTimeRef = useRef<number>(Date.now());

  // Push to undo stack on code edits
  const handleCodeChange = useCallback(
    (newVal: string) => {
      if (isUndoRedoRef.current) {
        isUndoRedoRef.current = false;
        onChange(newVal);
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastPushTimeRef.current;
      lastPushTimeRef.current = now;

      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        if (timeDiff < 350 && sliced.length > 1) {
          const updated = [...sliced];
          updated[updated.length - 1] = newVal;
          return updated;
        } else {
          const updated = [...sliced, newVal];
          if (updated.length > 100) updated.shift();
          setHistoryIndex(updated.length - 1);
          return updated;
        }
      });

      onChange(newVal);
    },
    [historyIndex, onChange]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      const targetCode = history[nextIdx];
      setHistoryIndex(nextIdx);
      isUndoRedoRef.current = true;
      onChange(targetCode);
      setAutoPosition(null);
      setExtraCursors([]);
      multiSearchRef.current = '';
    }
  }, [history, historyIndex, onChange]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      const targetCode = history[nextIdx];
      setHistoryIndex(nextIdx);
      isUndoRedoRef.current = true;
      onChange(targetCode);
      setAutoPosition(null);
      setExtraCursors([]);
      multiSearchRef.current = '';
    }
  }, [history, historyIndex, onChange]);

  const clearMulticursor = useCallback(() => {
    setExtraCursors((prev) => (prev.length === 0 ? prev : []));
    multiSearchRef.current = '';
  }, []);

  // External code swaps (preset / community load) invalidate offsets.
  useEffect(() => {
    if (code !== lastCodeRef.current) {
      if (isMultiCommitRef.current) {
        isMultiCommitRef.current = false;
      } else {
        setExtraCursors([]);
        multiSearchRef.current = '';
      }
      lastCodeRef.current = code;
    }
  }, [code]);

  // Keep the overlay aligned when it (re)mounts mid-scroll.
  useEffect(() => {
    const ta = textareaRef.current;
    const ml = multiLayerRef.current;
    if (ta && ml) {
      ml.scrollTop = ta.scrollTop;
      ml.scrollLeft = ta.scrollLeft;
    }
  });

  const readPrimaryCursor = (): { anchor: number; head: number } => {
    const ta = textareaRef.current;
    if (!ta) return { anchor: 0, head: 0 };
    const s = ta.selectionStart ?? 0;
    const e = ta.selectionEnd ?? s;
    return ta.selectionDirection === 'backward'
      ? { anchor: e, head: s }
      : { anchor: s, head: e };
  };

  const scrollOffsetIntoView = (offset: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lh = readEditorLineHeight();
    const { line } = offsetToLineCol(code, offset);
    const top = line * lh;
    if (top < ta.scrollTop + lh) ta.scrollTop = Math.max(0, top - lh * 2);
    else if (top > ta.scrollTop + ta.clientHeight - lh * 2) {
      ta.scrollTop = top - ta.clientHeight + lh * 2;
    }
    if (highlightRef.current) highlightRef.current.scrollTop = ta.scrollTop;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    if (multiLayerRef.current) multiLayerRef.current.scrollTop = ta.scrollTop;
  };

  /**
   * Apply one replacement per cursor (reps[0] is the primary). Overlapping
   * replacements merge; every cursor collapses to the end of its insert.
   */
  const commitMultiRanges = (
    reps: ({ start: number; end: number; insert: string } | null)[]
  ) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const fallback = reps.map((_, i) => {
      if (i === 0) return readPrimaryCursor().head;
      const c = extraCursors[i - 1];
      return c ? c.head : 0;
    });
    const indexed: { i: number; start: number; end: number; insert: string }[] = [];
    reps.forEach((r, i) => {
      if (r) indexed.push({ i, ...r });
    });
    if (indexed.length === 0) return;
    indexed.sort((x, y) => x.start - y.start || x.end - y.end);
    const merged: { start: number; end: number; insert: string; owners: number[] }[] = [];
    for (const r of indexed) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
        last.owners.push(r.i);
      } else {
        merged.push({ start: r.start, end: r.end, insert: r.insert, owners: [r.i] });
      }
    }
    let out = '';
    let last = 0;
    const newHead = [...fallback];
    for (const m of merged) {
      out += code.slice(last, m.start) + m.insert;
      m.owners.forEach((o) => {
        newHead[o] = out.length;
      });
      last = m.end;
    }
    out += code.slice(last);
    const newPrimary = newHead[0];
    const seen = new Set<number>([newPrimary]);
    const newExtras: MultiCursor[] = [];
    for (let k = 1; k < reps.length; k++) {
      const h = newHead[k];
      if (!seen.has(h)) {
        seen.add(h);
        newExtras.push({ anchor: h, head: h });
      }
    }
    isMultiCommitRef.current = true;
    handleCodeChange(out);
    setExtraCursors(newExtras);
    setAutoPosition(null);
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(newPrimary, newPrimary);
      } catch {}
      updateCursorPos(out, newPrimary);
    }, 0);
  };

  const allCursorRanges = (): { anchor: number; head: number }[] => [
    readPrimaryCursor(),
    ...extraCursors,
  ];

  const applyMultiText = (insert: string) => {
    const norm = insert.replace(/\r\n?/g, '\n');
    if (!norm) return;
    commitMultiRanges(
      allCursorRanges().map((c) => ({
        start: Math.min(c.anchor, c.head),
        end: Math.max(c.anchor, c.head),
        insert: norm,
      }))
    );
  };

  const applyMultiBackspace = () => {
    commitMultiRanges(
      allCursorRanges().map((c) => {
        const s = Math.min(c.anchor, c.head);
        const e = Math.max(c.anchor, c.head);
        if (s !== e) return { start: s, end: e, insert: '' };
        if (s <= 0) return null;
        return { start: s - 1, end: s, insert: '' };
      })
    );
  };

  const applyMultiDelete = () => {
    commitMultiRanges(
      allCursorRanges().map((c) => {
        const s = Math.min(c.anchor, c.head);
        const e = Math.max(c.anchor, c.head);
        if (s !== e) return { start: s, end: e, insert: '' };
        if (e >= code.length) return null;
        return { start: e, end: e + 1, insert: '' };
      })
    );
  };

  const insertMultiNewline = () => {
    const ls = code.split('\n');
    commitMultiRanges(
      allCursorRanges().map((c) => {
        const s = Math.min(c.anchor, c.head);
        const e = Math.max(c.anchor, c.head);
        const { line } = offsetToLineCol(code, c.head);
        const indent = ((ls[line] || '').match(/^\s*/) || [''])[0];
        return { start: s, end: e, insert: '\n' + indent };
      })
    );
  };

  /** Ctrl/Cmd+D: first press selects the word, later presses add the next match. */
  const addNextOccurrence = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const primary = readPrimaryCursor();
    const pStart = Math.min(primary.anchor, primary.head);
    const pEnd = Math.max(primary.anchor, primary.head);
    const ranges = [
      { start: pStart, end: pEnd },
      ...extraCursors.map((c) => ({
        start: Math.min(c.anchor, c.head),
        end: Math.max(c.anchor, c.head),
      })),
    ];
    let term = '';
    if (pEnd > pStart) {
      term = code.slice(pStart, pEnd);
    } else {
      const nonEmpty = ranges.find((r) => r.end > r.start);
      if (nonEmpty) {
        term = code.slice(nonEmpty.start, nonEmpty.end);
      } else {
        const w = getWordAt(code, primary.head);
        if (!w) return;
        ta.focus();
        try {
          ta.setSelectionRange(w.start, w.end);
        } catch {}
        multiSearchRef.current = w.text;
        updateCursorPos(code, w.end);
        setAutoPosition(null);
        return;
      }
    }
    if (!term) return;
    multiSearchRef.current = term;
    const maxEnd = Math.max(...ranges.map((r) => r.end));
    const findFrom = (from: number): number => {
      let idx = code.indexOf(term, from);
      let guard = 0;
      while (idx !== -1 && guard < 2000) {
        guard++;
        const e = idx + term.length;
        const overlap = ranges.some((r) => idx < r.end && e > r.start);
        if (!overlap) return idx;
        idx = code.indexOf(term, e);
      }
      return -1;
    };
    let idx = findFrom(maxEnd);
    if (idx === -1 && maxEnd > 0) idx = findFrom(0);
    if (idx === -1) return;
    if (extraCursors.length >= MULTI_CURSOR_CAP) return;
    setExtraCursors((prev) => [...prev, { anchor: idx, head: idx + term.length }]);
    setAutoPosition(null);
    ta.focus();
    scrollOffsetIntoView(idx);
  };

  /** Ctrl/Cmd+Shift (or Alt)+Up/Down: clone every cursor a line above/below. */
  const addCursorAboveBelow = (dir: -1 | 1) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const ls = code.split('\n');
    const all = allCursorRanges();
    const seen = new Set(all.map((c) => `${c.anchor}/${c.head}`));
    const fresh: MultiCursor[] = [];
    for (const c of all) {
      const ap = offsetToLineCol(code, c.anchor);
      const hp = offsetToLineCol(code, c.head);
      const al = Math.max(0, Math.min(ls.length - 1, ap.line + dir));
      const hl = Math.max(0, Math.min(ls.length - 1, hp.line + dir));
      const na = lineColToOffset(ls, al, ap.col);
      const nh = lineColToOffset(ls, hl, hp.col);
      const k = `${na}/${nh}`;
      if (fresh.length + all.length >= MULTI_CURSOR_CAP + 1) break;
      if (!seen.has(k)) {
        seen.add(k);
        fresh.push({ anchor: na, head: nh });
      }
    }
    if (fresh.length === 0) return;
    setExtraCursors((prev) => [...prev, ...fresh]);
    setAutoPosition(null);
    ta.focus();
  };

  /** Arrow/Home/End navigation applied to every cursor (Shift extends). */
  const moveCursors = (key: string, shift: boolean): boolean => {
    const ta = textareaRef.current;
    if (!ta) return false;
    const ls = code.split('\n');
    const all = allCursorRanges();
    const next: MultiCursor[] = [];
    for (const c of all) {
      const s = Math.min(c.anchor, c.head);
      const e = Math.max(c.anchor, c.head);
      let na = c.anchor;
      let nh = c.head;
      if (key === 'ArrowLeft') {
        if (!shift && s !== e) na = nh = s;
        else {
          nh = Math.max(0, c.head - 1);
          if (!shift) na = nh;
        }
      } else if (key === 'ArrowRight') {
        if (!shift && s !== e) na = nh = e;
        else {
          nh = Math.min(code.length, c.head + 1);
          if (!shift) na = nh;
        }
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        const d = key === 'ArrowUp' ? -1 : 1;
        const hp = offsetToLineCol(code, c.head);
        const nl = Math.max(0, Math.min(ls.length - 1, hp.line + d));
        nh = lineColToOffset(ls, nl, hp.col);
        if (!shift) na = nh;
      } else if (key === 'Home') {
        const hp = offsetToLineCol(code, c.head);
        nh = lineColToOffset(ls, hp.line, 0);
        if (!shift) na = nh;
      } else if (key === 'End') {
        const hp = offsetToLineCol(code, c.head);
        nh = lineColToOffset(ls, hp.line, (ls[hp.line] || '').length);
        if (!shift) na = nh;
      } else {
        return false;
      }
      next.push({ anchor: na, head: nh });
    }
    const [np, ...rest] = next;
    const seen = new Set([`${np.anchor}/${np.head}`]);
    const filtered = rest.filter((c) => {
      const k = `${c.anchor}/${c.head}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    setExtraCursors(filtered);
    setAutoPosition(null);
    ta.focus();
    try {
      ta.setSelectionRange(
        Math.min(np.anchor, np.head),
        Math.max(np.anchor, np.head),
        np.anchor <= np.head ? 'forward' : 'backward'
      );
    } catch {}
    updateCursorPos(code, np.head);
    return true;
  };

  /** Copy (cut=false) or cut (cut=true) across all cursors, VSCode-style. */
  const copyMultiCursors = (cut: boolean) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const ls = code.split('\n');
    const all = allCursorRanges();
    const indexed = all.map((c, i) => ({
      i,
      start: Math.min(c.anchor, c.head),
      end: Math.max(c.anchor, c.head),
    }));
    const ordered = [...indexed].sort((a, b) => a.start - b.start || a.end - b.end);
    let texts: string[];
    let reps: ({ start: number; end: number; insert: string } | null)[] | null = null;
    if (ordered.some((r) => r.end > r.start)) {
      texts = ordered.filter((r) => r.end > r.start).map((r) => code.slice(r.start, r.end));
      if (cut) {
        reps = all.map((c) => {
          const s = Math.min(c.anchor, c.head);
          const e = Math.max(c.anchor, c.head);
          return s === e ? null : { start: s, end: e, insert: '' };
        });
      }
    } else {
      const lineSet = new Set<number>();
      for (const r of ordered) lineSet.add(offsetToLineCol(code, r.start).line);
      const uniq = [...lineSet].sort((a, b) => a - b);
      texts = uniq.map((l) => ls[l] ?? '');
      if (cut) {
        const repByLine = new Map<number, { start: number; end: number; insert: string }>();
        for (const l of uniq) {
          const s = lineStartOffset(ls, l);
          const e = s + (ls[l] || '').length;
          repByLine.set(l, { start: s, end: l < ls.length - 1 ? e + 1 : e, insert: '' });
        }
        reps = all.map((c) => repByLine.get(offsetToLineCol(code, c.head).line) || null);
      }
    }
    try {
      const p = navigator.clipboard?.writeText(texts.join('\n'));
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {});
      }
    } catch {}
    if (cut && reps) commitMultiRanges(reps);
    else ta.focus();
  };

  // Compute suggestions based on cursor position
  const updateAutocomplete = useCallback(
    (text: string, cursor: number) => {
      const beforeCursor = text.slice(0, cursor);
      const currentLine = beforeCursor.split('\n').pop() || '';
      const lineIndex = beforeCursor.split('\n').length - 1;

      // Check if typing after a dot `.` e.g. `track("lead").` or `track("lead").c`
      const dotMatch = currentLine.match(/\.([a-zA-Z0-9_]*)$/);
      if (dotMatch) {
        const query = dotMatch[1].toLowerCase();
        const filtered = METHOD_SUGGESTIONS.filter((s) => s.label.toLowerCase().startsWith(query));

        if (filtered.length > 0) {
          setSuggestions(filtered);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });

          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      // Check if inside `.synth("...")`
      const synthMatch = currentLine.match(/synth\(\s*["']([^"']*)$/);
      if (synthMatch) {
        const query = synthMatch[1].toLowerCase();
        const insts = instrumentRegistry.getAll();
        const synthSugs: Suggestion[] = insts
          .filter((inst) => inst.name.toLowerCase().includes(query))
          .map((inst) => ({
            label: inst.name,
            insertText: inst.name,
            type: 'synth',
            detail: `synth: ${inst.type}`,
            documentation: `Synthesizer instrument patch with ${inst.oscillatorType} wave.`,
          }));

        if (synthSugs.length > 0) {
          setSuggestions(synthSugs);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });
          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      // Check if inside `.pattern("...")`
      const patMatch = currentLine.match(/pattern\(\s*["']([^"']*)$/);
      if (patMatch) {
        const query = patMatch[1].toLowerCase();
        const shared = patternScheduler.getSharedPatterns();
        const patSugs: Suggestion[] = Object.entries(shared)
          .filter(([k]) => k.includes(query))
          .map(([name, notation]) => ({
            label: name,
            insertText: name,
            type: 'pattern',
            detail: notation,
            documentation: `Shared master pattern: "${notation}"`,
          }));

        if (patSugs.length > 0) {
          setSuggestions(patSugs);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });
          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      // Check if inside `s("...")` for samples
      const sampleMatch = currentLine.match(/s\(\s*["']([^"']*)$/);
      if (sampleMatch) {
        const query = sampleMatch[1].toLowerCase();
        const samples = sampleManager.getAllSamples();
        const sampleSugs: Suggestion[] = samples
          .filter((s) => s.name.toLowerCase().includes(query))
          .slice(0, 8)
          .map((s) => ({
            label: s.name,
            insertText: s.name,
            type: 'sample',
            detail: `${(s.duration || 0).toFixed(2)}s audio`,
            documentation: `Audio sample item (${s.isUserUploaded ? 'user uploaded' : 'built-in'}).`,
          }));

        if (sampleSugs.length > 0) {
          setSuggestions(sampleSugs);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });
          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      // Check if inside `.midi("...")`
      const midiMatch = currentLine.match(/midi\(\s*["']([^"']*)$/);
      if (midiMatch) {
        const query = midiMatch[1].toLowerCase();
        const clips = midiManager.getRecordedClips();
        const clipSugs: Suggestion[] = clips
          .filter((c) => c.name.toLowerCase().includes(query))
          .map((c) => ({
            label: c.name,
            insertText: c.name,
            type: 'clip',
            detail: `${c.notes.length} notes · ${c.durationBeats}b`,
            documentation: 'Recorded or imported live MIDI clip.',
          }));

        if (clipSugs.length > 0) {
          setSuggestions(clipSugs);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });
          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      // Check if inside `.vst("...")` — suggest detected MIDI ports + known plugins
      const vstMatch = currentLine.match(/vst\(\s*["']([^"']*)$/);
      if (vstMatch) {
        const query = vstMatch[1].toLowerCase();
        const outs = vstBridge.getDiagnostics().midiOutputs;
        const portSugs: Suggestion[] = outs
          .filter((o) => o.name.toLowerCase().includes(query))
          .slice(0, 6)
          .map((o) => ({
            label: o.name,
            insertText: o.name,
            type: 'port',
            detail: 'detected MIDI port',
            documentation: `Route this track to the "${o.name}" MIDI output.`,
          }));
        const KNOWN_PLUGINS = [
          'Serum (External VST3)',
          'Vital (External VST3)',
          'Diva (External VST)',
          'Ardour MIDI Bus',
          'Reaper MIDI In',
          'Bitwig Note In',
          'Carla Rack (Linux)',
          'FL Studio MIDI Out',
        ];
        const plugSugs: Suggestion[] = KNOWN_PLUGINS.filter((plug) =>
          plug.toLowerCase().includes(query)
        ).map((plug) => ({
          label: plug,
          insertText: plug,
          type: 'vst',
          detail: 'bridge plugin target',
          documentation: "Send this track's notes to this plugin / DAW bus via the VST bridge.",
        }));
        const all = [...portSugs, ...plugSugs].slice(0, 10);
        if (all.length > 0) {
          setSuggestions(all);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });
          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      // General top-level keywords
      const wordMatch = currentLine.match(/^([a-zA-Z0-9_]*)$/);
      if (wordMatch && wordMatch[1].length >= 2) {
        const query = wordMatch[1].toLowerCase();
        const kwSugs = KEYWORD_SUGGESTIONS.filter((k) => k.label.toLowerCase().startsWith(query));
        if (kwSugs.length > 0) {
          setSuggestions(kwSugs);
          setAutoIndex(0);
          setReplaceRange({ start: cursor - query.length, end: cursor });
          setAutoPosition(getAutocompletePosition(textareaRef.current, lineIndex, currentLine.length));
          return;
        }
      }

      setAutoPosition(null);
    },
    []
  );

  const insertSuggestion = (sug: Suggestion) => {
    if (!replaceRange || !textareaRef.current) return;

    let insertion = sug.insertText;
    // Replace $1 with empty or select
    insertion = insertion.replace(/\$1/g, '').replace(/\$2/g, '');

    const newCode = code.slice(0, replaceRange.start) + insertion + code.slice(replaceRange.end);
    const newCursor = replaceRange.start + insertion.length;

    handleCodeChange(newCode);
    setAutoPosition(null);
    clearMulticursor();

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newCursor;
      }
    }, 0);
  };

  // Subscribe to real-time playing events for token highlighting
  useEffect(() => {
    const unsubEvent = patternScheduler.subscribeEvent((ev) => {
      setActiveEvents((prev) => {
        const next = new Map(prev);
        const key = `${ev.trackId}:${ev.notation}:${ev.value}:${ev.valueOccurrence}`;
        // Held notes stay highlighted for their sounding duration (capped so
        // a stuck note can't light a token forever); short hits keep 120ms.
        const holdMs = Math.min(Math.max(ev.duration || 0, 0), 4) * 1000;
        next.set(key, {
          value: normalizeEventToken(ev.value),
          notation: normalizeNotation(ev.notation),
          valueOccurrence: ev.valueOccurrence,
          time: ev.time,
          expiresAt: ev.time + Math.max(120, holdMs),
        });
        return next;
      });
    });

    const cleanInterval = setInterval(() => {
      const now = Date.now();
      setActiveEvents((prev) => {
        let changed = false;
        const next = new Map(prev);
        next.forEach((entry, key) => {
          if (now > entry.expiresAt) {
            next.delete(key);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 45);

    return () => {
      unsubEvent();
      clearInterval(cleanInterval);
    };
  }, []);

  // Prime detected MIDI ports for `.vst()` autocomplete
  useEffect(() => {
    vstBridge.refreshMidiOutputs().catch(() => {});
  }, []);

  const lines = code.split('\n');

  // Toggle // comments on the selected lines (or the current line).
  const toggleLineComments = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const lines = code.split('\n');

    const lineStartOffsets: number[] = [];
    let offset = 0;
    lines.forEach((line) => {
      lineStartOffsets.push(offset);
      offset += line.length + 1;
    });
    const lineOf = (pos: number) => {
      let idx = lineStartOffsets.findIndex((lineOffset, i) => {
        const next = i + 1 < lineStartOffsets.length ? lineStartOffsets[i + 1] : Infinity;
        return pos >= lineOffset && pos < next;
      });
      return idx === -1 ? lines.length - 1 : idx;
    };
    const startLine = lineOf(selStart);
    const endLine = lineOf(Math.max(selStart, selEnd - (selEnd > selStart ? 1 : 0)));

    // With multicursors active, toggle every cursor's lines (VSCode parity).
    const targetLines = new Set<number>();
    for (let i = startLine; i <= endLine; i++) targetLines.add(i);
    for (const c of extraCursors) {
      const s = Math.min(c.anchor, c.head);
      const e = Math.max(c.anchor, c.head);
      const sl = lineOf(s);
      const el = lineOf(Math.max(s, e - (e > s ? 1 : 0)));
      for (let i = sl; i <= el; i++) targetLines.add(i);
    }

    const inRange = [...targetLines].sort((a, b) => a - b).map((i) => lines[i]);
    const nonBlank = inRange.filter((l) => l.trim().length > 0);
    if (nonBlank.length === 0) return;
    const allCommented = nonBlank.every((l) => /^\s*\/\//.test(l));

    const deltas = new Array(lines.length).fill(0);
    const next = lines.map((line, idx) => {
      if (!targetLines.has(idx) || line.trim().length === 0) return line;
      const updated = allCommented
        ? line.replace(/^(\s*)\/\/ ?/, '$1')
        : line.replace(/^(\s*)/, '$1// ');
      deltas[idx] = updated.length - line.length;
      return updated;
    });

    let shiftStart = 0;
    let shiftEnd = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i < startLine) {
        shiftStart += deltas[i];
        shiftEnd += deltas[i];
      } else if (i === startLine) {
        shiftStart += deltas[i];
        shiftEnd += deltas[i];
      } else if (i <= endLine) {
        shiftEnd += deltas[i];
      }
    }

    handleCodeChange(next.join('\n'));
    setAutoPosition(null);
    clearMulticursor();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart + shiftStart, selEnd + shiftEnd);
      updateCursorPos(next.join('\n'), selEnd + shiftEnd);
    });
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Comment toggle wins over everything (and must not reach the window
    // handler, which no longer binds Ctrl+/ anyway).
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      e.stopPropagation();
      toggleLineComments();
      return;
    }

    // VSCode-style multicursor: Ctrl/Cmd+D adds the next occurrence.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      e.stopPropagation();
      addNextOccurrence();
      return;
    }

    // VSCode "add cursor above/below" (Ctrl+Alt+Up/Down by default; take
    // Ctrl/Cmd+Shift+Up/Down too since the OS often grabs Ctrl+Alt+arrows).
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.shiftKey || e.altKey) &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      e.preventDefault();
      e.stopPropagation();
      addCursorAboveBelow(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    // While secondary cursors are live, plain editing keys apply to every
    // cursor and take precedence over autocomplete.
    if (extraCursors.length > 0) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        e.stopPropagation();
        setAutoPosition(null);
        copyMultiCursors(false);
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        e.stopPropagation();
        setAutoPosition(null);
        copyMultiCursors(true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (autoPosition) setAutoPosition(null);
        else clearMulticursor();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        // Native select-all takes over; extras would go stale.
        clearMulticursor();
        return;
      }
      if (e.key === 'Enter' && !mod && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        insertMultiNewline();
        return;
      }
      if (e.key === 'Tab' && !mod && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        applyMultiText('  ');
        return;
      }
      if (e.key === 'Backspace' && !mod && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        applyMultiBackspace();
        return;
      }
      if (e.key === 'Delete' && !mod && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        applyMultiDelete();
        return;
      }
      if (e.key.length === 1 && !mod && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        applyMultiText(e.key);
        return;
      }
      if (
        (e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'Home' ||
          e.key === 'End') &&
        !mod &&
        !e.altKey
      ) {
        if (moveCursors(e.key, e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
        } else {
          clearMulticursor();
        }
        return;
      }
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'PageUp' ||
        e.key === 'PageDown' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        // Word jumps / paging only move the primary: exit multicursor.
        clearMulticursor();
        return;
      }
    }

    // Autocomplete navigation
    if (autoPosition && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutoIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutoIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(suggestions[autoIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutoPosition(null);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      handleFormatCode();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      handleRedo();
    } else if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      onEvalNextBeat();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onEval();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newCode = code.substring(0, start) + '  ' + code.substring(end);
      handleCodeChange(newCode);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateCursorPos = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    setCursorPos({
      line: before.split('\n').length - 1,
      col: cursor - (before.lastIndexOf('\n') + 1),
    });
  };

  const handleFormatCode = () => {
    const formatted = formatCode(code, formatWidth);
    if (formatted === code) return;

    const cursor = textareaRef.current?.selectionStart ?? 0;
    clearMulticursor();
    handleCodeChange(formatted);
    setAutoPosition(null);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextCursor = Math.min(cursor, formatted.length);
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      updateCursorPos(formatted, nextCursor);
    });
  };

  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    handleCodeChange(val);
    updateAutocomplete(val, e.target.selectionStart);
    updateCursorPos(val, e.target.selectionStart);
  };

  const onTextSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    updateCursorPos(target.value, target.selectionStart);
    // Programmatic selection syncs while multicursors are live must not
    // resurrect the autocomplete popup mid-gesture.
    if (extraCursors.length === 0) {
      updateAutocomplete(target.value, target.selectionStart);
    }
  };

  const onMultiPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (extraCursors.length === 0) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (text) applyMultiText(text);
  };

  const onEditorMouseDown = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (e.button !== 0) return;
    const ta = e.currentTarget;
    if (e.altKey) {
      // Alt+Click adds a cursor: remember the pre-click primary so the
      // click handler can keep it as a secondary cursor.
      mouseDownSelRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
    } else if (extraCursors.length > 0 && !e.shiftKey) {
      clearMulticursor();
    }
  };

  const onEditorClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!e.altKey || e.button !== 0) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const prev = mouseDownSelRef.current;
    mouseDownSelRef.current = null;
    const cur = { anchor: ta.selectionStart, head: ta.selectionEnd };
    const norm = (c: { anchor: number; head: number }) =>
      `${Math.min(c.anchor, c.head)}/${Math.max(c.anchor, c.head)}`;
    setExtraCursors((prior) => {
      const seen = new Set([norm(cur), ...prior.map(norm)]);
      const next = [...prior];
      if (prev) {
        const p = { anchor: prev.start, head: prev.end };
        if (!seen.has(norm(p))) {
          seen.add(norm(p));
          next.push(p);
        }
      }
      return next.length > MULTI_CURSOR_CAP ? next.slice(next.length - MULTI_CURSOR_CAP) : next;
    });
    setAutoPosition(null);
    ta.focus();
  };

  // Full logical strings for `"a" + "b"` fragments (formatCode splits long
  // notations across lines). Maps `${lineIdx}:${nthOnLine}` -> chain info.
  const concatChainMap = React.useMemo(() => buildConcatChainMap(code), [code]);

  // Helper to highlight inner tokens of a mini-notation string
  const renderMiniNotationString = (strLiteral: string, chainInfo?: ConcatChainInfo) => {
    const inner = strLiteral.slice(1, -1);
    const quoteChar = strLiteral[0];
    const effectiveNotation = normalizeNotation(chainInfo ? chainInfo.full : inner);
    const tokens = inner.split(MINI_TOKEN_SPLIT);
    const matchingEvents = Array.from(activeEvents.values()).filter((event) => event.notation === effectiveNotation);
    const seenValues = new Map<string, number>();

    return (
      <span className="font-mono">
        <span className="pg-tok-string-punct">{quoteChar}</span>
        {tokens.map((tok, tIdx) => {
          if (!tok) return null;
          const cleanTok = normalizeEventToken(tok);
          const localOccurrence = seenValues.get(cleanTok) || 0;
          const occurrence = localOccurrence + (chainInfo && cleanTok ? (chainInfo.precedingCounts.get(cleanTok) || 0) : 0);
          const repeatCount = tokens[tIdx + 1] === '*' || tokens[tIdx + 1] === '!'
            ? Math.max(1, parseInt(tokens[tIdx + 2] || '1', 10) || 1)
            : 1;
          const isTriggering = matchingEvents.some(
            (event) => event.value === cleanTok && event.valueOccurrence >= occurrence && event.valueOccurrence < occurrence + repeatCount
          );
          if (cleanTok) seenValues.set(cleanTok, localOccurrence + 1);

          if (isTriggering) {
            return (
              <span
                key={tIdx}
                className="pg-tok-flash"
              >
                {tok}
              </span>
            );
          }

          if (tok.match(/^(\[|\]|,)$/)) {
            return (
              <span key={tIdx} className="pg-tok-string-punct">
                {tok}
              </span>
            );
          }
          if (tok === '~' || tok === '-') {
            return (
              <span key={tIdx} className="pg-faint">
                {tok}
              </span>
            );
          }

          return (
            <span key={tIdx} className="pg-tok-string">
              {tok}
            </span>
          );
        })}
        <span className="pg-tok-string-punct">{quoteChar}</span>
      </span>
    );
  };

  // Per-line inline widgets: which track's chain a line belongs to (carried
  // across wrapped chain lines until `;`) and which viz methods it calls.
  // Mirrors Strudel's block widgets (`_pianoroll`, `_spiral`, ...) placement.
  let currentTrackId: string | null = null;
  const lineViz: { trackId: string; types: TrackVizType[] }[] = lines.map((line) => {
    const trackMatch = line.match(/track\(\s*["']([^"']+)["']\s*\)/);
    if (trackMatch) currentTrackId = trackMatch[1];
    const entry = { trackId: currentTrackId || '', types: currentTrackId ? vizTypesInLine(line) : [] };
    if (line.includes(';')) currentTrackId = null;
    return entry;
  });

  // `slider(...)` call sites for the floating slider pills (Strudel parity).
  const sliderSites = React.useMemo(() => scanSliderCalls(code), [code]);
  const sliderSitesByLine = React.useMemo(() => {
    const map = new Map<number, SliderCallSite[]>();
    for (const site of sliderSites) {
      const list = map.get(site.lineIdx) || [];
      list.push(site);
      map.set(site.lineIdx, list);
    }
    return map;
  }, [sliderSites]);

  // Evaluated widget options (cycles, size, ...) for the inline renderers.
  const [evaluatedWidgets, setEvaluatedWidgets] = useState<Record<string, TrackVizWidget[]>>({});
  useEffect(() => {
    const refresh = () => {
      const map: Record<string, TrackVizWidget[]> = {};
      for (const t of patternScheduler.getEvaluatedTracks()) {
        if (t.widgets && t.widgets.length > 0) map[t.id] = t.widgets;
      }
      setEvaluatedWidgets(map);
    };
    refresh();
    return patternScheduler.subscribeTracks(refresh);
  }, []);

  const handleSliderInput = (site: SliderCallSite, raw: number) => {
    const text = formatSliderValue(site, raw);
    const parsed = Number(text);
    const newCode = code.slice(0, site.valueStart) + text + code.slice(site.valueEnd);
    sliderStore.setByIndex(site.index, parsed);
    clearMulticursor();
    handleCodeChange(newCode);
    // Live-update the sounding voice without re-evaluating (Strudel ref parity).
    patternScheduler.applySliderValue(`n${site.index}`, parsed);
  };

  // Secondary multicursor paint: absolutely-positioned selection blocks and
  // caret bars at content coordinates; the layer scrolls in sync with the
  // highlight layer (see syncEditorScroll + the mount-sync effect above).
  const renderMultiCursors = () => {
    if (extraCursors.length === 0) return null;
    const lh = readEditorLineHeight();
    const cw = measureCharWidth();
    const padL = 16; // px-4
    const padT = 12; // py-3
    const sels: { top: number; left: number; width: number; key: string }[] = [];
    const carets: { top: number; left: number; key: string }[] = [];
    extraCursors.forEach((c, idx) => {
      const s = Math.min(c.anchor, c.head);
      const e = Math.max(c.anchor, c.head);
      const a = offsetToLineCol(code, s);
      const b = offsetToLineCol(code, e);
      const pushCaret = (line: number, col: number, key: string) => {
        carets.push({
          top: padT + line * lh,
          left: padL + visualCol(lines[line] || '', col) * cw,
          key,
        });
      };
      if (a.line === b.line) {
        const lt = lines[a.line] || '';
        const left = padL + visualCol(lt, a.col) * cw;
        const width = (visualCol(lt, b.col) - visualCol(lt, a.col)) * cw;
        if (s !== e && width > 0.5) {
          sels.push({ top: padT + a.line * lh, left, width, key: `ms${idx}` });
        }
        pushCaret(b.line, b.col, `mc${idx}`);
      } else {
        const [first, last] = a.line < b.line ? [a, b] : [b, a];
        const head = a.line < b.line ? b : a;
        const firstText = lines[first.line] || '';
        const firstLeft = padL + visualCol(firstText, first.col) * cw;
        const firstWidth =
          (visualCol(firstText, firstText.length) - visualCol(firstText, first.col)) * cw;
        if (firstWidth > 0.5) {
          sels.push({ top: padT + first.line * lh, left: firstLeft, width: firstWidth, key: `ms${idx}f` });
        }
        for (let l = first.line + 1; l < last.line; l++) {
          const lt = lines[l] || '';
          if (lt.length === 0) continue;
          sels.push({
            top: padT + l * lh,
            left: padL,
            width: visualCol(lt, lt.length) * cw,
            key: `ms${idx}m${l}`,
          });
        }
        const lastText = lines[last.line] || '';
        const lastWidth = visualCol(lastText, last.col) * cw;
        if (lastWidth > 0.5) {
          sels.push({ top: padT + last.line * lh, left: padL, width: lastWidth, key: `ms${idx}l` });
        }
        pushCaret(head.line, head.col, `mc${idx}`);
      }
    });
    return (
      <>
        {sels.map((r) => (
          <span
            key={r.key}
            className="pg-multi-sel"
            style={{ top: r.top, left: r.left, width: r.width, height: lh }}
          />
        ))}
        {carets.map((r) => (
          <span
            key={r.key}
            className="pg-multi-caret"
            style={{ top: r.top, left: r.left, height: lh }}
          />
        ))}
      </>
    );
  };

  // Highlighting engine for display overlay
  const renderHighlightedCode = () => {
    return lines.map((line, lineIdx) => {
      // Check if comment
      if (line.trim().startsWith('//')) {
        return (
          <div key={lineIdx} className="pg-tok-comment">
            {line || '\u00A0'}
          </div>
        );
      }

      const viz = lineViz[lineIdx];
      const trackId = viz.types.length > 0 ? viz.trackId : null;
      const isScopeLine = viz.types.includes('scope') && Boolean(trackId);
      const inlineVizTypes = viz.types.filter((t) => t !== 'scope');

      // Token regex for live-coding methods and strings
      const parts = line.split(
        /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|from|as|track|defPattern|def|bpm|cpm|setcpm|setbpm|slider|sliderWithID|s|note|sound|set|scale|sine|synth|vst|scope|meter|pianoroll|punchcard|wordfall|spiral|spectrum|fscope|pitchwheel|_pianoroll|_punchcard|_spiral|_scope|_spectrum|_pitchwheel|pattern|midi|gain|pan|cutoff|lpf|hpf|res|resonance|reverb|room|size|delay|delaytime|delayt|dt|delayfeedback|delayfb|dfb|chorus|distort|crush|vib|vibmod|attack|att|decay|dec|sustain|sus|release|rel|legato|orbit|duckorbit|duckattack|duckdepth|duckonset|color|fast|slow|transpose|oct|octave|vstChannel|vstOutput|mute|solo|soundAlias|samples)\b|\d+(?:\.\d+)?)/g
      );
      let stringNthOnLine = -1;

      return (
        <div key={lineIdx} className={lineIdx === cursorPos.line ? 'pg-current-line' : undefined}>
          <div>
            {parts.map((part, pIdx) => {
              if (!part) return null;

              // Mini-notation strings with real-time active token flash
              if (isStringLiteralPart(part)) {
                stringNthOnLine++;
                const chainInfo = concatChainMap.get(`${lineIdx}:${stringNthOnLine}`);
                return <React.Fragment key={pIdx}>{renderMiniNotationString(part, chainInfo)}</React.Fragment>;
              }

              // Core DSL keywords
              if (['import', 'from', 'as', 'track', 'defPattern', 'def', 'bpm', 'cpm', 'setcpm', 'setbpm', 'slider', 'sliderWithID', 's', 'note', 'sound', 'set', 'scale', 'sine', 'synth', 'vst', 'soundAlias', 'samples'].includes(part)) {
                return (
                  <span key={pIdx} className="pg-tok-keyword">
                    {part}
                  </span>
                );
              }

              // Chained methods
              if (
                [
                  'pattern',
                  'midi',
                  'scope',
                  'meter',
                  'pianoroll',
                  'punchcard',
                  'wordfall',
                  'spiral',
                  'spectrum',
                  'fscope',
                  'pitchwheel',
                  '_pianoroll',
                  '_punchcard',
                  '_spiral',
                  '_scope',
                  '_spectrum',
                  '_pitchwheel',
                  'gain',
                  'pan',
                  'cutoff',
                  'lpf',
                  'hpf',
                  'res',
                  'resonance',
                  'reverb',
                  'room',
                  'size',
                  'delay',
                  'delaytime',
                  'delayt',
                  'dt',
                  'delayfeedback',
                  'delayfb',
                  'dfb',
                  'chorus',
                  'distort',
                  'crush',
                  'vib',
                  'vibmod',
                  'attack',
                  'att',
                  'decay',
                  'dec',
                  'sustain',
                  'sus',
                  'release',
                  'rel',
                  'legato',
                  'orbit',
                  'duckorbit',
                  'duckattack',
                  'duckdepth',
                  'duckonset',
                  'color',
                  's',
                  'note',
                  'sound',
                  'set',
                  'scale',
                  'fast',
                  'slow',
                  'transpose',
                  'oct',
                  'octave',
                  'vstChannel',
                  'vstOutput',
                  'mute',
                  'solo',
                ].includes(part)
              ) {
                return (
                  <span key={pIdx} className="pg-tok-method">
                    {part}
                  </span>
                );
              }

              // Numbers
              if (/^\d+(?:\.\d+)?$/.test(part)) {
                return (
                  <span key={pIdx} className="pg-tok-number">
                    {part}
                  </span>
                );
              }

              return <span key={pIdx} style={{color:'var(--pg-text)'}}>{part}</span>;
            })}
            {line === '' && '\u00A0'}
            {isScopeLine && trackId && <InlineScope trackId={trackId} trackName={trackId} />}
            {trackId && inlineVizTypes.map((t) => {
              const known = (evaluatedWidgets[trackId] || []).find((w) => w.type === t);
              return (
                <InlineViz
                  key={t}
                  trackId={trackId}
                  trackName={trackId}
                  widget={known || { type: t }}
                />
              );
            })}
          </div>
        </div>
      );
    });
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Beat pulse + impact shake via WAAPI: no React state, no remounts, no
  // layout shift. Throttled so 16th-note steps can't spam the compositor.
  const handleFxBeat = useCallback(() => {
    const now = performance.now();
    if (now - fxLastBeatAt.current < 150) return;
    fxLastBeatAt.current = now;
    fxFrameRef.current?.animate(
      [
        { boxShadow: '0 0 0 1px color-mix(in srgb, var(--pg-accent) 45%, transparent), 0 0 14px 0 color-mix(in srgb, var(--pg-accent) 22%, transparent)' },
        { boxShadow: '0 0 0 0 transparent' },
      ],
      { duration: 260, easing: 'ease-out' }
    );
  }, []);
  const fxLastImpactAt = useRef(0);
  const fxSettingsRef = useRef(eventFx);
  fxSettingsRef.current = eventFx;
  const handleFxImpact = useCallback((strong?: boolean) => {
    const now = performance.now();
    // Light throttle so 16th-note kicks slam without stacking the compositor.
    if (now - fxLastImpactAt.current < 50) return;
    fxLastImpactAt.current = now;
    // Variable impact throw: 0 → subtle tremor, 100 → full slam.
    // Strong hits get the full throw; weak ones (preview) get a softer kick.
    const amount = (fxSettingsRef.current.shakeIntensity ?? 60) / 100;
    const base = 1 + amount * 11;
    const big = strong !== false;
    const scale = big ? 1 : 0.55;
    const jx = base * scale;
    const jy = base * 0.72 * scale;
    const roll = (0.08 + amount * 0.5) * scale;
    fxInnerRef.current?.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)' },
        { transform: `translate(${jx.toFixed(1)}px, ${(-jy).toFixed(1)}px) rotate(${roll.toFixed(2)}deg)` },
        { transform: `translate(${(-jx * 0.7).toFixed(1)}px, ${(jy * 0.6).toFixed(1)}px) rotate(${(-roll * 0.7).toFixed(2)}deg)` },
        { transform: `translate(${(jx * 0.35).toFixed(1)}px, ${(jy * 0.3).toFixed(1)}px) rotate(${(roll * 0.3).toFixed(2)}deg)` },
        { transform: 'translate(0, 0) rotate(0deg)' },
      ],
      { duration: big ? 170 + amount * 110 : 180, easing: 'cubic-bezier(.36,.07,.19,.97)' }
    );
    // Frame punch scales with the same amount — quick border flash alongside the shake.
    const punch = 1 + amount * 2;
    fxFrameRef.current?.animate(
      [
        { boxShadow: `0 0 0 ${punch.toFixed(1)}px color-mix(in srgb, var(--pg-accent-2) 70%, transparent), 0 0 ${(14 + amount * 22).toFixed(0)}px 0 color-mix(in srgb, var(--pg-accent-2) 40%, transparent)` },
        { boxShadow: '0 0 0 0 transparent' },
      ],
      { duration: 220, easing: 'ease-out' }
    );
  }, []);

  return (
    <div
      ref={fxFrameRef}
      className="relative flex flex-col h-full pg-panel pg-editor-frame"
      style={{ background: 'var(--pg-editor-bg)' }}
    >
      {/* Editor Header Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 text-xs pg-panel-header">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium" style={{ color: 'var(--pg-text)' }}>Session code</span>

          {/* Undo / Redo Buttons */}
          <div className="flex items-center gap-0.5 ml-2 p-0.5 rounded-md border" style={{ background: 'var(--pg-surface-3)', borderColor: 'var(--pg-border)' }}>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`p-1 rounded-sm transition-colors ${
                !canUndo ? 'opacity-30 cursor-not-allowed' : ''
              }`} style={{ color: 'var(--pg-muted)' }}
              title="Undo syntax changes (Ctrl+Z)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className={`p-1 rounded-sm transition-colors ${
                !canRedo ? 'opacity-30 cursor-not-allowed' : ''
              }`} style={{ color: 'var(--pg-muted)' }}
              title="Redo syntax changes (Ctrl+Y or Ctrl+Shift+Z)"
            >
              <RotateCw className="w-3 h-3" />
            </button>
          </div>

          {queuedTarget && (
            <div className="flex items-center gap-1 px-2 py-1 bg-amber-950 border border-amber-600/70 text-amber-300 rounded-md text-[11px]">
              <Clock className="w-3 h-3" />
              <span>Queued for {queuedTarget === 'next_beat' ? 'next beat' : 'next cycle'}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors hover:brightness-125" style={{ color: 'var(--pg-muted)' }}
            title="Copy code"
          >
            {copied ? <Check className="w-3 h-3" style={{ color: 'var(--pg-ok)' }} /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Eval Next Beat Button */}
          <button
            onClick={onEvalNextBeat}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors hover:brightness-110" style={{ color: 'var(--pg-warn)', borderColor: 'var(--pg-border)', background: 'var(--pg-surface)' }}
            title="Queue code update on next quarter note beat (Alt+Enter)"
          >
            <Clock className="w-3 h-3" />
            <span>Queue on beat</span>
            <kbd className="hidden sm:inline pg-kbd">
              Alt+↵
            </kbd>
          </button>

          {/* Eval Now Button */}
          <button
            onClick={onEval}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md font-semibold pg-btn-accent transition-colors ${evalFlash ? 'pg-eval-glow' : ''}`}
            title="Evaluate code immediately (Ctrl+Enter)"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Evaluate</span>
            <kbd className="hidden sm:inline pg-kbd">
              Ctrl+↵
            </kbd>
          </button>
        </div>
      </div>

      {/* Code Editor Container */}
      <div ref={fxInnerRef} className="relative flex-1 flex overflow-hidden pg-editor">
        {wallpaperImage && <div aria-hidden="true" className="pg-editor-wallpaper absolute inset-0 z-0 pointer-events-none" />}
        {visualizerOverlay && (
          <VisualizerCanvas
            mode={visualizerMode}
            transparent
            opacity={visualizerOpacity}
            className="absolute inset-0 z-0 h-full w-full pointer-events-none"
          />
        )}
        {/* Line Numbers */}
        <div ref={gutterRef} className="pg-editor-gutter relative z-10 w-[54px] py-3 select-none text-right pr-4 font-mono text-xs shrink-0 overflow-hidden pg-gutter-lines">
          {lines.map((_, idx) => (
            <div key={idx} style={idx === cursorPos.line ? { color: 'var(--pg-text)', fontWeight: 600 } : undefined}>
              {idx + 1}
            </div>
          ))}
        </div>

        {/* Textarea + Syntax Highlight Layer */}
        <div className="relative z-10 flex-1 h-full overflow-auto">
          {/* Highlighted text layer */}
          <div
            ref={highlightRef}
            aria-hidden="true"
            className="absolute inset-0 px-4 py-3 pointer-events-none whitespace-pre overflow-hidden select-none pg-editor pg-editor-lines"
          >
            {renderHighlightedCode()}
          </div>

          {/* Secondary multicursor paint (primary keeps native rendering) */}
          {extraCursors.length > 0 && (
            <div
              ref={multiLayerRef}
              aria-hidden="true"
              className="absolute inset-0 px-4 py-3 pointer-events-none overflow-hidden select-none"
            >
              <div className="absolute top-0 left-0 w-full">{renderMultiCursors()}</div>
            </div>
          )}

          {/* Interactive Textarea */}
          <textarea
            ref={textareaRef}
            value={code}
            onChange={onTextChange}
            onSelect={onTextSelect}
            onScroll={syncEditorScroll}
            onKeyDown={handleKeyDown}
            onPaste={onMultiPaste}
            onMouseDown={onEditorMouseDown}
            onClick={onEditorClick}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="absolute inset-0 w-full h-full px-4 py-3 bg-transparent resize-none focus:outline-none whitespace-pre pg-editor" style={{ color: 'transparent', caretColor: 'var(--pg-accent)' }}
          />

          {/* Event FX layer: particles + floating note labels + flash wash */}
          {eventFx.enabled && (
            <div className="absolute inset-0 z-20 pointer-events-none">
              <EventFxOverlay code={code} onBeatPulse={handleFxBeat} onImpact={handleFxImpact} />
            </div>
          )}

          {/* Floating slider pills (Strudel `slider()` parity): one compact
              range input per `slider(...)` call site, parked at the end of its
              code line. Dragging rewrites the code literal and live-updates
              the sounding value without re-evaluating. */}
          <div aria-hidden={sliderSites.length === 0} className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
            <div ref={sliderLayerInnerRef} className="absolute top-0 left-0">
              {sliderSites.map((site) => {
                const orderOnLine = (sliderSitesByLine.get(site.lineIdx) || []).indexOf(site);
                const lh = readEditorLineHeight();
                let fontSize = 14;
                try {
                  fontSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pg-editor-size')) || 14;
                } catch {}
                const charW = fontSize * 0.6;
                const expandedLen = (lines[site.lineIdx] || '').replace(/\t/g, '  ').length;
                const top = 12 + site.lineIdx * lh + Math.max(0, (lh - 20) / 2);
                const left = 16 + expandedLen * charW + 8 + Math.max(0, orderOnLine) * 148;
                const step = site.step ?? (site.max - site.min) / 1000;
                return (
                  <span
                    key={`${site.lineIdx}:${site.index}`}
                    className="absolute flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-md border font-mono pointer-events-auto"
                    style={{
                      top,
                      left,
                      background: 'color-mix(in srgb, var(--pg-surface-2) 92%, transparent)',
                      borderColor: 'var(--pg-border)',
                    }}
                    title={`slider(${site.value}, ${site.min}, ${site.max}) — drag to perform`}
                  >
                    <input
                      type="range"
                      aria-label={`Slider ${site.index + 1}: value ${site.value}, range ${site.min} to ${site.max}`}
                      min={site.min}
                      max={site.max}
                      step={step}
                      value={site.value}
                      onChange={(e) => handleSliderInput(site, Number(e.target.value))}
                      className="w-[72px] h-4"
                      style={{ accentColor: 'var(--pg-accent)' }}
                    />
                    <span className="text-[10px] tabular-nums min-w-8 text-right" style={{ color: 'var(--pg-text)' }}>
                      {formatSliderValue(site, site.value)}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>

      {/* Autocomplete popup */}
          {autoPosition && suggestions.length > 0 && (
            <div
              className="absolute z-40 w-80 rounded-md shadow-lg overflow-hidden text-xs font-sans pointer-events-auto"
              style={{
                background: 'color-mix(in srgb, var(--pg-surface-2) 94%, transparent)',
                border: '1px solid var(--pg-border)',
                top: `${autoPosition.top}px`,
                left: `${autoPosition.left}px`,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-mono pg-faint" style={{ background: 'var(--pg-surface-3)' }}>
                <span className="flex items-center gap-1 font-bold" style={{ color: 'var(--pg-accent)' }}>
                  <Code2 className="w-3 h-3" />
                  <span>Suggestions</span>
                </span>
                <span>Tab / ↵ to insert</span>
              </div>

              {/* Suggestions List */}
              <div className="max-h-48 overflow-y-auto">
                {suggestions.map((sug, idx) => {
                  const isSelected = idx === autoIndex;
                  return (
                    <div
                      key={sug.label}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSuggestion(sug);
                      }}
                      className="px-2.5 py-1.5 cursor-pointer flex items-center justify-between transition-colors"
                      style={
                        isSelected
                          ? { background: 'color-mix(in srgb, var(--pg-accent) 8%, transparent)' }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono font-semibold text-xs" style={{ color: 'var(--pg-text)' }}>{sug.label}</span>
                        <span className="text-[10px] pg-faint font-mono">{sug.detail}</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase shrink-0" style={{ background: 'var(--pg-surface-3)', color: 'var(--pg-muted)' }}>
                        {sug.type}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Documentation Footer */}
              {suggestions[autoIndex] && (
                <div className="p-2 text-[11px] pg-muted" style={{ background: 'var(--pg-surface-3)' }}>
                  <p className="font-medium">{suggestions[autoIndex].documentation}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Editor status bar */}
      <div
        className="flex items-center justify-between px-3 py-1 text-[10px] font-mono pg-faint shrink-0"
        style={{ borderTop: '1px solid var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
      >
        <span className="tabular-nums">
          Ln {cursorPos.line + 1}, Col {cursorPos.col + 1} · {lines.length} lines · {code.length} chars
          {extraCursors.length > 0 && (
            <span style={{ color: 'var(--pg-accent)', fontWeight: 700 }}>
              {' '}· {extraCursors.length + 1} cursors (Esc to exit)
            </span>
          )}
        </span>
        <span
          className="flex items-center gap-1.5"
          style={{ color: errorMessage ? 'var(--pg-danger)' : evalFlash ? 'var(--pg-ok)' : undefined }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full inline-block"
            style={{ background: errorMessage ? 'var(--pg-danger)' : evalFlash ? 'var(--pg-ok)' : 'var(--pg-faint)' }}
          />
          {errorMessage ? 'error' : evalFlash ? 'updated' : 'ready'}
        </span>
      </div>

      {/* Error Callout Overlay */}
      {errorMessage && (
        <div
          className="flex items-start gap-2 p-2.5 text-xs shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--pg-danger) 10%, transparent)',
            borderTop: '1px solid var(--pg-danger)',
            color: 'var(--pg-text)',
          }}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--pg-danger)' }} />
          <div className="flex-1">
            <span className="font-semibold" style={{ color: 'var(--pg-danger)' }}>Evaluation error: </span>
            <span className="font-mono">{errorMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
};
