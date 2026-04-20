// src/components/InlineAIEditPrompt.jsx
//
// Floating prompt invoked with Cmd+K (Ctrl+K). Sits above the selected range
// in the editor, takes a natural-language instruction, streams a rewrite,
// then either replaces the selection (Accept) or leaves things untouched
// (Discard). The visual language is intentionally minimal — a single row
// with a prompt, a loading pulse, and the two decision buttons — so the user
// stays in their flow without having to eyeball a big panel.
//
// The parent Editor owns the CodeMirror view and the range metadata. This
// component only handles the input → streaming → decision loop.

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Check, X, Loader2, RotateCcw } from 'lucide-react';
import { streamInlineEdit } from '../utils/aiInlineEdit';

const QUICK_PROMPTS = [
  'Refactor for clarity',
  'Add error handling',
  'Convert to TypeScript',
  'Add JSDoc comments',
  'Optimize performance',
  'Fix bugs',
];

export default function InlineAIEditPrompt({
  anchor,            // { top, left } in editor-relative pixels
  selection,         // { text, from, to, contextBefore, contextAfter }
  file,              // { path, extension }
  provider,
  apiKey,
  prefill = '',      // optional initial instruction (from quick-actions)
  onAccept,          // (newText: string) => void — commit replacement
  onDiscard,         // () => void — dismiss, keep original
  onPreview,         // (text: string) => void — live preview during stream
}) {
  const [instruction, setInstruction] = useState(prefill);
  const [status, setStatus] = useState('idle'); // idle | streaming | done | error
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const autoRanRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    // If a prefill came in (e.g. from a quick-action chip), auto-run it.
    if (prefill && !autoRanRef.current) {
      autoRanRef.current = true;
      // Defer a tick so the input visibly shows the prefilled text first.
      setTimeout(() => run(prefill), 30);
    }
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (explicitInstruction) => {
    const q = (explicitInstruction ?? instruction).trim();
    if (!q) return;
    if (!apiKey) { setError('Configure an API key first'); setStatus('error'); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus('streaming');
    setError('');
    setResult('');

    try {
      const full = await streamInlineEdit({
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
        selection: selection.text,
        language: file.extension,
        filePath: file.path,
        instruction: q,
        provider,
        apiKey,
        signal: ctrl.signal,
        onDelta: (_, accum) => {
          setResult(accum);
          onPreview?.(accum);
        },
      });
      setResult(full);
      onPreview?.(full);
      setStatus('done');
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message || String(e));
        setStatus('error');
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); abortRef.current?.abort(); onDiscard(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (status === 'done') { onAccept(result, instruction); return; }
      run();
    }
  };

  // Clamp anchor so the overlay never overflows the viewport. The editor
  // gives us coords relative to its scroll container; we just make sure we
  // keep a sane margin.
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 220));
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 520));

  return (
    <div
      className="absolute z-50 w-[480px] rounded-xl border border-lorica-accent/50 bg-lorica-panel/95 backdrop-blur-xl shadow-[0_0_40px_rgba(0,212,255,0.35)] overflow-hidden animate-fadeIn"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-lorica-border">
        <Sparkles size={14} className="text-lorica-accent shrink-0" />
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the change — e.g. 'add null checks', 'extract helper', 'translate to Rust'"
          disabled={status === 'streaming'}
          className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/50 disabled:opacity-60"
        />
        {status === 'streaming' && (
          <button onClick={() => abortRef.current?.abort()} title="Abort"
            className="text-red-400 hover:bg-red-500/20 p-1 rounded transition-colors">
            <X size={13} />
          </button>
        )}
        {status === 'done' && (
          <button onClick={() => run()} title="Regenerate"
            className="text-lorica-textDim hover:text-lorica-accent p-1 rounded transition-colors">
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      {/* Quick-prompt chips (shown before streaming starts) */}
      {status === 'idle' && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-lorica-border/50">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => { setInstruction(p); run(p); }}
              className="text-[10px] px-2 py-1 rounded-full border border-lorica-border text-lorica-textDim hover:text-lorica-accent hover:border-lorica-accent/50 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Streaming / result preview */}
      {status === 'streaming' && (
        <div className="px-3 py-2 flex items-center gap-2 text-[11px] text-lorica-textDim">
          <Loader2 size={12} className="animate-spin text-lorica-accent" />
          Generating… <span className="opacity-60">{result.length} chars</span>
        </div>
      )}

      {status === 'done' && (
        <div className="px-3 py-2 flex items-center gap-2 border-t border-lorica-border/50">
          <div className="flex-1 text-[11px] text-lorica-textDim">
            {result.split('\n').length} lines ready — <kbd className="px-1 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px]">↵</kbd> to accept, <kbd className="px-1 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px]">Esc</kbd> to cancel
          </div>
          <button
            onClick={onDiscard}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40 transition-colors"
          >
            <X size={11} /> Discard
          </button>
          <button
            onClick={() => onAccept(result, instruction)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-lorica-bg bg-lorica-accent hover:bg-lorica-accent/80 font-semibold transition-colors"
          >
            <Check size={11} /> Accept
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="px-3 py-2 text-[11px] text-red-400 border-t border-red-500/20 bg-red-500/5">
          {error}
        </div>
      )}
    </div>
  );
}
