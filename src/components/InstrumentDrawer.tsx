import React, { useState, useEffect } from 'react';
import { Cpu, Copy, Check, Play, Plus, Trash2, Sliders } from 'lucide-react';
import { InstrumentConfig } from '../types/music';
import { instrumentRegistry } from '../audio/InstrumentRegistry';
import { audioEngine } from '../audio/AudioEngine';

export const InstrumentDrawer: React.FC = () => {
  const [instruments, setInstruments] = useState<InstrumentConfig[]>(instrumentRegistry.getAll());
  const [selectedInstName, setSelectedInstName] = useState<string>('acid_303');
  const [copiedName, setCopiedName] = useState<string | null>(null);

  useEffect(() => {
    const unsub = instrumentRegistry.subscribe(() => {
      setInstruments(instrumentRegistry.getAll());
    });
    return unsub;
  }, []);

  const current = instrumentRegistry.get(selectedInstName) || instruments[0];

  const handleDuplicate = () => {
    if (!current) return;
    const cloned = instrumentRegistry.duplicate(current.name);
    setSelectedInstName(cloned.name);
  };

  const handleUpdate = (updates: Partial<InstrumentConfig>) => {
    if (!current) return;
    instrumentRegistry.update(current.name, updates);
  };

  const handleAudition = () => {
    if (!current) return;
    audioEngine.init();
    audioEngine.resume();
    // Play test note (C3 - MIDI 48)
    audioEngine.triggerSound('audition_preview', 'c3', 0, 0.4, 0.85, current.name);
  };

  const handleCopyCode = (name: string) => {
    navigator.clipboard.writeText(`.synth("${name}")`);
    setCopiedName(name);
    setTimeout(() => setCopiedName(null), 2000);
  };

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 pg-panel-header text-xs">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-neutral-200">Instruments</span>
          <span className="text-neutral-400 font-mono text-[11px] tabular-nums">
            {instruments.length} Synthesizers
          </span>
        </div>

        <button
          onClick={handleDuplicate}
          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs rounded transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>Duplicate Synth</span>
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Preset List */}
        <div className="w-48 bg-neutral-900/50 border-r border-neutral-800 p-2 overflow-y-auto space-y-1">
          {instruments.map((inst) => {
            const isSelected = inst.name.toLowerCase() === selectedInstName.toLowerCase();
            return (
              <button
                key={inst.id}
                onClick={() => setSelectedInstName(inst.name)}
                className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between ${
                  isSelected
                    ? 'bg-neutral-800 text-emerald-400 font-medium border border-neutral-700'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                <span className="truncate">{inst.name}</span>
                <span className="text-[9px] font-mono text-neutral-500 uppercase">{inst.type.slice(0, 4)}</span>
              </button>
            );
          })}
        </div>

        {/* Right Column: Active Synth Sound Design Panel */}
        {current && (
          <div className="flex-1 p-3 overflow-y-auto space-y-3">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={current.name}
                  onChange={(e) => handleUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                  className="font-mono font-bold text-sm text-neutral-100 bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-800 text-neutral-400 rounded">
                  Type: {current.type}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleAudition}
                  className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition-colors"
                  title="Audition synth note"
                >
                  <Play className="w-3 h-3 text-emerald-400 fill-current" />
                  <span>Audition</span>
                </button>

                <button
                  onClick={() => handleCopyCode(current.name)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition-colors"
                  title="Copy .synth() chain snippet"
                >
                  {copiedName === current.name ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Copy Snippet</span>
                </button>
              </div>
            </div>

            {/* Sound Design Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Oscillator & Waveform */}
              <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded space-y-2">
                <div className="text-[11px] font-semibold text-neutral-300">Oscillator Waveform</div>
                <div className="grid grid-cols-4 gap-1">
                  {(['sawtooth', 'square', 'sine', 'triangle'] as OscillatorType[]).map((wave) => (
                    <button
                      key={wave}
                      onClick={() => handleUpdate({ oscillatorType: wave })}
                      className={`py-1 text-[10px] rounded uppercase font-mono transition-colors ${
                        current.oscillatorType === wave
                          ? 'bg-emerald-600 text-neutral-950 font-bold'
                          : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {wave.slice(0, 3)}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>Drive / Saturation</span>
                    <span className="font-mono tabular-nums">{Math.round((current.drive || 0) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={current.drive || 0}
                    onChange={(e) => handleUpdate({ drive: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              </div>

              {/* Filter */}
              <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded space-y-2">
                <div className="text-[11px] font-semibold text-neutral-300">Filter Section</div>
                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>Cutoff</span>
                    <span className="font-mono tabular-nums">{Math.round(current.filterCutoff)}Hz</span>
                  </div>
                  <input
                    type="range"
                    min="60"
                    max="8000"
                    value={current.filterCutoff}
                    onChange={(e) => handleUpdate({ filterCutoff: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                    <span>Resonance Q</span>
                    <span className="font-mono tabular-nums">{current.filterResonance.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="20"
                    step="0.2"
                    value={current.filterResonance}
                    onChange={(e) => handleUpdate({ filterResonance: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>
              </div>

              {/* ADSR Envelope */}
              <div className="md:col-span-2 p-2.5 bg-neutral-900/60 border border-neutral-800 rounded space-y-2">
                <div className="text-[11px] font-semibold text-neutral-300">ADSR Envelope Generator</div>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <div className="flex justify-between text-[9px] text-neutral-400 mb-0.5">
                      <span>Attack</span>
                      <span className="font-mono">{current.attack.toFixed(3)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0.001"
                      max="0.5"
                      step="0.005"
                      value={current.attack}
                      onChange={(e) => handleUpdate({ attack: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[9px] text-neutral-400 mb-0.5">
                      <span>Decay</span>
                      <span className="font-mono">{current.decay.toFixed(2)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0.02"
                      max="1.5"
                      step="0.02"
                      value={current.decay}
                      onChange={(e) => handleUpdate({ decay: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[9px] text-neutral-400 mb-0.5">
                      <span>Sustain</span>
                      <span className="font-mono">{Math.round(current.sustain * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={current.sustain}
                      onChange={(e) => handleUpdate({ sustain: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[9px] text-neutral-400 mb-0.5">
                      <span>Release</span>
                      <span className="font-mono">{current.release.toFixed(2)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0.02"
                      max="2.0"
                      step="0.05"
                      value={current.release}
                      onChange={(e) => handleUpdate({ release: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* FM parameters if FM or custom */}
              {(current.type === 'fm_bell' || current.type === 'custom') && (
                <div className="md:col-span-2 p-2.5 bg-neutral-900/60 border border-neutral-800 rounded space-y-2">
                  <div className="text-[11px] font-semibold text-neutral-300">Frequency Modulation (FM)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-[9px] text-neutral-400 mb-0.5">
                        <span>Carrier/Modulator Ratio</span>
                        <span className="font-mono">{(current.fmRatio || 1).toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="8"
                        step="0.25"
                        value={current.fmRatio || 1}
                        onChange={(e) => handleUpdate({ fmRatio: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-purple-400"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[9px] text-neutral-400 mb-0.5">
                        <span>Modulation Index</span>
                        <span className="font-mono">{(current.fmIndex || 1).toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.2"
                        value={current.fmIndex || 1}
                        onChange={(e) => handleUpdate({ fmIndex: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-neutral-700 rounded appearance-none cursor-pointer accent-purple-400"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
