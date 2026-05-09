// src/components/AddAnnotationPrompt.jsx
//
// Tiny inline prompt for adding a spatial annotation (Wave 12.1).
// Shows up when the user right-clicks the annotations gutter; collects
// note text + colour, calls back into the host to persist.
//
// Kept as a small centered toast-style modal rather than a popover
// anchored at the click position — anchoring requires reaching into
// the editor for line geometry, which is more code than the UX win
// justifies for a v1.

import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, Check, X } from 'lucide-react';
import { ANNOTATION_COLORS } from '../utils/annotations';

const COLOR_DOT = {
  amber:   '#fbbf24',
  blue:    '#38bdf8',
  rose:    '#fb7185',
  emerald: '#34d399',
  violet:  '#a78bfa',
};

export default function AddAnnotationPrompt({ at, onSave, onClose }) {
  const [text, setText] = useState('');
  const [color, setColor] = useState('amber');
  const inputRef = useRef(null);

  useEffect(() => {
    setText('');
    setColor('amber');
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [at]);

  if (!at) return null;

  const fileLabel = at.file
    .replace(/\\/g, '/')
    .split('/')
    .slice(-2)
    .join('/');

  const submit = () => {
    if (!text.trim()) {
      onClose();
      return;
    }
    onSave({ file: at.file, line: at.line, color, text: text.trim() });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/40 backdrop-blur-[2px] animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md lorica-glass rounded-xl shadow-[0_0_40px_rgba(251,191,36,0.18)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-lorica-border">
          <StickyNote size={13} className="text-amber-400" />
          <div className="text-xs font-semibold text-lorica-text">Add annotation</div>
          <span className="text-[10px] text-lorica-textDim font-mono">
            {fileLabel}:{at.line}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40"
          >
            <X size={12} />
          </button>
        </div>
        <div className="p-3 space-y-2.5">
          <textarea
            ref={inputRef}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="What did you spot here?"
            className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-2.5 py-1.5 text-[12px] text-lorica-text outline-none focus:border-amber-400/50 resize-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Colour</span>
            <div className="flex items-center gap-1">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  title={c}
                  className={`w-4 h-4 rounded-full transition-all ${color === c ? 'ring-2 ring-lorica-text/60 scale-110' : 'opacity-60 hover:opacity-100'}`}
                  style={{ background: COLOR_DOT[c] }}
                />
              ))}
            </div>
            <div className="flex-1" />
            <span className="text-[9px] text-lorica-textDim">
              <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border text-[8px]">Ctrl/Cmd+Enter</kbd> to save · <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border text-[8px]">Esc</kbd> to cancel
            </span>
          </div>
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-400/15 border border-amber-400/40 text-[11px] text-amber-200 hover:bg-amber-400/25 disabled:opacity-40"
            >
              <Check size={11} />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
