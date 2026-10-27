import React, { useState, useEffect, useRef } from 'react';
import { Disc, Upload, Play, Copy, Check, Scissors, Volume2, Globe } from 'lucide-react';
import { SampleItem } from '../types/music';
import { sampleManager, type SampleBankStatus } from '../audio/SampleManager';
import { audioEngine } from '../audio/AudioEngine';
import { importSampleUrl, loadSamples } from '../audio/SampleLoader';

export const SampleDrawer: React.FC = () => {
  const [samples, setSamples] = useState<SampleItem[]>(sampleManager.getAllSamples());
  const [selectedSampleName, setSelectedSampleName] = useState<string>('kick_808');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [bankStatuses, setBankStatuses] = useState<SampleBankStatus[]>(sampleManager.getAllBankStatuses());
  const [bankNames, setBankNames] = useState<string[]>(sampleManager.getBankNames());
  const [collapsedBanks, setCollapsedBanks] = useState<Set<string>>(new Set());
  const [remoteUrl, setRemoteUrl] = useState<string>('');
  const [remoteLoading, setRemoteLoading] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const unsub = sampleManager.subscribe(() => {
      setSamples(sampleManager.getAllSamples());
      setBankStatuses(sampleManager.getAllBankStatuses());
      setBankNames(sampleManager.getBankNames());
    });
    return unsub;
  }, []);

  // Bank variants (samples() / Strudel map imports) live in their own
  // section; the flat list shows only builtin + uploaded one-shots.
  // Banks are the union of decoded banks and known (possibly still
  // pending) bank statuses, so `samples({...})` shows up immediately
  // after evaluate — variants fill in once decoded (press play).
  const flatSamples = samples.filter((s) => !s.id.startsWith('bank_'));
  const visibleBanks = Array.from(
    new Set([...bankNames, ...bankStatuses.map((b) => b.bank)])
  ).sort();
  const toggleBank = (bank: string) => {
    setCollapsedBanks((prev) => {
      const next = new Set(prev);
      if (next.has(bank)) next.delete(bank);
      else next.add(bank);
      return next;
    });
  };

  const handleImportUrl = async () => {
    const url = remoteUrl.trim();
    if (!url) return;
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      audioEngine.init();
      await audioEngine.resume();
      if (/strudel\.json$/i.test(url) || url.startsWith('github:') || url.startsWith('shabda:')) {
        // Strudel map shorthand or strudel.json URL: registers whole banks.
        await loadSamples(url);
      } else {
        await importSampleUrl(url);
      }
      setRemoteUrl('');
    } catch (err) {
      setRemoteError((err as Error)?.message || String(err));
    } finally {
      setRemoteLoading(false);
    }
  };

  const currentSample = sampleManager.getSample(selectedSampleName) || samples[0];

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentSample || !currentSample.buffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const buffer = currentSample.buffer;
    const channelData = buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    const amp = height / 2;

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, width, height);

    // Trim markers
    const startX = currentSample.trimStart * width;
    const endX = currentSample.trimEnd * width;

    // Active trim region background
    ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.fillRect(startX, 0, endX - startX, height);

    // Waveform line
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, amp);

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = channelData[i * step + j] || 0;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.lineTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

    // Draw trim handles
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, height);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, height);
    ctx.stroke();
  }, [currentSample]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      audioEngine.init();
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.type.includes('audio') || file.name.match(/\.(wav|mp3|ogg|flac|aac)$/i)) {
          try {
            const added = await sampleManager.importAudioFile(file);
            setSelectedSampleName(added.name);
          } catch (err) {
            console.warn('Failed to decode dropped audio:', err);
          }
        }
      }
    }
  };

  const handleAudition = () => {
    if (!currentSample) return;
    audioEngine.init();
    audioEngine.resume();
    audioEngine.triggerSound('sample_audition', currentSample.name, 0, currentSample.duration || 0.4, 0.9);
  };

  const handleCopyToken = (name: string) => {
    navigator.clipboard.writeText(`s("${name}")`);
    setCopiedToken(name);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 pg-panel-header text-xs">
        <div className="flex items-center gap-2">
          <Disc className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-neutral-200">Samples</span>
          <span className="text-neutral-400 font-mono text-[11px] tabular-nums">
            {flatSamples.length} Samples{visibleBanks.length > 0 ? ` · ${visibleBanks.length} Banks` : ''}
          </span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sample List Sidebar */}
        <div className="w-52 bg-neutral-900/50 border-r border-neutral-800 p-2 overflow-y-auto space-y-1">
          <div className="text-xs font-medium text-neutral-400 px-2 py-1">Sample list</div>
          {flatSamples.map((s) => {
            const isSelected = s.name.toLowerCase() === selectedSampleName.toLowerCase();
            return (
              <button
                key={s.id}
                onClick={() => setSelectedSampleName(s.name)}
                className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between ${
                  isSelected
                    ? 'bg-neutral-800 text-emerald-400 font-medium border border-neutral-700'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                <span className="font-mono truncate">{s.name}</span>
                {s.isUserUploaded && (
                  <span className="text-[9px] font-mono px-1 py-0.2 bg-emerald-950 text-emerald-300 rounded">
                    user
                  </span>
                )}
              </button>
            );
          })}

          {/* Imported banks (samples() / Strudel map): every variant audible */}
          {visibleBanks.length > 0 && (
            <div className="text-xs font-medium text-neutral-400 px-2 pt-2 pb-1">Banks</div>
          )}
          {visibleBanks.map((bank) => {
            const variants = sampleManager.getBankVariants(bank);
            const loaded = variants.filter(Boolean).length;
            const total = sampleManager.getBankTotal(bank);
            const status = bankStatuses.find((b) => b.bank === bank);
            const collapsed = collapsedBanks.has(bank);
            const awaitingDecode = loaded === 0;
            return (
              <div key={`bank-${bank}`} className="rounded overflow-hidden">
                <button
                  onClick={() => toggleBank(bank)}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between text-neutral-300 hover:text-neutral-100 hover:bg-neutral-900 bg-neutral-900/60 border border-neutral-800"
                >
                  <span className="font-mono truncate">
                    <span className="text-neutral-500 mr-1">{collapsed ? '▸' : '▾'}</span>
                    {bank}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500 shrink-0 ml-1">
                    {status?.error && loaded === 0 ? 'failed' : status?.pending || awaitingDecode ? `${loaded}/${total}…` : `${loaded}/${total}`}
                  </span>
                </button>
                {!collapsed && awaitingDecode && (
                  <div className="pl-6 pr-2 py-1 text-[10px] text-neutral-500 font-mono">
                    press play to decode
                  </div>
                )}
                {!collapsed &&
                  variants.map((v, idx) => {
                    if (!v) return null;
                    const token = idx === 0 ? bank : `${bank}:${idx}`;
                    const isSelected = selectedSampleName.toLowerCase() === token.toLowerCase();
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedSampleName(token)}
                        className={`w-full text-left pl-6 pr-2.5 py-1 rounded text-xs transition-colors flex items-center justify-between ${
                          isSelected
                            ? 'bg-neutral-800 text-emerald-400 font-medium border border-neutral-700'
                            : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                        }`}
                      >
                        <span className="font-mono truncate">
                          :{idx} <span className="text-neutral-600">{(v.duration || 0).toFixed(2)}s</span>
                        </span>
                        {copiedToken === token ? (
                          <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>

        {/* Right Main Panel: Drag Dropzone & Waveform Editor */}
        <div className="flex-1 p-3 overflow-y-auto space-y-3 flex flex-col justify-between">
          {/* Waveform & Inspector */}
          {currentSample && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={currentSample.name}
                    onChange={(e) =>
                      sampleManager.updateSample(currentSample.id, {
                        name: e.target.value.toLowerCase().replace(/[^a-z0-9_:]/g, '_'),
                      })
                    }
                    className="font-mono font-bold text-sm text-neutral-100 bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-neutral-500 font-mono">
                    {(currentSample.duration || 0).toFixed(2)}s
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAudition}
                    className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition-colors"
                  >
                    <Play className="w-3 h-3 text-emerald-400 fill-current" />
                    <span>Audition</span>
                  </button>

                  <button
                    onClick={() => handleCopyToken(currentSample.name)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition-colors"
                  >
                    {copiedToken === currentSample.name ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>Copy code</span>
                  </button>
                </div>
              </div>

              {/* Waveform Canvas */}
              <div className="relative h-28 bg-neutral-950 border border-neutral-800 rounded overflow-hidden">
                <canvas ref={canvasRef} width={600} height={112} className="w-full h-full block" />
              </div>

              {/* Trim & Playback Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2.5 bg-neutral-900/60 border border-neutral-800 rounded">
                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>Start</span>
                    <span className="font-mono">{Math.round(currentSample.trimStart * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="0.9"
                    step="0.01"
                    value={currentSample.trimStart}
                    onChange={(e) =>
                      sampleManager.updateSample(currentSample.id, { trimStart: parseFloat(e.target.value) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>End</span>
                    <span className="font-mono">{Math.round(currentSample.trimEnd * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.01"
                    value={currentSample.trimEnd}
                    onChange={(e) =>
                      sampleManager.updateSample(currentSample.id, { trimEnd: parseFloat(e.target.value) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>Volume</span>
                    <span className="font-mono">{Math.round(currentSample.gain * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={currentSample.gain}
                    onChange={(e) =>
                      sampleManager.updateSample(currentSample.id, { gain: parseFloat(e.target.value) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>Pitch</span>
                    <span className="font-mono">{currentSample.pitch > 0 ? `+${currentSample.pitch}` : currentSample.pitch} st</span>
                  </div>
                  <input
                    type="range"
                    min="-24"
                    max="24"
                    step="1"
                    value={currentSample.pitch}
                    onChange={(e) =>
                      sampleManager.updateSample(currentSample.id, { pitch: parseInt(e.target.value, 10) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Remote / Strudel map import */}
          <div className="p-3 border border-neutral-800 rounded-lg bg-neutral-900/40 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>Import from URL (Strudel parity)</span>
            </div>
            <div className="flex gap-1.5">
              <input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleImportUrl();
                }}
                placeholder='github:tidalcycles/dirt-samples · https://…/strudel.json · https://…/kick.wav'
                className="flex-1 min-w-0 px-2 py-1.5 rounded border border-neutral-800 bg-neutral-950 text-[11px] font-mono text-neutral-200 focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={handleImportUrl}
                disabled={remoteLoading || !remoteUrl.trim()}
                className="px-2.5 py-1.5 rounded text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white whitespace-nowrap"
              >
                {remoteLoading ? 'Loading…' : 'Load'}
              </button>
            </div>
            <p className="text-[10px] leading-snug text-neutral-500">
              Or in code: <code className="font-mono text-neutral-300">import {'{ ry30_bd as bd }'} from 'ry30'</code> then{' '}
              <code className="font-mono text-neutral-300">s("bd:4")</code>. Variants stream in; <code className="font-mono text-neutral-300">:n</code>{' '}
              wraps modulo bank size. Raw <code className="font-mono text-neutral-300">samples(…)</code> still works.
            </p>
            {remoteError && <p className="text-[11px] text-red-400">{remoteError}</p>}
            {bankStatuses.length > 0 && (
              <div className="space-y-1 pt-1">
                {bankStatuses.map((b) => (
                  <div key={b.bank} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="truncate text-neutral-300">
                      {b.bank}
                      <span className="text-neutral-500"> · {sampleManager.getBankSize(b.bank)}/{b.total}</span>
                    </span>
                    <span className={b.error && b.loaded === 0 ? 'text-red-400' : b.pending ? 'text-amber-300' : 'text-emerald-400'}>
                      {b.error && b.loaded === 0 ? 'failed' : b.pending ? 'loading…' : b.error ? `partial (${b.loaded})` : 'ready'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drag & Drop Audio Upload Target */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`p-4 border-2 border-dashed rounded-lg text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-emerald-500 bg-emerald-950/20 text-emerald-300'
                : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/40 text-neutral-400'
            }`}
          >
            <Upload className="w-5 h-5 mx-auto mb-1.5 opacity-80" />
            <p className="text-xs font-medium">Drop audio files to add samples</p>
            <p className="text-[10px] text-neutral-500 mt-0.5">WAV, MP3, OGG, or FLAC</p>
          </div>
        </div>
      </div>
    </div>
  );
};
