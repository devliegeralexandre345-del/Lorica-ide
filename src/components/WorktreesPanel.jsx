// src/components/WorktreesPanel.jsx
//
// Standalone git-worktree manager. SwarmPanel already creates worktrees
// when `useWorktrees` is on, but those are scoped to a single swarm run
// and disappear on cleanup. This panel is the user-facing "what
// worktrees exist on this repo right now" view — adds / removes /
// merges / opens any of them, including ones created from outside
// Lorica. The roadmap calls this Wave 6's "background task on a branch"
// pattern (V2.3_ROADMAP.md, "Agent worktree / 'background task on a
// branch'" row).
//
// Backend talks to `cmd_git_worktree_status` for the rich rows
// (dirty-count, ahead/behind) and the existing add/remove/merge
// commands shared with SwarmPanel.

import React, { useEffect, useState, useCallback } from 'react';
import {
  X, Plus, Trash2, GitMerge, FolderOpen, RefreshCw, GitBranch,
  Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';

export default function WorktreesPanel({ state, dispatch, onSwitchProject }) {
  const [worktrees, setWorktrees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [mergeResult, setMergeResult] = useState(null);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showWorktrees', value: false });

  const refresh = useCallback(async () => {
    if (!state.projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const r = await window.lorica.git.worktreeStatus(state.projectPath);
      if (r?.success) setWorktrees(Array.isArray(r.data) ? r.data : []);
      else setError(r?.error || 'Failed to read worktrees');
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [state.projectPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const addWorktree = async () => {
    const branch = newBranch.trim();
    if (!branch || !state.projectPath) return;
    setBusyId('__new__');
    try {
      const r = await window.lorica.git.worktreeAdd(state.projectPath, branch);
      if (r?.success) {
        setNewBranch('');
        setAdding(false);
        await refresh();
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Worktree "${branch}" created`, duration: 2500 } });
      } else {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: r?.error || 'Worktree add failed', duration: 4000 } });
      }
    } finally {
      setBusyId(null);
    }
  };

  const removeWorktree = async (wt, force) => {
    if (wt.isMain) return;
    if (wt.isDirty && !force) {
      const ok = window.confirm(`Worktree "${wt.branch}" has ${wt.modifiedCount} uncommitted change${wt.modifiedCount === 1 ? '' : 's'}. Force remove anyway?`);
      if (!ok) return;
      force = true;
    }
    setBusyId(wt.path);
    try {
      const r = await window.lorica.git.worktreeRemove(state.projectPath, wt.path, !!force);
      if (r?.success) {
        await refresh();
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Removed worktree "${wt.branch}"`, duration: 2000 } });
      } else {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: r?.error || 'Remove failed', duration: 4000 } });
      }
    } finally {
      setBusyId(null);
    }
  };

  const mergeWorktree = async (wt) => {
    if (wt.isMain) return;
    setBusyId(wt.path);
    setMergeResult(null);
    try {
      const r = await window.lorica.git.worktreeMerge(state.projectPath, [wt.branch]);
      if (r?.success && Array.isArray(r.data)) {
        const result = r.data[0];
        setMergeResult(result);
        if (result?.ok) {
          dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Merged "${wt.branch}"`, duration: 2500 } });
        } else {
          dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: `Merge of "${wt.branch}" had conflicts (${result?.conflicts?.length || 0} files)`, duration: 5000 } });
        }
        await refresh();
      } else {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: r?.error || 'Merge failed', duration: 4000 } });
      }
    } finally {
      setBusyId(null);
    }
  };

  const openInProject = (wt) => {
    if (!wt.path) return;
    if (typeof onSwitchProject === 'function') {
      onSwitchProject(wt.path);
      close();
    } else {
      // Fallback: ask the file system hook to open the worktree directly.
      // App's useFileSystem normally handles this via its `openProject`.
      try {
        dispatch({ type: 'SET_PROJECT_PATH', path: wt.path });
        dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: `Switched to ${wt.path}`, duration: 2000 } });
        close();
      } catch {}
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.15)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <GitBranch size={15} className="text-emerald-400" />
          <div className="text-sm font-semibold text-lorica-text">Git worktrees</div>
          <div className="text-[10px] text-lorica-textDim">Background tasks on a branch — isolated working copies sharing the same .git store.</div>
          <div className="flex-1" />
          <button onClick={refresh} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!state.projectPath ? (
            <div className="text-center py-10 text-xs text-lorica-textDim">Open a project to manage worktrees.</div>
          ) : worktrees.length === 0 && !loading ? (
            <div className="text-center py-10 text-xs text-lorica-textDim">No worktrees yet. Add one to start a parallel branch.</div>
          ) : (
            <div className="space-y-2">
              {worktrees.map((wt) => {
                const busy = busyId === wt.path;
                return (
                  <div key={wt.path} className="rounded-lg border border-lorica-border bg-lorica-bg/40 p-3">
                    <div className="flex items-center gap-2">
                      <GitBranch size={12} className="text-emerald-400 shrink-0" />
                      <div className="font-mono text-[12px] font-semibold text-lorica-text truncate">{wt.branch}</div>
                      {wt.isMain && (
                        <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-lorica-accent/20 text-lorica-accent border border-lorica-accent/40">main</span>
                      )}
                      {wt.isDetached && (
                        <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40">detached</span>
                      )}
                      <div className="flex-1" />
                      <div className="flex items-center gap-2 text-[10px] text-lorica-textDim">
                        {wt.modifiedCount > 0 && <span className="text-amber-300">{wt.modifiedCount} modified</span>}
                        {wt.ahead > 0 && <span>↑{wt.ahead}</span>}
                        {wt.behind > 0 && <span>↓{wt.behind}</span>}
                        <span className="font-mono">{wt.head?.slice(0, 7)}</span>
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-lorica-textDim font-mono truncate" title={wt.path}>{wt.path}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => openInProject(wt)}
                        disabled={busy}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-lorica-accent/15 border border-lorica-accent/40 text-[10px] text-lorica-accent hover:bg-lorica-accent/25 disabled:opacity-40"
                        title="Open this worktree as the active project"
                      >
                        <FolderOpen size={10} />
                        Open
                      </button>
                      {!wt.isMain && (
                        <>
                          <button
                            onClick={() => mergeWorktree(wt)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-400/15 border border-emerald-400/40 text-[10px] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
                            title="Merge this branch into the current branch (in main worktree)"
                          >
                            {busy ? <Loader2 size={10} className="animate-spin" /> : <GitMerge size={10} />}
                            Merge
                          </button>
                          <button
                            onClick={() => removeWorktree(wt, false)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-red-400/15 border border-red-400/40 text-[10px] text-red-300 hover:bg-red-400/25 disabled:opacity-40"
                            title={wt.isDirty ? 'Worktree has uncommitted changes — confirms before forcing' : 'Remove this worktree'}
                          >
                            <Trash2 size={10} />
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {mergeResult && (
            <div className={`mt-3 p-3 rounded-lg border text-[11px] ${mergeResult.ok ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/40 bg-amber-400/10 text-amber-200'}`}>
              <div className="flex items-center gap-2 font-semibold mb-1">
                {mergeResult.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                Merge of <span className="font-mono">{mergeResult.branch}</span>: {mergeResult.ok ? 'OK' : 'Conflicts'}
              </div>
              <div className="text-[10px] text-lorica-textDim">{mergeResult.message}</div>
              {!mergeResult.ok && mergeResult.conflicts?.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-[10px] font-mono">
                  {mergeResult.conflicts.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-lorica-border px-4 py-3 shrink-0">
          {!adding ? (
            <button
              onClick={() => { setAdding(true); setNewBranch(''); }}
              disabled={!state.projectPath}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-400/15 border border-emerald-400/40 text-[11px] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
            >
              <Plus size={11} />
              New worktree
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addWorktree();
                  if (e.key === 'Escape') setAdding(false);
                }}
                placeholder="branch-name (e.g. feat/login)"
                className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[12px] text-lorica-text font-mono outline-none focus:border-emerald-400/50"
              />
              <button
                onClick={addWorktree}
                disabled={!newBranch.trim() || busyId === '__new__'}
                className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-400/20 border border-emerald-400/50 text-[11px] text-emerald-300 hover:bg-emerald-400/30 disabled:opacity-40"
              >
                {busyId === '__new__' ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                Create
              </button>
              <button
                onClick={() => setAdding(false)}
                className="px-2 py-1 rounded text-[11px] text-lorica-textDim hover:bg-lorica-border/40"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
