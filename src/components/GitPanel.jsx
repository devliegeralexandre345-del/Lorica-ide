// src/components/GitPanel.jsx
//
// Performance-oriented rewrite:
//   • Single consolidated `git.summary` call (status + log + branches run
//     concurrently on the Rust side).
//   • Optimistic UI for stage/unstage/discard — local state updates
//     immediately, real refresh happens in the background.
//   • Debounced refresh coalesces rapid successive clicks into one call.
//   • FileRow memoized with React.memo to avoid re-rendering the whole list
//     when a single file changes.
//   • Stale data stays visible during refresh (no empty-state flicker).
//   • Log + branches are only fetched when their sections are expanded.

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  GitBranch, GitCommit, GitPullRequest, Plus, Minus, Check, X, RefreshCw,
  Upload, Download, RotateCcw, ChevronDown, ChevronRight,
  Sparkles, Loader2,
} from 'lucide-react';
import { generateCommitMessage } from '../utils/aiCommitMessage';
import PrDescriptionModal from './PrDescriptionModal';

const REFRESH_DEBOUNCE_MS = 120;

const statusColor = (status) => {
  switch (status) {
    case 'M': return 'text-amber-400';
    case 'A':
    case '?': return 'text-green-400';
    case 'D': return 'text-red-400';
    case 'R': return 'text-blue-400';
    default:  return 'text-lorica-textDim';
  }
};

const basename = (p) => (p || '').split(/[/\\]/).pop();

// ------------------------------------------------------------------
// Memoized file row — key bit of the perf fix. Without React.memo, a
// single optimistic state update re-renders every row in the list.
// ------------------------------------------------------------------
const FileRow = memo(function FileRow({ file, staged, onStage, onUnstage, onDiscard }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs hover:bg-lorica-panel/40 group">
      <span className={`text-[10px] font-mono w-3 ${statusColor(file.status)}`}>{file.status}</span>
      <span
        className={`flex-1 truncate ${staged ? 'text-lorica-text' : 'text-lorica-textDim group-hover:text-lorica-text'}`}
        title={file.path}
      >
        {basename(file.path)}
      </span>
      {staged ? (
        <button
          onClick={() => onUnstage(file.path)}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-lorica-textDim hover:text-amber-400"
          title="Unstage"
        >
          <Minus size={12} />
        </button>
      ) : (
        <>
          <button
            onClick={() => onStage(file.path)}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-lorica-textDim hover:text-green-400"
            title="Stage"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => onDiscard(file.path)}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-lorica-textDim hover:text-red-400"
            title="Discard"
          >
            <RotateCcw size={12} />
          </button>
        </>
      )}
    </div>
  );
});

export default function GitPanel({ state, dispatch }) {
  const [gitStatus, setGitStatus] = useState(null);
  const [gitLog, setGitLog] = useState([]);
  const [branches, setBranches] = useState([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // background indicator only
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [showPrModal, setShowPrModal] = useState(false);
  // When commit fails because git user.name/user.email aren't set, we
  // open an inline form instead of dumping the raw git error in a toast.
  const [authorPrompt, setAuthorPrompt] = useState(null); // null | { name, email, pendingMsg }
  const generateAbortRef = useRef(null);

  // Refs for debouncing + single-flight + stale-close protection
  const debounceTimerRef = useRef(null);
  const inflightRef = useRef(false);
  const pendingAnotherRef = useRef(false);
  const mountedRef = useRef(true);
  const showLogRef = useRef(showLog);
  const showBranchesRef = useRef(showBranches);

  useEffect(() => { showLogRef.current = showLog; }, [showLog]);
  useEffect(() => { showBranchesRef.current = showBranches; }, [showBranches]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  // ----------------------------------------------------------------
  // Core refresh — single IPC call, status+log+branches in parallel.
  // Only fetches log/branches if their accordions are open.
  // ----------------------------------------------------------------
  const doRefresh = useCallback(async () => {
    if (!state.projectPath) return;
    if (inflightRef.current) {
      // A refresh is already running — mark that we want another one after.
      pendingAnotherRef.current = true;
      return;
    }
    inflightRef.current = true;
    setRefreshing(true);

    try {
      const res = await window.lorica.git.summary(state.projectPath, {
        logCount: 20,
        includeLog: showLogRef.current,
        includeBranches: showBranchesRef.current,
      });
      if (!mountedRef.current) return;

      const payload = res?.data || res;
      if (payload && typeof payload === 'object' && 'status' in payload) {
        setGitStatus(payload.status);
        if (showLogRef.current) setGitLog(payload.log || []);
        if (showBranchesRef.current) setBranches(payload.branches || []);
      }
    } catch (e) {
      console.error('[GitPanel] refresh failed:', e);
    } finally {
      inflightRef.current = false;
      if (mountedRef.current) {
        setRefreshing(false);
        setHasLoadedOnce(true);
      }
      // If something requested another refresh while we were running, do it.
      if (pendingAnotherRef.current) {
        pendingAnotherRef.current = false;
        scheduleRefresh();
      }
    }
  }, [state.projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced scheduler — collapses bursts of calls into one.
  const scheduleRefresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      doRefresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [doRefresh]);

  // Initial load + when project changes.
  useEffect(() => {
    setHasLoadedOnce(false);
    setGitStatus(null);
    setGitLog([]);
    setBranches([]);
    doRefresh();
  }, [state.projectPath, doRefresh]);

  // Reload log/branches when their sections get toggled open (they may
  // not have been fetched yet).
  useEffect(() => {
    if (showLog && gitStatus?.is_repo && gitLog.length === 0) scheduleRefresh();
  }, [showLog]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (showBranches && gitStatus?.is_repo && branches.length === 0) scheduleRefresh();
  }, [showBranches]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----------------------------------------------------------------
  // Optimistic mutators — update local state immediately so the UI
  // feels instant, then kick off a background refresh to reconcile.
  // ----------------------------------------------------------------
  const applyOptimistic = useCallback((mutator) => {
    setGitStatus((prev) => {
      if (!prev) return prev;
      const files = mutator(prev.files);
      return { ...prev, files };
    });
  }, []);

  const handleStage = useCallback(async (filePath) => {
    applyOptimistic((files) =>
      files.map((f) => (f.path === filePath ? { ...f, staged: true } : f))
    );
    await window.lorica.git.stage(state.projectPath, filePath);
    scheduleRefresh();
  }, [state.projectPath, applyOptimistic, scheduleRefresh]);

  const handleUnstage = useCallback(async (filePath) => {
    applyOptimistic((files) =>
      files.map((f) => (f.path === filePath ? { ...f, staged: false } : f))
    );
    await window.lorica.git.unstage(state.projectPath, filePath);
    scheduleRefresh();
  }, [state.projectPath, applyOptimistic, scheduleRefresh]);

  const handleStageAll = useCallback(async () => {
    applyOptimistic((files) => files.map((f) => ({ ...f, staged: true })));
    await window.lorica.git.stageAll(state.projectPath);
    scheduleRefresh();
  }, [state.projectPath, applyOptimistic, scheduleRefresh]);

  const handleDiscard = useCallback(async (filePath) => {
    // Optimistically remove from unstaged list.
    applyOptimistic((files) => files.filter((f) => !(f.path === filePath && !f.staged)));
    await window.lorica.git.discard(state.projectPath, filePath);
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'info', message: `Discarded: ${basename(filePath)}` },
    });
    scheduleRefresh();
  }, [state.projectPath, applyOptimistic, scheduleRefresh, dispatch]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Enter a commit message' } });
      return;
    }
    const res = await window.lorica.git.commit(state.projectPath, commitMsg);
    if (res?.success !== false) {
      setCommitMsg('');
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Committed!', duration: 2000 } });
      scheduleRefresh();
      return;
    }
    // Special-case: the backend signals missing git identity with a
    // `GIT_AUTHOR_MISSING:` prefix so we can open a form instead of
    // dumping a multi-line git error in a tiny toast.
    const err = res?.error || 'Commit failed';
    if (typeof err === 'string' && err.startsWith('GIT_AUTHOR_MISSING')) {
      setAuthorPrompt({ name: '', email: '', pendingMsg: commitMsg });
      return;
    }
    dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: err } });
  }, [commitMsg, state.projectPath, scheduleRefresh, dispatch]);

  // Called when the user fills in name + email in the inline author form.
  // Persists the identity (globally by default so every future repo
  // inherits it), then retries the commit that was blocked.
  const handleSetAuthor = useCallback(async () => {
    if (!authorPrompt) return;
    const { name, email, pendingMsg } = authorPrompt;
    const res = await window.lorica.git.setAuthor(state.projectPath, name, email, true);
    if (res?.success === false) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: res?.error || 'Could not set git identity' } });
      return;
    }
    setAuthorPrompt(null);
    // Retry the commit that got blocked.
    const commit = await window.lorica.git.commit(state.projectPath, pendingMsg);
    if (commit?.success !== false) {
      setCommitMsg('');
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Identity saved and committed!' } });
      scheduleRefresh();
    } else {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: commit?.error || 'Commit failed after setting identity' } });
    }
  }, [authorPrompt, state.projectPath, scheduleRefresh, dispatch]);

  // --------------------------------------------------------------
  // AI-generated commit message.
  //   1. Grab the staged diff in a single IPC call.
  //   2. Ship it to the fast model (Haiku / deepseek-chat) with a
  //      Conventional-Commits prompt.
  //   3. Drop the result straight into the input so the user can
  //      tweak + Ctrl+Enter to commit.
  // --------------------------------------------------------------
  const handleGenerateCommitMessage = useCallback(async () => {
    if (generatingMsg) {
      // Second click cancels an in-flight request.
      generateAbortRef.current?.abort();
      return;
    }
    const provider = state.aiProvider || 'anthropic';
    const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
    if (!apiKey) {
      dispatch({
        type: 'ADD_TOAST',
        toast: {
          type: 'warning',
          message: `Configure a ${provider === 'anthropic' ? 'Anthropic' : 'DeepSeek'} API key in Settings first.`,
        },
      });
      return;
    }

    setGeneratingMsg(true);
    const ctrl = new AbortController();
    generateAbortRef.current = ctrl;
    try {
      const res = await window.lorica.git.diffStaged(state.projectPath);
      const diff = typeof res === 'string' ? res : res?.data;
      if (res && res.success === false) {
        throw new Error(res.error || 'git diff --cached failed');
      }
      if (!diff || !diff.trim()) {
        dispatch({
          type: 'ADD_TOAST',
          toast: { type: 'warning', message: 'Nothing staged — stage changes first.' },
        });
        return;
      }
      const msg = await generateCommitMessage({
        diff,
        provider,
        apiKey,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (msg) setCommitMsg(msg);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'error', message: `AI commit failed: ${e.message || e}` },
      });
    } finally {
      if (generateAbortRef.current === ctrl) generateAbortRef.current = null;
      setGeneratingMsg(false);
    }
  }, [generatingMsg, state.projectPath, state.aiProvider, state.aiApiKey, state.aiDeepseekKey, dispatch]);

  // Cancel any in-flight generation when the panel unmounts.
  useEffect(() => () => generateAbortRef.current?.abort(), []);

  const handlePush = useCallback(async () => {
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Pushing…', duration: 5000 } });
    const res = await window.lorica.git.push(state.projectPath);
    if (res?.success !== false) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Pushed!', duration: 2000 } });
      scheduleRefresh();
    } else {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: res?.error || 'Push failed' } });
    }
  }, [state.projectPath, scheduleRefresh, dispatch]);

  const handlePull = useCallback(async () => {
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Pulling…', duration: 5000 } });
    const res = await window.lorica.git.pull(state.projectPath);
    if (res?.success !== false) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Pulled!', duration: 2000 } });
      scheduleRefresh();
    } else {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: res?.error || 'Pull failed' } });
    }
  }, [state.projectPath, scheduleRefresh, dispatch]);

  const handleCheckout = useCallback(async (branch) => {
    const res = await window.lorica.git.checkout(state.projectPath, branch);
    if (res?.success !== false) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Switched to ${branch}` } });
      scheduleRefresh();
    } else {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: res?.error || 'Checkout failed' } });
    }
  }, [state.projectPath, scheduleRefresh, dispatch]);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showGit', value: false });

  // --- Early states -------------------------------------------------
  if (!hasLoadedOnce && !gitStatus) {
    return (
      <div className="h-full flex flex-col bg-lorica-surface">
        <div className="flex items-center justify-between px-3 py-2 border-b border-lorica-border">
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Git</span>
          <button onClick={close} className="text-lorica-textDim hover:text-lorica-text"><X size={14} /></button>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-lorica-textDim">
          <RefreshCw size={14} className="animate-spin mr-2" /> Loading…
        </div>
      </div>
    );
  }

  if (gitStatus && !gitStatus.is_repo) {
    return (
      <div className="h-full flex flex-col bg-lorica-surface">
        <div className="flex items-center justify-between px-3 py-2 border-b border-lorica-border">
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Git</span>
          <button onClick={close} className="text-lorica-textDim hover:text-lorica-text"><X size={14} /></button>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-lorica-textDim">
          <div className="text-center">
            <GitBranch size={28} className="mx-auto mb-2 opacity-20" />
            <div className="opacity-50">{state.projectPath ? 'Not a git repository' : 'Open a project first'}</div>
          </div>
        </div>
      </div>
    );
  }

  const files = gitStatus?.files || [];
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);

  return (
    <div className="h-full flex flex-col bg-lorica-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-lorica-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Git</span>
          <span className="text-[10px] text-lorica-accent font-mono">{gitStatus?.branch || '—'}</span>
          {gitStatus?.ahead > 0 && <span className="text-[9px] text-green-400">↑{gitStatus.ahead}</span>}
          {gitStatus?.behind > 0 && <span className="text-[9px] text-red-400">↓{gitStatus.behind}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={scheduleRefresh}
            className={`p-1 text-lorica-textDim hover:text-lorica-accent rounded ${refreshing ? 'animate-spin' : ''}`}
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
          <button onClick={close} className="p-1 text-lorica-textDim hover:text-lorica-text"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Git author setup — shown only when commit fails because
            user.name/user.email aren't configured. Form persists the
            pending commit message so the retry is seamless. */}
        {authorPrompt && (
          <div className="px-2 py-2 border-b border-lorica-border bg-amber-500/5">
            <div className="text-[11px] text-amber-400 font-semibold mb-1.5">
              Git identity missing
            </div>
            <div className="text-[10px] text-lorica-textDim mb-2">
              Git needs your name and email before it can commit. These are saved globally so every future repo uses them.
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                value={authorPrompt.name}
                onChange={(e) => setAuthorPrompt({ ...authorPrompt, name: e.target.value })}
                placeholder="Name (e.g. Alex Devlieger)"
                className="bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent placeholder:text-lorica-textDim/50"
              />
              <input
                value={authorPrompt.email}
                onChange={(e) => setAuthorPrompt({ ...authorPrompt, email: e.target.value })}
                placeholder="Email (e.g. alex@example.com)"
                className="bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent placeholder:text-lorica-textDim/50"
              />
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSetAuthor}
                  disabled={!authorPrompt.name.trim() || !authorPrompt.email.trim()}
                  className="flex-1 bg-lorica-accent/20 text-lorica-accent rounded py-1 text-[11px] hover:bg-lorica-accent/30 disabled:opacity-40"
                >
                  Save &amp; commit
                </button>
                <button
                  onClick={() => setAuthorPrompt(null)}
                  className="px-2 py-1 text-[11px] text-lorica-textDim hover:text-lorica-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Commit input */}
        <div className="px-2 py-2 border-b border-lorica-border">
          <div className="flex items-center gap-1">
            <input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleCommit()}
              placeholder="Commit message (Ctrl+Enter)"
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent placeholder:text-lorica-textDim/50"
              disabled={generatingMsg}
            />
            <button
              onClick={handleGenerateCommitMessage}
              className={`p-1.5 rounded transition-colors ${
                generatingMsg
                  ? 'bg-purple-500/30 text-purple-300'
                  : 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
              }`}
              title={generatingMsg ? 'Generating… (click to cancel)' : 'Generate commit message with AI'}
            >
              {generatingMsg
                ? <Loader2 size={14} className="animate-spin" />
                : <Sparkles size={14} />}
            </button>
            <button
              onClick={handleCommit}
              className="p-1.5 bg-lorica-accent/20 text-lorica-accent rounded hover:bg-lorica-accent/30"
              title="Commit"
            >
              <Check size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <button
              onClick={handlePull}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-lorica-textDim hover:text-lorica-text bg-lorica-bg rounded border border-lorica-border hover:border-lorica-accent/30 transition-colors"
            >
              <Download size={10} /> Pull
            </button>
            <button
              onClick={handlePush}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-lorica-textDim hover:text-lorica-text bg-lorica-bg rounded border border-lorica-border hover:border-lorica-accent/30 transition-colors"
            >
              <Upload size={10} /> Push
            </button>
          </div>
          <button
            onClick={() => setShowPrModal(true)}
            className="w-full mt-1.5 flex items-center justify-center gap-1 py-1 text-[10px] text-purple-400 hover:text-purple-300 bg-lorica-bg rounded border border-lorica-border hover:border-purple-400/30 transition-colors"
            title="Generate PR description with AI"
          >
            <GitPullRequest size={10} /> Description de PR (IA)
          </button>
        </div>

        {/* Staged */}
        {staged.length > 0 && (
          <div className="border-b border-lorica-border">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] text-green-400 font-semibold uppercase tracking-wider">
                Staged ({staged.length})
              </span>
            </div>
            {staged.map((f) => (
              <FileRow
                key={`s:${f.path}`}
                file={f}
                staged
                onUnstage={handleUnstage}
              />
            ))}
          </div>
        )}

        {/* Unstaged */}
        {unstaged.length > 0 && (
          <div className="border-b border-lorica-border">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
                Changes ({unstaged.length})
              </span>
              <button
                onClick={handleStageAll}
                className="text-[10px] text-lorica-textDim hover:text-green-400"
                title="Stage all"
              >
                <Plus size={12} />
              </button>
            </div>
            {unstaged.map((f) => (
              <FileRow
                key={`u:${f.path}`}
                file={f}
                staged={false}
                onStage={handleStage}
                onDiscard={handleDiscard}
              />
            ))}
          </div>
        )}

        {staged.length === 0 && unstaged.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-lorica-textDim opacity-50">
            Working tree clean ✓
          </div>
        )}

        {/* Branches */}
        <div className="border-b border-lorica-border">
          <button
            onClick={() => setShowBranches((v) => !v)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-lorica-textDim hover:text-lorica-text uppercase tracking-wider font-semibold"
          >
            {showBranches ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <GitBranch size={10} /> Branches {showBranches && `(${branches.length})`}
          </button>
          {showBranches && branches.map((b, i) => (
            <button
              key={`${b.name}:${i}`}
              onClick={() => !b.current && handleCheckout(b.name)}
              className={`w-full flex items-center gap-1.5 px-4 py-0.5 text-xs transition-colors ${
                b.current ? 'text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-panel/40'
              }`}
            >
              {b.current && <Check size={10} />}
              <span className={b.current ? '' : 'ml-3.5'}>{b.name}</span>
            </button>
          ))}
        </div>

        {/* Log */}
        <div>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-lorica-textDim hover:text-lorica-text uppercase tracking-wider font-semibold"
          >
            {showLog ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <GitCommit size={10} /> History
          </button>
          {showLog && gitLog.map((entry, i) => (
            <div
              key={`${entry.hash}:${i}`}
              className="flex items-start gap-2 px-3 py-1 text-[11px] hover:bg-lorica-panel/30 border-l-2 border-lorica-border hover:border-lorica-accent/30"
            >
              <span className="text-lorica-accent/50 font-mono flex-shrink-0">{entry.short_hash}</span>
              <div className="flex-1 min-w-0">
                <div className="text-lorica-text truncate" title={entry.message}>{entry.message}</div>
                <div className="text-[9px] text-lorica-textDim">{entry.author} · {entry.date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showPrModal && (
        <PrDescriptionModal
          state={state}
          dispatch={dispatch}
          onClose={() => setShowPrModal(false)}
        />
      )}
    </div>
  );
}
