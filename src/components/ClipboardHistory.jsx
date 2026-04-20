// src/components/ClipboardHistory.jsx
//
// Modal picker: press Ctrl+Shift+V to browse the recent clipboard items,
// filter with a search box, and insert the selected one. Keyboard-only
// navigation identical to the rest of the palette UIs.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, X, Pin, Trash2, PinOff } from 'lucide-react';

export default function ClipboardHistory({ state, dispatch }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showClipboardHistory', value: false });
  // Pinned items always bubble up to the top of the list. The reducer
  // enforces that at push time too, so this is a belt-and-braces sort.
  const items = useMemo(() => {
    const raw = state.clipboardItems || [];
    const pinned = raw.filter((it) => it.pinned).sort((a, b) => b.at - a.at);
    const rest   = raw.filter((it) => !it.pinned).sort((a, b) => b.at - a.at);
    return [...pinned, ...rest];
  }, [state.clipboardItems]);

  const togglePin = (text, e) => {
    e?.stopPropagation();
    dispatch({ type: 'CLIPBOARD_TOGGLE_PIN', text });
  };

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIdx(0); }, [query]);

  const filtered = items.filter((it) =>
    !query.trim() || it.text.toLowerCase().includes(query.toLowerCase())
  );

  const pasteAndClose = async (text) => {
    try {
      // Write to the actual system clipboard so the user can then paste
      // via their normal shortcut in the target surface (editor, terminal,
      // web input, …). We avoid trying to programmatically insert into
      // CodeMirror here because it's in a different focus context.
      await navigator.clipboard.writeText(text);
    } catch {}
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'success', message: 'Copied. Paste with Ctrl+V.', duration: 2000 },
    });
    close();
  };

  const remove = (text, e) => {
    e?.stopPropagation();
    dispatch({ type: 'CLIPBOARD_REMOVE', text });
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIdx]) {
      e.preventDefault();
      pasteAndClose(filtered[selectedIdx].text);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" onClick={close}>
      <div className="w-[560px] max-h-[60vh] lorica-glass rounded-xl shadow-[0_0_40px_rgba(0,212,255,0.2)] animate-fadeIn flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-lorica-border">
          <Clipboard size={14} className="text-lorica-accent" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search clipboard history…"
            className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/60"
          />
          <span className="text-[10px] text-lorica-textDim">{filtered.length} / {items.length}</span>
          <button onClick={close} className="p-1 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-[11px] text-lorica-textDim">
              {items.length === 0
                ? 'No clipboard history yet. Copy something inside Lorica to start filling this.'
                : 'No matches for your query.'}
            </div>
          )}
          {filtered.map((it, i) => (
            <button
              key={it.id}
              onClick={() => pasteAndClose(it.text)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full text-left px-4 py-2 border-b border-lorica-border/40 transition-colors group ${
                i === selectedIdx ? 'bg-lorica-accent/15' : 'hover:bg-lorica-accent/10'
              }`}
            >
              <div className={`text-[11px] font-mono ${i === selectedIdx ? 'text-lorica-accent' : 'text-lorica-text'} whitespace-pre-wrap break-all line-clamp-3`}>
                {it.text}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[9px] text-lorica-textDim">
                {it.pinned && <Pin size={9} className="text-amber-400" fill="currentColor" />}
                <span>{it.text.length} chars</span>
                <span>·</span>
                <span>{new Date(it.at).toLocaleTimeString()}</span>
                <button
                  onClick={(e) => togglePin(it.text, e)}
                  className={`ml-auto transition-opacity ${it.pinned ? 'text-amber-400 opacity-100' : 'opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-amber-400'}`}
                  title={it.pinned ? 'Unpin' : 'Pin — keep across rolling cap'}
                >
                  {it.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                </button>
                <button
                  onClick={(e) => remove(it.text, e)}
                  className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-red-400 transition-opacity"
                  title="Remove"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-1.5 border-t border-lorica-border text-[9px] text-lorica-textDim/70 flex gap-3">
          <span><kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">↵</kbd> copy & close</span>
          <span><kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">Esc</kbd> cancel</span>
        </div>
      </div>
    </div>
  );
}
