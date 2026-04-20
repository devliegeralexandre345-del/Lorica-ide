import React, { useState, useEffect, useRef } from 'react';
import {
  Search, FolderOpen, Save, Settings, Shield, Lock, Bot, Music,
  Terminal, PanelLeftClose, GitCompare, ClipboardList, Palette, Moon, Sun,
  Maximize, Minimize, SplitSquareHorizontal, Map, SaveAll,
  GitBranch, FileSearch, Replace, Bug, Package, Code2, AlertTriangle,
  Sparkles, GitCommit, Activity, Eye, Network, Zap,
} from 'lucide-react';

export default function CommandPalette({ state, dispatch, onOpenFolder, onLock, actions }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showCommandPalette', value: false });

  const run = (fn) => {
    close();
    // Run action after palette closes to avoid stale state
    setTimeout(() => fn(), 0);
  };

  const commands = [
    { label: 'Open Folder', icon: FolderOpen, action: () => { onOpenFolder(); close(); } },
    { label: 'Toggle File Explorer', icon: PanelLeftClose, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showFileTree' }); close(); } },
    { label: 'Toggle Terminal', icon: Terminal, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showTerminal' }); close(); } },
    { label: 'Toggle AI Copilot', icon: Bot, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showAIPanel' }); close(); } },
    { label: 'Toggle Spotify', icon: Music, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showSpotify' }); if (!state.showAIPanel) dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true }); close(); } },
    
    // ===== NEW FEATURES — use actions prop from App =====
    {
      label: state.zenMode ? 'Exit Zen Mode' : 'Enter Zen Mode',
      icon: state.zenMode ? Minimize : Maximize,
      hint: 'Ctrl+K Z',
      action: () => run(() => actions.toggleZen()),
    },
    {
      label: state.splitMode ? 'Close Split Editor' : 'Split Editor',
      icon: SplitSquareHorizontal,
      hint: 'Ctrl+\\',
      action: () => run(() => actions.toggleSplit()),
    },
    {
      label: state.showMinimap !== false ? 'Hide Minimap' : 'Show Minimap',
      icon: Map,
      action: () => run(() => actions.toggleMinimap()),
    },
    {
      label: state.autoSave ? 'Disable Auto-Save' : 'Enable Auto-Save',
      icon: SaveAll,
      action: () => run(() => actions.toggleAutoSave()),
    },

    // ===== SEARCH, GIT, FILE PALETTE =====
    {
      label: 'Search in Files',
      icon: FileSearch,
      hint: 'Ctrl+Shift+F',
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: true }); dispatch({ type: 'SET_PANEL', panel: 'showGit', value: false }); close(); },
    },
    {
      label: 'Go to File',
      icon: Search,
      hint: 'Ctrl+Shift+P',
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showFilePalette', value: true }); close(); },
    },
    {
      label: 'Git: Status & Commit',
      icon: GitBranch,
      hint: 'Ctrl+Shift+G',
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showGit', value: true }); dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: false }); close(); },
    },

    { label: 'Secret Vault', icon: Shield, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showSecretVault' }); close(); } },
    { label: 'Audit Log', icon: ClipboardList, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showAuditLog' }); close(); } },
    { label: 'Diff Viewer', icon: GitCompare, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showDiffViewer' }); close(); } },
    {
      label: 'Run & Debug',
      icon: Bug,
      action: () => {
        const sp = ['showFileTree', 'showSearch', 'showGit'];
        sp.forEach(p => dispatch({ type: 'SET_PANEL', panel: p, value: false }));
        dispatch({ type: 'SET_PANEL', panel: 'showDebug', value: true });
        close();
      },
    },
    {
      label: 'Extensions',
      icon: Package,
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showExtensions', value: true }); close(); },
    },
    {
      label: 'Problems',
      icon: AlertTriangle,
      hint: 'Ctrl+Shift+M',
      action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showProblems' }); close(); },
    },
    {
      label: 'Insert Snippet',
      icon: Code2,
      hint: 'Ctrl+J',
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: true }); close(); },
    },
    {
      label: state.blameEnabled ? 'Git Blame: Hide' : 'Git Blame: Show',
      icon: GitCommit,
      action: () => { dispatch({ type: 'TOGGLE_BLAME' }); close(); },
    },
    {
      label: state.showPerformanceHUD ? 'Performance HUD: Hide' : 'Performance HUD: Show',
      icon: Activity,
      action: () => { dispatch({ type: 'TOGGLE_PERFORMANCE_HUD' }); close(); },
    },
    {
      label: state.showInstantPreview ? 'Instant Preview: Hide' : 'Instant Preview: Show',
      icon: Eye,
      action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showInstantPreview' }); close(); },
    },
    {
      label: 'Code Canvas (Project Graph)',
      icon: Network,
      hint: 'Ctrl+Shift+N',
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showCodeCanvas', value: true }); close(); },
    },
    {
      label: 'Multi-Agent Deep Review',
      icon: Zap,
      hint: 'Ctrl+Shift+A',
      action: () => { dispatch({ type: 'SET_PANEL', panel: 'showAgentSwarm', value: true }); close(); },
    },
    { label: 'Settings', icon: Settings, action: () => { dispatch({ type: 'TOGGLE_PANEL', panel: 'showSettings' }); close(); } },
    { label: 'Lock IDE', icon: Lock, action: () => { onLock(); close(); } },
    { label: 'Theme: Midnight', icon: Moon, action: () => { dispatch({ type: 'SET_THEME', theme: 'midnight' }); close(); } },
    { label: 'Theme: Hacker Green', icon: Palette, action: () => { dispatch({ type: 'SET_THEME', theme: 'hacker' }); close(); } },
    { label: 'Theme: Arctic', icon: Sun, action: () => { dispatch({ type: 'SET_THEME', theme: 'arctic' }); close(); } },
  ];

  state.openFiles.forEach((file, i) => {
    commands.push({
      label: `Go to: ${file.name}`,
      icon: Search,
      action: () => { dispatch({ type: 'SET_ACTIVE_FILE', index: i }); close(); },
    });
  });

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  // When the user's query doesn't match any built-in command, we still want
  // them to be able to act on it — so the palette becomes a "type a question,
  // send it to the agent" surface. This is the same pattern VS Code uses
  // when you type `?` in the palette, except we route to Lorica's own agent
  // instead of a help search. It turns the palette into the single entry
  // point for *everything* — navigation, settings, AND conversation.
  const showAIFallback = query.trim().length > 2 && filtered.length === 0;
  const handleAskAI = () => {
    const q = query.trim();
    if (!q) return;
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    dispatch({ type: 'AGENT_PREFILL_INPUT', text: q });
    close();
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') {
      if (filtered.length > 0) {
        filtered[Math.min(selectedIdx, filtered.length - 1)]?.action();
      } else if (showAIFallback) {
        handleAskAI();
      }
    }
  };

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => {
    if (listRef.current && listRef.current.children[selectedIdx]) {
      listRef.current.children[selectedIdx].scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24" onClick={close}>
      <div className="w-[500px] bg-lorica-panel border border-lorica-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-lorica-border">
          <Search size={16} className="text-lorica-textDim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/50"
          />
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {filtered.map((cmd, i) => (
            <button
              key={i}
              className={`w-full flex items-center gap-3 px-4 py-2 text-xs transition-colors ${
                i === selectedIdx ? 'bg-lorica-accent/15 text-lorica-accent' : 'text-lorica-text hover:bg-lorica-accent/10 hover:text-lorica-accent'
              }`}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <cmd.icon size={14} className="opacity-60 flex-shrink-0" />
              <span className="flex-1 text-left">{cmd.label}</span>
              {cmd.hint && (
                <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px] text-lorica-textDim font-mono flex-shrink-0">{cmd.hint}</kbd>
              )}
            </button>
          ))}
          {filtered.length === 0 && !showAIFallback && (
            <div className="px-4 py-6 text-center text-xs text-lorica-textDim">No matching commands</div>
          )}
          {showAIFallback && (
            <button
              onClick={handleAskAI}
              className="w-full flex items-center gap-3 px-4 py-3 text-xs bg-gradient-to-r from-lorica-accent/10 via-purple-500/5 to-transparent hover:from-lorica-accent/20 hover:via-purple-500/10 text-lorica-accent transition-colors group"
            >
              <Sparkles size={14} className="flex-shrink-0 animate-pulse" />
              <div className="flex-1 text-left">
                <div className="font-semibold">Ask the Agent</div>
                <div className="text-[10px] text-lorica-textDim mt-0.5 truncate group-hover:text-lorica-text/80 transition-colors">"{query}"</div>
              </div>
              <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px] text-lorica-textDim font-mono flex-shrink-0">↵</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
