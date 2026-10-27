// Each theme maps the same workstation roles to a different palette.

export interface PulseTheme {
  id: string;
  name: string;
  description: string;
  dark: boolean;
  vars: Record<string, string>;
  /**
   * Optional per-theme CSS overlay — injected into a dedicated
   * <style id="pg-theme-css"> tag while the theme is active, removed on
   * switch. Use for background images, gradients, scanlines, grid
   * overlays, glows, animations — anything beyond flat vars. Pure paint
   * only (no layout): stick to body / .pg-workstation::before/::after,
   * .pg-panel, .pg-editor-surface, scrollbars, etc.
   */
  css?: string;
}

export const THEMES: PulseTheme[] = [
  {
    id: 'strudel-night',
    name: 'Studio Graphite',
    description: 'Quiet graphite surfaces with restrained mint and amber signals.',
    dark: true,
    vars: {
      '--pg-bg': '#111519',
      '--pg-bg-dots': 'rgba(255,255,255,0.035)',
      '--pg-surface': '#181e23',
      '--pg-surface-2': '#20282e',
      '--pg-surface-3': '#2a343b',
      '--pg-border': '#39454d',
      '--pg-border-soft': '#2a3339',
      '--pg-text': '#e8edf0',
      '--pg-muted': '#a6b1b8',
      '--pg-faint': '#87939b',
      '--pg-accent': '#6cdbb6',
      '--pg-accent-ink': '#10241d',
      '--pg-accent-2': '#e6b96f',
      '--pg-accent-3': '#a9c8df',
      '--pg-danger': '#f07878',
      '--pg-ok': '#6cdbb6',
      '--pg-warn': '#e6b96f',
      '--pg-editor-bg': '#12181c',
      '--pg-editor-gutter': '#87939b',
      '--pg-keyword': '#79dfbc',
      '--pg-method': '#a9c8df',
      '--pg-string': '#e6c98e',
      '--pg-string-punct': '#aab7bd',
      '--pg-number': '#d0b2df',
      '--pg-comment': '#8d999f',
      '--pg-token-flash-bg': '#6cdbb6',
      '--pg-token-flash-ink': '#10241d',
      '--pg-header-bg': 'rgba(17,21,25,0.96)',
    },
  },
  {
    id: 'strudel-cream',
    name: 'Warm Paper',
    description: 'Warm light surfaces for bright rooms and daytime use.',
    dark: false,
    vars: {
      '--pg-bg': '#faf5ea',
      '--pg-bg-dots': 'rgba(35,35,63,0.08)',
      '--pg-surface': '#ffffff',
      '--pg-surface-2': '#f4ecdc',
      '--pg-surface-3': '#ece0c9',
      '--pg-border': '#ddd0b8',
      '--pg-border-soft': '#e9dfc9',
      '--pg-text': '#23233f',
      '--pg-muted': '#6f6a85',
      '--pg-faint': '#777287',
      '--pg-accent': '#087d61',
      '--pg-accent-ink': '#ffffff',
      '--pg-accent-2': '#ad2168',
      '--pg-accent-3': '#9a6a00',
      '--pg-danger': '#d92d5b',
      '--pg-ok': '#0e9f7e',
      '--pg-warn': '#9a6a00',
      '--pg-editor-bg': '#fffdf6',
      '--pg-editor-gutter': '#777287',
      '--pg-keyword': '#087451',
      '--pg-method': '#2563eb',
      '--pg-string': '#9a6a00',
      '--pg-string-punct': '#d63384',
      '--pg-number': '#7c3aed',
      '--pg-comment': '#777287',
      '--pg-token-flash-bg': '#087d61',
      '--pg-token-flash-ink': '#ffffff',
      '--pg-header-bg': 'rgba(250,245,234,0.9)',
    },
  },
  {
    id: 'club-oled',
    name: 'Stage Black',
    description: 'Near-black surfaces with bright signals for dim rooms.',
    dark: true,
    vars: {
      '--pg-bg': '#000000',
      '--pg-bg-dots': 'rgba(255,255,255,0.07)',
      '--pg-surface': '#0d0d12',
      '--pg-surface-2': '#14141b',
      '--pg-surface-3': '#1d1d27',
      '--pg-border': '#2c2c38',
      '--pg-border-soft': '#1e1e28',
      '--pg-text': '#ffffff',
      '--pg-muted': '#a1a1b3',
      '--pg-faint': '#858591',
      '--pg-accent': '#00ffa3',
      '--pg-accent-ink': '#001208',
      '--pg-accent-2': '#ff4ecd',
      '--pg-accent-3': '#fff000',
      '--pg-danger': '#ff3b5c',
      '--pg-ok': '#00ffa3',
      '--pg-warn': '#fff000',
      '--pg-editor-bg': '#050508',
      '--pg-editor-gutter': '#858591',
      '--pg-keyword': '#00ffa3',
      '--pg-method': '#5cc8ff',
      '--pg-string': '#fff000',
      '--pg-string-punct': '#ff4ecd',
      '--pg-number': '#c59bff',
      '--pg-comment': '#858591',
      '--pg-token-flash-bg': '#00ffa3',
      '--pg-token-flash-ink': '#000000',
      '--pg-header-bg': 'rgba(0,0,0,0.88)',
    },
  },
  {
    id: 'mint-grid',
    name: 'Cool Slate',
    description: 'Deep blue-green surfaces with a cool mint accent.',
    dark: true,
    vars: {
      '--pg-bg': '#0d1b1e',
      '--pg-bg-dots': 'rgba(123,241,211,0.09)',
      '--pg-surface': '#12262b',
      '--pg-surface-2': '#173239',
      '--pg-surface-3': '#1e4049',
      '--pg-border': '#2a525d',
      '--pg-border-soft': '#1e4049',
      '--pg-text': '#eafff8',
      '--pg-muted': '#8fb8b5',
      '--pg-faint': '#739592',
      '--pg-accent': '#7bf1d3',
      '--pg-accent-ink': '#06231d',
      '--pg-accent-2': '#ffc7e3',
      '--pg-accent-3': '#ffedb0',
      '--pg-danger': '#ff8fa3',
      '--pg-ok': '#7bf1d3',
      '--pg-warn': '#ffedb0',
      '--pg-editor-bg': '#0a1518',
      '--pg-editor-gutter': '#739592',
      '--pg-keyword': '#7bf1d3',
      '--pg-method': '#9adcff',
      '--pg-string': '#ffedb0',
      '--pg-string-punct': '#ffc7e3',
      '--pg-number': '#cdb4ff',
      '--pg-comment': '#739592',
      '--pg-token-flash-bg': '#7bf1d3',
      '--pg-token-flash-ink': '#0d1b1e',
      '--pg-header-bg': 'rgba(13,27,30,0.88)',
    },
  },
  {
    id: 'sunset-tape',
    name: 'Plum Room',
    description: 'Rich plum surfaces with vivid rose, aqua, and gold signals.',
    dark: true,
    vars: {
      '--pg-bg': '#211126',
      '--pg-bg-dots': 'rgba(255,109,180,0.07)',
      '--pg-surface': '#2e1735',
      '--pg-surface-2': '#3b1d44',
      '--pg-surface-3': '#4a2754',
      '--pg-border': '#684274',
      '--pg-border-soft': '#4a2754',
      '--pg-text': '#fff0fa',
      '--pg-muted': '#d4b4d1',
      '--pg-faint': '#a785ad',
      '--pg-accent': '#ff6db4',
      '--pg-accent-ink': '#390c25',
      '--pg-accent-2': '#61e6d2',
      '--pg-accent-3': '#ffcb6a',
      '--pg-danger': '#ff6b6b',
      '--pg-ok': '#61e6d2',
      '--pg-warn': '#ffcb6a',
      '--pg-editor-bg': '#1e0f24',
      '--pg-editor-gutter': '#a785ad',
      '--pg-keyword': '#ff79c6',
      '--pg-method': '#8be9fd',
      '--pg-string': '#f1fa8c',
      '--pg-string-punct': '#e8c6e6',
      '--pg-number': '#bd93f9',
      '--pg-comment': '#a785ad',
      '--pg-token-flash-bg': '#ff6db4',
      '--pg-token-flash-ink': '#390c25',
      '--pg-header-bg': 'rgba(33,17,38,0.96)',
    },
  },
];

function createTheme(
  id: string,
  name: string,
  description: string,
  dark: boolean,
  vars: Record<string, string>,
  css?: string
): PulseTheme {
  return { id, name, description, dark, vars: { ...THEMES[0].vars, ...vars }, ...(css ? { css } : {}) };
}

THEMES.push(
  createTheme('blueprint', 'Blueprint', 'Deep blue panels with a clear sky-blue signal.', true, {
    '--pg-bg': '#0e1722',
    '--pg-bg-dots': 'rgba(190,220,245,0.035)',
    '--pg-surface': '#152231',
    '--pg-surface-2': '#1d2e40',
    '--pg-surface-3': '#293d50',
    '--pg-border': '#3c5367',
    '--pg-border-soft': '#2a3d4e',
    '--pg-text': '#e8f0f6',
    '--pg-muted': '#afbdc8',
    '--pg-faint': '#8999a6',
    '--pg-accent': '#4db9ff',
    '--pg-accent-ink': '#08202b',
    '--pg-accent-2': '#ffad66',
    '--pg-accent-3': '#d89bff',
    '--pg-danger': '#f07878',
    '--pg-ok': '#78d7b2',
    '--pg-warn': '#efb977',
    '--pg-editor-bg': '#101b26',
    '--pg-editor-gutter': '#8999a6',
    '--pg-keyword': '#7dd3fc',
    '--pg-method': '#cfb3ff',
    '--pg-string': '#ffd38a',
    '--pg-string-punct': '#aebdca',
    '--pg-number': '#ff9fcf',
    '--pg-comment': '#8999a6',
    '--pg-token-flash-bg': '#4db9ff',
    '--pg-token-flash-ink': '#08202b',
    '--pg-header-bg': 'rgba(14,23,34,0.96)',
  }),
  createTheme('oxide', 'Oxide', 'Warm charcoal with copper and sage accents.', true, {
    '--pg-bg': '#1a1714',
    '--pg-bg-dots': 'rgba(238,209,170,0.025)',
    '--pg-surface': '#231f1b',
    '--pg-surface-2': '#2d2822',
    '--pg-surface-3': '#383128',
    '--pg-border': '#4a4034',
    '--pg-border-soft': '#3a332c',
    '--pg-text': '#f0ece5',
    '--pg-muted': '#c4b8a7',
    '--pg-faint': '#a19380',
    '--pg-accent': '#e1a66e',
    '--pg-accent-ink': '#2d1d10',
    '--pg-accent-2': '#9dc3a3',
    '--pg-accent-3': '#dfcfaa',
    '--pg-danger': '#ef7770',
    '--pg-ok': '#9dc3a3',
    '--pg-warn': '#e1a66e',
    '--pg-editor-bg': '#191613',
    '--pg-editor-gutter': '#a19380',
    '--pg-keyword': '#eab37d',
    '--pg-method': '#b3c9d2',
    '--pg-string': '#e6d2a7',
    '--pg-string-punct': '#c2b8a8',
    '--pg-number': '#d0b4dc',
    '--pg-comment': '#a19380',
    '--pg-token-flash-bg': '#e1a66e',
    '--pg-token-flash-ink': '#2d1d10',
    '--pg-header-bg': 'rgba(26,23,20,0.96)',
  }),
  createTheme('chalk', 'Chalk', 'Cool light surfaces with ink text and blue controls.', false, {
    '--pg-bg': '#eef1f3',
    '--pg-bg-dots': 'rgba(25,45,58,0.035)',
    '--pg-surface': '#f8fafb',
    '--pg-surface-2': '#e6ebef',
    '--pg-surface-3': '#d8e0e6',
    '--pg-border': '#c5d0d8',
    '--pg-border-soft': '#d5dde3',
    '--pg-text': '#1b2832',
    '--pg-muted': '#465863',
    '--pg-faint': '#586a75',
    '--pg-accent': '#176b9a',
    '--pg-accent-ink': '#ffffff',
    '--pg-accent-2': '#ae5c1b',
    '--pg-accent-3': '#68549a',
    '--pg-danger': '#b42335',
    '--pg-ok': '#087a59',
    '--pg-warn': '#95500f',
    '--pg-editor-bg': '#f8fafb',
    '--pg-editor-gutter': '#586a75',
    '--pg-keyword': '#087451',
    '--pg-method': '#225f95',
    '--pg-string': '#81500e',
    '--pg-string-punct': '#6b536f',
    '--pg-number': '#7046a1',
    '--pg-comment': '#586a75',
    '--pg-token-flash-bg': '#176b9a',
    '--pg-token-flash-ink': '#ffffff',
    '--pg-header-bg': 'rgba(238,241,243,0.97)',
  }),
  createTheme('contrast', 'High Contrast', 'Bright status colors on near-black panels.', true, {
    '--pg-bg': '#080a0c',
    '--pg-bg-dots': 'rgba(255,255,255,0.025)',
    '--pg-surface': '#101316',
    '--pg-surface-2': '#1a2024',
    '--pg-surface-3': '#293137',
    '--pg-border': '#65727a',
    '--pg-border-soft': '#343d42',
    '--pg-text': '#ffffff',
    '--pg-muted': '#e1e7ea',
    '--pg-faint': '#bdc9cf',
    '--pg-accent': '#a4ff6e',
    '--pg-accent-ink': '#111a0c',
    '--pg-accent-2': '#ffd166',
    '--pg-accent-3': '#72d7ff',
    '--pg-danger': '#ff7474',
    '--pg-ok': '#a4ff6e',
    '--pg-warn': '#ffd166',
    '--pg-editor-bg': '#050708',
    '--pg-editor-gutter': '#bdc9cf',
    '--pg-keyword': '#a4ff6e',
    '--pg-method': '#72d7ff',
    '--pg-string': '#ffd166',
    '--pg-string-punct': '#e1e7ea',
    '--pg-number': '#d4b8ed',
    '--pg-comment': '#bdc9cf',
    '--pg-token-flash-bg': '#a4ff6e',
    '--pg-token-flash-ink': '#111a0c',
    '--pg-header-bg': 'rgba(8,10,12,0.97)',
  }),
  createTheme('ultraviolet', 'Ultraviolet', 'Indigo panels with bright violet, pink, and aqua.', true, {
    '--pg-bg': '#120e20',
    '--pg-bg-dots': 'rgba(210,180,255,0.04)',
    '--pg-surface': '#1c1530',
    '--pg-surface-2': '#281d40',
    '--pg-surface-3': '#362852',
    '--pg-border': '#4b3d69',
    '--pg-border-soft': '#362852',
    '--pg-text': '#f4edff',
    '--pg-muted': '#c2b5da',
    '--pg-faint': '#a292c4',
    '--pg-accent': '#c29bff',
    '--pg-accent-ink': '#26123f',
    '--pg-accent-2': '#ff7da9',
    '--pg-accent-3': '#65e6d1',
    '--pg-danger': '#ff747c',
    '--pg-ok': '#65e6d1',
    '--pg-warn': '#ffd166',
    '--pg-editor-bg': '#130e21',
    '--pg-editor-gutter': '#a292c4',
    '--pg-keyword': '#d5b5ff',
    '--pg-method': '#78e3ff',
    '--pg-string': '#ffe080',
    '--pg-string-punct': '#c2b5da',
    '--pg-number': '#ff9bbf',
    '--pg-comment': '#a292c4',
    '--pg-token-flash-bg': '#c29bff',
    '--pg-token-flash-ink': '#26123f',
    '--pg-header-bg': 'rgba(18,14,32,0.97)',
  }),
  createTheme('citrus', 'Citrus', 'Deep green surfaces with lime, coral, and aqua accents.', true, {
    '--pg-bg': '#101a18',
    '--pg-bg-dots': 'rgba(201,242,102,0.04)',
    '--pg-surface': '#172521',
    '--pg-surface-2': '#20352d',
    '--pg-surface-3': '#2d473b',
    '--pg-border': '#456453',
    '--pg-border-soft': '#30483d',
    '--pg-text': '#edf7e9',
    '--pg-muted': '#c3d1bd',
    '--pg-faint': '#9eae98',
    '--pg-accent': '#c9f266',
    '--pg-accent-ink': '#1c2810',
    '--pg-accent-2': '#ff976f',
    '--pg-accent-3': '#6bded0',
    '--pg-danger': '#ff7272',
    '--pg-ok': '#a5e887',
    '--pg-warn': '#ffc66d',
    '--pg-editor-bg': '#101b17',
    '--pg-editor-gutter': '#9eae98',
    '--pg-keyword': '#d7f779',
    '--pg-method': '#7de1d7',
    '--pg-string': '#ffd486',
    '--pg-string-punct': '#bbc9b6',
    '--pg-number': '#d2b4ff',
    '--pg-comment': '#9eae98',
    '--pg-token-flash-bg': '#c9f266',
    '--pg-token-flash-ink': '#1c2810',
    '--pg-header-bg': 'rgba(16,26,24,0.97)',
  })
);

/* CSS-overlay themes: translucent surfaces let the artwork bleed through,
   and each theme ships extra paint (gradients, grids, scanlines, glows).
   Overlays are pointer-events:none and layout-free by construction. */

THEMES.push(
  createTheme('neon-sunset', 'Neon Sunset', 'Synthwave sun + perspective grid over translucent violet glass.', true, {
    '--pg-bg': '#0d0221',
    '--pg-bg-dots': 'rgba(255,45,149,0.06)',
    '--pg-surface': 'rgba(26,11,61,0.82)',
    '--pg-surface-2': 'rgba(43,15,84,0.82)',
    '--pg-surface-3': 'rgba(63,24,110,0.9)',
    '--pg-border': '#7b4bc4',
    '--pg-border-soft': 'rgba(123,75,196,0.45)',
    '--pg-text': '#ffe9f6',
    '--pg-muted': '#c9a8e8',
    '--pg-faint': '#9a76c4',
    '--pg-accent': '#ff2d95',
    '--pg-accent-ink': '#2b0620',
    '--pg-accent-2': '#00e5ff',
    '--pg-accent-3': '#ffd319',
    '--pg-danger': '#ff5c5c',
    '--pg-ok': '#00e5ff',
    '--pg-warn': '#ffd319',
    '--pg-editor-bg': 'rgba(13,2,33,0.88)',
    '--pg-editor-gutter': '#9a76c4',
    '--pg-keyword': '#ff71ce',
    '--pg-method': '#01cdfe',
    '--pg-string': '#ffd319',
    '--pg-string-punct': '#ff2d95',
    '--pg-number': '#b967ff',
    '--pg-comment': '#9a76c4',
    '--pg-token-flash-bg': '#ff2d95',
    '--pg-token-flash-ink': '#2b0620',
    '--pg-header-bg': 'rgba(13,2,33,0.85)',
  }, `
body {
  background-color: #0d0221;
  background-image:
    radial-gradient(ellipse 60% 32% at 50% 100%, rgba(255,45,149,0.4), transparent 70%),
    radial-gradient(ellipse 34% 24% at 50% 72%, rgba(255,211,25,0.5), rgba(255,45,149,0.28) 55%, transparent 72%),
    linear-gradient(#05010f 0%, #0d0221 45%, #2b0f54 100%);
}
.pg-workstation::before {
  content: ""; position: absolute; inset: auto 0 0 0; height: 38%;
  pointer-events: none; z-index: 0; opacity: 0.55;
  background-image:
    linear-gradient(transparent 0 94%, rgba(255,45,149,0.7) 100%),
    repeating-linear-gradient(90deg, rgba(255,45,149,0.35) 0 2px, transparent 2px 64px),
    repeating-linear-gradient(0deg, rgba(1,205,254,0.4) 0 2px, transparent 2px 26px);
  -webkit-mask-image: linear-gradient(to top, black 25%, transparent 92%);
  mask-image: linear-gradient(to top, black 25%, transparent 92%);
}
.pg-panel, .pg-editor-surface { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.pg-btn-accent { box-shadow: 0 0 18px rgba(255,45,149,0.55); }
.pg-editor-frame:focus-within { box-shadow: 0 0 0 1px rgba(1,205,254,0.5), 0 0 28px rgba(255,45,149,0.25); }
`),
  createTheme('crt-phosphor', 'CRT Phosphor', 'Green-phosphor terminal: scanlines, vignette, glowing text.', true, {
    '--pg-bg': '#031007',
    '--pg-bg-dots': 'rgba(51,255,153,0.05)',
    '--pg-surface': 'rgba(4,20,12,0.9)',
    '--pg-surface-2': 'rgba(6,30,18,0.92)',
    '--pg-surface-3': 'rgba(10,44,26,0.95)',
    '--pg-border': '#1d5c3a',
    '--pg-border-soft': 'rgba(29,92,58,0.55)',
    '--pg-text': '#c8ffd9',
    '--pg-muted': '#6fbf8d',
    '--pg-faint': '#4a8a64',
    '--pg-accent': '#33ff99',
    '--pg-accent-ink': '#02120a',
    '--pg-accent-2': '#ffd319',
    '--pg-accent-3': '#7df9ff',
    '--pg-danger': '#ff6b6b',
    '--pg-ok': '#33ff99',
    '--pg-warn': '#ffd319',
    '--pg-editor-bg': 'rgba(2,12,7,0.94)',
    '--pg-editor-gutter': '#4a8a64',
    '--pg-keyword': '#33ff99',
    '--pg-method': '#7df9ff',
    '--pg-string': '#ffd319',
    '--pg-string-punct': '#6fbf8d',
    '--pg-number': '#ff9de2',
    '--pg-comment': '#4a8a64',
    '--pg-token-flash-bg': '#33ff99',
    '--pg-token-flash-ink': '#02120a',
    '--pg-header-bg': 'rgba(3,16,7,0.9)',
  }, `
body {
  background-color: #031007;
  background-image: radial-gradient(ellipse 90% 70% at 50% 40%, rgba(51,255,153,0.08), transparent 70%);
}
.pg-workstation::before {
  content: ""; position: absolute; inset: 0; z-index: 40; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.55) 100%);
}
.pg-workstation::after {
  content: ""; position: absolute; inset: 0; z-index: 41; pointer-events: none; opacity: 0.5;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.32) 0 1px, transparent 1px 3px);
}
.pg-editor, .pg-tok-keyword, .pg-tok-method {
  text-shadow: 0 0 7px rgba(51,255,153,0.45);
}
.pg-panel { box-shadow: inset 0 0 24px rgba(51,255,153,0.05), 0 0 0 1px rgba(51,255,153,0.08); }
.pg-editor-frame:focus-within { box-shadow: 0 0 24px rgba(51,255,153,0.22); }
`),
  createTheme('aurora', 'Aurora', 'Animated northern-lights wash drifting behind frosted panels.', true, {
    '--pg-bg': '#040e14',
    '--pg-bg-dots': 'rgba(0,255,200,0.05)',
    '--pg-surface': 'rgba(6,24,30,0.72)',
    '--pg-surface-2': 'rgba(9,34,42,0.72)',
    '--pg-surface-3': 'rgba(14,48,58,0.8)',
    '--pg-border': '#1f5f6b',
    '--pg-border-soft': 'rgba(31,95,107,0.5)',
    '--pg-text': '#e6fffa',
    '--pg-muted': '#8fc7bd',
    '--pg-faint': '#63928c',
    '--pg-accent': '#00ffc8',
    '--pg-accent-ink': '#03231c',
    '--pg-accent-2': '#9d7bff',
    '--pg-accent-3': '#ff8ac2',
    '--pg-danger': '#ff7b7b',
    '--pg-ok': '#00ffc8',
    '--pg-warn': '#ffd166',
    '--pg-editor-bg': 'rgba(3,14,18,0.78)',
    '--pg-editor-gutter': '#63928c',
    '--pg-keyword': '#00ffc8',
    '--pg-method': '#8ad8ff',
    '--pg-string': '#ffe29a',
    '--pg-string-punct': '#ff8ac2',
    '--pg-number': '#c4a8ff',
    '--pg-comment': '#63928c',
    '--pg-token-flash-bg': '#00ffc8',
    '--pg-token-flash-ink': '#03231c',
    '--pg-header-bg': 'rgba(4,14,20,0.7)',
  }, `
body { background-color: #040e14; }
.pg-workstation::before {
  content: ""; position: absolute; inset: -12%; z-index: 0; pointer-events: none;
  filter: blur(70px); -webkit-filter: blur(70px); opacity: 0.6;
  background:
    radial-gradient(38% 32% at 22% 18%, rgba(0,255,200,0.55), transparent 70%),
    radial-gradient(34% 38% at 80% 26%, rgba(157,123,255,0.6), transparent 70%),
    radial-gradient(46% 38% at 52% 92%, rgba(255,138,194,0.38), transparent 70%),
    radial-gradient(30% 26% at 68% 62%, rgba(0,180,255,0.4), transparent 70%);
  animation: pg-aurora-drift 16s ease-in-out infinite alternate;
}
@keyframes pg-aurora-drift {
  from { transform: translate3d(-3%, -2%, 0) scale(1); }
  to { transform: translate3d(3%, 3%, 0) scale(1.12); }
}
.pg-panel, .pg-editor-surface, .pg-panel-header {
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
.pg-btn-accent { box-shadow: 0 0 20px rgba(0,255,200,0.4); }
`),
  createTheme('starfield', 'Starfield', 'Twinkling deep-space dust over smoky translucent panels.', true, {
    '--pg-bg': '#02030a',
    '--pg-bg-dots': 'rgba(255,255,255,0.05)',
    '--pg-surface': 'rgba(10,13,28,0.82)',
    '--pg-surface-2': 'rgba(16,20,40,0.84)',
    '--pg-surface-3': 'rgba(26,30,58,0.9)',
    '--pg-border': '#343c66',
    '--pg-border-soft': 'rgba(52,60,102,0.5)',
    '--pg-text': '#eef1ff',
    '--pg-muted': '#a3abd6',
    '--pg-faint': '#767da8',
    '--pg-accent': '#8ab4ff',
    '--pg-accent-ink': '#0a1230',
    '--pg-accent-2': '#ff9de2',
    '--pg-accent-3': '#9df2ff',
    '--pg-danger': '#ff7b8a',
    '--pg-ok': '#8ab4ff',
    '--pg-warn': '#ffd166',
    '--pg-editor-bg': 'rgba(2,3,12,0.9)',
    '--pg-editor-gutter': '#767da8',
    '--pg-keyword': '#8ab4ff',
    '--pg-method': '#9df2ff',
    '--pg-string': '#ffe29a',
    '--pg-string-punct': '#ff9de2',
    '--pg-number': '#d0b3ff',
    '--pg-comment': '#767da8',
    '--pg-token-flash-bg': '#8ab4ff',
    '--pg-token-flash-ink': '#0a1230',
    '--pg-header-bg': 'rgba(2,3,10,0.85)',
  }, `
body {
  background-color: #02030a;
  background-image:
    radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,0.9), transparent 100%),
    radial-gradient(1px 1px at 68% 8%, rgba(255,255,255,0.8), transparent 100%),
    radial-gradient(1.5px 1.5px at 84% 34%, rgba(157,242,255,0.9), transparent 100%),
    radial-gradient(1px 1px at 42% 62%, rgba(255,255,255,0.7), transparent 100%),
    radial-gradient(1px 1px at 24% 78%, rgba(255,157,226,0.8), transparent 100%),
    radial-gradient(1.5px 1.5px at 56% 88%, rgba(255,255,255,0.85), transparent 100%),
    radial-gradient(1px 1px at 92% 72%, rgba(255,255,255,0.7), transparent 100%),
    radial-gradient(1px 1px at 33% 12%, rgba(255,255,255,0.75), transparent 100%),
    radial-gradient(ellipse 70% 45% at 70% 110%, rgba(90,80,220,0.28), transparent 70%),
    radial-gradient(ellipse 55% 40% at 20% -10%, rgba(255,80,180,0.14), transparent 70%);
}
.pg-workstation::before {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0.7;
  background-image:
    radial-gradient(1px 1px at 8% 64%, #fff, transparent 100%),
    radial-gradient(1px 1px at 48% 28%, #fff, transparent 100%),
    radial-gradient(1.5px 1.5px at 74% 54%, #9df2ff, transparent 100%),
    radial-gradient(1px 1px at 90% 14%, #fff, transparent 100%),
    radial-gradient(1px 1px at 60% 78%, #ffb3ec, transparent 100%);
  animation: pg-star-twinkle 3.2s ease-in-out infinite alternate;
}
@keyframes pg-star-twinkle { from { opacity: 0.25; } to { opacity: 0.8; } }
.pg-panel, .pg-editor-surface { backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
`),
  createTheme('vapor-mall', 'Vapor Mall', 'Pastel chrome sunset with checkerboard floor fade.', true, {
    '--pg-bg': '#1a1033',
    '--pg-bg-dots': 'rgba(255,209,220,0.07)',
    '--pg-surface': 'rgba(42,24,74,0.78)',
    '--pg-surface-2': 'rgba(58,32,96,0.8)',
    '--pg-surface-3': 'rgba(78,44,124,0.88)',
    '--pg-border': '#8f6fd0',
    '--pg-border-soft': 'rgba(143,111,208,0.45)',
    '--pg-text': '#fff2f8',
    '--pg-muted': '#d3b8e6',
    '--pg-faint': '#a88bc4',
    '--pg-accent': '#ff71ce',
    '--pg-accent-ink': '#33102b',
    '--pg-accent-2': '#01cdfe',
    '--pg-accent-3': '#fffb96',
    '--pg-danger': '#ff6b81',
    '--pg-ok': '#05ffa1',
    '--pg-warn': '#fffb96',
    '--pg-editor-bg': 'rgba(26,16,51,0.85)',
    '--pg-editor-gutter': '#a88bc4',
    '--pg-keyword': '#ff71ce',
    '--pg-method': '#01cdfe',
    '--pg-string': '#fffb96',
    '--pg-string-punct': '#ffb3ec',
    '--pg-number': '#b967ff',
    '--pg-comment': '#a88bc4',
    '--pg-token-flash-bg': '#ff71ce',
    '--pg-token-flash-ink': '#33102b',
    '--pg-header-bg': 'rgba(26,16,51,0.8)',
  }, `
body {
  background-color: #1a1033;
  background-image:
    radial-gradient(ellipse 55% 30% at 50% 30%, rgba(255,251,150,0.22), transparent 70%),
    radial-gradient(ellipse 75% 45% at 50% 42%, rgba(255,113,206,0.4), transparent 70%),
    linear-gradient(#12082b 0%, #2b1a5e 45%, #6a2a8f 70%, #ff71ce 100%);
}
.pg-workstation::before {
  content: ""; position: absolute; inset: auto 0 0 0; height: 30%;
  pointer-events: none; z-index: 0; opacity: 0.35;
  background-image:
    repeating-conic-gradient(rgba(1,205,254,0.5) 0 25%, rgba(26,16,51,0.9) 0 50%);
  background-size: 44px 44px;
  transform: perspective(320px) rotateX(58deg) scale(1.6);
  transform-origin: bottom;
  -webkit-mask-image: linear-gradient(to top, black 40%, transparent 95%);
  mask-image: linear-gradient(to top, black 40%, transparent 95%);
}
.pg-panel, .pg-editor-surface { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.pg-btn-accent {
  background: linear-gradient(135deg, #ff71ce, #b967ff 55%, #01cdfe);
  color: #fff; text-shadow: 0 1px 8px rgba(0,0,0,0.4);
  box-shadow: 0 0 22px rgba(255,113,206,0.5);
}
`),
  createTheme('graph-paper', 'Graph Paper', 'Light drafting-sheet grid with ink-blue accents.', false, {
    '--pg-bg': '#e8ecf1',
    '--pg-bg-dots': 'rgba(23,107,154,0.05)',
    '--pg-surface': 'rgba(255,255,255,0.88)',
    '--pg-surface-2': 'rgba(240,244,248,0.9)',
    '--pg-surface-3': 'rgba(226,232,240,0.95)',
    '--pg-border': '#9fb3c8',
    '--pg-border-soft': '#c7d3e0',
    '--pg-text': '#16283a',
    '--pg-muted': '#48657e',
    '--pg-faint': '#6d8aa3',
    '--pg-accent': '#0b5fa5',
    '--pg-accent-ink': '#ffffff',
    '--pg-accent-2': '#b3402a',
    '--pg-accent-3': '#1d7a4f',
    '--pg-danger': '#b42335',
    '--pg-ok': '#1d7a4f',
    '--pg-warn': '#95500f',
    '--pg-editor-bg': 'rgba(255,255,255,0.92)',
    '--pg-editor-gutter': '#6d8aa3',
    '--pg-keyword': '#0b5fa5',
    '--pg-method': '#6a3fb5',
    '--pg-string': '#8a4b0e',
    '--pg-string-punct': '#b3402a',
    '--pg-number': '#6a3fb5',
    '--pg-comment': '#6d8aa3',
    '--pg-token-flash-bg': '#0b5fa5',
    '--pg-token-flash-ink': '#ffffff',
    '--pg-header-bg': 'rgba(232,236,241,0.88)',
  }, `
body {
  background-color: #e8ecf1;
  background-image:
    linear-gradient(rgba(11,95,165,0.09) 1px, transparent 1px),
    linear-gradient(90deg, rgba(11,95,165,0.09) 1px, transparent 1px),
    linear-gradient(rgba(11,95,165,0.16) 1px, transparent 1px),
    linear-gradient(90deg, rgba(11,95,165,0.16) 1px, transparent 1px);
  background-size: 22px 22px, 22px 22px, 110px 110px, 110px 110px;
}
.pg-panel, .pg-editor-surface { backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.pg-panel { box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 24px rgba(22,40,58,0.08); }
.pg-editor-frame:focus-within { box-shadow: 0 0 0 2px rgba(11,95,165,0.25); }
`),
  createTheme('ember', 'Ember Drift', 'Smoldering coals: heat glow rising from the bottom edge.', true, {
    '--pg-bg': '#120806',
    '--pg-bg-dots': 'rgba(255,122,40,0.06)',
    '--pg-surface': 'rgba(30,14,10,0.85)',
    '--pg-surface-2': 'rgba(43,20,13,0.87)',
    '--pg-surface-3': 'rgba(60,28,17,0.92)',
    '--pg-border': '#7a3b26',
    '--pg-border-soft': 'rgba(122,59,38,0.5)',
    '--pg-text': '#ffeee2',
    '--pg-muted': '#d3a78e',
    '--pg-faint': '#a67c64',
    '--pg-accent': '#ff7a28',
    '--pg-accent-ink': '#2b0f04',
    '--pg-accent-2': '#ffc53d',
    '--pg-accent-3': '#ff4d6d',
    '--pg-danger': '#ff5c5c',
    '--pg-ok': '#ffb03d',
    '--pg-warn': '#ffc53d',
    '--pg-editor-bg': 'rgba(18,8,6,0.9)',
    '--pg-editor-gutter': '#a67c64',
    '--pg-keyword': '#ff9a4d',
    '--pg-method': '#ff8fa3',
    '--pg-string': '#ffd97a',
    '--pg-string-punct': '#d3a78e',
    '--pg-number': '#ff7ab8',
    '--pg-comment': '#a67c64',
    '--pg-token-flash-bg': '#ff7a28',
    '--pg-token-flash-ink': '#2b0f04',
    '--pg-header-bg': 'rgba(18,8,6,0.88)',
  }, `
body {
  background-color: #120806;
  background-image:
    radial-gradient(ellipse 80% 30% at 50% 112%, rgba(255,90,20,0.5), rgba(255,60,20,0.18) 45%, transparent 70%),
    radial-gradient(ellipse 40% 22% at 18% 100%, rgba(255,197,61,0.22), transparent 70%),
    radial-gradient(ellipse 40% 22% at 84% 100%, rgba(255,77,109,0.2), transparent 70%),
    linear-gradient(#0a0403 0%, #120806 60%, #1e0d08 100%);
}
.pg-workstation::before {
  content: ""; position: absolute; inset: auto 0 0 0; height: 26%;
  pointer-events: none; z-index: 0; opacity: 0.5; filter: blur(24px); -webkit-filter: blur(24px);
  background:
    radial-gradient(24% 70% at 20% 90%, rgba(255,122,40,0.8), transparent 70%),
    radial-gradient(20% 65% at 55% 95%, rgba(255,197,61,0.7), transparent 70%),
    radial-gradient(22% 70% at 82% 90%, rgba(255,77,109,0.65), transparent 70%);
  animation: pg-ember-breathe 4.5s ease-in-out infinite alternate;
}
@keyframes pg-ember-breathe { from { opacity: 0.32; } to { opacity: 0.62; } }
.pg-btn-accent { box-shadow: 0 0 20px rgba(255,122,40,0.5); }
.pg-editor-frame:focus-within { box-shadow: 0 0 28px rgba(255,122,40,0.22); }
`),
  createTheme('frosted', 'Frosted Glass', 'Blurred color blobs behind milky translucent panels.', true, {
    '--pg-bg': '#0b0f16',
    '--pg-bg-dots': 'rgba(255,255,255,0.05)',
    '--pg-surface': 'rgba(24,30,42,0.55)',
    '--pg-surface-2': 'rgba(30,38,54,0.55)',
    '--pg-surface-3': 'rgba(44,54,76,0.6)',
    '--pg-border': 'rgba(150,170,200,0.4)',
    '--pg-border-soft': 'rgba(150,170,200,0.22)',
    '--pg-text': '#f2f6fc',
    '--pg-muted': '#a9b7cc',
    '--pg-faint': '#8494ab',
    '--pg-accent': '#7dd3fc',
    '--pg-accent-ink': '#08202b',
    '--pg-accent-2': '#f0abfc',
    '--pg-accent-3': '#86efac',
    '--pg-danger': '#fda4af',
    '--pg-ok': '#86efac',
    '--pg-warn': '#fde68a',
    '--pg-editor-bg': 'rgba(11,15,22,0.62)',
    '--pg-editor-gutter': '#8494ab',
    '--pg-keyword': '#7dd3fc',
    '--pg-method': '#c4b5fd',
    '--pg-string': '#fde68a',
    '--pg-string-punct': '#f0abfc',
    '--pg-number': '#f0abfc',
    '--pg-comment': '#8494ab',
    '--pg-token-flash-bg': '#7dd3fc',
    '--pg-token-flash-ink': '#08202b',
    '--pg-header-bg': 'rgba(11,15,22,0.55)',
  }, `
body {
  background-color: #0b0f16;
  background-image:
    radial-gradient(36% 30% at 12% 8%, rgba(125,211,252,0.4), transparent 70%),
    radial-gradient(32% 30% at 88% 18%, rgba(240,171,252,0.34), transparent 70%),
    radial-gradient(40% 34% at 55% 100%, rgba(134,239,172,0.22), transparent 70%),
    radial-gradient(30% 28% at 85% 85%, rgba(196,181,253,0.3), transparent 70%);
  background-attachment: fixed;
}
.pg-panel, .pg-editor-surface, .pg-panel-header, .pg-header-blur {
  backdrop-filter: blur(20px) saturate(1.3); -webkit-backdrop-filter: blur(20px) saturate(1.3);
}
.pg-panel { box-shadow: 0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12); }
`)
);

export interface FontOption {
  id: string;
  name: string;
  stack: string;
  googleUrl?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    googleUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap',
  },
  {
    id: 'plex',
    name: 'IBM Plex Mono',
    stack: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    googleUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap',
  },
  {
    id: 'fira',
    name: 'Fira Code',
    stack: '"Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
    googleUrl: 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&display=swap',
  },
  {
    id: 'space',
    name: 'Space Mono',
    stack: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    googleUrl: 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap',
  },
  {
    id: 'grotesk',
    name: 'System Sans',
    stack: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    id: 'system',
    name: 'System Mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
];

export const DEFAULT_THEME_ID = 'strudel-night';
export const DEFAULT_FONT_ID = 'jetbrains';
export const DEFAULT_FONT_SIZE = 14;

export interface ThemePalette {
  bg: string;
  accent: string;
  accent2: string;
  accent3: string;
  grid: string;
}

const PALETTE_FALLBACK: ThemePalette = {
  bg: '#12181c',
  accent: '#6cdbb6',
  accent2: '#e6b96f',
  accent3: '#a9c8df',
  grid: '#2a3339',
};

/**
 * Synchronous palette lookup by theme id.
 *
 * Canvas visualizers must use this instead of
 * `getComputedStyle(document.documentElement)` snapshots: child effects run
 * before the ThemeProvider effect that writes the new CSS vars to <html>,
 * so a DOM read on theme change returns the *previous* theme's colors and
 * the monitor lags behind by one theme switch.
 */
export function getThemePalette(themeId: string): ThemePalette {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const v = theme?.vars || {};
  return {
    bg: v['--pg-editor-bg'] || PALETTE_FALLBACK.bg,
    accent: v['--pg-accent'] || PALETTE_FALLBACK.accent,
    accent2: v['--pg-accent-2'] || PALETTE_FALLBACK.accent2,
    accent3: v['--pg-accent-3'] || PALETTE_FALLBACK.accent3,
    grid: v['--pg-border-soft'] || PALETTE_FALLBACK.grid,
  };
}
