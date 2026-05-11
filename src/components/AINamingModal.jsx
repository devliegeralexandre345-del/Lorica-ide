// src/components/AINamingModal.jsx
//
// Wave 64 — UI for AI naming suggestions. Auto-fires against the
// active selection (or auto-filled by the user) and shows 3
// alternatives. Apply replaces the active selection via the existing
// `lorica:insertAtCursor` event (smartInsert extension) — same
// channel the Wave 48 refactor modal uses, so we don't touch
// CodeMirror internals.

import React, { useEffect, useRef, useState } from 'react';
import { Tag, X, Loader2, RefreshCw, AlertTriangle, Check, Sparkles } from 'lucide-react';
import { suggestNames } from '../utils/aiNameSuggestions';

export default function AINamingModal({ state, dispatch, activeFile }) {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showNaming', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  // Auto-fill from the active selection on open. If multi-word, take
  // the first non-whitespace token — same logic the hover-doc modal
  // uses for consistency.
  useEffect(() => {
    const sel = state.editorSelection?.text;
    if (typeof sel === 'string' && sel.trim()) {
      const word = sel.trim().split(/\s+/)[0].replace(/[^\w$]/g, '');
      if (word) setIdentifier(word);
    }
  }, []);

  const run = async () => {
    const id = identifier.trim();
    if (!id) { setError('Type an identifier first.'); return; }
    setBusy(true);
    setError(null);
    setSuggestions(null);
    abortRef.current = new AbortController();
    try {
      // Build a snippet for context — prefer selection, else file head.
      const sel = state.editorSelection?.text || '';
      const snippet = sel.length > id.length
        ? sel
        : (activeFile?.content || '').slice(0, 4000);
      const out = await suggestNames({
        identifier: id,
        snippet,
        fileName: activeFile?.name,
        language: activeFile?.extension,
        provider, apiKey,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
        ollamaBaseUrl: state.aiOllamaUrl,
        signal: abortRef.current.signal,
      });
      if (!out) throw new Error('AI returned unparseable output. Re-run or simplify the snippet.');
      setSuggestions(out.suggestions);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Auto-run on open if an identifier was pre-filled.
  useEffect(() => {
    if (identifier.trim()) run();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const apply = (name) => {
    // Splice the new name into the current selection. The user is
    // responsible for invoking project-wide rename via LSP if they
    // want every reference updated — this modal scoping is intentional
    // to keep the action reversible.
    window.dispatchEvent(new CustomEvent('lorica:insertAtCursor', { detail: { text: name } }));
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'success', message: `Renamed to "${name}" at cursor`, duration: 2200 },
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-2xl max-h-[80vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(132,204,22,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Tag size={15} className="text-lime-400" />
          <div className="text-sm font-semibold text-lorica-text">AI naming suggestions</div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Re-run
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-lorica-border flex items-center gap-2">
          <span className="text-[11px] text-lorica-textDim">Identifier:</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run(); }}
            placeholder="myVariable"
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[12px] text-lorica-text font-mono outline-none focus:border-lime-400/50"
          />
          <button
            onClick={run}
            disabled={busy || !identifier.trim()}
            className="flex items-center gap-1 px-3 py-1 rounded bg-lime-400/15 border border-lime-400/40 text-[11px] text-lime-200 hover:bg-lime-400/25 disabled:opacity-40"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Suggest
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {!suggestions && !busy && !error && (
            <div className="p-5 text-[11px] text-lorica-textDim italic">
              Pick a token in the editor before opening, or type one above. Press Enter to suggest.
            </div>
          )}
          {suggestions && suggestions.map((s, i) => (
            <div key={i} className="border-b border-lorica-border/30 px-5 py-3 flex items-center gap-3 hover:bg-lorica-accent/5">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[13px] text-lorica-text truncate">{s.name}</div>
                <div className="text-[10px] text-lorica-textDim italic mt-0.5 truncate">{s.rationale || '(no rationale)'}</div>
              </div>
              <button
                onClick={() => apply(s.name)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-lime-400/15 border border-lime-400/40 text-[10px] text-lime-200 hover:bg-lime-400/25 shrink-0"
              >
                <Check size={10} />
                Use
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
