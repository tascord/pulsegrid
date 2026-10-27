/**
 * MixerStore — localStorage persistence for the mixer panel.
 *
 * The scheduler owns live track params, but every manual fader/Mute/Solo
 * tweak is mirrored here so a reload (or a code re-evaluation) restores the
 * mix instead of wiping it. Stored as part of the local project alongside
 * the code/cpm keys in App.tsx.
 */

export interface TrackMixerState {
  gain: number;
  /** -1..1. Null = track currently uses a modulated (Signal) pan. */
  pan: number | null;
  /** Hz. Null = track currently uses a modulated (Signal) cutoff. */
  cutoff: number | null;
  resonance: number;
  reverbSend: number;
  delaySend: number;
  muted: boolean;
  solo: boolean;
}

export interface MasterMixerState {
  volume: number;
  muted: boolean;
}

export interface MixerProjectState {
  tracks: Record<string, TrackMixerState>;
  master: MasterMixerState;
  updatedAt: number;
}

export const MIXER_STORAGE_KEY = 'pulsegrid-mixer-v1';
export const MASTER_VOLUME_KEY = 'pulsegrid-master-v1';

export const DEFAULT_MASTER: MasterMixerState = { volume: 0.85, muted: false };

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeTrack(raw: unknown): TrackMixerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const gain = isFiniteNum(r.gain) ? Math.min(1.5, Math.max(0, r.gain)) : null;
  if (gain === null) return null;
  const panRaw = r.pan;
  const cutoffRaw = r.cutoff;
  const pan =
    panRaw === null || panRaw === undefined
      ? null
      : isFiniteNum(panRaw)
        ? Math.min(1, Math.max(-1, panRaw))
        : null;
  const cutoff =
    cutoffRaw === null || cutoffRaw === undefined
      ? null
      : isFiniteNum(cutoffRaw)
        ? Math.min(18000, Math.max(40, cutoffRaw))
        : null;
  const resonance = isFiniteNum(r.resonance) ? Math.min(25, Math.max(0.1, r.resonance)) : 2;
  const reverbSend = isFiniteNum(r.reverbSend) ? Math.min(1, Math.max(0, r.reverbSend)) : 0;
  const delaySend = isFiniteNum(r.delaySend) ? Math.min(1, Math.max(0, r.delaySend)) : 0;
  return {
    gain,
    pan,
    cutoff,
    resonance,
    reverbSend,
    delaySend,
    muted: r.muted === true,
    solo: r.solo === true,
  };
}

function sanitizeMaster(raw: unknown): MasterMixerState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MASTER };
  const r = raw as Record<string, unknown>;
  return {
    volume: isFiniteNum(r.volume) ? Math.min(1.2, Math.max(0, r.volume)) : DEFAULT_MASTER.volume,
    muted: r.muted === true,
  };
}

export function loadMixerState(): Record<string, TrackMixerState> {
  try {
    const raw = localStorage.getItem(MIXER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    // Support both `{ tracks: {...} }` and a bare map (legacy).
    const maybeTracks = (parsed as Record<string, unknown>).tracks ?? parsed;
    if (!maybeTracks || typeof maybeTracks !== 'object') return {};
    const out: Record<string, TrackMixerState> = {};
    for (const [id, val] of Object.entries(maybeTracks as Record<string, unknown>)) {
      const clean = sanitizeTrack(val);
      if (clean) out[id] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveMixerState(tracks: Record<string, TrackMixerState>): void {
  try {
    const payload: MixerProjectState = {
      tracks,
      master: loadMasterState(),
      updatedAt: Date.now(),
    };
    localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — mixer simply won't persist */
  }
}

/** Persist a single track's mixer-relevant fields (debounced by the caller). */
export function persistTrackMixer(id: string, patch: Partial<TrackMixerState>): void {
  try {
    const current = loadMixerState();
    const prev = current[id];
    const next: TrackMixerState = {
      gain: isFiniteNum(patch.gain) ? patch.gain : (prev?.gain ?? 0.8),
      pan: patch.pan !== undefined ? patch.pan : (prev?.pan ?? null),
      cutoff: patch.cutoff !== undefined ? patch.cutoff : (prev?.cutoff ?? null),
      resonance: isFiniteNum(patch.resonance) ? patch.resonance : (prev?.resonance ?? 2),
      reverbSend: isFiniteNum(patch.reverbSend) ? patch.reverbSend : (prev?.reverbSend ?? 0),
      delaySend: isFiniteNum(patch.delaySend) ? patch.delaySend : (prev?.delaySend ?? 0),
      muted: typeof patch.muted === 'boolean' ? patch.muted : (prev?.muted ?? false),
      solo: typeof patch.solo === 'boolean' ? patch.solo : (prev?.solo ?? false),
    };
    current[id] = next;
    saveMixerState(current);
  } catch {
    /* ignore */
  }
}

export function removeMixerTracks(idsToDrop: string[]): void {
  if (idsToDrop.length === 0) return;
  try {
    const current = loadMixerState();
    let changed = false;
    for (const id of idsToDrop) {
      if (id in current) {
        delete current[id];
        changed = true;
      }
    }
    if (changed) saveMixerState(current);
  } catch {
    /* ignore */
  }
}

export function clearMixerState(): void {
  try {
    localStorage.removeItem(MIXER_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadMasterState(): MasterMixerState {
  // New unified blob wins; fall back to the legacy standalone master key.
  try {
    const raw = localStorage.getItem(MIXER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { master?: unknown };
      if (parsed && typeof parsed === 'object' && parsed.master) {
        return sanitizeMaster(parsed.master);
      }
    }
  } catch {
    /* fall through to legacy key */
  }
  try {
    const legacy = localStorage.getItem(MASTER_VOLUME_KEY);
    if (legacy) return sanitizeMaster(JSON.parse(legacy));
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_MASTER };
}

export function saveMasterState(master: MasterMixerState): void {
  try {
    localStorage.setItem(MASTER_VOLUME_KEY, JSON.stringify(master));
    // Mirror into the unified mixer blob so the whole mix travels as one project.
    const tracks = loadMixerTracksOnly();
    const payload: MixerProjectState = { tracks, master: sanitizeMaster(master), updatedAt: Date.now() };
    localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function loadMixerTracksOnly(): Record<string, TrackMixerState> {
  try {
    const raw = localStorage.getItem(MIXER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { tracks?: unknown };
    if (!parsed || typeof parsed !== 'object' || !parsed.tracks || typeof parsed.tracks !== 'object') return {};
    const out: Record<string, TrackMixerState> = {};
    for (const [id, val] of Object.entries(parsed.tracks as Record<string, unknown>)) {
      const clean = sanitizeTrack(val);
      if (clean) out[id] = clean;
    }
    return out;
  } catch {
    return {};
  }
}
