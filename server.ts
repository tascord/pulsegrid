import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import dns from 'dns/promises';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'pulsegrid.db');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── JWT secret: env wins, otherwise a persisted random secret so tokens ──
// ── survive restarts but are never hardcoded in the repo.               ──
function loadJwtSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  const secretFile = path.join(DATA_DIR, '.jwt_secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {}
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretFile, generated + '\n', { mode: 0o600 });
  } catch {}
  return generated;
}
const JWT_SECRET = loadJwtSecret();

// ── SQLite ──────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  cpm REAL NOT NULL DEFAULT 132,
  patterns TEXT NOT NULL DEFAULT '{}',
  custom_instruments TEXT NOT NULL DEFAULT '[]',
  midi_bindings TEXT NOT NULL DEFAULT '[]',
  mixer TEXT,
  master TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS community_items (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL DEFAULT 'Guest Performer',
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'project',
  description TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  likes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_type_likes ON community_items(type, likes DESC);
CREATE TABLE IF NOT EXISTS community_votes (
  item_id TEXT NOT NULL REFERENCES community_items(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, voter)
);
`);

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
}

interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  code: string;
  cpm: number;
  patterns: string;
  custom_instruments: string;
  midi_bindings: string;
  mixer: string | null;
  master: string | null;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toProjectJson(row: ProjectRow) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    code: row.code,
    cpm: row.cpm,
    patterns: parseJson<Record<string, string>>(row.patterns, {}),
    customInstruments: parseJson<unknown[]>(row.custom_instruments, []),
    midiBindings: parseJson<unknown[]>(row.midi_bindings, []),
    mixer: row.mixer ? parseJson(row.mixer, undefined) : undefined,
    master: row.master ? parseJson(row.master, undefined) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCommunityJson(row: any) {
  return {
    id: row.id,
    author: row.author,
    userId: row.user_id ?? undefined,
    title: row.title,
    type: row.type,
    description: row.description,
    data: parseJson(row.data, {}),
    tags: parseJson<string[]>(row.tags, []),
    likes: row.likes,
    createdAt: row.created_at,
  };
}

// ── Seed gallery from demos/ (single source of truth) + theme presets ───
import { parseDemoFile } from './src/demos';

function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM community_items').get() as { n: number }).n;
  if (count > 0) return;

  const candidates = [path.resolve(__dirname, 'demos'), path.resolve(__dirname, '..', 'demos')];
  const dir = candidates.find((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });

  const now = Date.now();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO community_items
     (id, author, user_id, title, type, description, data, tags, likes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  if (dir) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
      files.forEach((f, i) => {
        const demo = parseDemoFile(f, fs.readFileSync(path.join(dir, f), 'utf8'));
        const slug = f.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `demo-${i}`;
        insert.run(
          `comm_demo_${slug}`,
          'PulseGrid',
          null,
          demo.name,
          'project',
          `${demo.name} at ${demo.cpm ?? '?'} CPM.`,
          JSON.stringify({ cpm: demo.cpm ?? 132, code: demo.code }),
          JSON.stringify(['demo']),
          42 - i,
          now - 36000000 - i * 1000
        );
      });
    } catch (err) {
      console.warn('[seed] demo load failed:', err);
    }
  }

  const themes = [
    {
      id: 'comm_theme_strudel_night',
      title: 'Studio Graphite',
      description: 'Graphite surfaces with a restrained mint accent.',
      tags: ['theme', 'style', 'dark'],
      likes: 31,
      createdAt: now - 5400000,
      data: {
        theme: { themeId: 'strudel-night', fontId: 'jetbrains', customFontStack: '', fontSize: 14, customCss: '' },
        vars: { '--pg-bg': '#111519', '--pg-surface': '#181e23', '--pg-accent': '#6cdbb6', '--pg-accent-2': '#e6b96f', '--pg-accent-3': '#a9c8df' },
      },
    },
    {
      id: 'comm_theme_cream',
      title: 'Warm Paper',
      description: 'Light paper theme for daytime sets and bright projectors.',
      tags: ['theme', 'style', 'light'],
      likes: 17,
      createdAt: now - 3600000,
      data: {
        theme: { themeId: 'strudel-cream', fontId: 'plex', customFontStack: '', fontSize: 14, customCss: '' },
        vars: { '--pg-bg': '#faf5ea', '--pg-surface': '#ffffff', '--pg-accent': '#0e9f7e', '--pg-accent-2': '#d63384', '--pg-accent-3': '#9a6a00' },
      },
    },
  ];
  for (const t of themes) {
    insert.run(t.id, 'PulseGrid', null, t.title, 'theme', t.description, JSON.stringify(t.data), JSON.stringify(t.tags), t.likes, t.createdAt);
  }

  // Demo account with a real bcrypt hash (password: live2026-debug).
  // Only used for local development; safe to delete via SQL.
  const demoCount = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('performer@pulsegrid.audio') as { n: number }).n;
  if (demoCount === 0) {
    const hash = bcrypt.hashSync('live2026-debug', 10);
    db.prepare('INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'user_livecoder_01',
      'performer@pulsegrid.audio',
      'Alex LiveCoder',
      hash,
      now - 86400000
    );
  }
}
seedIfEmpty();

// ── Middleware ──────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}) as express.RequestHandler);

app.use(express.json({ limit: '10mb' }));

app.use(((req, _res, next) => {
  const started = Date.now();
  const url = req.originalUrl || req.url;
  next();
  const ms = Date.now() - started;
  if (!url.startsWith('/api/sample-proxy') || ms > 1000) {
    console.log(`${req.method} ${url} ${ms}ms`);
  }
}) as express.RequestHandler);

// Simple in-memory rate limiter for auth + share endpoints.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(max: number, windowMs: number) {
  return ((req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    return next();
  }) as express.RequestHandler;
}

interface AuthPayload {
  sub: string;
  email: string;
}

function signToken(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email } as AuthPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

function getAuthUser(req: Request): { id: string; email: string } | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(header.substring(7), JWT_SECRET) as AuthPayload;
    return { id: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  (req as any).authUser = user;
  return next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMUNITY_TYPES = new Set(['project', 'pattern', 'instrument', 'snippet', 'theme']);

// ── Auth API ────────────────────────────────────────────────────────────
app.post('/api/auth/register', rateLimit(30, 60_000), async (req: Request, res: Response) => {
  const { email, password, name } = req.body ?? {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim().toLowerCase())) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const displayName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : normalizedEmail.split('@')[0];

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail) as { id: string } | undefined;
  if (existing) return res.status(409).json({ error: 'User with this email already exists' });

  const id = `user_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    normalizedEmail,
    displayName,
    passwordHash,
    Date.now()
  );
  const token = signToken({ id, email: normalizedEmail });
  return res.json({ token, user: { id, email: normalizedEmail, name: displayName } });
});

app.post('/api/auth/login', rateLimit(60, 60_000), async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  const token = signToken({ id: row.id, email: row.email });
  return res.json({ token, user: { id: row.id, email: row.email, name: row.name } });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  // JWTs are stateless; logout is completed client-side by discarding the
  // token. This endpoint exists so clients have a symmetric API to call.
  return res.json({ success: true });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ authenticated: false });
  const row = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(auth.id) as
    | { id: string; email: string; name: string }
    | undefined;
  if (!row) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true, user: row });
});

// ── Projects API (authenticated, per-user) ──────────────────────────────
app.get('/api/projects', requireAuth, (req: Request, res: Response) => {
  const auth = (req as any).authUser as { id: string };
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const rows = db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .all(auth.id, limit, offset) as unknown as ProjectRow[];
  return res.json({ projects: rows.map(toProjectJson) });
});

app.get('/api/projects/:id', requireAuth, (req: Request, res: Response) => {
  const auth = (req as any).authUser as { id: string };
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, auth.id) as unknown as ProjectRow | undefined;
  if (!row) return res.status(404).json({ error: 'Project not found' });
  return res.json({ project: toProjectJson(row) });
});

function validateProjectBody(body: any): { error?: string; value?: {
  title: string; code: string; cpm: number; patterns: unknown; customInstruments: unknown;
  midiBindings: unknown; mixer: unknown; master: unknown;
} } {
  const { title, code, cpm, patterns, customInstruments, midiBindings, mixer, master } = body ?? {};
  if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
    return { error: 'Title must be a string up to 200 characters' };
  }
  if (code !== undefined && (typeof code !== 'string' || code.length > 500_000)) {
    return { error: 'Code must be a string up to 500KB' };
  }
  if (cpm !== undefined && (typeof cpm !== 'number' || !isFinite(cpm) || cpm < 20 || cpm > 1000)) {
    return { error: 'CPM must be a number between 20 and 1000' };
  }
  for (const [key, val] of Object.entries({ patterns, customInstruments, midiBindings, mixer, master })) {
    if (val !== undefined && (typeof val !== 'object' || val === null)) {
      return { error: `${key} must be an object/array when provided` };
    }
  }
  return {
    value: {
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Untitled Live Session',
      code: typeof code === 'string' ? code : '',
      cpm: typeof cpm === 'number' ? cpm : 132,
      patterns: patterns ?? {},
      customInstruments: customInstruments ?? [],
      midiBindings: midiBindings ?? [],
      mixer: mixer ?? null,
      master: master ?? null,
    },
  };
}

app.post('/api/projects', requireAuth, (req: Request, res: Response) => {
  const auth = (req as any).authUser as { id: string };
  const { error, value } = validateProjectBody(req.body);
  if (error || !value) return res.status(400).json({ error: error ?? 'Invalid project' });
  const id = typeof req.body?.id === 'string' && req.body.id.length <= 80 ? req.body.id : `proj_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects
     (id, user_id, title, code, cpm, patterns, custom_instruments, midi_bindings, mixer, master, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, code=excluded.code, cpm=excluded.cpm,
       patterns=excluded.patterns, custom_instruments=excluded.custom_instruments,
       midi_bindings=excluded.midi_bindings, mixer=excluded.mixer, master=excluded.master,
       updated_at=excluded.updated_at`
  ).run(
    id,
    auth.id,
    value.title,
    value.code,
    value.cpm,
    JSON.stringify(value.patterns),
    JSON.stringify(value.customInstruments),
    JSON.stringify(value.midiBindings),
    value.mixer ? JSON.stringify(value.mixer) : null,
    value.master ? JSON.stringify(value.master) : null,
    now,
    now
  );
  // On upsert-of-foreign-id, enforce ownership: only return rows we own.
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, auth.id) as unknown as ProjectRow | undefined;
  if (!row) return res.status(409).json({ error: 'Project ID is owned by another user' });
  return res.json({ success: true, project: toProjectJson(row) });
});

app.put('/api/projects/:id', requireAuth, (req: Request, res: Response) => {
  const auth = (req as any).authUser as { id: string };
  const existing = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, auth.id) as unknown as ProjectRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Project not found' });
  const { error, value } = validateProjectBody(req.body);
  if (error || !value) return res.status(400).json({ error: error ?? 'Invalid project' });
  db.prepare(
    `UPDATE projects SET title=?, code=?, cpm=?, patterns=?, custom_instruments=?,
     midi_bindings=?, mixer=?, master=?, updated_at=? WHERE id=? AND user_id=?`
  ).run(
    value.title,
    value.code,
    value.cpm,
    JSON.stringify(value.patterns),
    JSON.stringify(value.customInstruments),
    JSON.stringify(value.midiBindings),
    value.mixer ? JSON.stringify(value.mixer) : null,
    value.master ? JSON.stringify(value.master) : null,
    Date.now(),
    req.params.id,
    auth.id
  );
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, auth.id) as unknown as ProjectRow;
  return res.json({ success: true, project: toProjectJson(row) });
});

app.delete('/api/projects/:id', requireAuth, (req: Request, res: Response) => {
  const auth = (req as any).authUser as { id: string };
  const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, auth.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
  return res.json({ success: true });
});

// ── Community API ───────────────────────────────────────────────────────
app.get('/api/community', (req: Request, res: Response) => {
  const typeFilter = typeof req.query.type === 'string' && COMMUNITY_TYPES.has(req.query.type) ? req.query.type : null;
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;
  const sort = req.query.sort === 'recent' ? 'recent' : 'likes';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (typeFilter) {
    where.push('type = ?');
    params.push(typeFilter);
  }
  if (q) {
    where.push('(title LIKE ? OR description LIKE ? OR author LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = sort === 'recent' ? 'created_at DESC' : 'likes DESC, created_at DESC';
  const rows = db.prepare(`SELECT * FROM community_items ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM community_items ${whereSql}`).get(...params) as { n: number }).n;
  return res.json({ items: rows.map(toCommunityJson), total });
});

app.post('/api/community/share', rateLimit(30, 60_000), (req: Request, res: Response) => {
  const { title, type, description, data, tags, author } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return res.status(400).json({ error: 'Title is required (max 200 chars)' });
  }
  if (data === undefined || typeof data !== 'object' || data === null) {
    return res.status(400).json({ error: 'Content data is required' });
  }
  const shareType = typeof type === 'string' && COMMUNITY_TYPES.has(type) ? type : 'project';
  if (shareType === 'theme' && (typeof (data as any).theme !== 'object' || (data as any).theme === null)) {
    return res.status(400).json({ error: 'Theme shares require data.theme settings' });
  }
  const auth = getAuthUser(req);
  const cleanTags = Array.isArray(tags)
    ? tags.filter((t) => typeof t === 'string').map((t) => t.slice(0, 40)).slice(0, 12)
    : shareType === 'theme'
      ? ['theme', 'style']
      : ['livecode', 'performance'];

  const id = `comm_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO community_items
     (id, author, user_id, title, type, description, data, tags, likes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    typeof author === 'string' && author.trim() ? author.trim().slice(0, 80) : auth ? undefinedNames(auth.email) : 'Guest Performer',
    auth ? auth.id : null,
    title.trim(),
    shareType,
    typeof description === 'string' ? description.slice(0, 2000) : shareType === 'theme' ? 'Shared look & feel preset' : '',
    JSON.stringify(data),
    JSON.stringify(cleanTags),
    1,
    now
  );
  const row = db.prepare('SELECT * FROM community_items WHERE id = ?').get(id) as any;
  return res.json({ success: true, item: toCommunityJson(row) });

  function undefinedNames(_email: string): string {
    // Look up the display name for the share author field.
    try {
      const u = db.prepare('SELECT name FROM users WHERE id = ?').get(auth!.id) as { name: string } | undefined;
      return u?.name || 'LiveCoder';
    } catch {
      return 'LiveCoder';
    }
  }
});

app.post('/api/community/:id/like', rateLimit(120, 60_000), (req: Request, res: Response) => {
  const item = db.prepare('SELECT * FROM community_items WHERE id = ?').get(req.params.id) as any;
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const auth = getAuthUser(req);
  const voter = auth ? `user:${auth.id}` : `ip:${req.ip}`;
  const existing = db.prepare('SELECT 1 FROM community_votes WHERE item_id = ? AND voter = ?').get(req.params.id, voter);
  if (existing) {
    return res.json({ success: true, likes: item.likes, alreadyVoted: true });
  }
  try {
    db.exec('BEGIN');
    db.prepare('INSERT INTO community_votes (item_id, voter, created_at) VALUES (?, ?, ?)').run(req.params.id, voter, Date.now());
    db.prepare('UPDATE community_items SET likes = likes + 1 WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    return res.status(409).json({ error: 'Already voted' });
  }
  const updated = db.prepare('SELECT likes FROM community_items WHERE id = ?').get(req.params.id) as { likes: number };
  return res.json({ success: true, likes: updated.likes });
});

app.delete('/api/community/:id', requireAuth, (req: Request, res: Response) => {
  const auth = (req as any).authUser as { id: string };
  const item = db.prepare('SELECT user_id FROM community_items WHERE id = ?').get(req.params.id) as { user_id: string | null } | undefined;
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!item.user_id || item.user_id !== auth.id) {
    return res.status(403).json({ error: 'Only the author can delete this item' });
  }
  db.prepare('DELETE FROM community_items WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

// ── Sample proxy: hardened fetch of sample maps + audio ─────────────────
// Blocks private/loopback/link-local targets (SSRF) and HTML responses.
const PROXY_CAP = 60 * 1024 * 1024;

function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === 'localhost' || v === '::1' || v === '::ffff:127.0.0.1') return true;
  if (v.startsWith('127.') || v.startsWith('0.')) return true;
  if (v.startsWith('10.') || v.startsWith('192.168.')) return true;
  if (v.startsWith('169.254.')) return true;
  const m172 = v.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
  return false;
}

async function assertPublicHttpUrl(target: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw Object.assign(new Error('Missing or invalid ?url= (absolute http(s) URL required)'), { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Only http(s) URLs are proxied'), { status: 400 });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('URLs with credentials are not proxied'), { status: 400 });
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname)) {
    throw Object.assign(new Error('Private/local targets are not proxied'), { status: 400 });
  }
  // Resolve DNS and reject private IPs (prevents dns-rebinding exfiltration).
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.some((r) => isPrivateIp(r.address))) {
      throw Object.assign(new Error('Private/local targets are not proxied'), { status: 400 });
    }
  } catch (err: any) {
    if (err?.status === 400) throw err;
    throw Object.assign(new Error(`DNS lookup failed for ${hostname}`), { status: 502 });
  }
  return parsed;
}

app.get('/api/sample-proxy', rateLimit(300, 60_000), async (req: Request, res: Response) => {
  const target = typeof req.query.url === 'string' ? req.query.url : '';
  let parsed: URL;
  try {
    parsed = await assertPublicHttpUrl(target);
  } catch (err: any) {
    return res.status(err?.status || 400).json({ error: err?.message || 'Bad proxy target' });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'PulseGrid-Sample-Proxy/1.0' },
      redirect: 'follow',
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({ error: `Upstream ${upstream.status} for ${target}` });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('text/html')) {
      return res.status(502).json({ error: 'Upstream returned HTML (expected sample map or audio)' });
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const reader = upstream.body.getReader();
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > PROXY_CAP) {
          try {
            await reader.cancel();
          } catch {}
          if (!res.headersSent) return res.status(413).json({ error: 'Proxied file exceeds 60MB cap' });
          return res.end();
        }
        if (!res.write(value)) await new Promise((r) => res.once('drain', r));
      }
    } finally {
      reader.releaseLock();
    }
    return res.end();
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({ error: aborted ? 'Upstream fetch timed out' : `Proxy fetch failed: ${err?.message || err}` });
  } finally {
    clearTimeout(timeout);
  }
});

// ── VST Bridge status: real TCP probe instead of a hardcoded stub ───────
function probeTcp(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

app.get('/api/vst-bridge/status', async (req: Request, res: Response) => {
  const recommendedPort = Math.min(Math.max(parseInt(String(req.query.port ?? '8080'), 10) || 8080, 1), 65535);
  const bridgeOnline = await probeTcp('127.0.0.1', recommendedPort);
  const scriptKinds = ['linux', 'node', 'setup', 'service', 'readme'] as const;
  const fileNames: Record<(typeof scriptKinds)[number], string> = {
    linux: 'vst-bridge-linux.py',
    node: 'vst-bridge.js',
    setup: 'setup-linux-midi.sh',
    service: 'pulsegrid-bridge.service',
    readme: 'README.md',
  };
  const availableScripts = scriptKinds.filter((kind) => {
    try {
      return fs.existsSync(path.resolve(__dirname, 'bridge', fileNames[kind]));
    } catch {
      return false;
    }
  });
  return res.json({
    bridgeOnline,
    probedPort: recommendedPort,
    protocol: 'WebSocket/WebMIDI-Bridge-v1',
    serverPlatform: process.platform,
    supportedDAWs: ['Ableton Live', 'FL Studio', 'Reaper', 'Bitwig Studio', 'Logic Pro', 'Ardour', 'Carla (Linux)'],
    // Virtual MIDI ports live in the browser/DAW host, not on this server:
    // enumerate them client-side via WebMIDI (see VstBridge.refreshMidiOutputs).
    midiPortsVisibleToServer: [],
    availableScripts,
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
        `python3 bridge/vst-bridge-linux.py --port ${recommendedPort}`,
        'In DAW: enable "PulseGrid VST Out" as MIDI input (Ardour/Reaper/Bitwig/Carla).',
        'No ports? run: sudo modprobe snd-virmidi midi_devs=1, then aconnect -l',
      ],
      macos: [
        'Open Audio MIDI Setup → MIDI Studio → enable IAC Driver Bus 1',
        `node bridge/vst-bridge.js --port ${recommendedPort}`,
        'In DAW: select PulseGrid VST Out / IAC Bus as MIDI input.',
      ],
      windows: [
        'Install loopMIDI, create port "PulseGrid VST Out"',
        `node bridge/vst-bridge.js --port ${recommendedPort}`,
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

app.get('/api/health', (_req: Request, res: Response) => {
  let dbOk = false;
  try {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    dbOk = row?.ok === 1;
  } catch {}
  return res.json({ ok: dbOk, db: dbOk ? 'sqlite' : 'unreachable', uptimeSec: Math.round(process.uptime()), time: new Date().toISOString() });
});

// 404 + error handler (JSON, never HTML for /api)
app.use('/api', ((_req: Request, res: Response) => {
  return res.status(404).json({ error: 'Not found' });
}) as express.RequestHandler);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err?.message || err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  return res.status(500).json({ error: 'Internal server error' });
}) as express.ErrorRequestHandler);

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
    console.log(`PulseGrid workstation on http://0.0.0.0:${PORT} (db: ${DB_PATH})`);
  });
}

startServer();
