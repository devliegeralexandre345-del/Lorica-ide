import React, { useState, useEffect } from 'react';
import {
  FolderOpen, Bot, Terminal, Shield, Keyboard,
  Sparkles, Rocket, GitBranch, Search,
  Star, Cpu, Eye, Palette, Lock, Brain, Wrench,
  Settings, Code, GitMerge, Package, Bug
} from 'lucide-react';
import LoricaLogo from './LoricaLogo';

const FEATURES = [
  { icon: Cpu,      label: 'Rust Engine',    description: 'Backend natif ×2',       color: 'text-cyan-400',    bg: 'bg-cyan-400/10',    border: 'border-cyan-400/20' },
  { icon: Brain,    label: 'AI Copilot',     description: 'Claude · DeepSeek · GPT', color: 'text-purple-400',  bg: 'bg-purple-400/10',  border: 'border-purple-400/20' },
  { icon: GitMerge, label: 'Git intégré',    description: 'Stage, commit, branches', color: 'text-green-400',   bg: 'bg-green-400/10',   border: 'border-green-400/20' },
  { icon: Shield,   label: 'Secure Vault',   description: 'XChaCha20-Poly1305',      color: 'text-rose-400',    bg: 'bg-rose-400/10',    border: 'border-rose-400/20' },
  { icon: Terminal, label: 'Terminal natif', description: 'PS · Bash · Zsh',         color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  { icon: Bug,      label: 'Debugger',       description: 'Python · C++ · Rust',     color: 'text-orange-400',  bg: 'bg-orange-400/10',  border: 'border-orange-400/20' },
  { icon: Eye,      label: 'Visual Enhance', description: 'Sticky Scroll · Guides',  color: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-400/20' },
  { icon: Palette,  label: 'Customizable',   description: 'Themes & Keymaps',        color: 'text-pink-400',    bg: 'bg-pink-400/10',    border: 'border-pink-400/20' },
];

const WHATS_NEW = [
  { icon: Cpu,      text: 'Moteur Rust optimisé',          sub: 'Performances ×2, sécurité renforcée',              color: 'text-cyan-400' },
  { icon: Eye,      text: 'Améliorations visuelles',       sub: 'Sticky Scroll, Guides, minimap fluide',            color: 'text-blue-400' },
  { icon: Palette,  text: 'Raccourcis personnalisables',   sub: 'Modifiez tous les raccourcis clavier',             color: 'text-purple-400' },
  { icon: Lock,     text: 'Sécurité avancée',              sub: 'Chiffrement XChaCha20-Poly1305',                   color: 'text-green-400' },
  { icon: Brain,    text: 'IA multi-modèles',              sub: 'Claude, DeepSeek, GPT-4o',                         color: 'text-amber-400' },
  { icon: Wrench,   text: 'Outils développeur',            sub: 'Debugger intégré, profiling CPU/GPU',              color: 'text-orange-400' },
];

const QUICK_ACTIONS = [
  { label: 'Open Folder', icon: FolderOpen, color: 'text-blue-400',    bg: 'bg-blue-400/10 hover:bg-blue-400/20',    action: 'onOpenFolder' },
  { label: 'AI Copilot',  icon: Bot,        color: 'text-purple-400',  bg: 'bg-purple-400/10 hover:bg-purple-400/20', action: 'showAIPanel' },
  { label: 'Git Panel',   icon: GitBranch,  color: 'text-green-400',   bg: 'bg-green-400/10 hover:bg-green-400/20',  action: 'showGit' },
  { label: 'Search',      icon: Search,     color: 'text-amber-400',   bg: 'bg-amber-400/10 hover:bg-amber-400/20',  action: 'showSearch' },
  { label: 'Terminal',    icon: Terminal,   color: 'text-emerald-400', bg: 'bg-emerald-400/10 hover:bg-emerald-400/20', action: 'showTerminal' },
  { label: 'Extensions',  icon: Package,    color: 'text-indigo-400',  bg: 'bg-indigo-400/10 hover:bg-indigo-400/20', action: 'showExtensions' },
  { label: 'Debug',       icon: Bug,        color: 'text-orange-400',  bg: 'bg-orange-400/10 hover:bg-orange-400/20', action: 'showDebug' },
  { label: 'Settings',    icon: Settings,   color: 'text-lorica-accent', bg: 'bg-lorica-accent/10 hover:bg-lorica-accent/20', action: 'showSettings' },
];

const SHORTCUTS = [
  ['Ctrl+P',       'Command Palette'],
  ['Ctrl+Shift+P', 'Go to File'],
  ['Ctrl+Shift+F', 'Search in Files'],
  ['Ctrl+K → Z',   'Zen Mode'],
  ['Ctrl+\\',      'Split Editor'],
  ['Ctrl+Shift+G', 'Git Panel'],
  ['Ctrl+Shift+A', 'AI Copilot'],
  ['Ctrl+J',       'Snippets'],
];

export default function WelcomeTab({ dispatch, onOpenFolder }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleAction = (action) => {
    if (action === 'onOpenFolder') {
      onOpenFolder();
    } else {
      dispatch({ type: 'SET_PANEL', panel: action, value: true });
    }
  };

  return (
    <div
      className={`h-full w-full bg-lorica-bg overflow-y-auto overflow-x-hidden transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* ── Header ── */}
        <div className="flex items-center gap-5 mb-8">
          <div className="flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-2xl border bg-white/5"
            style={{ borderColor: 'color-mix(in srgb, var(--color-border) 60%, transparent)' }}>
            <LoricaLogo size={36} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-lorica-text tracking-tight">Lorica</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-lorica-accent"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' }}>
                v2.0.0
              </span>
            </div>
            <p className="text-sm text-lorica-textDim mt-0.5">
              Secure, AI‑powered native IDE — Rust backend, enterprise-grade security.
            </p>
          </div>
        </div>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-3 gap-6">

          {/* Left+Center (2/3) */}
          <div className="col-span-2 flex flex-col gap-6">

            {/* What's New */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full text-lorica-accent"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                  <Star size={11} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Nouveautés v2.0.0</span>
                </div>
                <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent)' }} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {WHATS_NEW.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-lorica-surface/50 border border-lorica-border/40 hover:border-lorica-border transition-colors">
                    <item.icon size={15} className={`${item.color} flex-shrink-0 mt-0.5`} />
                    <div>
                      <p className="text-xs font-semibold text-lorica-text">{item.text}</p>
                      <p className="text-[11px] text-lorica-textDim mt-0.5">{item.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Core Features */}
            <div>
              <h2 className="text-sm font-semibold text-lorica-text mb-3 flex items-center gap-2">
                <Code size={15} className="text-lorica-accent" />
                Core Features
              </h2>
              <div className="grid grid-cols-4 gap-2">
                {FEATURES.map((feat, idx) => (
                  <div key={idx} className={`${feat.bg} border ${feat.border} rounded-xl p-3 text-center hover:scale-[1.03] transition-transform`}>
                    <feat.icon size={20} className={`${feat.color} mx-auto mb-1.5`} />
                    <h3 className="text-[11px] font-semibold text-lorica-text mb-0.5">{feat.label}</h3>
                    <p className="text-[10px] text-lorica-textDim leading-snug">{feat.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <h2 className="text-sm font-semibold text-lorica-text mb-3 flex items-center gap-2">
                <Rocket size={15} className="text-lorica-accent" />
                Quick Actions
              </h2>
              <div className="grid grid-cols-4 gap-2">
                {QUICK_ACTIONS.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAction(action.action)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border border-lorica-border/40 ${action.bg} transition-all group hover:border-lorica-accent/30`}
                  >
                    <action.icon size={18} className={`${action.color} group-hover:scale-110 transition-transform`} />
                    <span className="text-[11px] font-medium text-lorica-textDim group-hover:text-lorica-text transition-colors">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right (1/3) */}
          <div className="flex flex-col gap-4">

            {/* Shortcuts */}
            <div className="bg-lorica-surface/40 border border-lorica-border/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Keyboard size={14} className="text-lorica-accent" />
                <h3 className="text-sm font-semibold text-lorica-text">Shortcuts</h3>
              </div>
              <div className="space-y-2">
                {SHORTCUTS.map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-lorica-textDim truncate">{desc}</span>
                    <kbd className="flex-shrink-0 px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-lorica-accent font-mono text-[10px]">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>

            {/* Customize */}
            <div className="rounded-xl p-4 border"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-surface))', borderColor: 'color-mix(in srgb, var(--color-accent) 20%, var(--color-border))' }}>
              <div className="flex items-center gap-2 mb-2">
                <Palette size={14} className="text-lorica-accent" />
                <h3 className="text-sm font-semibold text-lorica-text">Customizable</h3>
              </div>
              <p className="text-[11px] text-lorica-textDim mb-3 leading-relaxed">
                Personnalisez raccourcis, thèmes et comportements via les Paramètres.
              </p>
              <button
                onClick={() => dispatch({ type: 'SET_PANEL', panel: 'showSettings', value: true })}
                className="w-full text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-lorica-accent border"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' }}
              >
                Ouvrir les paramètres
              </button>
            </div>

            {/* Pro Tip */}
            <div className="rounded-xl p-4 border border-lorica-border/30 bg-lorica-surface/20">
              <div className="flex items-start gap-2">
                <Sparkles size={13} className="text-lorica-accent flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-lorica-accent mb-1">Pro Tip</h4>
                  <p className="text-[11px] text-lorica-textDim leading-relaxed">
                    Appuyez sur{' '}
                    <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-lorica-accent font-mono text-[10px]">
                      Ctrl+P
                    </kbd>{' '}
                    pour la Command Palette et accéder à toutes les actions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-8 pt-5 border-t border-lorica-border/20 flex items-center justify-between">
          <p className="text-[11px] text-lorica-textDim">
            Lorica v2.0.0 · Rust · React · CodeMirror
          </p>
          <button
            onClick={() => dispatch({ type: 'SET_PANEL', panel: 'showSettings', value: true })}
            className="text-[11px] text-lorica-accent hover:underline"
          >
            Customize your experience →
          </button>
        </div>
      </div>
    </div>
  );
}
