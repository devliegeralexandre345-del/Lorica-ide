// src/components/KeyboardCheatsheet.jsx
//
// A searchable, category-grouped cheatsheet for every Lorica shortcut.
// Invoked with `?` (global, when no input is focused) or from the
// Omnibar / command palette. The shortcuts live in one place here so
// they can't drift out of sync between the help UI and reality — if you
// add a shortcut to useShortcuts.js, register it here too.

import React, { useMemo, useState } from 'react';
import { Keyboard, X, Search } from 'lucide-react';

const GROUPS = [
  {
    id: 'palette', label: 'Palettes & Search',
    items: [
      { keys: 'Ctrl+P',         desc: 'Omnibar — files · commands · symbols · semantic · ask agent' },
      { keys: 'Ctrl+Shift+P',   desc: 'Command Palette (legacy)' },
      { keys: 'Ctrl+Shift+F',   desc: 'Search in files' },
      { keys: '?',              desc: 'This cheatsheet' },
      { keys: 'Esc',            desc: 'Close any open modal' },
    ],
  },
  {
    id: 'editor', label: 'Editor',
    items: [
      { keys: 'Ctrl+S',         desc: 'Save current file' },
      { keys: 'Ctrl+K',         desc: 'Inline AI edit over selection (or current line)' },
      { keys: 'Ctrl+M',         desc: 'Toggle bookmark on current line' },
      { keys: 'Ctrl+;',         desc: 'Jump to next bookmark (wraps)' },
      { keys: 'Alt+\\',          desc: 'Force AI ghost-text completion' },
      { keys: 'Ctrl+D',         desc: 'Select next occurrence' },
      { keys: 'Ctrl+\\',         desc: 'Toggle split editor' },
    ],
  },
  {
    id: 'ai', label: 'AI',
    items: [
      { keys: 'Ctrl+Alt+A',     desc: 'Toggle AI Copilot side panel' },
      { keys: 'Ctrl+Shift+A',   desc: 'Multi-agent Deep Review' },
      { keys: 'Ctrl+Alt+X',     desc: 'Auto-Fix last terminal error' },
      { keys: 'Ctrl+Alt+H',     desc: 'API Tester' },
      { keys: 'Ctrl+Alt+R',     desc: 'Regex Builder' },
      { keys: 'Ctrl+Alt+S',     desc: 'Sandbox (Run/Replay/Probes)' },
      { keys: 'Ctrl+Alt+W',     desc: 'Swarm Development' },
      { keys: 'Ctrl+Alt+Y',     desc: 'Semantic Types panel' },
      { keys: 'Ctrl+Alt+P',     desc: 'PR Ready? checklist' },
    ],
  },
  {
    id: 'visualization', label: 'Visualization',
    items: [
      { keys: 'Ctrl+Shift+N',   desc: 'Code Canvas (project graph)' },
      { keys: 'Ctrl+Alt+G',     desc: 'Toggle Code Heatmap' },
      { keys: 'Ctrl+Alt+B',     desc: 'Toggle Git Blame gutter' },
      { keys: 'Ctrl+Alt+T',     desc: 'Toggle Time Scrub' },
      { keys: 'Alt+Shift+P',    desc: 'Performance HUD' },
    ],
  },
  {
    id: 'productivity', label: 'Productivity',
    items: [
      { keys: 'Ctrl+Shift+V',   desc: 'Clipboard History' },
      { keys: 'Ctrl+Alt+F',     desc: 'Focus Timer (Pomodoro)' },
      { keys: 'Ctrl+J',         desc: 'Snippets palette' },
    ],
  },
  {
    id: 'navigation', label: 'Navigation',
    items: [
      { keys: 'Ctrl+B',         desc: 'Toggle file explorer' },
      { keys: 'Ctrl+`',         desc: 'Toggle terminal' },
      { keys: 'Ctrl+Shift+G',   desc: 'Git panel' },
      { keys: 'Ctrl+Shift+M',   desc: 'Problems panel' },
      { keys: 'Ctrl+L',         desc: 'Lock IDE' },
      { keys: 'Ctrl+K Z',       desc: 'Enter Zen mode' },
    ],
  },
  {
    id: 'omnibar', label: 'Omnibar Prefixes',
    items: [
      { keys: '> query',        desc: 'Commands only' },
      { keys: '@ symbol',       desc: 'Symbols in active file' },
      { keys: '# semantic',     desc: 'Semantic code search' },
      { keys: '? question',     desc: 'Ask the agent directly' },
      { keys: ': 42',           desc: 'Go to line in active file' },
    ],
  },
];

export default function KeyboardCheatsheet({ state, dispatch }) {
  const [query, setQuery] = useState('');
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showKeyboardCheatsheet', value: false });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        i.keys.toLowerCase().includes(q) ||
        i.desc.toLowerCase().includes(q) ||
        g.label.toLowerCase().includes(q)
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const total = GROUPS.reduce((n, g) => n + g.items.length, 0);
  const shown = filtered.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-3xl max-h-[82vh] lorica-glass rounded-2xl shadow-[0_0_40px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Keyboard size={15} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Keyboard Shortcuts</div>
          <div className="text-[10px] text-lorica-textDim">{shown} / {total}</div>
          <div className="flex-1 flex items-center gap-2 mx-4">
            <Search size={11} className="text-lorica-textDim" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter shortcuts…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-lorica-textDim/50"
            />
          </div>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 gap-x-6 gap-y-4">
          {filtered.map((g) => (
            <div key={g.id}>
              <div className="text-[10px] uppercase tracking-widest text-lorica-accent font-semibold mb-1.5 border-b border-lorica-accent/20 pb-1">
                {g.label}
              </div>
              {g.items.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 text-[11px] border-b border-lorica-border/30 last:border-b-0">
                  <span className="text-lorica-text/90 flex-1">{i.desc}</span>
                  <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[10px] font-mono text-lorica-accent ml-2 shrink-0">
                    {i.keys}
                  </kbd>
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 text-center text-[11px] text-lorica-textDim py-10">No shortcuts match "{query}"</div>
          )}
        </div>

        <div className="px-5 py-2 border-t border-lorica-border text-[10px] text-lorica-textDim flex items-center gap-3">
          <span>Press <kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">?</kbd> anytime to reopen</span>
          <span className="ml-auto">Shortcuts can be customized in Settings</span>
        </div>
      </div>
    </div>
  );
}
