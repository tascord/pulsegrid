import React, { useState, useEffect } from 'react';
import { X, Cloud, Share2, LogIn, UserPlus, Heart, Download, UploadCloud } from 'lucide-react';
import { patternScheduler } from '../audio/PatternScheduler';
import { instrumentRegistry } from '../audio/InstrumentRegistry';
import { midiManager } from '../audio/MidiManager';
import { audioEngine } from '../audio/AudioEngine';
import type { TrackMixerState, MasterMixerState } from '../audio/MixerStore';
import { useTheme } from '../theme/ThemeContext';
import { THEMES } from '../theme/themes';

interface CommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: { name: string; email: string } | null;
  setUser: (user: { name: string; email: string } | null) => void;
  currentCode: string;
  onLoadProject: (
    code: string,
    cpm: number,
    patterns?: Record<string, string>,
    mixer?: Record<string, TrackMixerState> | null,
    master?: MasterMixerState | null,
  ) => void;
}

export const CommunityModal: React.FC<CommunityModalProps> = ({
  isOpen,
  onClose,
  user,
  setUser,
  currentCode,
  onLoadProject,
}) => {
  const [activeTab, setActiveTab] = useState<'community' | 'cloud' | 'auth'>('community');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Community state
  const [items, setItems] = useState<any[]>([]);
  const [userProjects, setUserProjects] = useState<any[]>([]);
  const [projectTitle, setProjectTitle] = useState('My Performance Session');
  const [shareTitle, setShareTitle] = useState('');
  const [shareDesc, setShareDesc] = useState('');
  const [shareType, setShareType] = useState<'project' | 'theme'>('project');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'project' | 'theme'>('all');
  const [appliedThemeId, setAppliedThemeId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    if (isOpen) {
      fetchCommunity();
      fetchProjects();
    }
  }, [isOpen]);

  const fetchCommunity = async () => {
    try {
      const res = await fetch('/api/community');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {}
  };

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('pulsegrid_token');
      const res = await fetch('/api/projects', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setUserProjects(data.projects || []);
      }
    } catch {}
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }
      localStorage.setItem('pulsegrid_token', data.token);
      setUser(data.user);
      setActiveTab('cloud');
      fetchProjects();
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    }
  };

  const handleSaveToCloud = async () => {
    const token = localStorage.getItem('pulsegrid_token');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: projectTitle,
          code: currentCode,
          cpm: patternScheduler.getCpm(),
          patterns: patternScheduler.getSharedPatterns(),
          customInstruments: instrumentRegistry.getAll(),
          midiBindings: midiManager.getBindings(),
          mixer: patternScheduler.getMixerSnapshot(),
          master: { volume: audioEngine.getMasterVolume(), muted: audioEngine.getMuted() },
        }),
      });
      if (res.ok) {
        fetchProjects();
      }
    } catch {}
  };

  const handleShareToCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareTitle && shareType === 'project') return;

    const isTheme = shareType === 'theme';
    const activeTheme = THEMES.find((t) => t.id === theme.themeId) || THEMES[0];
    try {
      const res = await fetch('/api/community/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isTheme
            ? {
                title: shareTitle || `${activeTheme.name} theme`,
                description: shareDesc || `${activeTheme.description} · ${theme.fontSize}px`,
                author: user ? user.name : 'Guest Performer',
                type: 'theme',
                tags: ['theme', 'style'],
                data: {
                  theme: JSON.parse(theme.exportJson()),
                  vars: activeTheme.vars,
                },
              }
            : {
                title: shareTitle,
                description: shareDesc,
                author: user ? user.name : 'Guest Performer',
                type: 'project',
                data: {
                  code: currentCode,
                  cpm: patternScheduler.getCpm(),
                  patterns: patternScheduler.getSharedPatterns(),
                  mixer: patternScheduler.getMixerSnapshot(),
                  master: { volume: audioEngine.getMasterVolume(), muted: audioEngine.getMuted() },
                },
              }
        ),
      });
      if (res.ok) {
        setIsSharing(false);
        setShareTitle('');
        setShareDesc('');
        fetchCommunity();
      }
    } catch {}
  };

  const handleApplyTheme = (item: any) => {
    try {
      if (item?.data?.theme && theme.importJson(JSON.stringify(item.data.theme))) {
        setAppliedThemeId(item.id);
        setTimeout(() => setAppliedThemeId(null), 2500);
      }
    } catch {}
  };

  const handleLike = async (id: string) => {
    try {
      const res = await fetch(`/api/community/${id}/like`, { method: 'POST' });
      if (res.ok) {
        fetchCommunity();
      }
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-2xl bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-4 py-3 pg-panel-header">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-sm text-neutral-100">Share</span>
          </div>

          {/* Segmented Tab Buttons */}
          <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-xs">
            <button
              onClick={() => setActiveTab('community')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'community' ? 'bg-neutral-800 text-emerald-400 font-medium' : 'text-neutral-400'
              }`}
            >
              Explore Community
            </button>
            <button
              onClick={() => setActiveTab('cloud')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'cloud' ? 'bg-neutral-800 text-emerald-400 font-medium' : 'text-neutral-400'
              }`}
            >
              My Cloud Backups
            </button>
            <button
              onClick={() => setActiveTab('auth')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'auth' ? 'bg-neutral-800 text-emerald-400 font-medium' : 'text-neutral-400'
              }`}
            >
              {user ? 'Account Profile' : 'Sign In'}
            </button>
          </div>

          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 p-4 overflow-y-auto">
          {/* TAB 1: Community Presets */}
          {activeTab === 'community' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-200">Community presets</h3>
                  <p className="text-xs text-neutral-400">
                    Discover and audition ready-to-perform algorithmic tracks and custom synth patches.
                  </p>
                </div>
                <button
                  onClick={() => setIsSharing(!isSharing)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs rounded transition-colors flex items-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Publish My Session</span>
                </button>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-full border border-neutral-800 text-[11px]">
                {(['all', 'project', 'theme'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setGalleryFilter(f)}
                    className={`px-2.5 py-1 rounded-full capitalize transition-colors ${
                      galleryFilter === f ? 'bg-neutral-800 text-neutral-100 font-semibold' : 'text-neutral-500'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'project' ? 'Sessions' : 'Themes'}
                  </button>
                ))}
              </div>

              {isSharing && (
                <form
                  onSubmit={handleShareToCommunity}
                  className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-200">
                      {shareType === 'theme' ? 'Share Current Look to Theme Gallery' : 'Share Current Performance to Community'}
                    </span>
                    <div className="flex items-center gap-1 p-0.5 rounded-full border border-neutral-800 text-[11px]">
                      {(['project', 'theme'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setShareType(t)}
                          className={`px-2.5 py-0.5 rounded-full capitalize ${
                            shareType === t ? 'bg-neutral-700 text-neutral-100 font-semibold' : 'text-neutral-500'
                          }`}
                        >
                          {t === 'project' ? 'Session' : 'Theme'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    placeholder={shareType === 'theme' ? 'Title (e.g. Midnight Club Theme)' : 'Title (e.g. Berlin Warehouse Acid)'}
                    value={shareTitle}
                    onChange={(e) => setShareTitle(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
                    required={shareType === 'project'}
                  />
                  <textarea
                    placeholder="Short description or performance tips..."
                    value={shareDesc}
                    onChange={(e) => setShareDesc(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 resize-none h-16"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsSharing(false)}
                      className="px-3 py-1 bg-neutral-800 text-neutral-300 rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold rounded text-xs"
                    >
                      Publish
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 gap-2.5">
                {items
                  .filter((item) => galleryFilter === 'all' || item.type === galleryFilter)
                  .map((item) =>
                    item.type === 'theme' ? (
                      <div
                        key={item.id}
                        className="p-3 bg-neutral-900/70 border border-neutral-800 hover:border-neutral-700 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          {Object.values((item.data?.vars || {}) as Record<string, string>)
                            .filter((v) => typeof v === 'string' && v.startsWith('#'))
                            .slice(0, 5)
                            .map((c, i) => (
                              <span key={i} className="w-5 h-5 rounded-full border border-black/40" style={{ background: c as string }} />
                            ))}
                          <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                            {item.data?.theme?.fontSize || ''}px{item.data?.theme?.fontId ? ` · ${item.data.theme.fontId}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-xs text-neutral-100">{item.title}</span>
                          <span className="text-[10px] text-neutral-500">by {item.author}</span>
                        </div>
                        <p className="text-xs text-neutral-400 mb-2">{item.description}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60">
                          <button
                            onClick={() => handleLike(item.id)}
                            className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-red-400 transition-colors"
                          >
                            <Heart className="w-3.5 h-3.5" />
                            <span className="font-mono tabular-nums">{item.likes}</span>
                          </button>
                          <button
                            onClick={() => handleApplyTheme(item)}
                            className="flex items-center gap-1.5 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 rounded text-xs transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{appliedThemeId === item.id ? 'Applied ✓' : 'Apply Theme'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={item.id}
                        className="p-3 bg-neutral-900/70 border border-neutral-800 hover:border-neutral-700 rounded-lg transition-colors flex flex-col justify-between"
                      >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-neutral-100">{item.title}</span>
                        <span className="text-[10px] text-neutral-500">by {item.author}</span>
                      </div>
                      <p className="text-xs text-neutral-400 mb-2">{item.description}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleLike(item.id)}
                          className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-red-400 transition-colors"
                        >
                          <Heart className="w-3.5 h-3.5" />
                          <span className="font-mono tabular-nums">{item.likes}</span>
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          onLoadProject(item.data.code, item.data.cpm, item.data.patterns, item.data.mixer, item.data.master);
                          onClose();
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 rounded text-xs transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Load into Editor</span>
                      </button>
                    </div>
                  </div>
                    )
                  )}
              </div>
            </div>
          )}

          {/* TAB 2: Cloud Project Backups */}
          {activeTab === 'cloud' && (
            <div className="space-y-4">
              <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg space-y-2">
                <span className="text-xs font-semibold text-neutral-200">Save Snapshot to Cloud</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    placeholder="Project Title"
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleSaveToCloud}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold rounded text-xs transition-colors"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Backup Now</span>
                  </button>
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold text-neutral-300 block mb-2">Saved Performance Snapshots</span>
                {userProjects.length === 0 ? (
                  <div className="p-6 text-center text-neutral-500 text-xs border border-neutral-800 rounded">
                    No cloud backups yet. Click "Backup Now" to preserve your session state!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {userProjects.map((p) => (
                      <div
                        key={p.id}
                        className="p-2.5 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-between"
                      >
                        <div>
                          <span className="font-semibold text-xs text-neutral-200">{p.title}</span>
                          <div className="text-[10px] text-neutral-500">
                            {p.cpm} CPM · {new Date(p.updatedAt).toLocaleTimeString()}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            onLoadProject(p.code, p.cpm, p.patterns, p.mixer, p.master);
                            onClose();
                          }}
                          className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: User Authentication */}
          {activeTab === 'auth' && (
            <div className="max-w-sm mx-auto py-4">
              {user ? (
                <div className="text-center space-y-3">
                  <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-lg font-bold">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-neutral-100">{user.name}</h4>
                    <p className="text-xs text-neutral-500">{user.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      localStorage.removeItem('pulsegrid_token');
                      setUser(null);
                    }}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAuth} className="space-y-3">
                  <div className="flex border-b border-neutral-800 mb-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={`flex-1 py-1.5 text-center font-medium ${
                        authMode === 'login' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-neutral-400'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={`flex-1 py-1.5 text-center font-medium ${
                        authMode === 'register' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-neutral-400'
                      }`}
                    >
                      Register
                    </button>
                  </div>

                  {authError && (
                    <div className="p-2 bg-red-950/80 border border-red-800 text-red-300 text-xs rounded">
                      {authError}
                    </div>
                  )}

                  {authMode === 'register' && (
                    <div>
                      <label className="text-[10px] text-neutral-400 uppercase font-mono block mb-1">
                        Performer Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alex Hertz"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] text-neutral-400 uppercase font-mono block mb-1">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="livecoder@pulsegrid.audio"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-neutral-400 uppercase font-mono block mb-1">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs rounded transition-colors mt-2"
                  >
                    {authMode === 'login' ? 'Sign In to PulseGrid' : 'Create LiveCoder Account'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
