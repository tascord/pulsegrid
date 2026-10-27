/**
 * `import`-style syntax for sample loading (PulseGrid extension).
 *
 * The live-coding DSL evaluates via `new Function(...)`, which cannot
 * contain real ES `import` declarations — so this module preprocesses
 * import-looking lines into the existing `samples()` / `soundAlias()`
 * calls before evaluation. `samples()`/`soundAlias()` keep working as-is.
 *
 * Supported forms (one per line, `{...}` may span lines):
 *
 *   import '/samples/strudel.json'
 *   import 'github:tidalcycles/dirt-samples'
 *   import { ry30_bd as bd, ry30_hh as hh } from '/samples/strudel.json'
 *   import { bd } from 'github:tidalcycles/dirt-samples'
 *   import bd from '/samples/ry30-bd/Bassdrum-01.wav'
 *   import * as dirt from 'github:tidalcycles/dirt-samples'
 *
 * Semantics mirror JS imports: the name before `as` is the bank name in
 * the sample map, the name after `as` is the local alias used in patterns
 * (`soundAlias(original, alias)`). Bare names (`import { hh }`) just load
 * the map — no alias needed since the bank is already called `hh`.
 *
 * Pack shorthand: a bare specifier without path/URL characters resolves
 * via SAMPLE_IMPORT_PACKS (`import { ... } from 'ry30'`).
 */

export interface SampleImportAlias {
  original: string;
  alias: string;
}

export interface SampleImportStatement {
  /** Resolved URL/map shorthand passed to `samples()`. */
  url: string;
  /** `original as alias` pairs (`soundAlias` calls). */
  aliases: SampleImportAlias[];
  /** Set for `import name from 'file.wav'` one-shot imports. */
  singleFileBank?: { bank: string; file: string };
}

export interface SampleImportTransform {
  /** Code with import lines removed (line count preserved). */
  code: string;
  statements: SampleImportStatement[];
  /** JS prelude to prepend (`samples(...)` / `soundAlias(...)` calls). */
  prelude: string;
  /** Non-fatal problems, surfaced as eval warnings. */
  errors: string[];
}

/** Bare pack names usable as `from 'ry30'` (vendored kit manifest). */
export const SAMPLE_IMPORT_PACKS: Record<string, string> = {
  ry30: '/samples/strudel.json',
  local: '/samples/strudel.json',
  stock: '/samples/strudel.json',
};

const AUDIO_FILE_RE = /\.(wav|mp3|ogg|flac|aac|m4a|webm|opus)(\?[^]*)?$/i;
const NAME_RE = /^[A-Za-z0-9_:-]+$/;

export function resolveSampleImportSpecifier(spec: string): string {
  const s = spec.trim();
  if (Object.prototype.hasOwnProperty.call(SAMPLE_IMPORT_PACKS, s)) {
    return SAMPLE_IMPORT_PACKS[s];
  }
  return s;
}

function blockCommentRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\/\*[\s\S]*?(?:\*\/|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** Parse `a, b as c` inside `{...}` into alias pairs. */
function parseNamedList(inner: string, errors: string[], lineNo: number): SampleImportAlias[] {
  const aliases: SampleImportAlias[] = [];
  const items = inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    errors.push(`import (line ${lineNo}): empty { } list — nothing to import`);
    return aliases;
  }
  for (const item of items) {
    const parts = item.split(/\s+as\s+/);
    if (parts.length > 2) {
      errors.push(`import (line ${lineNo}): bad entry "${item}" (want "bank" or "bank as alias")`);
      continue;
    }
    const original = (parts[0] || '').trim();
    const alias = (parts[1] || '').trim() || original;
    if (!original || !NAME_RE.test(original) || !NAME_RE.test(alias)) {
      errors.push(`import (line ${lineNo}): bad entry "${item}" (want "bank" or "bank as alias")`);
      continue;
    }
    aliases.push({ original, alias });
  }
  return aliases;
}

function lineOf(code: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (code[i] === '\n') n++;
  return n;
}

export function transformSampleImports(code: string): SampleImportTransform {
  const errors: string[] = [];
  const statements: SampleImportStatement[] = [];
  const comments = blockCommentRanges(code);

  type Match = { index: number; length: number; newlines: number; statement?: SampleImportStatement; error?: string };
  const matches: Match[] = [];

  const inComment = (index: number) => comments.some(([a, b]) => index >= a && index < b);

  // Single scan: side-effect `import 'url'` is tried first at each line so
  // a following `import { ... } from '...'` can never be swallowed into one
  // multiline `from`-match. The from-clause may still span lines (`{...}`).
  const re =
    /^[ \t]*import[ \t]*(?:('[^'\n]*'|"[^"\n]*")|([\s\S]*?)\bfrom\b[ \t]*('[^'\n]*'|"[^"\n]*"))[ \t]*;?[ \t]*$/gm;

  const take = (m: RegExpExecArray) => {
    if (inComment(m.index)) return;
    const lineNo = lineOf(code, m.index);
    const newlines = (m[0].match(/\n/g) || []).length;
    if (m[1] != null) {
      const raw = m[1].slice(1, -1).trim();
      if (!raw) {
        matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): empty module specifier` });
        return;
      }
      const url = resolveSampleImportSpecifier(raw);
      statements.push({ url, aliases: [] });
      matches.push({ index: m.index, length: m[0].length, newlines });
      return;
    }
    // from-form: group 2 = clause, group 3 = quoted URL.
    const clause = (m[2] || '').trim();
    const rawUrl = (m[3] || '').slice(1, -1).trim();
    if (!rawUrl) {
      matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): empty module specifier` });
      return;
    }
    const url = resolveSampleImportSpecifier(rawUrl);
    if (!clause) {
      matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): expected { ... }, *, or a name before "from"` });
      return;
    }
    // Namespace: * as ns
    if (/^\*\s+as\s+[\w$]+$/.test(clause)) {
      statements.push({ url, aliases: [] });
      matches.push({ index: m.index, length: m[0].length, newlines });
      return;
    }
    // Split optional default + named:  Name, { ... }
    let defaultName: string | null = null;
    let namedInner: string | null = null;
    const braceAt = clause.indexOf('{');
    if (braceAt >= 0) {
      const before = clause.slice(0, braceAt).trim().replace(/,$/, '').trim();
      const braceClose = clause.lastIndexOf('}');
      if (braceClose < braceAt) {
        matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): missing closing "}"` });
        return;
      }
      const after = clause.slice(braceClose + 1).trim();
      if (after) {
        matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): unexpected text after "}"` });
        return;
      }
      if (before) {
        if (!/^[\w$][\w$-]*$/.test(before)) {
          matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): bad default import "${before}"` });
          return;
        }
        defaultName = before;
      }
      namedInner = clause.slice(braceAt + 1, braceClose);
    } else if (/^[\w$][\w$-]*$/.test(clause)) {
      defaultName = clause;
    } else {
      matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): expected { ... }, *, or a name before "from"` });
      return;
    }

    const aliases: SampleImportAlias[] = [];
    if (namedInner != null) {
      aliases.push(...parseNamedList(namedInner, errors, lineNo));
    }
    if (defaultName) {
      if (AUDIO_FILE_RE.test(url)) {
        const bank = defaultName.toLowerCase();
        if (!NAME_RE.test(bank)) {
          matches.push({ index: m.index, length: m[0].length, newlines, error: `import (line ${lineNo}): bad sample name "${defaultName}"` });
          return;
        }
        statements.push({ url, aliases, singleFileBank: { bank, file: url } });
        matches.push({ index: m.index, length: m[0].length, newlines });
        return;
      }
      // Default import from a map URL: just load the map (name unused).
      errors.push(`import (line ${lineNo}): default import from a sample map loads the whole map — prefer "{ bank }" or "import '${rawUrl}'"`);
    }
    statements.push({ url, aliases });
    matches.push({ index: m.index, length: m[0].length, newlines });
  };

  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(code)) !== null) take(m);
  for (const mt of matches) if (mt.error) errors.push(mt.error);

  // Fallback: any other line-starting `import` is invalid JS in `new Function`
  // scope — remove it (keeping the line) and warn instead of eval-crashing.
  const claimed = matches.map((k) => [k.index, k.index + k.length] as [number, number]);
  const fallbackRe = /^[ \t]*import\b.*$/gm;
  const fallbacks: Match[] = [];
  while ((m = fallbackRe.exec(code)) !== null) {
    if (inComment(m.index)) continue;
    if (claimed.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    // Skip matches fully inside an already-claimed multiline import.
    if (matches.some((k) => m!.index > k.index && m!.index < k.index + k.length)) continue;
    const lineNo = lineOf(code, m.index);
    errors.push(`import (line ${lineNo}): unsupported import — use "import 'url'", "import { a as b } from 'url'", or "import name from 'file.wav'"`);
    fallbacks.push({ index: m.index, length: m[0].length, newlines: 0 });
  }

  // Remove matches back-to-front, preserving line numbers with padding.
  const all = [...matches, ...fallbacks].sort((a, b) => b.index - a.index);
  let out = code;
  for (const k of all) {
    const pad = k.newlines > 0 ? '\n'.repeat(k.newlines) : '';
    out = out.slice(0, k.index) + pad + out.slice(k.index + k.length);
  }

  // Build the prelude: one samples() per unique map URL (import order),
  // one samples({bank:[file]}) per one-shot, then soundAlias() renames.
  const preludeLines: string[] = [];
  const emitted = new Set<string>();
  for (const st of statements) {
    if (st.singleFileBank) {
      preludeLines.push(
        `samples(${JSON.stringify({ [st.singleFileBank.bank]: [st.singleFileBank.file] })});`,
      );
    } else if (!emitted.has(st.url)) {
      emitted.add(st.url);
      preludeLines.push(`samples(${JSON.stringify(st.url)});`);
    }
    for (const a of st.aliases) {
      if (a.alias !== a.original) {
        preludeLines.push(`soundAlias(${JSON.stringify(a.original)}, ${JSON.stringify(a.alias)});`);
      }
    }
  }

  return { code: out, statements, prelude: preludeLines.join('\n'), errors };
}
