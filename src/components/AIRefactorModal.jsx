// src/components/AIRefactorModal.jsx
//
// Wave 48 — UI for the AI refactor suggester. Auto-fires on open
// against the active editor selection. Shows three side-by-side
// suggestions (title + rationale + replacement preview); the user
// picks one and we route the replacement through the existing
// `lorica:insertAtCursor` window event (smartInsert extension) so
// CodeMirror's selection is overwritten in place.

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { suggestRefactors } from '../utils/aiRefactorSuggestions';

export default function AIRefactorModal({ state, dispatch, activeFile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showRefactor', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  const snippet = (() => {
    const sel = state.editorSelection?.text;
    if (typeof sel === 'string' && sel.trim()) return { code: sel, source: 'selection' };
    return { code: '', source: 'empty' };
  })();

  const run = async () => {
    if (!snippet.code.trim()) {
      setError('Select some code first — refactoring needs a target.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestions(null);
    abortRef.current = new AbortController();
    try {
      const out = await suggestRefactors({
        source: snippet.code,
        fileName: activeFile?.name,
        language: activeFile?.extension,
        provider, apiKey,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
        ollamaBaseUrl: state.aiOllamaUrl,
        signal: abortRef.current.signal,
      });
      if (!out) throw new Error('AI returned unparseable output. Re-run or simplify the selection.');
      setSuggestions(out.suggestions);
      setActiveIdx(0);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const apply = () => {
    const pick = suggestions?.[activeIdx];
    if (!pick) return;
    // Fire the same window event Smart Paste uses to overwrite the
    // current selection. Editor.jsx's smartInsert ViewPlugin handles
    // the actual `view.dispatch` so we never touch CodeMirror internals.
    window.dispatchEvent(new CustomEvent('lorica:insertAtCursor', {
      detail: { text: pick.replacement },
    }));
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'success', message: `Applied "${pick.title}"`, duration: 2500 },
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-4xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(167,139,250,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Sparkles size={15} className="text-purple-400" />
          <div className="text-sm font-semibold text-lorica-text">AI Refactor Suggestions</div>
          <div className="text-[10px] text-lorica-textDim">
            {snippet.source === 'selection' ? 'Active selection' : 'No selection'}
          </div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Re-run
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {busy && !suggestions && (
          <div className="px-5 py-4 flex items-center gap-2 text-[11px] text-lorica-textDim">
            <Loader2 size={12} className="animate-spin text-purple-400" />
            Asking the model for 3 refactor angles…
          </div>
        )}
        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        {suggestions && (
          <>
            <div className="px-5 py-2 border-b border-lorica-border flex items-center gap-2 text-[10px]">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className={`px-2 py-1 rounded border ${
                    i === activeIdx
                      ? 'bg-purple-400/15 border-purple-400/40 text-purple-200'
                      : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
                  }`}
                >
                  {i + 1}. {s.title}
                </button>
              ))}
            </div>
            <div className="px-5 py-2 border-b border-lorica-border text-[11px] text-lorica-textDim italic">
              {suggestions[activeIdx]?.rationale || '(no rationale provided)'}
            </div>
            <div className="flex-1 overflow-auto">
              <textarea
                readOnly
                value={suggestions[activeIdx]?.replacement || ''}
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
                onClick={apply}
                disabled={!suggestions[activeIdx]}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-400/15 border border-purple-400/40 text-[11px] text-purple-200 hover:bg-purple-400/25 disabled:opacity-40"
              >
                <Check size={11} />
                Apply this refactor
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
