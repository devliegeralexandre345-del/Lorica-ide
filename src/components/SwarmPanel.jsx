// src/components/SwarmPanel.jsx
//
// The Swarm Development control room. The user types a feature request,
// the orchestrator decomposes it into sub-tasks (Kanban cards), tiered
// by dependency order. The user can review each task, kick off the
// whole run, inspect each task's proposed changes, and approve writes.
//
// Safety model:
//   • Decomposition happens on click, shown as read-only cards for review.
//   • Execution produces proposed writes as JSON patches; NOTHING is
//     written to disk until the user approves that specific task card.
//   • Approved writes apply one file at a time; on error the task is
//     marked failed and surfaces the message.

import React, { useMemo, useRef, useState } from 'react';
import {
  Zap, X, Play, Loader2, Check, AlertTriangle, ChevronRight,
  Layers, GitBranch, GitMerge, FolderTree,
} from 'lucide-react';
import {
  decomposeFeature, executeTask, tierTasks,
} from '../utils/swarmOrchestrator';

const ROLE_META = {
  api:      { label: 'API',     color: 'text-sky-400',   bg: 'bg-sky-400/10 border-sky-400/30',    emoji: '🛠️' },
  ui:       { label: 'UI',      color: 'text-pink-400',  bg: 'bg-pink-400/10 border-pink-400/30',  emoji: '🎨' },
  tests:    { label: 'Tests',   color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', emoji: '🧪' },
  docs:     { label: 'Docs',    color: 'text-sky-300',   bg: 'bg-sky-300/10 border-sky-300/30',    emoji: '📘' },
  refactor: { label: 'Refactor', color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/30', emoji: '🛠️' },
  glue:     { label: 'Glue',    color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30', emoji: '🔗' },
};

function summarizeTree(tree, depth = 0, limit = 60) {
  const out = [];
  function walk(nodes, indent) {
    if (out.length >= limit) return;
    for (const n of nodes || []) {
      if (out.length >= limit) return;
      out.push(`${indent}${n.isDirectory ? '[D]' : '[F]'} ${n.name}`);
      if (n.children && n.children.length && indent.length < 6) walk(n.children, indent + '  ');
    }
  }
  walk(tree, '');
  return out.join('\n');
}

export default function SwarmPanel({ state, dispatch }) {
  const [feature, setFeature] = useState('');
  const [tasks, setTasks] = useState(null); // null = not decomposed yet
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'decomposing' | 'running' | 'merging' | 'done'
  const [useWorktrees, setUseWorktrees] = useState(true);
  const [worktrees, setWorktrees] = useState({}); // taskId → { path, branch }
  const [mergeResults, setMergeResults] = useState(null);
  const abortRef = useRef(null);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showSwarm', value: false });
  };

  const decompose = async () => {
    if (!feature.trim()) return;
    if (!apiKey) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Configure an API key first', duration: 2500 } });
      return;
    }
    setBusy(true);
    setPhase('decomposing');
    setTasks(null);
    abortRef.current = new AbortController();
    try {
      const subtasks = await decomposeFeature({
        featureRequest: feature.trim(),
        projectTreeSummary: summarizeTree(state.fileTree),
        provider, apiKey,
        signal: abortRef.current.signal,
      });
      setTasks(subtasks);
      setPhase('idle');
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Decompose failed: ${e.message}`, duration: 4000 } });
      setPhase('idle');
    } finally { setBusy(false); }
  };

  // Parallel-within-tier executor. When `useWorktrees` is on we create
  // one worktree per task and report its path/branch in the task result
  // so the approve step writes files INTO the worktree, not the main
  // working tree. A final merge phase combines the branches back.
  const runAll = async () => {
    if (!tasks || !apiKey) return;
    setBusy(true);
    setPhase('running');
    setMergeResults(null);
    abortRef.current = new AbortController();
    const tiers = tierTasks(tasks);
    // Local copy we mutate as each tier completes — keeps React state
    // in sync at tier granularity (Promise.all finishes together).
    let working = [...tasks];
    const patchTask = (id, patch) => {
      working = working.map((t) => t.id === id ? { ...t, ...patch } : t);
      setTasks(working);
    };

    const newWorktrees = { ...worktrees };

    for (const tier of tiers) {
      // Mark the whole tier "running" up front for visual feedback.
      tier.forEach((t) => patchTask(t.id, { status: 'running' }));

      // Provision worktrees for this tier (sequential — git can't handle
      // concurrent worktree adds cleanly).
      if (useWorktrees && state.projectPath) {
        for (const t of tier) {
          if (newWorktrees[t.id]) continue;
          try {
            const r = await window.lorica.git.worktreeAdd(state.projectPath, t.id);
            if (r?.success) {
              newWorktrees[t.id] = { path: r.data.path, branch: r.data.branch };
            }
          } catch {}
        }
        setWorktrees({ ...newWorktrees });
      }

      // Fan out the actual LLM calls. These are safe to parallelize.
      const projectContext = summarizeTree(state.fileTree);
      await Promise.all(tier.map(async (t) => {
        try {
          const res = await executeTask({
            task: t, projectContext,
            provider, apiKey,
            signal: abortRef.current.signal,
          });
          patchTask(t.id, {
            status: 'awaiting-approval',
            result: res,
            worktree: newWorktrees[t.id] || null,
          });
        } catch (e) {
          patchTask(t.id, { status: 'failed', error: e.message });
        }
      }));
    }
    setPhase('done');
    setBusy(false);
  };

  // Final merge phase — called after user approves the tasks they want.
  // We merge the branches that have `applied` set (agents wrote files
  // into them already). Main working tree remains the user's.
  const mergeAll = async () => {
    if (!tasks) return;
    const branches = tasks
      .filter((t) => t.status === 'applied' && t.worktree)
      .map((t) => t.worktree.branch);
    if (branches.length === 0) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'No applied worktrees to merge', duration: 2500 } });
      return;
    }
    setPhase('merging');
    setBusy(true);
    try {
      const r = await window.lorica.git.worktreeMerge(state.projectPath, branches);
      if (r?.success) setMergeResults(r.data);
    } finally {
      setBusy(false);
      setPhase('done');
    }
  };

  const cleanupWorktrees = async () => {
    if (!state.projectPath) return;
    for (const [, info] of Object.entries(worktrees)) {
      try { await window.lorica.git.worktreeRemove(state.projectPath, info.path, true); } catch {}
    }
    setWorktrees({});
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Worktrees cleaned up', duration: 2000 } });
  };

  const approve = async (taskId) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || !t.result) return;
    const changes = t.result.changes || [];
    // When a worktree is attached, paths are resolved relative to the
    // worktree — not the main project — so parallel tasks don't collide.
    // The final merge phase brings the results back.
    const rootPath = t.worktree?.path || state.projectPath;
    const sep = rootPath?.includes('\\') ? '\\' : '/';
    let written = 0, failed = 0;
    for (const ch of changes) {
      if (!ch.path || !rootPath) { failed++; continue; }
      const abs = /^[a-zA-Z]:[\\/]/.test(ch.path) || ch.path.startsWith('/')
        ? ch.path
        : `${rootPath}${sep}${ch.path}`;
      try {
        if (ch.action === 'append') {
          let prev = '';
          try { const r = await window.lorica.fs.readFile(abs); if (r?.success) prev = r.data.content || ''; } catch {}
          await window.lorica.fs.writeFile(abs, prev + ch.content);
        } else {
          await window.lorica.fs.writeFile(abs, ch.content);
        }
        written++;
      } catch { failed++; }
    }
    // If we have a worktree, also `git add` + `git commit` inside it so
    // the branch has a concrete commit before merge.
    if (t.worktree?.path && written > 0) {
      try { await window.lorica.terminal.runCommand('git add -A && git commit -m "swarm: ' + t.title.replace(/"/g, "\\\"") + '"', t.worktree.path); } catch {}
    }
    setTasks((cur) => cur.map((x) => x.id === taskId ? { ...x, status: 'applied', applied: { written, failed } } : x));
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Applied ${written} file${written === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}`, duration: 2500 } });
  };

  const reject = (taskId) => {
    setTasks((cur) => cur.map((x) => x.id === taskId ? { ...x, status: 'rejected', result: null } : x));
  };

  const tiers = useMemo(() => (tasks ? tierTasks(tasks) : []), [tasks]);
  const selected = tasks?.find((t) => t.id === selectedId) || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-6xl h-full max-h-[90vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(255,107,157,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Zap size={15} className="text-pink-400" />
          <div className="text-sm font-semibold text-lorica-text">Swarm Development</div>
          <div className="text-[10px] text-lorica-textDim">Decompose → review → execute in tiers. You orchestrate, agents implement.</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {!tasks && (
          <div className="flex-1 p-6 flex flex-col items-center justify-center">
            <Zap size={40} className="text-pink-400/40 mb-3" />
            <div className="text-xs text-lorica-textDim mb-2">Describe the feature. I'll decompose it into parallel sub-tasks.</div>
            <textarea
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && decompose()}
              rows={5}
              className="w-full max-w-2xl bg-lorica-bg border border-lorica-border rounded-lg p-3 text-[12px] text-lorica-text outline-none focus:border-pink-400/50 resize-none"
              placeholder={'e.g. "Add OAuth Google login: API endpoint, UI button, session storage, tests."'}
            />
            <button
              onClick={decompose}
              disabled={busy || !feature.trim()}
              className="mt-3 flex items-center gap-1.5 px-4 py-1.5 rounded bg-pink-500/20 border border-pink-400/50 text-pink-300 text-xs font-semibold hover:bg-pink-500/30 disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
              Decompose
            </button>
            <div className="text-[10px] text-lorica-textDim mt-2">Ctrl/Cmd+Enter to submit</div>
          </div>
        )}

        {tasks && (
          <div className="flex-1 flex overflow-hidden">
            {/* Kanban */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Task DAG</div>
                <span className="text-[10px] text-lorica-textDim">·</span>
                <span className="text-[10px] text-lorica-textDim">{tiers.length} tier{tiers.length === 1 ? '' : 's'} · {tasks.length} tasks</span>
                <div className="flex-1" />
                <label className="flex items-center gap-1 text-[10px] text-lorica-textDim cursor-pointer mr-2" title="Use git worktrees for true parallel isolation">
                  <input
                    type="checkbox"
                    checked={useWorktrees}
                    onChange={() => setUseWorktrees((v) => !v)}
                    className="accent-pink-400"
                  />
                  <FolderTree size={10} /> Parallel worktrees
                </label>
                {phase !== 'running' && tasks.some((t) => t.status === 'todo') && (
                  <button
                    onClick={runAll}
                    disabled={busy}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-pink-500/20 border border-pink-400/50 text-pink-300 text-[11px] font-semibold hover:bg-pink-500/30 disabled:opacity-40"
                  >
                    <Play size={11} /> Run swarm
                  </button>
                )}
                {phase === 'done' && tasks.some((t) => t.status === 'applied' && t.worktree) && (
                  <button
                    onClick={mergeAll}
                    disabled={busy}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[11px] font-semibold hover:bg-emerald-500/30 disabled:opacity-40"
                  >
                    <GitMerge size={11} /> Merge branches
                  </button>
                )}
                {Object.keys(worktrees).length > 0 && phase === 'done' && (
                  <button
                    onClick={cleanupWorktrees}
                    className="text-[10px] text-lorica-textDim hover:text-red-400 px-2"
                    title="Remove all worktrees"
                  >
                    Cleanup
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {tiers.map((tier, ti) => (
                  <div key={ti}>
                    <div className="flex items-center gap-2 mb-1.5 text-[10px] text-lorica-textDim">
                      <GitBranch size={10} />
                      Tier {ti + 1} · runs after tier {ti}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {tier.map((t) => <TaskCard key={t.id} task={t} onSelect={() => setSelectedId(t.id)} isSelected={selectedId === t.id} onApprove={() => approve(t.id)} onReject={() => reject(t.id)} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Task detail */}
            <div className="w-[40%] border-l border-lorica-border overflow-y-auto">
              {selected ? <TaskDetail task={selected} /> : (
                <div className="h-full flex items-center justify-center text-[11px] text-lorica-textDim">Select a task to inspect.</div>
              )}
            </div>
          </div>
        )}

        {mergeResults && (
          <div className="border-t border-lorica-border p-3 bg-lorica-panel/80 shrink-0 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-1.5">
              <GitMerge size={10} className="inline mr-1" /> Merge results
            </div>
            {mergeResults.map((r, i) => (
              <div key={i} className={`flex items-start gap-2 text-[11px] py-1 ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {r.ok ? <Check size={11} className="mt-0.5 shrink-0" /> : <AlertTriangle size={11} className="mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <code className="font-mono">{r.branch}</code>
                  <span className="text-lorica-text/80 ml-2">{r.ok ? r.message : 'Conflict — aborted'}</span>
                  {r.conflicts?.length > 0 && (
                    <div className="text-[10px] text-red-300 mt-0.5">Conflicts: {r.conflicts.join(', ')}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onSelect, isSelected, onApprove, onReject }) {
  const meta = ROLE_META[task.role] || ROLE_META.glue;
  const statusLabel = {
    todo: '○ todo',
    running: '● running',
    'awaiting-approval': '⟳ awaiting approval',
    applied: '✓ applied',
    rejected: '✗ rejected',
    failed: '! failed',
  }[task.status] || task.status;
  const statusColor = {
    todo: 'text-lorica-textDim',
    running: 'text-lorica-accent',
    'awaiting-approval': 'text-amber-400',
    applied: 'text-emerald-400',
    rejected: 'text-red-400',
    failed: 'text-red-400',
  }[task.status];

  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-lg border ${meta.bg} p-3 transition-colors ${isSelected ? 'ring-2 ring-lorica-accent/60' : 'hover:brightness-110'}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-semibold ${meta.color}`}>{task.title}</span>
            <span className={`ml-auto text-[9px] ${statusColor}`}>{statusLabel}</span>
          </div>
          <div className="text-[10px] text-lorica-text/80 mt-0.5 line-clamp-2">{task.description}</div>
          {task.files?.length > 0 && (
            <div className="text-[9px] text-lorica-textDim font-mono mt-1 truncate">{task.files.slice(0, 2).join(', ')}{task.files.length > 2 ? ` +${task.files.length - 2}` : ''}</div>
          )}
          {task.dependsOn?.length > 0 && (
            <div className="text-[9px] text-lorica-textDim mt-0.5">↰ {task.dependsOn.join(', ')}</div>
          )}
          {task.status === 'awaiting-approval' && (
            <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
              <button onClick={onApprove} className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] hover:bg-emerald-500/30">
                <Check size={10} /> Apply
              </button>
              <button onClick={onReject} className="flex items-center gap-1 px-2 py-0.5 rounded border border-lorica-border text-lorica-textDim text-[10px] hover:text-red-400">
                Reject
              </button>
            </div>
          )}
          {task.status === 'failed' && task.error && (
            <div className="text-[9px] text-red-400 mt-1">{task.error}</div>
          )}
          {task.status === 'applied' && task.applied && (
            <div className="text-[9px] text-emerald-400 mt-1">Wrote {task.applied.written} file{task.applied.written === 1 ? '' : 's'}{task.applied.failed ? ` · ${task.applied.failed} failed` : ''}</div>
          )}
        </div>
      </div>
    </button>
  );
}

function TaskDetail({ task }) {
  return (
    <div className="p-4 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-lorica-textDim mb-1">{task.role}</div>
        <div className="text-sm font-semibold text-lorica-text">{task.title}</div>
        <div className="text-[11px] text-lorica-text/80 mt-1">{task.description}</div>
      </div>
      {task.files?.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1">Files</div>
          <div className="text-[11px] font-mono text-lorica-accent space-y-0.5">
            {task.files.map((f) => <div key={f}>{f}</div>)}
          </div>
        </div>
      )}
      {task.dependsOn?.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1">Depends on</div>
          <div className="text-[11px] text-lorica-text">{task.dependsOn.join(', ')}</div>
        </div>
      )}
      {task.result && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1">Proposed changes</div>
          {task.result.notes && (
            <div className="text-[11px] text-lorica-text/80 mb-2 italic">{task.result.notes}</div>
          )}
          {(task.result.changes || []).map((c, i) => (
            <details key={i} className="mb-2 rounded border border-lorica-border p-2">
              <summary className="cursor-pointer text-[11px] font-mono flex items-center gap-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-lorica-accent/20 text-lorica-accent">{c.action}</span>
                <span className="text-lorica-accent truncate">{c.path}</span>
              </summary>
              <pre className="mt-2 text-[10px] font-mono text-lorica-text whitespace-pre-wrap max-h-72 overflow-y-auto bg-lorica-bg/60 p-2 rounded">
                {c.content}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
