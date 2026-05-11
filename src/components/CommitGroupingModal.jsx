// src/components/CommitGroupingModal.jsx
//
// Wave 65 — AI commit-grouping helper. On open we fetch the full
// diff (unstaged + staged combined) for the current project and ask
// the AI to propose splitting it into 1-5 atomic commits. The user
// reviews each group and can "Stage these files" → "Use as commit
// message" to drive the actual git commands, but we never rewrite
// the index automatically (too easy to get wrong silently).

import React, { useEffect, useRef, useState } from 'react';
import { GitCommit, X, Loader2, AlertTriangle, RefreshCw, Sparkles, FileText, Check } from 'lucide-react';
import { suggestCommitGroups } from '../utils/aiCommitGrouping';

export default function CommitGroupingModal({ state, dispatch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState(null);
  const [stagingIdx, setStagingIdx] = useState(null);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showCommitGrouping', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  const run = async () => {
    if (!state.projectPath) { setError('Open a project first.'); return; }
    setBusy(true);
    setError(null);
    setGroups(null);
    abortRef.current = new AbortController();
    try {
      // Concat unstaged + staged so the model sees the WHOLE set of
      // changes. Staged-only or unstaged-only would miss half the
      // story for users who pre-staged some files.
      const [u, s] = await Promise.all([
        window.lorica.git.diff(state.projectPath, null),
        window.lorica.git.diffStaged(state.projectPath, null),
      ]);
      const combined = [
        s?.success ? (s.data || '') : '',
        u?.success ? (u.data || '') : '',
      ].filter(Boolean).join('\n');
      if (!combined.trim()) {
        throw new Error('Nothing to commit — the working tree is clean.');
      }
      const out = await suggestCommitGroups({
        diff: combined,
        provider, apiKey,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
        ollamaBaseUrl: state.aiOllamaUrl,
        signal: abortRef.current.signal,
      });
      if (!out) throw new Error('AI returned unparseable output. Re-run or pre-stage the right files manually.');
      setGroups(out.groups);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Stage just this group's files via cmd_git_stage_files. Doesn't
  // unstage anything else — that's the user's job (and the panel
  // shows what's currently staged after this runs).
  const stageGroup = async (idx) => {
    const g = groups[idx];
    if (!g || !state.projectPath) return;
    setStagingIdx(idx);
    try {
      // No bulk-stage IPC — loop the per-file stage command. We stop on
      // first failure so the user sees a specific error rather than
      // half-staged state with no signal.
      for (const f of g.files) {
        const r = await window.lorica.git.stage(state.projectPath, f);
        if (!r?.success) {
          throw new Error(r?.error || `Stage failed for ${f}`);
        }
      }
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Staged ${g.files.length} file${g.files.length === 1 ? '' : 's'} for group ${idx + 1}`, duration: 2500 } });
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: e?.message || String(e), duration: 4000 } });
    } finally {
      setStagingIdx(null);
    }
  };

  const useAsMessage = (g) => {
    const text = g.body ? `${g.subject}\n\n${g.body}` : g.subject;
    // GitPanel reads this via a listener we ship next to its draft
    // commit listener — same surface as Wave 50.
    window.dispatchEvent(new CustomEvent('lorica:setCommitMessage', { detail: { text } }));
    dispatch({ type: 'SET_PANEL', panel: 'showGit', value: true });
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Commit message copied into GitPanel', duration: 2200 } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(99,102,241,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <GitCommit size={15} className="text-indigo-400" />
          <div className="text-sm font-semibold text-lorica-text">AI commit grouping</div>
          <div className="text-[10px] text-lorica-textDim">Suggest atomic commits to split your working tree into.</div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Re-run
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {busy && !groups && (
          <div className="px-5 py-4 flex items-center gap-2 text-[11px] text-lorica-textDim">
            <Loader2 size={12} className="animate-spin text-indigo-400" />
            Reading diff and asking the model to group it…
          </div>
        )}
        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        {groups && (
          <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
            {groups.map((g, i) => (
              <div key={i} className="rounded-lg border border-lorica-border bg-lorica-bg/40 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold">Group {i + 1}</div>
                  <div className="font-mono text-[12px] text-lorica-text truncate">{g.subject}</div>
                </div>
                {g.rationale && (
                  <div className="text-[11px] italic text-lorica-textDim mb-2">
                    <Sparkles size={9} className="inline mr-1" />
                    {g.rationale}
                  </div>
                )}
                {g.body && (
                  <pre className="text-[11px] font-mono text-lorica-text whitespace-pre-wrap mb-2 max-h-32 overflow-auto">
                    {g.body}
                  </pre>
                )}
                <ul className="text-[10px] font-mono text-lorica-textDim space-y-0.5 mb-3 max-h-32 overflow-auto">
                  {g.files.map((f) => (
                    <li key={f} className="flex items-center gap-1">
                      <FileText size={9} />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => stageGroup(i)}
                    disabled={stagingIdx === i}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-400/15 border border-indigo-400/40 text-[10px] text-indigo-200 hover:bg-indigo-400/25 disabled:opacity-40"
                  >
                    {stagingIdx === i ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                    Stage these files
                  </button>
                  <button
                    onClick={() => useAsMessage(g)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-400/15 border border-emerald-400/40 text-[10px] text-emerald-200 hover:bg-emerald-400/25"
                  >
                    Use as commit message
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
