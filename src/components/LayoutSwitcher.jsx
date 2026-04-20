// src/components/LayoutSwitcher.jsx
//
// Small modal to switch between named layout profiles — think "workspace
// presets" in pro IDEs. Three built-ins (Coding / Reviewing / Deep work)
// plus any custom ones the user captured. Triggered from the Omnibar or
// from the Dock.

import React, { useState } from 'react';
import { Layers, X, Play, Plus, Trash2, Star } from 'lucide-react';
import {
  BUILTIN_LAYOUTS, loadLayouts, saveLayout, deleteLayout,
  captureCurrentLayout, applyLayout,
} from '../utils/layouts';

export default function LayoutSwitcher({ state, dispatch }) {
  const [customLayouts, setCustomLayouts] = useState(() => loadLayouts());
  const [newName, setNewName] = useState('');
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showLayoutSwitcher', value: false });

  const apply = (layout) => {
    applyLayout(layout, dispatch);
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Layout: ${layout.name}`, duration: 1500 } });
    close();
  };

  const captureAs = () => {
    const n = (newName || 'Custom layout').trim();
    const l = captureCurrentLayout(state, n);
    saveLayout(l);
    setCustomLayouts(loadLayouts());
    setNewName('');
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Saved layout "${l.name}"`, duration: 2000 } });
  };

  const remove = (id) => {
    deleteLayout(id);
    setCustomLayouts(loadLayouts());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-xl lorica-glass rounded-2xl shadow-[0_0_40px_rgba(0,212,255,0.2)] overflow-hidden animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border">
          <Layers size={15} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Window Layout</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <div className="px-5 py-2 text-[9px] uppercase tracking-widest text-lorica-textDim">Built-in</div>
          {BUILTIN_LAYOUTS.map((l) => (
            <button key={l.id} onClick={() => apply(l)} className="w-full flex items-center gap-3 px-5 py-2.5 border-b border-lorica-border/40 hover:bg-lorica-accent/10 transition-colors text-left">
              <span className="text-lg">{l.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-lorica-text">{l.name}</div>
                <div className="text-[10px] text-lorica-textDim truncate">
                  {Object.entries(l.fields).filter(([, v]) => v).slice(0, 5).map(([k]) => k.replace('show', '').replace('Enabled', '')).join(' · ')}
                </div>
              </div>
              <Play size={11} className="text-lorica-accent opacity-70" />
            </button>
          ))}

          {customLayouts.length > 0 && (
            <div className="px-5 py-2 text-[9px] uppercase tracking-widest text-lorica-textDim">Your layouts</div>
          )}
          {customLayouts.map((l) => (
            <div key={l.id} className="group flex items-center gap-3 px-5 py-2 border-b border-lorica-border/30 hover:bg-lorica-accent/5">
              <button onClick={() => apply(l)} className="flex items-center gap-2 flex-1 text-left">
                <Star size={11} className="text-amber-400 shrink-0" />
                <span className="text-xs text-lorica-text">{l.name}</span>
              </button>
              <button onClick={() => remove(l.id)} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-red-400 transition-opacity">
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-lorica-border bg-lorica-panel/60 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') captureAs(); }}
            placeholder="Name this layout…"
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none"
          />
          <button
            onClick={captureAs}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent text-[11px] hover:bg-lorica-accent/30"
          >
            <Plus size={11} /> Save current
          </button>
        </div>
      </div>
    </div>
  );
}
