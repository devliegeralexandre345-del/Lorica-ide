// src/components/AICodeExplainModal.jsx
//
// Wave 38 — modal that asks the AI to explain the active editor's
// selection (or, when nothing is selected, the active file's first
// 200 lines). Output is rendered as Markdown via MarkdownMessage.
// Read-only — no edit affordance; this is a "help me understand"
// surface, not a refactor one.
//
// Trigger paths:
//   • Command Palette: "Explain selection (AI)"
//   • Voice intent (Wave 28 catalog) — already supports
//     "explain this" through the agent fallback; explicit intent
//     could be added in Wave 39+.

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, Copy, RefreshCw } from 'lucide-react';
import { explainCode } from '../utils/aiCodeExplain';
import MarkdownMessage from './MarkdownMessage';

export default function AICodeExplainModal({ state, dispatch, activeFile }) {
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showCodeExplain', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  // Resolve the snippet: prefer `state.editorSelection` if the host
  // populates it (Wave 38 leaves that as a follow-up), otherwise fall
  // back to the active file's first 200 lines so the user always gets
  // SOMETHING explained on first open.
  const snippet = (() => {
    const sel = state.editorSelection?.text;
    if (typeof sel === 'string' && sel.trim()) return { code: sel, source: 'selection' };
    const content = activeFile?.content;
    if (typeof content !== 'string' || !content) return { code: '', source: 'empty' };
    const lines = content.split('\n').slice(0, 200);
    return { code: lines.join('\n'), source: 'file-head' };
  })();

  const run = async () => {
    if (!snippet.code.trim()) {
      setError('Nothing to explain — open a file or select some code.');
      return;
    }
    setBusy(true);
    setError(null);
    setExplanation('');
    abortRef.current = new AbortController();
    try {
      const md = await explainCode({
        code: snippet.code,
        language: activeFile?.extension,
        fileName: activeFile?.name,
        provider, apiKey,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
        ollamaBaseUrl: state.aiOllamaUrl,
        signal: abortRef.current.signal,
      });
      setExplanation(md);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Auto-run on first open so the user lands on an answer, not a
  // call-to-action button.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    if (!explanation) return;
    try {
      await navigator.clipboard.writeText(explanation);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Sparkles size={15} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Explain code</div>
          <div className="text-[10px] text-lorica-textDim">
            {snippet.source === 'selection'
              ? 'Active editor selection'
              : snippet.source === 'file-head'
              ? `First ${Math.min(200, snippet.code.split('\n').length)} lines of ${activeFile?.name || 'file'}`
              : 'No file open'}
          </div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Re-run
          </button>
          <button onClick={copy} disabled={!explanation} className={`flex items-center gap-1 text-[10px] ${copied ? 'text-emerald-300' : 'text-lorica-textDim hover:text-lorica-accent'} disabled:opacity-40`}>
            <Copy size={11} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {busy && !explanation && (
            <div className="flex items-center gap-2 text-[11px] text-lorica-textDim">
              <Loader2 size={12} className="animate-spin text-lorica-accent" />
              Asking the model…
            </div>
          )}
          {error && (
            <div className="px-3 py-2 rounded bg-red-400/10 border border-red-400/30 text-[11px] text-red-300">{error}</div>
          )}
          {explanation && (
            <div className="text-[12px]">
              <MarkdownMessage content={explanation} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
