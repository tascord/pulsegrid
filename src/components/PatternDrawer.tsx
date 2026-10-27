import React, { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, Copy, Check, Radio } from 'lucide-react';
import { patternScheduler } from '../audio/PatternScheduler';

export const PatternDrawer: React.FC = () => {
  const [patterns, setPatterns] = useState<Record<string, string>>(patternScheduler.getSharedPatterns());
  const [editingPattern, setEditingPattern] = useState<string | null>(null);
  const [editNotation, setEditNotation] = useState<string>('');
  const [newPatternName, setNewPatternName] = useState<string>('');
  const [newPatternNotation, setNewPatternNotation] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const unsub = patternScheduler.subscribeTracks(() => {
      setPatterns(patternScheduler.getSharedPatterns());
    });
    return unsub;
  }, []);

  const tracks = patternScheduler.getEvaluatedTracks();

  const getReferencingTracks = (patternKey: string): string[] => {
    return tracks
      .filter((t) => t.patternName && t.patternName.toLowerCase() === patternKey.toLowerCase())
      .map((t) => t.name);
  };

  const handleStartEdit = (key: string, currentVal: string) => {
    setEditingPattern(key);
    setEditNotation(currentVal);
  };

  const handleSaveEdit = (key: string) => {
    if (editNotation.trim()) {
      patternScheduler.setSharedPattern(key, editNotation.trim());
      setPatterns(patternScheduler.getSharedPatterns());
    }
    setEditingPattern(null);
  };

  const handleCreatePattern = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatternName.trim() || !newPatternNotation.trim()) return;

    const key = newPatternName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    patternScheduler.setSharedPattern(key, newPatternNotation.trim());
    setPatterns(patternScheduler.getSharedPatterns());
    setNewPatternName('');
    setNewPatternNotation('');
  };

  const handleCopyUsage = (key: string) => {
    const snippet = `defPattern("${key}", "${patterns[key]}");\ntrack("my_track").pattern("${key}");`;
    navigator.clipboard.writeText(snippet);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="flex flex-col h-full pg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 pg-panel-header text-xs">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-neutral-200">Patterns</span>
          <span className="text-neutral-400 font-mono text-[11px] tabular-nums">
            {Object.keys(patterns).length} Shared Patterns
          </span>
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {/* New Pattern Quick Form */}
        <form onSubmit={handleCreatePattern} className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded">
          <div className="text-[11px] font-semibold text-neutral-300 mb-2 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New pattern</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Pattern name (e.g. main_hook)"
              value={newPatternName}
              onChange={(e) => setNewPatternName(e.target.value)}
              className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <input
              type="text"
              placeholder="Mini-notation (e.g. c3 [eb3 g3] [bb3 ~])"
              value={newPatternNotation}
              onChange={(e) => setNewPatternNotation(e.target.value)}
              className="sm:col-span-2 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <div className="flex justify-end mt-2">
            <button
              type="submit"
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs rounded transition-colors"
            >
              Add Pattern
            </button>
          </div>
        </form>

        {/* Existing Pattern List */}
        <div className="space-y-2">
          {Object.entries(patterns).map(([key, notation]) => {
            const linkedTracks = getReferencingTracks(key);
            const isEditing = editingPattern === key;

            return (
              <div
                key={key}
                className="p-2.5 bg-neutral-900/90 border border-neutral-800 rounded hover:border-neutral-700 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-emerald-400">{key}</span>
                    {linkedTracks.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-neutral-500">used by:</span>
                        {linkedTracks.map((tr) => (
                          <span
                            key={tr}
                            className="text-[10px] font-mono px-1.5 py-0.2 bg-neutral-800 text-cyan-300 rounded"
                          >
                            {tr}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-neutral-500">Not used</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopyUsage(key)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                      title="Copy code usage"
                    >
                      {copiedKey === key ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Use</span>
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      value={editNotation}
                      onChange={(e) => setEditNotation(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(key)}
                      className="flex-1 bg-neutral-950 border border-emerald-500 rounded px-2.5 py-1 text-xs text-neutral-200 font-mono focus:outline-none"
                    />
                    <button
                      onClick={() => handleSaveEdit(key)}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs rounded"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => setEditingPattern(null)}
                      className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => handleStartEdit(key, notation)}
                    className="p-1.5 bg-neutral-950/70 border border-neutral-800/80 rounded font-mono text-xs text-amber-300 cursor-pointer hover:border-neutral-600 transition-colors"
                    title="Click to live-edit pattern"
                  >
                    {notation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
