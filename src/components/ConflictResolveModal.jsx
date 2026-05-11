// src/components/ConflictResolveModal.jsx
//
// Wave 61 — UI for the direct AI conflict resolver. Auto-fires on
// open against the conflict block the user clicked. Shows the
// AI-proposed merge + rationale; the user accepts (splices into the
// file) or cancels (no-op).
//
// We render the result in a read-only textarea — editing the
// suggestion before applying would force us to track which edits to
// apply where, which the existing inline ours/theirs/both buttons
// already cover for trivial cases.

import React, { useEffect, useRef, useState } from 'react';
import { GitMerge, X, Loader2, AlertTriangle, Check, Sparkles } from 'lucide-react';
import { resolveConflict } from '../utils/aiConflictResolve';

export default function ConflictResolveModal({ state, dispatch, block, file, onAccept }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showConflictResolve', value: false });
    dispatch({ type: 'SET_CONFLICT_BLOCK', block: null });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  useEffect(() => {
    if (!block || !file) return;
    const doc = file.content || '';
    const ours = doc.slice(block.oursStart, block.oursEnd);
    const theirs = doc.slice(block.theirsStart, block.theirsEnd);
    // ±5 lines of surrounding context so the AI can ground the merge.
    const beforeText = doc.slice(0, block.start);
    const afterText  = doc.slice(block.end);
    const beforeLines = beforeText.split('\n');
    const afterLines  = afterText.split('\n');
    const contextBefore = beforeLines.slice(Math.max(0, beforeLines.length - 6), beforeLines.length - 1).join('\n');
    const contextAfter  = afterLines.slice(1, 6).join('\n');

    setBusy(true);
    setError(null);
    setResult(null);
    abortRef.current = new AbortController();
    resolveConflict({
      ours, theirs, contextBefore, contextAfter,
      fileName: file.name,
      language: file.extension,
      provider, apiKey,
      model: provider === 'ollama' ? state.aiOllamaModel
        : provider === 'openrouter' ? state.aiOpenRouterModel
        : undefined,
      ollamaBaseUrl: state.aiOllamaUrl,
      signal: abortRef.current.signal,
    })
      .then((out) => {
        if (!out) throw new Error('AI returned unparseable output. Try the manual ours/theirs/both buttons.');
        setResult(out);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message || String(e));
      })
      .finally(() => setBusy(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.start, file?.path]);

  const accept = () => {
    if (!result?.replacement || !block) return;
    onAccept?.(block, result.replacement);
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(245,158,11,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <GitMerge size={15} className="text-amber-400" />
          <div className="text-sm font-semibold text-lorica-text">AI conflict resolver</div>
          {block && (
            <div className="text-[10px] text-lorica-textDim">
              {block.oursLabel} ↔ {block.theirsLabel} · line {block.startLine}
            </div>
          )}
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {busy && (
          <div className="px-5 py-4 flex items-center gap-2 text-[11px] text-lorica-textDim">
            <Loader2 size={12} className="animate-spin text-amber-400" />
            Asking the model to merge the two sides…
          </div>
        )}
        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="px-5 py-2 border-b border-lorica-border text-[11px] text-lorica-textDim italic">
              <Sparkles size={10} className="inline mr-1 text-amber-400" />
              {result.rationale || '(no rationale provided)'}
            </div>
            <div className="flex-1 overflow-auto">
              <textarea
                readOnly
                value={result.replacement}
                className="w-full h-full min-h-[260px] bg-lorica-bg/40 text-[11px] text-lorica-text font-mono p-3 outline-none resize-none"
              />
            </div>
            <div className="border-t border-lorica-border px-4 py-3 flex items-center justify-end gap-2">
              <button
                onClick={close}
                className="px-3 py-1.5 rounded text-[11px] text-lorica-textDim hover:bg-lorica-border/40"
              >
                Cancel
              </button>
              <button
                onClick={accept}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-400/15 border border-amber-400/40 text-[11px] text-amber-200 hover:bg-amber-400/25"
              >
                <Check size={11} />
                Apply merge
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
