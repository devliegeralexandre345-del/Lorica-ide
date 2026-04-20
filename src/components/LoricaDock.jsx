import React, { useState } from 'react';
import {
  Files, Search, GitBranch, Bot, Shield, Settings, Music,
  Terminal, Bug, Package, Hash, Clock, Zap, Network, Eye,
  Star, StickyNote, ClipboardCheck, Send, Regex, Clock3, Clipboard,
  Wand2, ShieldCheck, Brain, UserCircle2, FileCode, Layers, Tag,
  Keyboard, Rocket,
} from 'lucide-react';
import LoricaLogo from './LoricaLogo';

const NAV_ITEMS = [
  { id: 'files',    icon: Files,     panel: 'showFileTree', label: 'Explorer',       color: '#00d4ff', sidebar: true },
  { id: 'search',   icon: Search,    panel: 'showSearch',   label: 'Search',         color: '#a78bfa', sidebar: true },
  { id: 'git',      icon: GitBranch, panel: 'showGit',      label: 'Source Control', color: '#34d399', sidebar: true },
  { id: 'debug',    icon: Bug,       panel: 'showDebug',    label: 'Run & Debug',    color: '#f97316', sidebar: true },
  { id: 'outline',  icon: Hash,      panel: 'showOutline',  label: 'Outline',        color: '#8b5cf6', sidebar: true },
  { id: 'timeline', icon: Clock,     panel: 'showTimeline', label: 'Timeline',       color: '#0ea5e9', sidebar: true },
  { id: 'bookmarks',icon: Star,      panel: 'showBookmarksPanel', label: 'Bookmarks',color: '#fbbf24', sidebar: true },
  { id: 'scratchpad', icon: StickyNote, panel: 'showScratchpad', label: 'Scratchpad', color: '#fb923c', sidebar: true },
  { id: 'todo',     icon: ClipboardCheck, panel: 'showTodoBoard', label: 'TODO Board', color: '#10b981', sidebar: true },
  { id: 'brain',    icon: Brain,          panel: 'showProjectBrain', label: 'Project Brain', color: '#f472b6', sidebar: true },
  { id: 'ai',       icon: Bot,       panel: 'showAIPanel',  label: 'AI Copilot',     color: '#f59e0b' },
  { id: 'swarm',    icon: Zap,       panel: 'showAgentSwarm', label: 'Deep Review (Multi-Agent)', color: '#ff6b9d' },
  { id: 'canvas',   icon: Network,   panel: 'showCodeCanvas', label: 'Code Canvas',   color: '#00d4ff' },
  { id: 'preview',  icon: Eye,       panel: 'showInstantPreview', label: 'Instant Preview', color: '#60efff' },
  { id: 'api',      icon: Send,      panel: 'showApiTester',   label: 'API Tester',     color: '#22d3ee' },
  { id: 'regex',    icon: Regex,     panel: 'showRegexBuilder',label: 'Regex Builder',  color: '#f472b6' },
  { id: 'clipboard',icon: Clipboard, panel: 'showClipboardHistory', label: 'Clipboard (Ctrl+Shift+V)', color: '#94a3b8' },
  { id: 'pomodoro', icon: Clock3,    panel: 'showFocusTimer',  label: 'Focus Timer',    color: '#fb7185' },
  { id: 'agentNew', icon: Wand2,     panel: 'showAgentBuilder',label: 'Create Custom Agent', color: '#a78bfa' },
  { id: 'prReady',  icon: ShieldCheck, panel: 'showPrReady',   label: 'PR Ready? (Ctrl+Alt+P)', color: '#34d399' },
  { id: 'identity', icon: UserCircle2, panel: 'showAgentIdentity', label: 'Agent Identity', color: '#38bdf8' },
  { id: 'sandbox',  icon: FileCode,   panel: 'showSandbox',    label: 'Sandbox (Run/Replay/Probe)', color: '#c084fc' },
  { id: 'swarm2',   icon: Layers,     panel: 'showSwarm',      label: 'Swarm Development', color: '#f472b6' },
  { id: 'semtypes', icon: Tag,        panel: 'showSemanticTypes', label: 'Semantic Types (Ctrl+Alt+Y)', color: '#38bdf8' },
  { id: 'cheatsheet', icon: Keyboard, panel: 'showKeyboardCheatsheet', label: 'Keyboard shortcuts (?)', color: '#94a3b8' },
  { id: 'whatsnew',   icon: Rocket,   panel: 'showReleaseNotes',       label: "What's new in v2.2",   color: '#a78bfa' },
  { id: 'terminal', icon: Terminal,  panel: 'showTerminal', label: 'Terminal',       color: '#6ee7b7' },
  { id: 'extensions', icon: Package, panel: 'showExtensions', label: 'Extensions',  color: '#818cf8' },
  { id: 'vault',    icon: Shield,    panel: 'showSecretVault', label: 'Vault',       color: '#f472b6' },
  { id: 'spotify',  icon: Music,     panel: 'showSpotify',  label: 'Spotify',        color: '#1db954' },
  { id: 'settings', icon: Settings,  panel: 'showSettings', label: 'Settings',       color: '#94a3b8' },
];


export default function LoricaDock({ state, dispatch }) {
  const [hoveredId, setHoveredId] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const handleClick = (item) => {
    // All panels that share the single left sidebar slot — click one, the
    // others close so the user never ends up with orphaned state.
    const sidebarPanels = [
      'showFileTree', 'showSearch', 'showGit', 'showDebug', 'showOutline', 'showTimeline',
      'showBookmarksPanel', 'showScratchpad', 'showTodoBoard', 'showProjectBrain',
    ];

    if (item.sidebar) {
      if (state[item.panel]) {
        dispatch({ type: 'SET_PANEL', panel: item.panel, value: false });
      } else {
        sidebarPanels.forEach(p => dispatch({ type: 'SET_PANEL', panel: p, value: p === item.panel }));
      }
    } else {
      dispatch({ type: 'TOGGLE_PANEL', panel: item.panel });
      if (item.panel === 'showSpotify' && !state.showAIPanel) {
        dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
      }
    }
  };

  const isActive = (item) => !!state[item.panel];

  return (
    <div className="lorica-dock-container">
      {/* Logo */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="lorica-dock-logo"
        title="Lorica"
      >
        <LoricaLogo size={18} />
      </button>

      {/* Nav items */}
      {expanded && (
        <div className="lorica-dock-items">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            const hovered = hoveredId === item.id;

            return (
              <div key={item.id} className="lorica-dock-item-wrap">
                <button
                  onClick={() => handleClick(item)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`lorica-dock-item ${active ? 'active' : ''}`}
                  style={{
                    '--item-color': item.color,
                    '--item-glow': active ? `0 0 12px ${item.color}40` : 'none',
                  }}
                  title={item.label}
                >
                  {active && (
                    <div className="lorica-dock-ring" style={{ borderColor: item.color + '55' }} />
                  )}
                  <item.icon size={16} />
                </button>

                {hovered && (
                  <div className="lorica-dock-tooltip" style={{ '--tip-color': item.color }}>
                    {item.label}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
