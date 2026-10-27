import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollText, Trash2, Copy, Check, ArrowDownToLine } from 'lucide-react';
import { logger, LogEntry, LogLevel } from '../audio/Logger';

const LEVEL_ORDER: LogLevel[] = ['error', 'warn', 'info', 'success', 'debug'];

const LEVEL_STYLE: Record<LogLevel, { color: string; border: string; label: string }> = {
  error: { color: 'var(--pg-danger)', border: 'var(--pg-danger)', label: 'error' },
  warn: { color: 'var(--pg-warn)', border: 'var(--pg-warn)', label: 'warn' },
  info: { color: 'var(--pg-accent)', border: 'var(--pg-border)', label: 'info' },
  success: { color: 'var(--pg-ok)', border: 'var(--pg-ok)', label: 'ok' },
  debug: { color: 'var(--pg-faint)', border: 'var(--pg-border)', label: 'debug' },
};

function formatTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const LogsDrawer: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>(() => [...logger.getEntries()]);
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LEVEL_ORDER));
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = logger.subscribe(() => setEntries([...logger.getEntries()]));
    return unsub;
  }, []);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, follow]);

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, success: 0, debug: 0 };
    for (const e of entries) c[e.level] += 1;
    return c;
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        levels.has(e.level) &&
        (q === '' ||
          e.message.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q))
    );
  }, [entries, levels, query]);

  const toggleLevel = (level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const copyAll = () => {
    const text = visible
      .map((e) => `[${formatTime(e.at)}] [${e.level}] [${e.source}] ${e.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 pg-panel-header text-xs gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ScrollText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pg-accent)' }} />
          <span className="font-bold truncate">Logs</span>
          <span className="font-mono text-[11px] pg-faint tabular-nums">
            {visible.length}/{entries.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setFollow((f) => !f)}
            title={follow ? 'Stop following new logs' : 'Follow new logs'}
            className="p-1.5 rounded-lg border"
            style={{
              borderColor: 'var(--pg-border)',
              color: follow ? 'var(--pg-accent)' : 'var(--pg-faint)',
            }}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={copyAll}
            title="Copy visible logs"
            className="p-1.5 rounded-lg border"
            style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => logger.clear()}
            title="Clear logs"
            className="p-1.5 rounded-lg border"
            style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2 flex-wrap text-[11px]" style={{ borderBottom: '1px solid var(--pg-border-soft)' }}>
        {LEVEL_ORDER.map((level) => {
          const active = levels.has(level);
          const style = LEVEL_STYLE[level];
          return (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className="px-2 py-0.5 rounded-full border font-mono tabular-nums"
              style={{
                borderColor: active ? style.border : 'var(--pg-border-soft)',
                color: active ? style.color : 'var(--pg-faint)',
                opacity: active ? 1 : 0.55,
              }}
              title={`Toggle ${style.label} logs`}
            >
              {style.label} {counts[level]}
            </button>
          );
        })}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter…"
          className="ml-auto min-w-0 flex-1 sm:flex-none sm:w-32 rounded-lg border px-2 py-1 font-mono text-[11px] bg-transparent focus:outline-none"
          style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {visible.length === 0 ? (
          <p className="text-[11px] pg-faint px-2 py-4 text-center">
            {entries.length === 0
              ? 'No logs yet — eval some code and activity will show up here.'
              : 'Nothing matches the current filters.'}
          </p>
        ) : (
          visible.map((e) => {
            const style = LEVEL_STYLE[e.level];
            return (
              <div
                key={e.id}
                className="rounded-lg border px-2 py-1.5 font-mono text-[11px] leading-relaxed break-words"
                style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="pg-faint tabular-nums">{formatTime(e.at)}</span>
                  <span
                    className="px-1.5 py-px rounded-full text-[9px] uppercase font-bold border"
                    style={{ borderColor: style.border, color: style.color }}
                  >
                    {style.label}
                  </span>
                  <span className="pg-muted">[{e.source}]</span>
                </div>
                <div className="mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--pg-text)' }}>
                  {e.message}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
