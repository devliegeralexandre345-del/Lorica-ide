// src/components/InlineEditHistory.jsx
//
// Browser for the history of accepted Cmd+K inline edits. Grouped by
// file, each entry shows the instruction + a compact before→after
// preview. One-click restore pulls the "before" text back to the
// clipboard so the user can paste it manually — we intentionally don't
// auto-revert, because the file has almost certainly moved on since
// the edit was accepted.

import React, { useEffect, useMemo, useState } from 'react';
import { X, FileText, Search, Copy, Clock, Trash2, History } from 'lucide-react';
import { readInlineEditHistory, clearInlineEditHistory } from '../utils/aiInlineEdit';

function loadAll() {
  try { return JSON.parse(localStorage.getItem('lorica.inlineEditHistory.v1') || '{}'); } catch { return {}; }
}

function fmtAgo(t) {
  const d = Date.now() - t;
  if (d < 60_000)     return `${Math.floor(d / 1000)}s`;
  if (d < 3600_000)   return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000)  return `${Math.floor(d / 3600_000)}h`;
  return new Date(t).toLocaleDateString();
}

export default function InlineEditHistory({ state, dispatch }) {
  const [map, setMap] = useState(() => loadAll());
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState(null);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showInlineEditHistory', value: false });

  const files = useMemo(() => {
    const rows = Object.entries(map).map(([path, entries]) => ({
      path, count: entries.length,
      last: entries[0]?.at || 0,
      name: path.split(/[\\/]/).pop(),
    })).sort((a, b) => b.last - a.last);
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.path.toLowerCase().includes(q));
  }, [map, query]);

  const current = selectedPath ? (map[selectedPath] || []) : [];

  // When the user switches files but we haven't picked one yet, auto-
  // select the most recently touched one.
  useEffect(() => {
    if (!selectedPath && files.length > 0) setSelectedPath(files[0].path);
  }, [files, selectedPath]);

  const copyBefore = (entry) => {
    navigator.clipboard.writeText(entry.before).catch(() => {});
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Original text copied — paste to restore', duration: 2000 } });
  };

  const openFile = (path) => {
    window.lorica.fs.readFile(path).then((r) => {
      if (!r?.success) return;
      const name = path.split(/[\\/]/).pop();
      const ext = name.includes('.') ? name.split('.').pop() : '';
      dispatch({ type: 'OPEN_FILE', file: { path, name, extension: ext, content: r.data.content, dirty: false } });
      close();
    });
  };

  const purgeFile = (path) => {
    if (!confirm(`Clear inline-edit history for ${path.split(/[\\/]/).pop()}?`)) return;
    clearInlineEditHistory(path);
    setMap(loadAll());
    setSelectedPath(null);
  };

  const purgeAll = () => {
    if (!confirm('Clear ALL inline-edit history?')) return;
    clearInlineEditHistory();
    setMap({});
    setSelectedPath(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-4xl h-full max-h-[82vh] lorica-glass rounded-2xl shadow-[0_0_40px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <History size={14} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Inline AI Edit History</div>
          <div className="text-[10px] text-lorica-textDim">
            {Object.values(map).reduce((n, list) => n + list.length, 0)} edits across {files.length} file{files.length === 1 ? '' : 's'}
          </div>
          <div className="flex-1 flex items-center gap-2 mx-4">
            <Search size={11} className="text-lorica-textDim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter files…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-lorica-textDim/50"
            />
          </div>
          <button
            onClick={purgeAll}
            disabled={Object.keys(map).length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-lorica-textDim hover:text-red-400 disabled:opacity-30"
          >
            <Trash2 size={10} /> Clear all
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Files list */}
          <div className="w-64 border-r border-lorica-border overflow-y-auto shrink-0">
            {files.length === 0 && (
              <div className="p-4 text-[11px] text-lorica-textDim text-center">
                No inline-edit history yet. Use <kbd className="px-1 bg-lorica-bg border border-lorica-border rounded text-[9px]">Ctrl+K</kbd> on any selection to start.
              </div>
            )}
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelectedPath(f.path)}
                className={`w-full text-left px-3 py-1.5 border-b border-lorica-border/40 group ${
                  selectedPath === f.path ? 'bg-lorica-accent/10' : 'hover:bg-lorica-border/30'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <FileText size={11} className="text-lorica-textDim shrink-0" />
                  <span className={`text-[11px] font-medium truncate ${selectedPath === f.path ? 'text-lorica-accent' : 'text-lorica-text'}`}>{f.name}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[9px] text-lorica-textDim truncate flex-1">{f.path}</span>
                  <span className="text-[9px] text-lorica-textDim ml-1">{f.count} · {fmtAgo(f.last)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Entries for selected file */}
          <div className="flex-1 overflow-y-auto">
            {current.length === 0 && (
              <div className="p-6 text-center text-[11px] text-lorica-textDim">Pick a file to view its edits.</div>
            )}
            {current.length > 0 && (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <code className="text-[10px] text-lorica-accent font-mono truncate flex-1">{selectedPath}</code>
                  <button onClick={() => openFile(selectedPath)} className="text-[10px] text-lorica-textDim hover:text-lorica-accent px-2 py-0.5 rounded">
                    Open
                  </button>
                  <button onClick={() => purgeFile(selectedPath)} className="text-[10px] text-lorica-textDim hover:text-red-400 px-2 py-0.5 rounded">
                    <Trash2 size={10} />
                  </button>
                </div>
                {current.map((entry, i) => (
                  <div key={i} className="rounded-lg border border-lorica-border p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Clock size={11} className="text-lorica-textDim shrink-0 mt-0.5" />
                      <div className="text-[10px] text-lorica-textDim">{fmtAgo(entry.at)} ago</div>
                      <div className="flex-1 text-[11px] text-lorica-accent italic">{entry.instruction || '(no instruction recorded)'}</div>
                      <button
                        onClick={() => copyBefore(entry)}
                        className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent px-1.5 py-0.5 rounded"
                        title="Copy the original text to clipboard"
                      >
                        <Copy size={9} /> Revert
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                      <div className="rounded border border-red-400/30 bg-red-400/5 p-2 max-h-28 overflow-y-auto text-red-300 whitespace-pre-wrap">
                        {entry.before || '(empty)'}
                      </div>
                      <div className="rounded border border-emerald-400/30 bg-emerald-400/5 p-2 max-h-28 overflow-y-auto text-emerald-300 whitespace-pre-wrap">
                        {entry.after || '(empty)'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
