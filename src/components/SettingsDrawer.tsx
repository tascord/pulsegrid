import React, { useRef, useState } from 'react';
import { Palette, Type, Braces, RotateCcw, Download, Upload, Check, ALargeSmall, Share2, Sparkles, Zap } from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';
import { FONT_OPTIONS, THEMES } from '../theme/themes';
import { WALLPAPER_ACCEPTED_TYPES, processWallpaperFile } from '../theme/wallpaper';
import { previewEventFxBurst } from './EventFxOverlay';

function FxToggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-xs font-medium" style={{ color: 'var(--pg-text)' }}>{label}</div>
        {hint && <div className="text-[10px] pg-faint leading-snug">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative w-9 h-5 rounded-full shrink-0 transition-colors"
        style={{ background: checked ? 'var(--pg-accent)' : 'var(--pg-surface-3)' }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? '18px' : '2px' }}
        />
      </button>
    </div>
  );
}

function FxSlider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1 pl-1">
      <span className="text-[11px] pg-muted w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="flex-1 disabled:opacity-40"
        aria-label={label}
      />
      <span className="text-[11px] font-mono tabular-nums w-8 text-right" style={{ color: 'var(--pg-text)' }}>{value}</span>
    </div>
  );
}

export const SettingsDrawer: React.FC = () => {
  const theme = useTheme();
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [importText, setImportText] = useState('');
  const [wallpaperError, setWallpaperError] = useState('');
  const [copied, setCopied] = useState(false);
  const [importOk, setImportOk] = useState<boolean | null>(null);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishState, setPublishState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const activeTheme = THEMES.find((t) => t.id === theme.themeId) || THEMES[0];

  const handleExport = () => {
    navigator.clipboard.writeText(theme.exportJson());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleImport = () => {
    const ok = theme.importJson(importText);
    setImportOk(ok);
    setTimeout(() => setImportOk(null), 2500);
  };

  const [wallpaperBusy, setWallpaperBusy] = useState(false);

  const handleWallpaperUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!WALLPAPER_ACCEPTED_TYPES.includes(file.type)) {
      setWallpaperError('Choose a PNG, JPEG, WebP, or GIF image.');
      return;
    }

    setWallpaperBusy(true);
    try {
      const dataUrl = await processWallpaperFile(file);
      theme.setWallpaperImage(dataUrl);
      setWallpaperError('');
    } catch (err) {
      if (err instanceof Error && err.message === 'too-large') {
        setWallpaperError('That image is too large, even after optimizing (max 20 MB).');
      } else {
        setWallpaperError('This image could not be loaded.');
      }
    } finally {
      setWallpaperBusy(false);
    }
  };

  const handlePublish = async () => {
    setPublishState('sending');
    try {
      const preset = THEMES.find((t) => t.id === theme.themeId) || THEMES[0];
      const res = await fetch('/api/community/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: publishTitle || `${preset.name} · ${theme.fontSize}px`,
            description: `${preset.description} Published from the Style tab.`,
            author: 'Local Performer',
            type: 'theme',
            tags: ['theme', 'style'],
            data: { theme: JSON.parse(theme.exportJson()), vars: preset.vars, css: preset.css || '' },
          }),
      });
      setPublishState(res.ok ? 'done' : 'error');
    } catch {
      setPublishState('error');
    }
    setTimeout(() => setPublishState('idle'), 3000);
  };

  return (
    <div className="flex flex-col h-full pg-panel">
      <div className="flex items-center justify-between px-3 py-2 pg-panel-header text-xs">
        <div className="flex items-center gap-2">
          <Palette className="w-3.5 h-3.5" style={{ color: 'var(--pg-accent)' }} />
          <span className="font-semibold">Appearance</span>
        </div>
        <button
          onClick={theme.resetAll}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border hover:brightness-110"
          style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-muted)' }}
          title="Reset theme, font and CSS"
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {/* Theme presets */}
        <section>
          <h3 className="text-xs font-semibold mb-2 pg-muted">Color theme</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {THEMES.map((t) => {
              const active = t.id === theme.themeId;
              return (
                <button
                  key={t.id}
                  onClick={() => theme.setThemeId(t.id)}
                  className="text-left rounded-xl border p-2.5 transition-all hover:scale-[1.01]"
                  style={{
                    borderColor: active ? 'var(--pg-accent)' : 'var(--pg-border)',
                    background: 'var(--pg-surface-2)',
                    boxShadow: active ? '0 0 0 1px var(--pg-accent)' : undefined,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {['--pg-bg', '--pg-surface', '--pg-accent', '--pg-accent-2', '--pg-accent-3']
                      .map((key) => t.vars[key])
                      .map((c, i) => (
                        <span
                          key={i}
                          className="w-4 h-4 rounded-full border border-black/30"
                          style={{ background: c }}
                        />
                      ))}
                    {active && <Check className="w-3.5 h-3.5 ml-auto" style={{ color: 'var(--pg-accent)' }} />}
                  </div>
                  <div className="font-semibold text-[12px] flex items-center gap-1.5">
                    {t.name}
                    {t.css && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded-full border"
                        style={{ borderColor: 'var(--pg-accent)', color: 'var(--pg-accent)' }}
                        title="This theme ships a CSS overlay (background art, grids, scanlines…)"
                      >
                        CSS FX
                      </span>
                    )}
                  </div>
                  <div className="pg-muted text-[11px] leading-snug">{t.description}</div>
                </button>
              );
            })}
          </div>
          <p className="pg-faint text-[11px] mt-2">
            Active: <span style={{ color: 'var(--pg-text)' }}>{activeTheme.name}</span> · persisted to this browser.
          </p>
        </section>

        <section
          className="rounded-xl border p-3 space-y-2"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
        >
          <h3 className="text-xs font-semibold pg-muted">Editor wallpaper</h3>
          <div
            className="relative h-16 overflow-hidden rounded-md border"
            style={{
              borderColor: 'var(--pg-border)',
              backgroundColor: 'var(--pg-editor-bg)',
              backgroundImage: theme.wallpaperImage
                ? `linear-gradient(color-mix(in srgb, var(--pg-editor-bg) 38%, transparent), color-mix(in srgb, var(--pg-editor-bg) 38%, transparent)), url("${theme.wallpaperImage}")`
                : undefined,
              backgroundPosition: 'center',
              backgroundSize: 'cover',
            }}
          />
          <input
            ref={wallpaperInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleWallpaperUpload}
            className="sr-only"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => wallpaperInputRef.current?.click()}
              disabled={wallpaperBusy}
              className="px-2.5 py-1.5 rounded-md border text-xs font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
            >
              {wallpaperBusy ? 'Optimizing…' : theme.wallpaperImage ? 'Change image' : 'Upload image'}
            </button>
            {theme.wallpaperImage && (
              <button
                type="button"
                onClick={() => {
                  theme.setWallpaperImage('');
                  setWallpaperError('');
                }}
                className="px-2 py-1.5 rounded-md text-xs pg-muted"
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-xs pg-muted">
            <label htmlFor="pg-wallpaper-opacity">Image strength</label>
            <input
              id="pg-wallpaper-opacity"
              type="range"
              min={0.05}
              max={0.4}
              step={0.01}
              disabled={!theme.wallpaperImage}
              value={theme.wallpaperOpacity}
              onChange={(e) => theme.setWallpaperOpacity(parseFloat(e.target.value))}
              className="w-32 disabled:opacity-40"
            />
          </div>
          <p className="text-[10px] pg-faint">Stored in this browser. Large images are optimized automatically (up to 20 MB). GIFs keep animating.</p>
          {wallpaperError && <p className="text-xs" style={{ color: 'var(--pg-danger)' }}>{wallpaperError}</p>}
        </section>

        {/* Event FX */}
        <section
          className="rounded-xl border p-3 space-y-1"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold pg-muted flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Event FX · make it immense
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={previewEventFxBurst}
                className="flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium hover:brightness-110"
                style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
                title="Fire a test particle burst in the code editor"
              >
                <Zap className="w-3 h-3" /> Preview
              </button>
              <button
                type="button"
                onClick={theme.resetEventFx}
                className="px-2 py-1 rounded-md text-[11px] pg-muted hover:opacity-80"
                title="Reset event effects to defaults"
              >
                Reset
              </button>
            </div>
          </div>
          <p className="text-[11px] pg-faint leading-relaxed">
            Eye candy fired by live trigger events in the Session editor. Play something, then tune the chaos.
          </p>
          <FxToggle
            label="Event effects"
            hint="Master switch for glow, particles, floaters and pulses."
            checked={theme.eventFx.enabled}
            onChange={(v) => theme.setEventFx({ enabled: v })}
          />
          <div className={theme.eventFx.enabled ? undefined : 'opacity-40 pointer-events-none'}>
            <FxToggle
              label="Token glow"
              hint="Triggering words ignite with neon glow + pop."
              checked={theme.eventFx.glow}
              onChange={(v) => theme.setEventFx({ glow: v })}
            />
            <FxSlider
              label="Glow strength"
              value={theme.eventFx.glowIntensity}
              disabled={!theme.eventFx.glow}
              onChange={(v) => theme.setEventFx({ glowIntensity: v })}
            />
            <div className="my-1 border-t" style={{ borderColor: 'var(--pg-border-soft)' }} />
            <FxToggle
              label="Particle bursts"
              hint="Additive glowing sparks erupt at the triggering line."
              checked={theme.eventFx.particles}
              onChange={(v) => theme.setEventFx({ particles: v })}
            />
            <FxSlider
              label="Particle amount"
              value={theme.eventFx.particleAmount}
              disabled={!theme.eventFx.particles}
              onChange={(v) => theme.setEventFx({ particleAmount: v })}
            />
            <div className="my-1 border-t" style={{ borderColor: 'var(--pg-border-soft)' }} />
            <FxToggle
              label="Shockwave rings"
              hint="Expanding rings bloom from each hit — big on kicks."
              checked={theme.eventFx.shockwaves}
              onChange={(v) => theme.setEventFx({ shockwaves: v })}
            />
            <FxSlider
              label="Ring size"
              value={theme.eventFx.shockwaveAmount}
              disabled={!theme.eventFx.shockwaves}
              onChange={(v) => theme.setEventFx({ shockwaveAmount: v })}
            />
            <FxToggle
              label="Light streaks"
              hint="Hats, snares and clicks fire horizontal dashes."
              checked={theme.eventFx.streaks}
              onChange={(v) => theme.setEventFx({ streaks: v })}
            />
            <FxToggle
              label="Shard burst"
              hint="Spinning diamonds + triangles tumble with the sparks."
              checked={theme.eventFx.shards}
              onChange={(v) => theme.setEventFx({ shards: v })}
            />
            <FxSlider
              label="Shard amount"
              value={theme.eventFx.shardAmount}
              disabled={!theme.eventFx.shards}
              onChange={(v) => theme.setEventFx({ shardAmount: v })}
            />
            <div className="my-1 border-t" style={{ borderColor: 'var(--pg-border-soft)' }} />
            <FxToggle
              label="Line flash"
              hint="The whole triggering line lights up, then fades."
              checked={theme.eventFx.lineFlash}
              onChange={(v) => theme.setEventFx({ lineFlash: v })}
            />
            <FxToggle
              label="Energy bar"
              hint="Bottom meter pumps with event density, decays live."
              checked={theme.eventFx.energyBar}
              onChange={(v) => theme.setEventFx({ energyBar: v })}
            />
            <FxToggle
              label="Edge glow"
              hint="Inset vignette breathes on beats, slams on kicks."
              checked={theme.eventFx.edgeGlow}
              onChange={(v) => theme.setEventFx({ edgeGlow: v })}
            />
            <FxToggle
              label="Bass bloom"
              hint="Slow soft swell across the editor on strong hits."
              checked={theme.eventFx.bassBloom}
              onChange={(v) => theme.setEventFx({ bassBloom: v })}
            />
            <FxToggle
              label="Glitch bars"
              hint="RGB-split slices jitter on kicks. Maximum chaos."
              checked={theme.eventFx.glitchBars}
              onChange={(v) => theme.setEventFx({ glitchBars: v })}
            />
            <FxToggle
              label="Combo streak"
              hint="×N stacks top-right, old numbers fly off, round numbers burst."
              checked={theme.eventFx.comboCounter}
              onChange={(v) => theme.setEventFx({ comboCounter: v })}
            />
            <div className="my-1 border-t" style={{ borderColor: 'var(--pg-border-soft)' }} />
            <FxToggle
              label="Floating note labels"
              hint="bd, cp, hh… rise and fade above the burst."
              checked={theme.eventFx.floaters}
              onChange={(v) => theme.setEventFx({ floaters: v })}
            />
            <FxToggle
              label="Beat pulse"
              hint="Editor frame breathes on every step."
              checked={theme.eventFx.beatPulse}
              onChange={(v) => theme.setEventFx({ beatPulse: v })}
            />
            <FxToggle
              label="Bass flash wash"
              hint="Big radial flash on kicks / bass hits. Pairs with shake."
              checked={theme.eventFx.screenFlash}
              onChange={(v) => theme.setEventFx({ screenFlash: v })}
            />
            <FxToggle
              label="Impact shake"
              hint="Slam + rebound on strong hits. dial in the throw below."
              checked={theme.eventFx.shake}
              onChange={(v) => theme.setEventFx({ shake: v })}
            />
            <FxSlider
              label="Shake amount"
              value={theme.eventFx.shakeIntensity}
              disabled={!theme.eventFx.shake}
              onChange={(v) => theme.setEventFx({ shakeIntensity: v })}
            />
          </div>
          <p className="text-[10px] pg-faint">Respects prefers-reduced-motion. Saved with your theme.</p>
        </section>

        {/* Font */}
        <section
          className="rounded-xl border p-3 space-y-3"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
        >
          <h3 className="text-xs font-semibold pg-muted flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5" /> Editor font
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.id}
                onClick={() => theme.setFontId(f.id)}
                className="px-2 py-1.5 rounded-lg border text-[11px] truncate"
                style={{
                  borderColor: theme.fontId === f.id ? 'var(--pg-accent)' : 'var(--pg-border)',
                  background: theme.fontId === f.id ? 'var(--pg-surface-3)' : 'transparent',
                  fontFamily: f.stack,
                }}
                title={f.stack}
              >
                {f.name}
              </button>
            ))}
            <button
              onClick={() => theme.setFontId('custom')}
              className="px-2 py-1.5 rounded-lg border text-[11px]"
              style={{
                borderColor: theme.fontId === 'custom' ? 'var(--pg-accent)' : 'var(--pg-border)',
                background: theme.fontId === 'custom' ? 'var(--pg-surface-3)' : 'transparent',
              }}
            >
              Custom…
            </button>
          </div>

          {theme.fontId === 'custom' && (
            <input
              value={theme.customFontStack}
              onChange={(e) => theme.setCustomFontStack(e.target.value)}
              placeholder='"My Font", monospace'
              className="w-full rounded-lg border px-2.5 py-1.5 text-[12px] bg-transparent focus:outline-none"
              style={{ borderColor: 'var(--pg-border)', fontFamily: 'var(--pg-editor-font)' }}
            />
          )}

          <div>
            <div className="flex items-center justify-between text-[11px] pg-muted mb-1">
              <span className="flex items-center gap-1">
                <ALargeSmall className="w-3.5 h-3.5" /> Font size
              </span>
              <span className="font-mono tabular-nums" style={{ color: 'var(--pg-text)' }}>
                {theme.fontSize}px
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={24}
              step={1}
              value={theme.fontSize}
              onChange={(e) => theme.setFontSize(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div
              className="mt-2 rounded-lg border p-2.5"
              style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-editor-bg)' }}
            >
              <span style={{ fontFamily: 'var(--pg-editor-font)', fontSize: 'var(--pg-editor-size)' }}>
                <span className="pg-tok-keyword">track</span>
                <span>(</span>
                <span className="pg-tok-string">"acid"</span>
                <span>).</span>
                <span className="pg-tok-method">pattern</span>
                <span>(</span>
                <span className="pg-tok-string">"c2 [c2 eb2] g2"</span>
                <span>)</span>
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--pg-border-soft)' }}>
              <div>
                <label htmlFor="pg-format-width" className="text-xs font-medium">Format width</label>
                <p className="text-[10px] pg-faint">Wrap chains and long patterns at this column.</p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  id="pg-format-width"
                  type="number"
                  min={60}
                  max={160}
                  value={theme.formatWidth}
                  onChange={(e) => theme.setFormatWidth(parseInt(e.target.value, 10))}
                  className="w-16 rounded-md border bg-transparent px-2 py-1 text-right font-mono text-xs"
                  style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
                />
                <span className="text-[10px] pg-faint">chars</span>
              </div>
            </div>
          </div>
        </section>

        {/* Custom CSS */}
        <section
          className="rounded-xl border p-3 space-y-2"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
        >
          <h3 className="text-xs font-semibold pg-muted flex items-center gap-1.5">
            <Braces className="w-3.5 h-3.5" /> Custom CSS
          </h3>
          <p className="pg-muted text-[11px] leading-relaxed">
            Injected live into <code>&lt;style id="pg-custom-css"&gt;</code>. Try e.g.{' '}
            <code className="font-mono">.pg-panel &#123; border-radius: 8px &#125;</code>
          </p>
          <textarea
            value={theme.customCss}
            onChange={(e) => theme.setCustomCss(e.target.value)}
            spellCheck={false}
            rows={7}
            placeholder={"/* Workspace overrides */\n.pg-panel {\n  border-radius: 8px;\n}"}
            className="w-full rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed bg-transparent focus:outline-none resize-y"
            style={{
              borderColor: 'var(--pg-border)',
              fontFamily: 'var(--pg-editor-font)',
              background: 'var(--pg-editor-bg)',
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold pg-btn-accent"
            >
              {copied ? <Check className="w-3 h-3" /> : <Download className="w-3 h-3" />}
              {copied ? 'Copied JSON' : 'Copy theme JSON'}
            </button>
            <span className="pg-faint text-xs">Export or share this theme.</span>
          </div>
          <div className="flex gap-2">
            <input
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste theme JSON to import…"
              className="flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono bg-transparent focus:outline-none"
              style={{ borderColor: 'var(--pg-border)' }}
            />
            <button
              onClick={handleImport}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px]"
              style={{ borderColor: 'var(--pg-border)' }}
            >
              <Upload className="w-3 h-3" /> Import
            </button>
          </div>
          {importOk === true && <p className="text-[11px]" style={{ color: 'var(--pg-ok)' }}>Theme imported.</p>}
          {importOk === false && <p className="text-[11px]" style={{ color: 'var(--pg-danger)' }}>Invalid JSON.</p>}
        </section>

        {/* Publish to theme gallery */}
        <section
          className="rounded-xl border p-3 space-y-2"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface-2)' }}
        >
          <h3 className="text-xs font-semibold pg-muted flex items-center gap-1.5">
            <Share2 className="w-3.5 h-3.5" /> Theme gallery
          </h3>
          <div className="flex gap-2">
            <input
              value={publishTitle}
              onChange={(e) => setPublishTitle(e.target.value)}
              placeholder={`${activeTheme.name} · my variation`}
              className="flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] bg-transparent focus:outline-none"
              style={{ borderColor: 'var(--pg-border)' }}
            />
            <button
              onClick={handlePublish}
              disabled={publishState === 'sending'}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold pg-btn-accent disabled:opacity-50"
            >
              {publishState === 'sending' ? '…' : publishState === 'done' ? 'Live ✓' : 'Publish'}
            </button>
          </div>
          {publishState === 'done' && (
            <p className="text-[11px]" style={{ color: 'var(--pg-ok)' }}>Theme is live in Share → Explore Community → Themes.</p>
          )}
          {publishState === 'error' && (
            <p className="text-[11px]" style={{ color: 'var(--pg-danger)' }}>Publish failed — is the server running?</p>
          )}
        </section>
      </div>
    </div>
  );
};
