import React, { useState, useEffect } from 'react';
import { Music, Radio, Trash2, Mic, Square, Upload, Check, Copy } from 'lucide-react';
import { midiManager } from '../audio/MidiManager';
import { MidiBinding, MidiRecordedClip } from '../types/music';

export const MidiDrawer: React.FC = () => {
  const [inputs, setInputs] = useState<MIDIInput[]>(midiManager.getInputs());
  const [bindings, setBindings] = useState<MidiBinding[]>(midiManager.getBindings());
  const [lastActivity, setLastActivity] = useState(midiManager.getLastActivity());
  const [isRecording, setIsRecording] = useState<boolean>(midiManager.isRecordingActive());
  const [recordedClips, setRecordedClips] = useState<MidiRecordedClip[]>(midiManager.getRecordedClips());
  const [clipNameInput, setClipNameInput] = useState<string>('');
  const [copiedClip, setCopiedClip] = useState<string | null>(null);

  useEffect(() => {
    const unsub = midiManager.subscribe(() => {
      setInputs(midiManager.getInputs());
      setBindings(midiManager.getBindings());
      setLastActivity(midiManager.getLastActivity());
      setIsRecording(midiManager.isRecordingActive());
      setRecordedClips(midiManager.getRecordedClips());
    });
    return unsub;
  }, []);

  const handleRequestAccess = async () => {
    await midiManager.requestAccess();
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      const clip = midiManager.stopRecording(16, clipNameInput || undefined);
      setClipNameInput('');
    } else {
      midiManager.startRecording(0);
    }
  };

  const handleDropMidiFile = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
          await midiManager.parseMidiFile(file);
        }
      }
    }
  };

  const handleCopyClipCode = (clipName: string) => {
    const snippet = `track("synth").midi("${clipName}").synth("poly_saw");`;
    navigator.clipboard.writeText(snippet);
    setCopiedClip(clipName);
    setTimeout(() => setCopiedClip(null), 2000);
  };

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 pg-panel-header text-xs">
        <div className="flex items-center gap-2">
          <Music className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-neutral-200">MIDI</span>
          <span className="text-neutral-400 font-mono text-[11px] tabular-nums">
            {inputs.length} Inputs Active
          </span>
        </div>

        {inputs.length === 0 ? (
          <button
            onClick={handleRequestAccess}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded border border-neutral-700 transition-colors"
          >
            <Radio className="w-3 h-3 text-cyan-400" />
            <span>Connect MIDI Devices</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Web MIDI Online</span>
          </div>
        )}
      </div>

      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {/* Real-time Activity Readout */}
        <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-neutral-300">Input monitor</span>
          </div>
          <div className="font-mono text-xs text-cyan-300">
            {lastActivity ? lastActivity.text : 'No incoming MIDI messages detected yet'}
          </div>
        </div>

        {/* Live MIDI Note Recording & .MID Drag Drop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-200">Record a clip</span>
              <span className="text-[10px] text-neutral-500">Play notes from a keyboard or pad controller.</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Clip Name (e.g. riff_lead)"
                value={clipNameInput}
                onChange={(e) => setClipNameInput(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 font-mono focus:outline-none"
              />
              <button
                onClick={handleToggleRecord}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors ${
                  isRecording
                    ? 'bg-red-500 text-neutral-950 animate-pulse'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-neutral-950'
                }`}
              >
                {isRecording ? <Square className="w-3 h-3 fill-current" /> : <Mic className="w-3 h-3" />}
                <span>{isRecording ? 'Stop' : 'Record'}</span>
              </button>
            </div>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropMidiFile}
            className="p-2.5 border-2 border-dashed border-neutral-800 hover:border-neutral-700 bg-neutral-900/40 rounded flex flex-col items-center justify-center text-center cursor-pointer"
          >
            <Upload className="w-4 h-4 text-neutral-500 mb-1" />
            <span className="text-xs font-medium text-neutral-300">Drop a MIDI file</span>
            <span className="text-[10px] text-neutral-500">Import notes as a pattern clip.</span>
          </div>
        </div>

        {/* Recorded / Imported MIDI Clips */}
        {recordedClips.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-neutral-400">Recorded clips</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recordedClips.map((clip) => (
                <div
                  key={clip.id}
                  className="p-2 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-between"
                >
                  <div>
                    <span className="font-mono font-bold text-xs text-cyan-300">{clip.name}</span>
                    <div className="text-[10px] text-neutral-500">
                      {clip.notes.length} notes · {clip.durationBeats} beats
                    </div>
                  </div>
                  <button
                    onClick={() => handleCopyClipCode(clip.name)}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                  >
                    {copiedClip === clip.name ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Use Clip</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MIDI Learn Mappings Table */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-neutral-400">MIDI mappings</div>
          {bindings.length === 0 ? (
            <div className="p-4 bg-neutral-900/40 border border-neutral-800 rounded text-center text-neutral-500 text-xs">
              No MIDI knobs mapped yet. Click "Learn" on any mixer fader or cutoff knob to bind physical controls!
            </div>
          ) : (
            <div className="border border-neutral-800 rounded overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-neutral-900 text-neutral-400 text-[10px] uppercase font-mono">
                  <tr>
                    <th className="p-2">CC</th>
                    <th className="p-2">Channel</th>
                    <th className="p-2">Target Parameter</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 font-mono">
                  {bindings.map((b) => (
                    <tr key={b.id} className="hover:bg-neutral-900/60">
                      <td className="p-2 text-cyan-400 font-bold">CC {b.cc}</td>
                      <td className="p-2 text-neutral-400">ch {b.channel}</td>
                      <td className="p-2 text-neutral-200">{b.label}</td>
                      <td className="p-2 text-right">
                        <button
                          onClick={() => midiManager.removeBinding(b.id)}
                          className="text-neutral-500 hover:text-red-400 transition-colors"
                          title="Remove binding"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
