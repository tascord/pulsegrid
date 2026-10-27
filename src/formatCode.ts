function splitTrailingComment(line: string): [string, string] {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '/' && line[i + 1] === '/') {
      return [line.slice(0, i).trimEnd(), line.slice(i)];
    }
  }
  return [line, ''];
}

function findChainBreaks(content: string): number[] {
  const breaks: number[] = [];
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }

    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (char === '.' && depth === 0 && /[a-zA-Z_$]/.test(content[i + 1] || '') && content[i - 1] === ')') {
      breaks.push(i);
    }
  }

  return breaks;
}

/** Split any `fn(...).method(...).method(...)` chain into segments. */
function splitChainSegments(content: string): string[] | null {
  const breaks = findChainBreaks(content);
  if (breaks.length === 0) return null;
  const base = content.slice(0, breaks[0]).trimEnd();
  if (!base.includes('(')) return null;
  const segments = [base];
  for (let i = 0; i < breaks.length; i++) {
    segments.push(content.slice(breaks[i], breaks[i + 1] ?? content.length).trim());
  }
  for (let i = 1; i < segments.length; i++) {
    if (!/^\.[a-zA-Z_$]/.test(segments[i])) return null;
  }
  return segments;
}

/** Group physical lines into logical blocks (multiline args stay together,
 *  dot-continuations stay with their chain). */
function buildBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let depth = 0;
  let quote = '';
  let escaped = false;

  const scanLine = (line: string) => {
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '/' && line[i + 1] === '/') break;
      else if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    current.push(lines[idx]);
    scanLine(lines[idx]);
    if (quote !== '' || depth > 0) continue;
    const next = lines[idx + 1];
    if (next !== undefined && /^\s*\./.test(next)) continue;
    blocks.push(current);
    current = [];
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** True when every newline in the block is a top-level chain break
 *  (continuation lines all start with `.`). */
function isPureChainBlock(block: string[]): boolean {
  if (block.length < 2) return false;
  for (let i = 1; i < block.length; i++) {
    if (!/^\s*\./.test(block[i])) return false;
  }
  // Interior lines must not carry trailing comments (except the last line,
  // whose comment is re-attached after re-emitting).
  for (let i = 0; i < block.length - 1; i++) {
    if (splitTrailingComment(block[i])[1] !== '') return false;
  }
  const text = block.join('\n');
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    } else if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (char === '\n') {
      if (depth !== 0) return false;
      const rest = text.slice(i + 1).match(/^\s*/)![0];
      if (text[i + 1 + rest.length] !== '.') return false;
    }
  }
  return true;
}

/** Split a block with multiline call args at top-level chain breaks,
 *  preserving interior newlines. Returns null when not applicable. */
function splitBlockPreservingNewlines(block: string[], width: number): string[] | null {
  for (let i = 0; i < block.length - 1; i++) {
    if (splitTrailingComment(block[i])[1] !== '') return null;
  }
  const text = block.join('\n');
  const [code, comment] = splitTrailingComment(text);
  const breaks = findChainBreaks(code);
  if (breaks.length === 0) return null;
  const base = code.slice(0, breaks[0]).trim();
  if (!base.includes('(')) return null;

  const hasDotContinuation = block.slice(1).some((line) => /^\s*\./.test(line));
  const collapsedLength = code.replace(/\s+/g, ' ').trim().length;
  const indent = block[0].match(/^\s*/)?.[0] || '';
  if (collapsedLength + indent.length <= width && !hasDotContinuation) return null;

  const rawSegments: string[] = [];
  for (let i = 0; i < breaks.length; i++) {
    rawSegments.push(code.slice(breaks[i], breaks[i + 1] ?? code.length));
  }
  for (const seg of rawSegments) {
    if (!/^\s*\.[a-zA-Z_$]/.test(seg)) return null;
  }

  const output: string[] = [];
  const baseLines = code.slice(0, breaks[0]).split('\n');
  output.push(indent + baseLines[0].trimStart());
  for (let i = 1; i < baseLines.length; i++) output.push(baseLines[i]);
  for (const seg of rawSegments) {
    const segLines = seg.split('\n');
    const first = segLines[0].replace(/^\s*/, '');
    output.push(`${indent}  ${first.trimEnd()}`);
    for (let i = 1; i < segLines.length; i++) output.push(segLines[i]);
  }
  if (comment) output[output.length - 1] += ` ${comment}`;
  return output;
}

function splitAtWordBoundaries(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt <= 0) break;
    chunks.push(remaining.slice(0, splitAt + 1));
    remaining = remaining.slice(splitAt + 1);
  }
  if (chunks.length === 0) return [text];
  chunks.push(remaining);
  return chunks;
}

function wrapLongString(line: string, width: number): string[] {
  let quote = '';
  let escaped = false;
  let start = -1;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) {
        const value = line.slice(start + 1, i);
        if (value.includes(' ') && line.length > width) {
          const indent = line.match(/^\s*/)?.[0] || '';
          const continuationIndent = `${indent}  `;
          const capacity = Math.min(
            width - start - 4,
            width - continuationIndent.length - 4
          );
          if (capacity > 0) {
            const chunks = splitAtWordBoundaries(value, capacity);
            if (chunks.length > 1) {
              const prefix = line.slice(0, start + 1);
              const suffix = line.slice(i);
              return chunks.map((chunk, index) => {
                const partPrefix = index === 0 ? prefix : `${continuationIndent}${quote}`;
                const partSuffix = index === chunks.length - 1 ? suffix : `${quote} +`;
                return `${partPrefix}${chunk}${partSuffix}`;
              });
            }
          }
        }
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      start = i;
    }
  }

  return [line];
}

function emitOnePerLine(indent: string, segments: string[], comment: string): string[] {
  const output = [indent + segments[0].trim()];
  for (let i = 1; i < segments.length; i++) {
    output.push(`${indent}  ${segments[i].trim()}`);
  }
  if (comment) output[output.length - 1] += ` ${comment}`;
  return output;
}

export function formatCode(source: string, maxChars = 100): string {
  const width = Math.min(160, Math.max(60, Math.round(maxChars)));
  const out: string[] = [];

  for (const block of buildBlocks(source.split('\n'))) {
    if (block.length === 1) {
      const line = block[0];
      const trimmed = line.trimStart();
      if (line.length <= width || trimmed.startsWith('//')) {
        out.push(line);
        continue;
      }
      // Sample import lines are preprocessed (multiline-aware) — never rewrap
      // them: splitting a quoted URL/module list with `+` would break the import.
      if (/^import\b/.test(trimmed)) {
        out.push(line);
        continue;
      }
      const [codePart, comment] = splitTrailingComment(line);
      const indent = codePart.match(/^\s*/)?.[0] || '';
      const content = codePart.trim();
      if (!content) {
        out.push(line);
        continue;
      }
      const segments = splitChainSegments(content);
      if (segments) {
        out.push(...emitOnePerLine(indent, segments, comment).flatMap((part) => wrapLongString(part, width)));
      } else {
        out.push(...wrapLongString(line, width));
      }
      continue;
    }

    // Multiline block.
    const firstTrimmed = block[0].trimStart();
    if (/^import\b/.test(firstTrimmed)) {
      out.push(...block);
      continue;
    }
    if (!isPureChainBlock(block)) {
      // Chain with multiline call args: still break top-level methods
      // one per line, keeping the interior arg layout untouched.
      const preserved = splitBlockPreservingNewlines(block, width);
      if (preserved) {
        out.push(...preserved.flatMap((part) => (part.length <= width ? [part] : wrapLongString(part, width))));
      } else {
        for (const line of block) {
          const trimmed = line.trimStart();
          if (line.length <= width || trimmed.startsWith('//') || /^import\b/.test(trimmed)) {
            out.push(line);
          } else {
            out.push(...wrapLongString(line, width));
          }
        }
      }
      continue;
    }

    // Pure `fn()\n  .abc()\n  .abc()` chain: normalize to one method per line.
    const indent = block[0].match(/^\s*/)?.[0] || '';
    const [, lastComment] = splitTrailingComment(block[block.length - 1]);
    const collapsed =
      splitTrailingComment(block[0])[0].trimEnd() +
      block
        .slice(1)
        .map((line) => splitTrailingComment(line)[0].trim())
        .join('');
    const segments = splitChainSegments(collapsed.trim());
    if (!segments) {
      out.push(...block);
      continue;
    }
    out.push(...emitOnePerLine(indent, segments, lastComment).flatMap((part) => wrapLongString(part, width)));
  }

  return out.join('\n');
}
