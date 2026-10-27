import React, { useState } from 'react';
import { BookOpen, Search, Copy, Check } from 'lucide-react';
import {
  KEYWORD_SUGGESTIONS,
  METHOD_SUGGESTIONS,
  MINI_NOTATION_REFERENCE,
  type Suggestion,
} from '../audio/language';

const SECTIONS: { title: string; hint: string; items: Suggestion[] }[] = [
  {
    title: 'Setup',
    hint: 'top-level statements',
    items: KEYWORD_SUGGESTIONS,
  },
  {
    title: 'Track chain',
    hint: 'track("x").method(...)',
    items: METHOD_SUGGESTIONS,
  },
  {
    title: 'Mini-notation',
    hint: 'inside pattern strings',
    items: MINI_NOTATION_REFERENCE,
  },
];

function snippetOf(sug: Suggestion): string {
  return sug.insertText.replace(/\$1/g, '').replace(/\$2/g, '');
}

export const DocsDrawer: React.FC = () => {
  const [query, setQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (sug: Suggestion) =>
    q.length === 0 ||
    sug.label.toLowerCase().includes(q) ||
    sug.detail.toLowerCase().includes(q) ||
    sug.documentation.toLowerCase().includes(q);

  const handleCopy = (sug: Suggestion) => {
    navigator.clipboard.writeText(snippetOf(sug));
    const key = `${sug.label}`;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
  };

  const totalShown = SECTIONS.reduce((n, sec) => n + sec.items.filter(matches).length, 0);

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 pg-panel-header text-xs">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-neutral-200">Docs</span>
          <span className="text-neutral-400 font-mono text-[11px] tabular-nums">
            {totalShown} functions
          </span>
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto space-y-4">
        {/* Search */}
        <label
          className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pg-muted)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter functions... (e.g. delay, euclid, midi)"
            className="w-full bg-transparent text-xs focus:outline-none"
            style={{ color: 'var(--pg-text)' }}
          />
        </label>

        {SECTIONS.map((sec) => {
          const items = sec.items.filter(matches);
          if (items.length === 0) return null;
          return (
            <section key={sec.title}>
              <div className="flex items-baseline gap-2 mb-1.5 px-0.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--pg-text)' }}>
                  {sec.title}
                </h3>
                <span className="text-[10px] pg-faint font-mono">{sec.hint}</span>
              </div>
              <div className="space-y-1.5">
                {items.map((sug) => {
                  const key = `${sec.title}:${sug.label}`;
                  const copied = copiedKey === sug.label;
                  return (
                    <button
                      key={key}
                      onClick={() => handleCopy(sug)}
                      title="Click to copy snippet"
                      className="w-full text-left p-2 rounded border transition-colors hover:opacity-90"
                      style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-[12px] font-mono font-semibold" style={{ color: 'var(--pg-accent-2)' }}>
                          {sug.label}
                        </code>
                        {copied ? (
                          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pg-ok)' }} />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0 pg-faint" />
                        )}
                      </div>
                      <div className="text-[10px] font-mono pg-faint mt-0.5">{sug.detail}</div>
                      <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--pg-muted)' }}>
                        {sug.documentation}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {totalShown === 0 && (
          <p className="text-xs pg-faint text-center py-6">No functions match “{query}”.</p>
        )}
      </div>
    </div>
  );
};
