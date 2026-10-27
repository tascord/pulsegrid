// Central in-app log store. The Logs drawer subscribes to this.
// Call installConsoleHook() once at startup so existing console.* calls
// (samples, MIDI, VST bridge, eval errors) also land here.

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  source: string;
  message: string;
}

const MAX_ENTRIES = 500;

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message || String(arg);
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Pull a "[source]" prefix out of a message, e.g. "[samples] load failed". */
function splitSource(message: string): { source: string; message: string } {
  const m = message.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (m) return { source: m[1], message: m[2] || message };
  return { source: 'app', message };
}

class Logger {
  private entries: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;
  private hooked = false;

  public getEntries(): LogEntry[] {
    return this.entries;
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }

  public add(level: LogLevel, source: string, message: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      at: Date.now(),
      level,
      source: source || 'app',
      message,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.notify();
    return entry;
  }

  public info(source: string, message: string): LogEntry {
    return this.add('info', source, message);
  }

  public success(source: string, message: string): LogEntry {
    return this.add('success', source, message);
  }

  public warn(source: string, message: string): LogEntry {
    return this.add('warn', source, message);
  }

  public error(source: string, message: string): LogEntry {
    return this.add('error', source, message);
  }

  public debug(source: string, message: string): LogEntry {
    return this.add('debug', source, message);
  }

  public clear() {
    this.entries = [];
    this.notify();
  }

  /** Wrap console.* once so unstructured logs also show up in the Logs tab. */
  public installConsoleHook() {
    if (this.hooked || typeof console === 'undefined') return;
    this.hooked = true;
    const orig = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: (console.debug || console.log).bind(console),
    };
    const capture = (level: LogLevel, original: (...args: unknown[]) => void, ...args: unknown[]) => {
      original(...args);
      try {
        const raw = args.map(formatArg).join(' ');
        const { source, message } = splitSource(raw);
        this.add(level, source, message);
      } catch {}
    };
    console.log = (...args: unknown[]) => capture('info', orig.log, ...args);
    console.info = (...args: unknown[]) => capture('info', orig.info, ...args);
    console.warn = (...args: unknown[]) => capture('warn', orig.warn, ...args);
    console.error = (...args: unknown[]) => capture('error', orig.error, ...args);
    console.debug = (...args: unknown[]) => capture('debug', orig.debug, ...args);
  }
}

export const logger = new Logger();
