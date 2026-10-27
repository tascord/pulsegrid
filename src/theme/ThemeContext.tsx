import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FONT_ID, DEFAULT_FONT_SIZE, DEFAULT_THEME_ID, FONT_OPTIONS, THEMES } from './themes';
import { clearWallpaper, loadWallpaper, saveWallpaper } from './wallpaperStore';

export interface EventFxSettings {
  /** Master switch for all event-driven eye candy. */
  enabled: boolean;
  /** Neon underline/glow on the triggering token. */
  glow: boolean;
  /** 0-100: token glow strength. */
  glowIntensity: number;
  /** Canvas particle bursts on each trigger. */
  particles: boolean;
  /** 0-100: particle burst density. */
  particleAmount: number;
  /** Floating note labels that rise and fade. */
  floaters: boolean;
  /** Editor frame pulses on every beat/step. */
  beatPulse: boolean;
  /** Brief full-editor flash on strong events (kick/bass). */
  screenFlash: boolean;
  /** Tiny impact shake on strong events. */
  shake: boolean;
  /** 0-100: impact shake throw. */
  shakeIntensity: number;
  /** Expanding shockwave rings from the triggering token. */
  shockwaves: boolean;
  /** 0-100: shockwave ring size/alpha. */
  shockwaveAmount: number;
  /** Horizontal light streaks that shoot across the editor. */
  streaks: boolean;
  /** Whole-line background flash on the triggering line. */
  lineFlash: boolean;
  /** Bottom energy bar that pumps with event density. */
  energyBar: boolean;
  /** Spinning diamond/triangle shards alongside sparks. */
  shards: boolean;
  /** 0-100: shard burst density. */
  shardAmount: number;
  /** Inset edge glow that breathes on beats and slams on kicks. */
  edgeGlow: boolean;
  /** Soft full-editor bloom swell on strong hits. */
  bassBloom: boolean;
  /** Brief RGB-split glitch bars on strong hits. */
  glitchBars: boolean;
  /** Hit-streak combo readout that pops as events stack up. */
  comboCounter: boolean;
}

// Quiet defaults: subtle glow only. Particles default to a low amount and
// floaters / beat-pulse / flash / shake are opt-in, since they cost React
// renders + canvas time on the same thread as the audio scheduler.
export const DEFAULT_EVENT_FX: EventFxSettings = {
  enabled: true,
  glow: true,
  glowIntensity: 35,
  particles: true,
  particleAmount: 25,
  floaters: false,
  beatPulse: false,
  screenFlash: false,
  shake: false,
  shakeIntensity: 60,
  shockwaves: true,
  shockwaveAmount: 55,
  streaks: false,
  lineFlash: false,
  energyBar: false,
  shards: true,
  shardAmount: 45,
  edgeGlow: true,
  bassBloom: false,
  glitchBars: false,
  comboCounter: false,
};

function clampFx01(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

function coerceEventFx(raw: unknown): EventFxSettings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<EventFxSettings>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_EVENT_FX.enabled,
    glow: typeof p.glow === 'boolean' ? p.glow : DEFAULT_EVENT_FX.glow,
    glowIntensity: clampFx01(p.glowIntensity, DEFAULT_EVENT_FX.glowIntensity),
    particles: typeof p.particles === 'boolean' ? p.particles : DEFAULT_EVENT_FX.particles,
    particleAmount: clampFx01(p.particleAmount, DEFAULT_EVENT_FX.particleAmount),
    floaters: typeof p.floaters === 'boolean' ? p.floaters : DEFAULT_EVENT_FX.floaters,
    beatPulse: typeof p.beatPulse === 'boolean' ? p.beatPulse : DEFAULT_EVENT_FX.beatPulse,
    screenFlash: typeof p.screenFlash === 'boolean' ? p.screenFlash : DEFAULT_EVENT_FX.screenFlash,
    shake: typeof p.shake === 'boolean' ? p.shake : DEFAULT_EVENT_FX.shake,
    shakeIntensity: clampFx01(p.shakeIntensity, DEFAULT_EVENT_FX.shakeIntensity),
    shockwaves: typeof p.shockwaves === 'boolean' ? p.shockwaves : DEFAULT_EVENT_FX.shockwaves,
    shockwaveAmount: clampFx01(p.shockwaveAmount, DEFAULT_EVENT_FX.shockwaveAmount),
    streaks: typeof p.streaks === 'boolean' ? p.streaks : DEFAULT_EVENT_FX.streaks,
    lineFlash: typeof p.lineFlash === 'boolean' ? p.lineFlash : DEFAULT_EVENT_FX.lineFlash,
    energyBar: typeof p.energyBar === 'boolean' ? p.energyBar : DEFAULT_EVENT_FX.energyBar,
    shards: typeof p.shards === 'boolean' ? p.shards : DEFAULT_EVENT_FX.shards,
    shardAmount: clampFx01(p.shardAmount, DEFAULT_EVENT_FX.shardAmount),
    edgeGlow: typeof p.edgeGlow === 'boolean' ? p.edgeGlow : DEFAULT_EVENT_FX.edgeGlow,
    bassBloom: typeof p.bassBloom === 'boolean' ? p.bassBloom : DEFAULT_EVENT_FX.bassBloom,
    glitchBars: typeof p.glitchBars === 'boolean' ? p.glitchBars : DEFAULT_EVENT_FX.glitchBars,
    comboCounter: typeof p.comboCounter === 'boolean' ? p.comboCounter : DEFAULT_EVENT_FX.comboCounter,
  };
}

export interface ThemeSettings {
  themeId: string;
  fontId: string;
  customFontStack: string;
  fontSize: number;
  formatWidth: number;
  wallpaperImage: string;
  wallpaperOpacity: number;
  customCss: string;
  eventFx: EventFxSettings;
}

const STORAGE_KEY = 'pulsegrid-theme-v1';
const SETTINGS_VERSION = 3;

function clampFormatWidth(value: unknown): number {
  const width = Number(value);
  return Number.isFinite(width) ? Math.min(160, Math.max(60, Math.round(width))) : 100;
}

function clampWallpaperOpacity(value: unknown): number {
  const opacity = Number(value);
  return Number.isFinite(opacity) ? Math.min(0.4, Math.max(0.05, opacity)) : 0.16;
}

function loadStored(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        themeId: parsed.version === SETTINGS_VERSION ? parsed.themeId || DEFAULT_THEME_ID : DEFAULT_THEME_ID,
        fontId: parsed.fontId || DEFAULT_FONT_ID,
        customFontStack: parsed.customFontStack || '',
        fontSize: Math.min(24, Math.max(10, Number(parsed.fontSize) || DEFAULT_FONT_SIZE)),
        formatWidth: clampFormatWidth(parsed.formatWidth),
        wallpaperImage: typeof parsed.wallpaperImage === 'string' && parsed.wallpaperImage.startsWith('data:image/')
          ? parsed.wallpaperImage
          : '',
        wallpaperOpacity: clampWallpaperOpacity(parsed.wallpaperOpacity),
        customCss: parsed.version === SETTINGS_VERSION ? parsed.customCss || '' : '',
        eventFx: coerceEventFx(parsed.eventFx),
      };
    }
  } catch {}
  return {
    themeId: DEFAULT_THEME_ID,
    fontId: DEFAULT_FONT_ID,
    customFontStack: '',
    fontSize: DEFAULT_FONT_SIZE,
    formatWidth: 100,
    wallpaperImage: '',
    wallpaperOpacity: 0.16,
    customCss: '',
    eventFx: { ...DEFAULT_EVENT_FX },
  };
}

interface ThemeContextValue extends ThemeSettings {
  setThemeId: (id: string) => void;
  setFontId: (id: string) => void;
  setCustomFontStack: (s: string) => void;
  setFontSize: (n: number) => void;
  setFormatWidth: (n: number) => void;
  setWallpaperImage: (image: string) => void;
  setWallpaperOpacity: (opacity: number) => void;
  setCustomCss: (s: string) => void;
  eventFx: EventFxSettings;
  setEventFx: (patch: Partial<EventFxSettings>) => void;
  resetEventFx: () => void;
  resetAll: () => void;
  exportJson: () => string;
  importJson: (json: string) => boolean;
  editorFont: string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(loadStored);

  // Wallpaper hydration gate: the image lives in IndexedDB (multi-MB GIFs
  // included), so the write-through below must not run until the initial
  // IndexedDB load has finished — otherwise a legacy localStorage value (or
  // '') would clobber a newer stored image.
  const wallpaperHydratedRef = useRef(false);
  const savedWallpaperRef = useRef<string | null>(null);

  // Load wallpaper from IndexedDB (survives reloads, keeps GIF animation).
  useEffect(() => {
    let cancelled = false;
    loadWallpaper().then((stored) => {
      if (!cancelled && stored) {
        savedWallpaperRef.current = stored;
        setSettings((s) => (s.wallpaperImage === stored ? s : { ...s, wallpaperImage: stored }));
      }
      if (!cancelled) wallpaperHydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist. Settings JSON stays in localStorage (wallpaper stripped — it can
  // be many megabytes); the image itself is written to IndexedDB, and only
  // when it actually changed, so opacity slider drags don't rewrite it.
  useEffect(() => {
    const { wallpaperImage: _wallpaper, ...rest } = settings;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, version: SETTINGS_VERSION }));
    } catch {}
    if (!wallpaperHydratedRef.current) return;
    const wallpaperImage = settings.wallpaperImage;
    if (wallpaperImage === savedWallpaperRef.current) return;
    savedWallpaperRef.current = wallpaperImage;
    if (wallpaperImage) {
      saveWallpaper(wallpaperImage).catch(() => {
        // IndexedDB unavailable (e.g. private mode): fall back to
        // localStorage so small images still survive a reload.
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION }));
        } catch {}
      });
    } else {
      clearWallpaper().catch(() => {});
    }
  }, [settings]);

  // Apply theme vars + font + size to <html>
  useEffect(() => {
    const root = document.documentElement;
    const theme = THEMES.find((t) => t.id === settings.themeId) || THEMES[0];
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.theme = theme.id;
    root.style.colorScheme = theme.dark ? 'dark' : 'light';

    const fontOpt = FONT_OPTIONS.find((f) => f.id === settings.fontId);
    const stack = settings.fontId === 'custom' && settings.customFontStack
      ? settings.customFontStack
      : fontOpt?.stack || FONT_OPTIONS[0].stack;
    root.style.setProperty('--pg-editor-font', stack);
    root.style.setProperty('--pg-editor-size', `${settings.fontSize}px`);
    root.style.setProperty('--pg-editor-lh', `${Math.round(settings.fontSize * 1.75)}px`);
    root.style.setProperty(
      '--pg-wallpaper-image',
      settings.wallpaperImage ? `url("${settings.wallpaperImage}")` : 'none'
    );
    root.style.setProperty('--pg-wallpaper-opacity', String(settings.wallpaperOpacity));
    // Event FX vars: token glow strength drives background alpha + blur.
    // Kept subtle so text stays readable; no layout-affecting props here.
    const fx = settings.eventFx;
    const glowT = (fx.glow && fx.enabled ? fx.glowIntensity : 0) / 100;
    root.style.setProperty('--pg-fx-glow-alpha', String(0.09 + glowT * 0.25));
    root.style.setProperty('--pg-fx-glow-blur', `${Math.round(2 + glowT * 8)}px`);
    root.style.setProperty('--pg-fx-glow-spread', '0px');
    root.dataset.fx = fx.enabled ? 'on' : 'off';

    // Load Google font on demand
    if (fontOpt?.googleUrl && !document.querySelector(`link[data-font="${fontOpt.id}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = fontOpt.googleUrl;
      link.dataset.font = fontOpt.id;
      document.head.appendChild(link);
    }

    // Per-theme CSS overlay (backgrounds, scanlines, grids, glows…)
    let themeCssEl = document.getElementById('pg-theme-css') as HTMLStyleElement | null;
    if (!themeCssEl) {
      themeCssEl = document.createElement('style');
      themeCssEl.id = 'pg-theme-css';
      document.head.appendChild(themeCssEl);
    }
    themeCssEl.textContent = theme.css || '';

    // Custom CSS injection (user overrides — applied after theme CSS)
    let styleEl = document.getElementById('pg-custom-css') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'pg-custom-css';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = settings.customCss || '';
  }, [settings]);

  const setThemeId = useCallback((themeId: string) => setSettings((s) => ({ ...s, themeId })), []);
  const setFontId = useCallback((fontId: string) => setSettings((s) => ({ ...s, fontId })), []);
  const setCustomFontStack = useCallback(
    (customFontStack: string) => setSettings((s) => ({ ...s, customFontStack })),
    []
  );
  const setFontSize = useCallback(
    (fontSize: number) => setSettings((s) => ({ ...s, fontSize: Math.min(24, Math.max(10, fontSize)) })),
    []
  );
  const setFormatWidth = useCallback(
    (formatWidth: number) => setSettings((s) => ({ ...s, formatWidth: clampFormatWidth(formatWidth) })),
    []
  );
  const setWallpaperImage = useCallback(
    (wallpaperImage: string) => setSettings((s) => ({ ...s, wallpaperImage })),
    []
  );
  const setWallpaperOpacity = useCallback(
    (wallpaperOpacity: number) => setSettings((s) => ({ ...s, wallpaperOpacity: clampWallpaperOpacity(wallpaperOpacity) })),
    []
  );
  const setCustomCss = useCallback((customCss: string) => setSettings((s) => ({ ...s, customCss })), []);
  const setEventFx = useCallback(
    (patch: Partial<EventFxSettings>) =>
      setSettings((s) => ({ ...s, eventFx: { ...s.eventFx, ...patch } })),
    []
  );
  const resetEventFx = useCallback(
    () => setSettings((s) => ({ ...s, eventFx: { ...DEFAULT_EVENT_FX } })),
    []
  );
  const resetAll = useCallback(
    () =>
      setSettings({
        themeId: DEFAULT_THEME_ID,
        fontId: DEFAULT_FONT_ID,
        customFontStack: '',
        fontSize: DEFAULT_FONT_SIZE,
        formatWidth: 100,
        wallpaperImage: '',
        wallpaperOpacity: 0.16,
        customCss: '',
        eventFx: { ...DEFAULT_EVENT_FX },
      }),
    []
  );
  // Wallpaper data URLs are megabytes of base64 — never export/share them.
  const exportJson = useCallback(() => {
    const { wallpaperImage: _omitted, ...shareable } = settings;
    return JSON.stringify(shareable, null, 2);
  }, [settings]);
  const importJson = useCallback((json: string) => {
    try {
      const p = JSON.parse(json);
      if (!p || typeof p !== 'object') return false;
      const importedWallpaper =
        typeof p.wallpaperImage === 'string' && p.wallpaperImage.startsWith('data:image/')
          ? p.wallpaperImage
          : undefined;
      setSettings((s) => ({
        themeId: typeof p.themeId === 'string' ? p.themeId : DEFAULT_THEME_ID,
        fontId: typeof p.fontId === 'string' ? p.fontId : DEFAULT_FONT_ID,
        customFontStack: typeof p.customFontStack === 'string' ? p.customFontStack : '',
        fontSize: Math.min(24, Math.max(10, Number(p.fontSize) || DEFAULT_FONT_SIZE)),
        formatWidth: clampFormatWidth(p.formatWidth),
        wallpaperImage: importedWallpaper ?? s.wallpaperImage,
        wallpaperOpacity: clampWallpaperOpacity(p.wallpaperOpacity),
        customCss: typeof p.customCss === 'string' ? p.customCss : '',
        eventFx: coerceEventFx(p.eventFx),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const editorFont = useMemo(() => {
    const fontOpt = FONT_OPTIONS.find((f) => f.id === settings.fontId);
    return settings.fontId === 'custom' && settings.customFontStack
      ? settings.customFontStack
      : fontOpt?.stack || FONT_OPTIONS[0].stack;
  }, [settings]);

  const value: ThemeContextValue = {
    ...settings,
    setThemeId,
    setFontId,
    setCustomFontStack,
    setFontSize,
    setFormatWidth,
    setWallpaperImage,
    setWallpaperOpacity,
    setCustomCss,
    setEventFx,
    resetEventFx,
    resetAll,
    exportJson,
    importJson,
    editorFont,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
