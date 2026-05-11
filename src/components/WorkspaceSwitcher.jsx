// src/components/WorkspaceSwitcher.jsx
//
// Wave 43 — quick-jump panel listing recently-opened projects. Click
// to switch the active project root; the WelcomeTab + useFileSystem
// + useAnnotations + useDevContainer all swap into the new context
// because they key on `state.projectPath`.
//
// Lives as a modal because we already crowd the dock with feature
// icons and an extra always-visible panel didn't earn its real estate.
// Trigger: Cmd+Shift+W (added below) or the command palette.

import React, { useState, useMemo, useEffect } from 'react';
import {
  X, FolderOpen, Clock, Trash2, Search, Plus, ArrowRight,
} from 'lucide-react';
import { loadRecentProjects, removeRecentProject } from '../utils/recentProjects';

function fmtAge(ms) {
  if (!ms) return '';
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

export default function WorkspaceSwitcher({ state, dispatch, onOpen, onOpenFolder }) {
  const [recent, setRecent] = useState(() => loadRecentProjects());
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showWorkspaceSwitcher', value: false });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((r) =>
      r.path.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [recent, filter]);

  // Reset highlight whenever the filtered list changes — picking the
  // first match by default is the keyboard-friendly behaviour.
  useEffect(() => { setHighlight(0); }, [filter, recent.length]);

  const refresh = () => setRecent(loadRecentProjects());

  const handleOpen = async (entry) => {
    if (!entry?.path) return;
    if (entry.path === state.projectPath) {
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'info', message: 'Already on that project', duration: 1500 },
      });
      close();
      return;
    }
    if (typeof onOpen === 'function') {
      try {
        await onOpen(entry.path);
        dispatch({
          type: 'ADD_TOAST',
          toast: { type: 'success', message: `Switched to ${entry.name}`, duration: 2000 },
        });
      } catch (e) {
        dispatch({
          type: 'ADD_TOAST',
          toast: { type: 'error', message: `Failed to open: ${e?.message || e}`, duration: 3500 },
        });
        return;
      }
    }
    close();
  };

  const handleForget = (path, e) => {
    e.stopPropagation();
    removeRecentProject(path);
    refresh();
  };

  const handleOpenFolder = async () => {
    if (typeof onOpenFolder === 'function') {
      try { await onOpenFolder(); } catch {}
    }
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={close}
    >
      <div
        className="w-full max-w-xl lorica-glass rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.18)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-lorica-border shrink-0">
          <FolderOpen size={14} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Switch workspace</div>
          <div className="text-[10px] text-lorica-textDim">
            {recent.length} recent · pick or open a new folder
          </div>
          <div className="flex-1" />
          <button onClick={close} className="p-1 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={13} />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-lorica-border flex items-center gap-2">
          <Search size={12} className="text-lorica-textDim" />
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[highlight]) handleOpen(filtered[highlight]);
                else if (filter.trim() === '') handleOpenFolder();
              } else if (e.key === 'Escape') {
                close();
              }
            }}
            placeholder="Filter by name or path…"
            className="flex-1 bg-transparent text-xs text-lorica-text outline-none placeholder:text-lorica-textDim/50"
          />
          <button
            onClick={handleOpenFolder}
            title="Open a folder not in the list"
            className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent"
          >
            <Plus size={11} />
            Open folder…
          </button>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[420px]">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-[11px] text-lorica-textDim">
              {recent.length === 0 ? (
                <>No recent projects yet. <button onClick={handleOpenFolder} className="text-lorica-accent hover:underline">Open a folder</button> to begin.</>
              ) : (
                'No recent project matches that filter.'
              )}
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((r, i) => {
                const isActive = r.path === state.projectPath;
                const isHighlighted = i === highlight;
                return (
                  <li
                    key={r.path}
                    onClick={() => handleOpen(r)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`group px-3 py-2 cursor-pointer flex items-center gap-3 transition-colors ${
                      isHighlighted
                        ? 'bg-lorica-accent/15 text-lorica-text'
                        : 'hover:bg-lorica-border/20 text-lorica-text'
                    }`}
                  >
                    <FolderOpen size={12} className={isActive ? 'text-lorica-accent' : 'text-lorica-textDim'} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold flex items-center gap-2">
                        {r.name}
                        {isActive && (
                          <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-lorica-accent/20 text-lorica-accent border border-lorica-accent/40">
                            active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-lorica-textDim font-mono truncate" title={r.path}>
                        {r.path}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-lorica-textDim">
                      <Clock size={10} />
                      {fmtAge(r.at)}
                    </div>
                    <button
                      onClick={(e) => handleForget(r.path, e)}
                      title="Remove from recents"
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-lorica-textDim hover:text-red-300 hover:bg-red-400/15"
                    >
                      <Trash2 size={10} />
                    </button>
                    {isHighlighted && !isActive && (
                      <ArrowRight size={10} className="text-lorica-accent" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-3 py-2 border-t border-lorica-border text-[9px] text-lorica-textDim flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border">↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border">Enter</kbd> open</span>
          <span><kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
