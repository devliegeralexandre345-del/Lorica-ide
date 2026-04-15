import React, { useState } from 'react';
import {
  Files, Search, GitBranch, Bot, Shield, Settings, Music,
  Terminal, Bug, Package, Hash, Clock
} from 'lucide-react';
import LoricaLogo from './LoricaLogo';

const NAV_ITEMS = [
  { id: 'files',    icon: Files,     panel: 'showFileTree', label: 'Explorer',       color: '#00d4ff', sidebar: true },
  { id: 'search',   icon: Search,    panel: 'showSearch',   label: 'Search',         color: '#a78bfa', sidebar: true },
  { id: 'git',      icon: GitBranch, panel: 'showGit',      label: 'Source Control', color: '#34d399', sidebar: true },
  { id: 'debug',    icon: Bug,       panel: 'showDebug',    label: 'Run & Debug',    color: '#f97316', sidebar: true },
  { id: 'outline',  icon: Hash,      panel: 'showOutline',  label: 'Outline',        color: '#8b5cf6', sidebar: true },
  { id: 'timeline', icon: Clock,     panel: 'showTimeline', label: 'Timeline',       color: '#0ea5e9', sidebar: true },
  { id: 'ai',       icon: Bot,       panel: 'showAIPanel',  label: 'AI Copilot',     color: '#f59e0b' },
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
    const sidebarPanels = ['showFileTree', 'showSearch', 'showGit', 'showDebug', 'showOutline', 'showTimeline'];

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
