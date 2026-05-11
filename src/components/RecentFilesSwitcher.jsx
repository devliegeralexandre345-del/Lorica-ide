// src/components/RecentFilesSwitcher.jsx
//
// Wave 49 — Ctrl+E quick-switch. Like FilePalette but scoped to
// currently-open files plus recently-closed ones from this project's
// localStorage history. No project file scan, so it opens instantly
// regardless of repo size. Activates a file by:
//   - clicking it, or
//   - keyboard nav (↑/↓/Enter), or
//   - typing a filename fragment and pressing Enter.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileCode, Clock, FolderOpen } from 'lucide-react';
import { loadRecentFiles, mergeOpenAndRecent } from '../utils/recentFiles';

export default function RecentFilesSwitcher({ state, dispatch, onFileOpen }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const entries = useMemo(() => {
    const recent = loadRecentFiles(state.projectPath);
    return mergeOpenAndRecent(state.openFiles, recent);
  }, [state.projectPath, state.openFiles]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.path || '').toLowerCase().includes(q)
    );
  }, [entries, query]);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showRecentFiles', value: false });

  const pick = (entry) => {
    close();
    // Open files already in the tab strip → switch via index.
    if (entry.open) {
      const idx = state.openFiles.findIndex((f) => f.path === entry.path);
      if (idx >= 0) {
        dispatch({ type: 'SET_ACTIVE_FILE', index: idx });
        return;
      }
    }
    // Recently-closed → re-open from disk.
    if (typeof onFileOpen === 'function' && entry.path) {
      onFileOpen(entry.path);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered.length > 0) {
      pick(filtered[Math.min(selectedIdx, filtered.length - 1)]);
    }
  };

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => {
    if (listRef.current?.children[selectedIdx]) {
      listRef.current.children[selectedIdx].scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" onClick={close}>
      <div className="w-[500px] bg-lorica-panel border border-lorica-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-lorica-border">
          <Clock size={16} className="text-lorica-accent" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Recent files — type to filter…"
            className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/50"
          />
          <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px] text-lorica-textDim font-mono">Ctrl+E</kbd>
        </div>

        <div ref={listRef} className="max-h-[380px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-lorica-textDim">
              <FolderOpen size={20} className="mx-auto mb-2 opacity-40" />
              {entries.length === 0
                ? 'No recent files yet — open a file to start the history.'
                : 'No matches.'}
            </div>
          ) : (
            filtered.map((entry, i) => (
              <button
                key={entry.path}
                className={`w-full flex items-center gap-3 px-4 py-1.5 text-xs transition-colors ${
                  i === selectedIdx ? 'bg-lorica-accent/15 text-lorica-accent' : 'text-lorica-text hover:bg-lorica-accent/10'
                }`}
                onClick={() => pick(entry)}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <FileCode size={14} className="opacity-50 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium truncate">{entry.name}</div>
                  <div className="text-[10px] text-lorica-textDim truncate">{entry.path}</div>
                </div>
                {entry.open ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-lorica-accent/20 text-lorica-accent flex-shrink-0">open</span>
                ) : (
                  <span className="text-[9px] text-lorica-textDim/50 flex-shrink-0">{entry.extension || ''}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
