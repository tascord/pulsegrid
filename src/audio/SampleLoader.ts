/**
 * Strudel-parity external sample loading.
 *
 * Mirrors `samples()` / `fetchSampleMap()` / `processSampleMap()` from
 * strudel-main/packages/superdough/sampler.mjs, adapted to the PulseGrid
 * SampleManager (bank variants + AudioContext decoding):
 *
 *   samples('github:tidalcycles/dirt-samples')
 *   samples('https://example.com/strudel.json')
 *   samples({ bd: ['bd/BD0000.wav', 'bd/BD0001.wav'] }, 'https://.../Dirt-Samples/')
 *   samples({ casio: ['http://.../casio0.wav'] })
 *
 * Loading is async and fire-and-forget from the DSL: already-decoded
 * variants sound immediately (`bank:n` modulo-wraps), the rest stream in.
 */

import { sampleManager } from './SampleManager';

export type SampleMapInput = string | Record<string, string | string[] | Record<string, string | string[]>>;

function resolveSpecialPaths(base: string): string {
  if (base.startsWith('bubo:')) {
    const [, repo] = base.split(':');
    return `github:Bubobubobubobubo/dough-${repo}`;
  }
  return base;
}

function githubPath(base: string, subpath = ''): string {
  if (!base.startsWith('github:')) {
    throw new Error('expected "github:" at the start of pseudoUrl');
  }
  let path = base.slice('github:'.length);
  path = path.endsWith('/') ? path.slice(0, -1) : path;

  const components = path.split('/');
  const user = components[0];
  const repo = components.length >= 2 ? components[1] : 'samples';
  const branch = components.length >= 3 ? components[2] : 'main';
  const other = components.slice(3);
  other.push(subpath ? subpath : '');
  return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${other.join('/')}`;
}

function getBaseURL(url: string): string {
  try {
    const u = new URL(url);
    return url.slice(0, url.lastIndexOf('/') + 1) || `${u.origin}/`;
  } catch {
    const idx = url.lastIndexOf('/');
    return idx >= 0 ? url.slice(0, idx + 1) : '';
  }
}

function isAbsoluteUrl(v: string): boolean {
  return /^(https?:|blob:|data:)/i.test(v);
}

/**
 * Cross-origin sample fetches go through the same-origin proxy
 * (GET /api/sample-proxy?url=...) so the editor loads them without
 * browser CORS/mixed-content failures. Same-origin relative paths
 * (e.g. `/samples/...`) fetch directly.
 */
export function proxiedUrl(url: string): string {
  if (/^https?:/i.test(url)) {
    // Already proxied, or running outside a browser (CLI bounce): leave alone.
    if (url.includes('/api/sample-proxy?')) return url;
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return url;
    try {
      const absolute = new URL(url, window.location.href);
      if (absolute.origin === window.location.origin) return url;
    } catch {
      return url;
    }
    return `/api/sample-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** Fetch a `strudel.json`-style map from the supported shorthands. */
export async function fetchSampleMap(url: string): Promise<[unknown, string]> {
  let resolved = resolveSpecialPaths(url);
  if (resolved.startsWith('github:')) {
    resolved = githubPath(resolved, 'strudel.json');
  } else if (resolved.startsWith('shabda:')) {
    const [, path] = resolved.split('shabda:');
    resolved = `https://shabda.ndre.gr/${path}.json?strudel=1`;
  }
  if (typeof fetch !== 'function') {
    throw new Error(`cannot fetch sample map "${url}" (no fetch in this environment)`);
  }
  const base = getBaseURL(resolved);
  const json = await fetch(proxiedUrl(resolved)).then((res) => {
    if (!res.ok) throw new Error(`error loading "${url}" (HTTP ${res.status})`);
    return res.json();
  });
  const baseFromMap =
    json && typeof json === 'object' && typeof (json as { _base?: unknown })._base === 'string'
      ? ((json as { _base: string })._base as string)
      : base;
  return [json, baseFromMap];
}

/** Iterate banks in a strudel.json map, resolving each file against baseUrl. */
export function processSampleMap(
  sampleMap: Record<string, unknown>,
  fn: (key: string, bank: string[]) => void,
  baseUrl: string = (sampleMap as { _base?: string })._base || '',
): void {
  for (const [key, value] of Object.entries(sampleMap)) {
    if (key === '_base') continue;
    let base = baseUrl;
    let v: unknown = value;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (typeof obj._base === 'string') base = obj._base as string;
    }
    base = resolveSpecialPaths(base);
    if (base.startsWith('github:')) base = githubPath(base, '');
    const fullUrl = (file: string) => (isAbsoluteUrl(file) ? file : base + file);
    let bank: string[];
    if (typeof v === 'string') {
      bank = [fullUrl(v)];
    } else if (Array.isArray(v)) {
      bank = (v as unknown[]).map((f) => fullUrl(String(f)));
    } else if (v && typeof v === 'object') {
      // Pitch-keyed map { "60": ["file.wav"] } — flatten, keep file order.
      bank = Object.values(v as Record<string, unknown>).flatMap((entry) =>
        (Array.isArray(entry) ? entry : [entry]).map((f) => fullUrl(String(f))),
      );
    } else {
      throw new Error('wrong sample map format for ' + key);
    }
    fn(key, bank);
  }
}

const bufferCache = new Map<string, Promise<AudioBuffer>>();

function decodeWithContext(ctx: AudioContext | OfflineAudioContext, raw: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData detaches the input in some browsers; copy defensively.
  const copy = raw.slice(0);
  const p = ctx.decodeAudioData(copy);
  if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
    return p as Promise<AudioBuffer>;
  }
  // Safari-style callback overload falls through to a promise wrapper.
  return new Promise<AudioBuffer>((resolve, reject) => {
    (ctx.decodeAudioData as unknown as (
      buf: ArrayBuffer,
      ok: (b: AudioBuffer) => void,
      err: (e: unknown) => void,
    ) => void).call(ctx, copy, resolve, reject);
  });
}

export function loadBufferCached(url: string): Promise<AudioBuffer> | null {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  const ctx = sampleManager.getDecodeContext();
  if (!ctx) return null;
  const task = (async () => {
    const res = await fetch(proxiedUrl(url.replace('#', '%23')));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const raw = await res.arrayBuffer();
    return decodeWithContext(ctx, raw);
  })();
  // Drop failures from the cache so a retry re-fetches.
  task.catch(() => bufferCache.delete(url));
  bufferCache.set(url, task);
  return task;
}

/**
 * Load a single remote audio file into a one-variant bank.
 * Used by the Samples drawer URL box.
 */
export async function importSampleUrl(url: string, name?: string): Promise<void> {
  const clean = url.trim();
  if (!clean) throw new Error('empty URL');
  const bank = (name || clean.split('/').pop()?.split('?')[0]?.replace(/\.[^/.]+$/, '') || 'remote')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 48) || 'remote';
  const ctx = sampleManager.getDecodeContext();
  if (!ctx) throw new Error('No audio decode path available in this environment');
  sampleManager.setBankStatus(bank, { total: 1, loaded: 0, pending: true });
  try {
    const task = loadBufferCached(clean);
    if (!task) throw new Error('AudioContext not initialized (press play first)');
    const buffer = await task;
    sampleManager.registerBankVariant(bank, 0, buffer, clean);
    sampleManager.markBankProgress(bank, 1);
    sampleManager.markBankDone(bank);
  } catch (err) {
    sampleManager.markBankDone(bank, (err as Error)?.message || String(err));
    throw err;
  }
}

/**
 * Strudel-compatible `samples()` entry point. Accepts a map URL/shorthand
 * (`github:`, `https:…`, `shabda:`) or an inline map + optional base URL.
 * Safe to call before AudioContext init — bank entries queue and decode on
 * first availability poll (the scheduler retries via `pumpPendingBanks`).
 */
const pendingBanks: { key: string; bank: string[] }[] = [];

export function pumpPendingBanks(): void {
  if (pendingBanks.length === 0) return;
  if (!sampleManager.getAudioContext()) return;
  const queued = pendingBanks.splice(0, pendingBanks.length);
  for (const { key, bank } of queued) {
    void loadBank(key, bank);
  }
}

async function loadBank(key: string, bank: string[]): Promise<void> {
  const total = bank.length;
  sampleManager.setBankStatus(key, { total, loaded: 0, pending: true });
  let loaded = 0;
  let firstError: string | undefined;
  // Sequential to bound memory; browsers cap parallel decodes anyway.
  for (let i = 0; i < bank.length; i++) {
    try {
      const task = loadBufferCached(bank[i]);
      if (!task) {
        pendingBanks.push({ key, bank: bank.slice(i) });
        sampleManager.markBankDone(key, 'paused until AudioContext init');
        return;
      }
      const buffer = await task;
      sampleManager.registerBankVariant(key, i, buffer, bank[i]);
      loaded++;
      sampleManager.markBankProgress(key, loaded);
    } catch (err) {
      if (!firstError) firstError = (err as Error)?.message || String(err);
    }
  }
  sampleManager.markBankDone(key, loaded === 0 ? firstError || 'all files failed' : undefined);
  if (loaded === 0 && firstError) {
    console.warn(`[samples] bank "${key}" failed to load: ${firstError}`);
  }
}

export async function loadSamples(
  sampleMap: SampleMapInput,
  baseUrl = '',
  options: { prebake?: boolean; tag?: string } = {},
): Promise<string[]> {
  void options;
  if (typeof sampleMap === 'string') {
    const [json, base] = await fetchSampleMap(sampleMap);
    return loadSamples(json as SampleMapInput, baseUrl || base);
  }
  const names: string[] = [];
  processSampleMap(
    sampleMap as Record<string, unknown>,
    (key, bank) => {
      const lower = key.toLowerCase();
      names.push(lower);
      if (!sampleManager.getDecodeContext()) {
        // No decode path at all (bare Node): defer until the engine boots.
        sampleManager.setBankStatus(lower, { total: bank.length, loaded: 0, pending: true });
        pendingBanks.push({ key: lower, bank });
      } else {
        void loadBank(lower, bank);
      }
    },
    baseUrl || (sampleMap as { _base?: string })._base || '',
  );
  return names;
}
