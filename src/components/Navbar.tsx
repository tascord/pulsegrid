import React, { useEffect, useState } from 'react';
import {
  Play,
  Square,
  Volume2,
  VolumeX,
  Sliders,
  Music,
  Cpu,
  Disc,
  Share2,
  Layers,
  AudioLines,
  Palette,
  BookOpen,
  ScrollText,
} from 'lucide-react';
import { patternScheduler } from '../audio/PatternScheduler';
import { audioEngine } from '../audio/AudioEngine';

export type DrawerTab = 'mixer' | 'patterns' | 'instruments' | 'samples' | 'midi' | 'logs' | 'style' | 'docs' | null;

interface NavbarProps {
  activeTab: DrawerTab;
  setActiveTab: (tab: DrawerTab) => void;
  onOpenCommunity: () => void;
  user: { name: string; email: string } | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenCommunity,
  user,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(patternScheduler.getIsPlaying());
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(() => audioEngine.getMuted());
  const [volume, setVolume] = useState<number>(() => audioEngine.getMasterVolume());

  useEffect(() => {
    const unsub = patternScheduler.subscribeStep((step) => {
      setCurrentStep(step);
      setIsPlaying(patternScheduler.getIsPlaying());
    });
    return unsub;
  }, []);

  const handleTogglePlay = () => {
    if (patternScheduler.getIsPlaying()) {
      patternScheduler.stop();
      setIsPlaying(false);
    } else {
      patternScheduler.start();
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    audioEngine.setMasterVolume(val);
  };

  const handleToggleMute = () => {
    const newMute = !isMuted;
    setIsMuted(newMute);
    audioEngine.setMute(newMute);
  };

  const toggleTab = (tab: Exclude<DrawerTab, null>) => {
    setActiveTab(activeTab === tab ? null : tab);
  };

  const tabBtn = (id: Exclude<DrawerTab, null>, icon: React.ReactNode, label: string) => (
    <button
      key={id}
      onClick={() => toggleTab(id)}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors whitespace-nowrap text-xs"
      style={
        activeTab === id
          ? { background: 'var(--pg-surface-3)', color: 'var(--pg-text)', boxShadow: 'inset 0 -2px 0 var(--pg-accent)', fontWeight: 600 }
          : { color: 'var(--pg-muted)' }
      }
      onMouseEnter={(e) => {
        if (activeTab !== id) e.currentTarget.style.color = 'var(--pg-text)';
      }}
      onMouseLeave={(e) => {
        if (activeTab !== id) e.currentTarget.style.color = 'var(--pg-muted)';
      }}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );

  return (
    <header
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm select-none sticky top-0 z-40 pg-header-blur"
      style={{ borderBottom: '1px solid var(--pg-border-soft)' }}
    >
      {/* Zone 1: Brand & Transport */}
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 pg-logo-badge flex items-center justify-center">
            <AudioLines className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="font-semibold tracking-tight text-[15px]">PulseGrid</div>
        </div>

        <button
          onClick={handleTogglePlay}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors"
          style={
            isPlaying
              ? { background: 'var(--pg-accent-2)', color: 'var(--pg-accent-ink)' }
              : { background: 'var(--pg-accent)', color: 'var(--pg-accent-ink)' }
          }
          title="Toggle Playback (Space)"
        >
          {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>

        {/* 16-step pulse */}
        <div
          className="hidden lg:flex items-center gap-1 rounded-md px-2.5 py-2 border"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface)' }}
        >
          {Array.from({ length: 16 }).map((_, idx) => {
            const isDownbeat = idx % 4 === 0;
            const isActive = isPlaying && currentStep === idx;
            return (
              <div
                key={idx}
                className="transition-all duration-75 rounded-full"
                style={{
                  width: isDownbeat ? 4 : 3,
                  height: isDownbeat ? 12 : 8,
                  background: isActive
                    ? 'var(--pg-accent)'
                    : isDownbeat
                    ? 'var(--pg-border)'
                    : 'var(--pg-border-soft)',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Zone 2: Tabs */}
      <nav
        className="hidden md:flex items-center gap-0.5 p-1 rounded-lg border text-xs overflow-x-auto"
        style={{ background: 'var(--pg-surface)', borderColor: 'var(--pg-border-soft)' }}
      >
        {tabBtn('mixer', <Sliders className="w-3.5 h-3.5" />, 'Mixer')}
        {tabBtn('patterns', <Layers className="w-3.5 h-3.5" />, 'Patterns')}
        {tabBtn('instruments', <Cpu className="w-3.5 h-3.5" />, 'Synths')}
        {tabBtn('samples', <Disc className="w-3.5 h-3.5" />, 'Samples')}
        {tabBtn('midi', <Music className="w-3.5 h-3.5" />, 'MIDI')}
        {tabBtn('logs', <ScrollText className="w-3.5 h-3.5" />, 'Logs')}
        {tabBtn('style', <Palette className="w-3.5 h-3.5" />, 'Settings')}
        {tabBtn('docs', <BookOpen className="w-3.5 h-3.5" />, 'Docs')}
      </nav>

      {/* Zone 3: Volume & Cloud */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="hidden sm:flex items-center gap-2 rounded-md px-2.5 py-2 border"
          style={{ borderColor: 'var(--pg-border-soft)', background: 'var(--pg-surface)' }}
        >
          <button onClick={handleToggleMute} title={isMuted ? 'Unmute' : 'Mute'} style={{ color: 'var(--pg-muted)' }}>
            {isMuted ? <VolumeX className="w-3.5 h-3.5" style={{ color: 'var(--pg-danger)' }} /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <input type="range" min="0" max="1.2" step="0.01" value={volume} onChange={handleVolumeChange} className="w-16" />
        </div>

        <button
          onClick={onOpenCommunity}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0"
          style={{ borderColor: 'var(--pg-border)', color: 'var(--pg-text)' }}
        >
          <Share2 className="w-3.5 h-3.5" style={{ color: 'var(--pg-accent-2)' }} />
          <span className="hidden sm:inline">{user ? user.name : 'Share'}</span>
        </button>
      </div>
    </header>
  );
};
