// src/components/HoverDocModal.jsx
//
// Wave 55 — AI hover-doc lookup surface. Auto-extracts the identifier
// from the active selection (or the first non-whitespace word the
// user types), calls the AI provider via `fetchHoverDoc`, and renders
// a one-paragraph explanation. Cached per session inside aiHoverDoc.
//
// Why a modal instead of a real CM hover provider: extending CodeMirror's
// hover system requires modifying Editor.jsx (forbidden per LEDGER).
// A command-palette-launched modal lets users get the same lookup with
// one keypress and stays clear of editor internals.

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, X, Loader2, Search, AlertTriangle, Sparkles, Server } from 'lucide-react';
import { fetchHoverDoc, getCachedHoverDoc } from '../utils/aiHoverDoc';

// Wave 59 — convert an LSP hover response (per the spec) into a plain
// string. Hover is one of `{ contents: string }`, `{ contents: MarkupContent }`,
// `{ contents: (MarkedString | string)[] }`, or null.
function lspHoverToString(hover) {
  if (!hover) return '';
  const c = hover.contents;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((x) => (typeof x === 'string' ? x : (x?.value || ''))).filter(Boolean).join('\n\n');
  }
  if (c?.value) return c.value;
  return '';
}

// Locate the first occurrence of the identifier in the file's content.
// Returns { line, character } (0-indexed, LSP-style) or null.
function findIdentifierPosition(content, identifier) {
  if (!content || !identifier) return null;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(identifier);
    if (idx >= 0) return { line: i, character: idx };
  }
  return null;
}

export default function HoverDocModal({ state, dispatch, activeFile, lsp }) {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [source, setSource] = useState(null); // 'lsp' | 'ai' | 'cache' | null
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showHoverDoc', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  // Auto-fill from the current selection when the modal opens. We trim
  // to a single word — multi-line selections are almost never a useful
  // hover-doc target; the explain-selection modal is the right surface
  // for those.
  useEffect(() => {
    const sel = state.editorSelection?.text;
    if (typeof sel === 'string' && sel.trim()) {
      const word = sel.trim().split(/\s+/)[0].replace(/[^\w$.[\]]/g, '');
      if (word) setIdentifier(word);
    }
    inputRef.current?.focus();
  }, []);

  // Pre-fill the result box from cache if we already have one.
  useEffect(() => {
    if (!identifier) { setResult(null); setFromCache(false); setSource(null); return; }
    const cached = getCachedHoverDoc(activeFile?.name, identifier);
    if (cached) { setResult(cached); setFromCache(true); setSource('cache'); }
    else { setResult(null); setFromCache(false); setSource(null); }
  }, [identifier, activeFile?.name]);

  const run = async () => {
    if (!identifier.trim()) { setError('Type an identifier first.'); return; }
    setBusy(true);
    setError(null);
    setFromCache(false);
    setSource(null);
    abortRef.current = new AbortController();
    try {
      // Wave 59 — try LSP first when there's an active session for
      // this file. LSP-provided hovers are richer than what the AI
      // can guess from a snippet (real signature, real docstring).
      if (lsp && activeFile?.content) {
        const pos = findIdentifierPosition(activeFile.content, identifier.trim());
        if (pos) {
          try {
            const hover = await lsp.requestHover(activeFile, pos.line, pos.character);
            const text = lspHoverToString(hover).trim();
            if (text) {
              setResult(text);
              setSource('lsp');
              return;
            }
          } catch {
            // Fall through to AI on any LSP error — the AI path is
            // the resilient fallback.
          }
        }
      }
      // Build a small snippet for context — prefer the active selection
      // when it's larger than a single word, else use the file head.
      const sel = state.editorSelection?.text || '';
      const snippet = sel.length > identifier.length
        ? sel
        : (activeFile?.content || '').slice(0, 4000);
      const text = await fetchHoverDoc({
        identifier: identifier.trim(),
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
      setResult(text);
      setSource('ai');
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !busy) run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-2xl max-h-[80vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(56,189,248,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <BookOpen size={15} className="text-sky-400" />
          <div className="text-sm font-semibold text-lorica-text">Hover doc lookup</div>
          <div className="text-[10px] text-lorica-textDim">
            {activeFile?.name ? `Context: ${activeFile.name}` : 'No file open'}
          </div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-lorica-border flex items-center gap-2">
          <Search size={12} className="text-lorica-textDim shrink-0" />
          <input
            ref={inputRef}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Identifier (function, variable, type…)"
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[12px] text-lorica-text font-mono outline-none focus:border-sky-400/50"
          />
          <button
            onClick={run}
            disabled={busy || !identifier.trim()}
            className="flex items-center gap-1 px-3 py-1 rounded bg-sky-400/15 border border-sky-400/40 text-[11px] text-sky-200 hover:bg-sky-400/25 disabled:opacity-40"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {fromCache && !busy && !result ? 'Refresh' : 'Look up'}
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto px-5 py-3">
          {!result && !busy && !error && (
            <div className="text-[11px] text-lorica-textDim italic">
              Press Enter to look up. The result is cached per session so re-hovers are instant.
            </div>
          )}
          {result && (
            <>
              <div className="flex items-center gap-2 mb-1">
                {fromCache && (
                  <span className="text-[9px] uppercase tracking-widest text-emerald-300">Cached</span>
                )}
                {source === 'lsp' && (
                  <span className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-sky-300">
                    <Server size={9} /> LSP
                  </span>
                )}
                {source === 'ai' && (
                  <span className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-purple-300">
                    <Sparkles size={9} /> AI
                  </span>
                )}
              </div>
              <div className="text-[12px] leading-relaxed text-lorica-text whitespace-pre-wrap">
                {result}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
