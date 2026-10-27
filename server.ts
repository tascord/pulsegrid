import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// In-memory data store for full-stack auth, projects, and community presets
interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: number;
}

interface Project {
  id: string;
  userId: string;
  title: string;
  code: string;
  cpm: number;
  patterns: Record<string, string>;
  customInstruments: any[];
  midiBindings: any[];
  mixer?: Record<string, { gain: number; pan: number | null; cutoff: number | null; resonance: number; reverbSend: number; delaySend: number; muted: boolean; solo: boolean }>;
  master?: { volume: number; muted: boolean };
  updatedAt: number;
}

interface CommunityItem {
  id: string;
  author: string;
  title: string;
  type: 'project' | 'pattern' | 'instrument' | 'snippet' | 'theme';
  description: string;
  data: any;
  likes: number;
  tags: string[];
  createdAt: number;
}

const users: Map<string, User> = new Map();
const sessions: Map<string, string> = new Map(); // token -> userId
const projects: Map<string, Project> = new Map();
const communityItems: Map<string, CommunityItem> = new Map();

// Seed initial demo user and community items
const demoUser: User = {
  id: 'user_livecoder_01',
  email: 'performer@pulsegrid.audio',
  name: 'Alex LiveCoder',
  passwordHash: 'live2026',
  createdAt: Date.now() - 86400000,
};
users.set(demoUser.email, demoUser);

const initialCommunityPresets: CommunityItem[] = [
  {
    id: 'comm_acid_techno',
    author: 'PulseGrid',
    title: 'Acid 303',
    type: 'project',
    description: '33 CPM techno with a 303 line, kick, hats, and clap.',
    tags: ['acid', 'techno', '303', '909'],
    likes: 42,
    createdAt: Date.now() - 36000000,
    data: {
      cpm: 33,
      code: `// Acid 303
defPattern("kick_groove", "bd ~ bd [~ bd]");
defPattern("hats", "[~ hh*2] [~ hh] [~ hh*2] [oh ~]");
defPattern("clap_snare", "~ cp ~ [cp*2 ~]");
defPattern("acid_riff", "c2 [c2 eb2] g2 [bb2 c3]");

track("kick").pattern("kick_groove").gain(0.95);
track("hats").pattern("hats").gain(0.7).pan(0.15);
track("clap").pattern("clap_snare").gain(0.8).reverb(0.25);
track("acid").pattern("acid_riff")
  .synth("acid_303")
  .cutoff(1200)
  .res(12)
  .delay(0.35)
  .gain(0.85);`,
    },
  },
  {
    id: 'comm_liquid_dnb',
    author: 'PulseGrid',
    title: 'Liquid DnB',
    type: 'project',
    description: '43.5 CPM breakbeat with sub bass, drums, and a pad.',
    tags: ['dnb', 'liquid', 'breakbeat', 'amen'],
    likes: 38,
    createdAt: Date.now() - 18000000,
    data: {
      cpm: 43.5,
      code: `// Liquid drum and bass
defPattern("amen_slices", "amen:0 [amen:1 amen:2] amen:0 [amen:3 ~]");
defPattern("sub_roller", "f1 ~ [f1 ab1] c2");
defPattern("lush_pad", "c3 [eb3 g3] [bb3 ~] d4");

track("drums").pattern("amen_slices").gain(0.9);
track("sub").pattern("sub_roller").synth("sub_bass").lpf(320).gain(0.9);
track("atmosphere").pattern("lush_pad")
  .synth("poly_saw")
  .slow(2)
  .reverb(0.5)
  .delay(0.4)
  .gain(0.65);`,
    },
  },
  {
    id: 'comm_fm_bells',
    author: 'PulseGrid',
    title: 'FM Ambient',
    type: 'project',
    description: '22.5 CPM FM bells, bass drone, and light percussion.',
    tags: ['ambient', 'fm', 'drone', 'chill'],
    likes: 29,
    createdAt: Date.now() - 7200000,
    data: {
      cpm: 22.5,
      code: `// FM ambient
defPattern("chimes", "[c4, eb4, g4] [bb4 d5] [f4, ab4] c5");
defPattern("drone", "c2/2 ~ g2/2 ~");
defPattern("click_perc", "rim(3,8) [~ hh(5,8)]");

track("bells").pattern("chimes")
  .synth("fm_bell")
  .fast(1.5)
  .reverb(0.6)
  .delay(0.3)
  .gain(0.7);
track("bass").pattern("drone").synth("sub_bass").gain(0.75);
track("clicks").pattern("click_perc").gain(0.55).pan(-0.2);`,
    },
  },
];

initialCommunityPresets.forEach((item) => communityItems.set(item.id, item));

// Seed theme gallery entries (shared look & feel presets)
const seedThemes: CommunityItem[] = [
  {
    id: 'comm_theme_strudel_night',
    author: 'PulseGrid',
    title: 'Studio Graphite',
    type: 'theme',
    description: 'Graphite surfaces with a restrained mint accent.',
    tags: ['theme', 'style', 'dark'],
    likes: 31,
    createdAt: Date.now() - 5400000,
    data: {
      theme: { themeId: 'strudel-night', fontId: 'jetbrains', customFontStack: '', fontSize: 14, customCss: '' },
      vars: { '--pg-bg': '#111519', '--pg-surface': '#181e23', '--pg-accent': '#6cdbb6', '--pg-accent-2': '#e6b96f', '--pg-accent-3': '#a9c8df' },
    },
  },
  {
    id: 'comm_theme_cream',
    author: 'PulseGrid',
    title: 'Warm Paper',
    type: 'theme',
    description: 'Light paper theme for daytime sets and bright projectors.',
    tags: ['theme', 'style', 'light'],
    likes: 17,
    createdAt: Date.now() - 3600000,
    data: {
      theme: { themeId: 'strudel-cream', fontId: 'plex', customFontStack: '', fontSize: 14, customCss: '' },
      vars: { '--pg-bg': '#faf5ea', '--pg-surface': '#ffffff', '--pg-accent': '#0e9f7e', '--pg-accent-2': '#d63384', '--pg-accent-3': '#9a6a00' },
    },
  },
];
seedThemes.forEach((item) => communityItems.set(item.id, item));

// Auth Helpers
function getUserIdFromAuth(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return sessions.get(token) || null;
}

// API Routes
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (users.has(email.toLowerCase())) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const newUser: User = {
    id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    passwordHash: password, // In production this would be bcrypt
    createdAt: Date.now(),
  };

  users.set(newUser.email, newUser);
  const token = `token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  sessions.set(token, newUser.id);

  return res.json({
    token,
    user: { id: newUser.id, email: newUser.email, name: newUser.name },
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = users.get(email.toLowerCase());
  if (!user || user.passwordHash !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = `token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  sessions.set(token, user.id);

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name },
  });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const userId = getUserIdFromAuth(req);
  if (!userId) {
    return res.status(401).json({ authenticated: false });
  }

  let foundUser: User | null = null;
  for (const u of users.values()) {
    if (u.id === userId) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser) {
    return res.status(401).json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: { id: foundUser.id, email: foundUser.email, name: foundUser.name },
  });
});

// Projects API
app.get('/api/projects', (req: Request, res: Response) => {
  const userId = getUserIdFromAuth(req);
  const userProjects: Project[] = [];
  for (const proj of projects.values()) {
    if (!userId || proj.userId === userId) {
      userProjects.push(proj);
    }
  }
  return res.json({ projects: userProjects });
});

app.post('/api/projects', (req: Request, res: Response) => {
  const userId = getUserIdFromAuth(req) || 'anonymous';
  const { id, title, code, cpm, patterns, customInstruments, midiBindings, mixer, master } = req.body;

  const projectId = id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const savedProject: Project = {
    id: projectId,
    userId,
    title: title || 'Untitled Live Session',
    code: code || '',
    cpm: cpm || 30,
    patterns: patterns || {},
    customInstruments: customInstruments || [],
    midiBindings: midiBindings || [],
    mixer: mixer && typeof mixer === 'object' ? mixer : undefined,
    master: master && typeof master === 'object' ? master : undefined,
    updatedAt: Date.now(),
  };

  projects.set(projectId, savedProject);
  return res.json({ success: true, project: savedProject });
});

// Community API
app.get('/api/community', (req: Request, res: Response) => {
  const typeFilter = typeof req.query.type === 'string' ? req.query.type : null;
  let items = Array.from(communityItems.values()).sort((a, b) => b.likes - a.likes);
  if (typeFilter) items = items.filter((i) => i.type === typeFilter);
  return res.json({ items });
});

app.post('/api/community/share', (req: Request, res: Response) => {
  const { title, type, description, data, tags, author } = req.body;
  if (!title || !data) {
    return res.status(400).json({ error: 'Title and content data are required' });
  }
  if (type === 'theme' && (!data.theme || typeof data.theme !== 'object')) {
    return res.status(400).json({ error: 'Theme shares require data.theme settings' });
  }

  const newItem: CommunityItem = {
    id: `comm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    author: author || 'Guest LiveCoder',
    title,
    type: type || 'project',
    description: description || (type === 'theme' ? 'Shared look & feel preset' : ''),
    data,
    likes: 1,
    tags: tags || (type === 'theme' ? ['theme', 'style'] : ['livecode', 'performance']),
    createdAt: Date.now(),
  };

  communityItems.set(newItem.id, newItem);
  return res.json({ success: true, item: newItem });
});

app.post('/api/community/:id/like', (req: Request, res: Response) => {
  const item = communityItems.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }
  item.likes += 1;
  return res.json({ success: true, likes: item.likes });
});

// VST Bridge status + downloadable helper scripts (Linux-ready)
import fs from 'fs';

app.get('/api/vst-bridge/status', (_req: Request, res: Response) => {
  const platform = process.platform; // 'linux' | 'darwin' | 'win32'
  return res.json({
    bridgeOnline: false,
    recommendedPort: 8080,
    protocol: 'WebSocket/WebMIDI-Bridge-v1',
    serverPlatform: platform,
    supportedDAWs: ['Ableton Live', 'FL Studio', 'Reaper', 'Bitwig Studio', 'Logic Pro', 'Ardour', 'Carla (Linux)'],
    detectedVirtualPorts: ['PulseGrid VST Out', 'IAC Driver Bus 1', 'loopMIDI Port 1'],
    scripts: {
      linux: 'GET /api/vst-bridge/script/linux  →  bridge/vst-bridge-linux.py',
      node: 'GET /api/vst-bridge/script/node  →  bridge/vst-bridge.js',
      setup: 'GET /api/vst-bridge/script/setup  →  bridge/setup-linux-midi.sh',
      service: 'GET /api/vst-bridge/script/service  →  bridge/pulsegrid-bridge.service',
      readme: 'GET /api/vst-bridge/script/readme  →  bridge/README.md',
    },
    instructions: {
      linux: [
        'pip install mido python-rtmidi websockets',
        'python3 bridge/vst-bridge-linux.py --port 8080',
        'In DAW: enable "PulseGrid VST Out" as MIDI input (Ardour/Reaper/Bitwig/Carla).',
        'No ports? run: sudo modprobe snd-virmidi midi_devs=1, then aconnect -l',
      ],
      macos: [
        'Open Audio MIDI Setup → MIDI Studio → enable IAC Driver Bus 1',
        'node bridge/vst-bridge.js --port 8080',
        'In DAW: select PulseGrid VST Out / IAC Bus as MIDI input.',
      ],
      windows: [
        'Install loopMIDI, create port "PulseGrid VST Out"',
        'node bridge/vst-bridge.js --port 8080',
        'In DAW: select the loopMIDI port as MIDI input.',
      ],
    },
  });
});

app.get('/api/vst-bridge/script/:kind', (req: Request, res: Response) => {
  const kind = req.params.kind;
  const fileMap: Record<string, string> = {
    linux: path.resolve(__dirname, 'bridge', 'vst-bridge-linux.py'),
    node: path.resolve(__dirname, 'bridge', 'vst-bridge.js'),
    setup: path.resolve(__dirname, 'bridge', 'setup-linux-midi.sh'),
    service: path.resolve(__dirname, 'bridge', 'pulsegrid-bridge.service'),
    readme: path.resolve(__dirname, 'bridge', 'README.md'),
  };
  const file = fileMap[kind];
  if (!file || !fs.existsSync(file)) {
    return res.status(404).json({ error: 'Unknown bridge script. Use linux, node, setup, service, or readme.' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
  return res.sendFile(file);
});

// Mount Vite in dev or serve dist in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: Number(PORT),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`PulseGrid live-coding workstation server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
