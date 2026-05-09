// src/components/AnnotationsPanel.jsx
//
// Browse / edit / jump-to all spatial annotations in the active
// project (Wave 11.4). Companion panel to the in-editor sticky note
// gutter — a power-user view of every note across every file with
// filter + search.
//
// Design choice: we don't try to show the gutter dots IN this panel.
// The panel is text-oriented (file → line → snippet of the note), the
// editor is the spatial view. Click a row → open the file at the
// annotation's line.

import React, { useState, useMemo } from 'react';
import {
  X, StickyNote, Trash2, MapPin, Search, Pin, PinOff,
} from 'lucide-react';
import { ANNOTATION_COLORS } from '../utils/annotations';

const COLOR_BAR = {
  amber:   'bg-amber-400',
  blue:    'bg-sky-400',
  rose:    'bg-rose-400',
  emerald: 'bg-emerald-400',
  violet:  'bg-violet-400',
};

const COLOR_BG = {
  amber:   'bg-amber-400/10 border-amber-400/30',
  blue:    'bg-sky-400/10 border-sky-400/30',
  rose:    'bg-rose-400/10 border-rose-400/30',
  emerald: 'bg-emerald-400/10 border-emerald-400/30',
  violet:  'bg-violet-400/10 border-violet-400/30',
};

export default function AnnotationsPanel({
  state,
  dispatch,
  annotations,
  removeAnnotation,
  updateAnnotation,
  onOpenFile,
}) {
  const [filter, setFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('all');
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showAnnotationsPanel', value: false });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (annotations || [])
      .filter((a) => colorFilter === 'all' || a.color === colorFilter)
      .filter((a) => {
        if (!q) return true;
        return (
          a.file.toLowerCase().includes(q) ||
          a.text.toLowerCase().includes(q) ||
          (a.author || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [annotations, filter, colorFilter]);

  const jump = (a) => {
    if (typeof onOpenFile === 'function') {
      const projectRoot = (state.projectPath || '').replace(/\\/g, '/').replace(/\/$/, '');
      const abs = projectRoot && !/^[a-zA-Z]:[\\/]/.test(a.file) && !a.file.startsWith('/')
        ? `${projectRoot}/${a.file}`
        : a.file;
      onOpenFile(abs, a.line);
    }
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(251,191,36,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <StickyNote size={15} className="text-amber-400" />
          <div className="text-sm font-semibold text-lorica-text">Annotations</div>
          <div className="text-[10px] text-lorica-textDim">Spatial notes anchored to lines · stored under <code>.lorica/annotations.json</code></div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-lorica-border flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-1.5">
            <Search size={12} className="text-lorica-textDim" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by file / text / author"
              className="flex-1 bg-transparent text-xs text-lorica-text outline-none placeholder:text-lorica-textDim/50"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setColorFilter('all')}
              className={`px-2 py-1 rounded-full text-[10px] ${colorFilter === 'all' ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text'}`}
            >
              All
            </button>
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColorFilter(c)}
                title={c}
                className={`w-5 h-5 rounded-full ${COLOR_BAR[c]} ${colorFilter === c ? 'ring-2 ring-lorica-text/60 scale-110' : 'opacity-60 hover:opacity-100'} transition-all`}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-xs text-lorica-textDim">
              {annotations?.length === 0
                ? 'No annotations yet. Right-click any gutter line in the editor to add one.'
                : 'No annotations match this filter.'}
            </div>
          ) : (
            filtered.map((a) => (
              <div key={a.id} className={`rounded-lg border p-3 ${COLOR_BG[a.color] || COLOR_BG.amber}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <button
                    onClick={() => jump(a)}
                    className="flex items-center gap-1 text-[11px] font-mono text-lorica-text hover:text-lorica-accent"
                    title={`${a.file}:${a.line}`}
                  >
                    <MapPin size={10} />
                    <span className="truncate max-w-[280px]">{a.file}</span>
                    <span className="text-lorica-textDim">:{a.line}</span>
                  </button>
                  <div className="flex-1" />
                  {a.author && <span className="text-[9px] text-lorica-textDim italic">{a.author}</span>}
                  <button
                    onClick={() => updateAnnotation(a.id, { pinned: !a.pinned })}
                    title={a.pinned ? 'Unpin' : 'Pin'}
                    className="p-1 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40"
                  >
                    {a.pinned ? <Pin size={11} /> : <PinOff size={11} />}
                  </button>
                  <button
                    onClick={() => removeAnnotation(a.id)}
                    title="Delete annotation"
                    className="p-1 rounded text-lorica-textDim hover:text-red-300 hover:bg-red-400/15"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <textarea
                  value={a.text}
                  onChange={(e) => updateAnnotation(a.id, { text: e.target.value })}
                  rows={Math.min(6, Math.max(2, a.text.split('\n').length))}
                  className="w-full bg-lorica-bg/50 border border-lorica-border rounded px-2 py-1.5 text-[11px] text-lorica-text font-sans resize-none outline-none focus:border-lorica-accent"
                  placeholder="Empty note — type to fill."
                />
                <div className="mt-1.5 flex items-center gap-1">
                  {ANNOTATION_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateAnnotation(a.id, { color: c })}
                      title={c}
                      className={`w-3.5 h-3.5 rounded-full ${COLOR_BAR[c]} ${a.color === c ? 'ring-2 ring-lorica-text/60' : 'opacity-50 hover:opacity-90'} transition-all`}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
