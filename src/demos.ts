/**
 * Shared parsing for demos/ — the single source of truth for demo sessions.
 * Dependency-free so it can be imported from the Vite client (src/App.tsx),
 * the tsx server (server.ts), and Node tooling alike.
 *
 * Convention: filename is the display name (UPPERCASE, `_` renders as a
 * space: `STRUDEL_DEMO.js` → "STRUDEL DEMO"). Tempo comes from the code's
 * own top-level `cpm(N)` call — no metadata is kept anywhere else.
 */

export interface DemoFile {
  /** Display name derived from the filename (`_` → ` `). */
  name: string;
  /** Tempo parsed from the code's `cpm()` call, or null when absent. */
  cpm: number | null;
  /** Raw session code. */
  code: string;
  /** Original filename (or glob key) the demo was loaded from. */
  file: string;
}

/** `STRUDEL_DEMO.js` → `STRUDEL DEMO`. */
export function demoNameFromFilename(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
}

/** First top-level `cpm(N)` / `setcpm(N)` call; legacy `bpm(N)` is cycles/4. */
export function parseDemoCpm(code: string): number | null {
  const m = code.match(/^\s*(setcpm|cpm|setbpm|bpm)\(\s*([\d.]+)\s*\)/m);
  if (!m) return null;
  const v = parseFloat(m[2]);
  if (!isFinite(v) || v <= 0) return null;
  return m[1] === 'setbpm' || m[1] === 'bpm' ? v / 4 : v;
}

export function parseDemoFile(file: string, code: string): DemoFile {
  return {
    name: demoNameFromFilename(file),
    cpm: parseDemoCpm(code),
    code,
    file,
  };
}
