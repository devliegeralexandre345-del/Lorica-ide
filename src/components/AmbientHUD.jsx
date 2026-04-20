// src/components/AmbientHUD.jsx
//
// A tiny, low-volume status pill that surfaces background work happening
// in the app. The idea: most IDEs hide async work behind silent spinners
// inside separate panels, so the user never knows the agent is streaming,
// the next-edit predictor is thinking, or the semantic index is rebuilding
// in the background. The ambient HUD puts all of that in one calm corner.
//
// It's intentionally read-only. Clicking an activity opens the relevant
// panel (agent → AI side panel, next-edit → NextEditPanel is already
// floating, semantic → search sidebar, swarm → swarm modal).
//
// Rendering rules:
//   • Completely hidden when nothing is happening — no "ready" chip.
//   • Groups activities by severity of attention: streaming work
//     (visible, pulse) vs background tasks (subtle dot).
//   • Auto-collapses the list after 3 items to keep visual noise down.

import React from 'react';
import { Loader2, Bot, Brain, Zap, GitCommit, Sparkles, Flame, Wand2, FileCode, Activity } from 'lucide-react';

export default function AmbientHUD({ state, dispatch }) {
  const activities = [];

  if (state.agentLoading) {
    activities.push({
      id: 'agent', icon: Bot, color: 'text-amber-400', label: 'Agent streaming',
      onClick: () => dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true }),
    });
  }
  if (state.nextEditSuggestions?.loading) {
    activities.push({
      id: 'next-edit', icon: Sparkles, color: 'text-lorica-accent', label: 'Predicting next edits',
    });
  }
  if (state.showAgentSwarm) {
    activities.push({
      id: 'swarm', icon: Zap, color: 'text-pink-400', label: 'Multi-agent review',
      onClick: () => dispatch({ type: 'SET_PANEL', panel: 'showAgentSwarm', value: true }),
    });
  }
  if (state.showAutoFix) {
    activities.push({
      id: 'autofix', icon: Wand2, color: 'text-red-300', label: 'Auto-Fix analyzing',
      onClick: () => dispatch({ type: 'SET_PANEL', panel: 'showAutoFix', value: true }),
    });
  }
  if (state.showSandbox) {
    activities.push({
      id: 'sandbox', icon: FileCode, color: 'text-purple-400', label: 'Sandbox running',
      onClick: () => dispatch({ type: 'SET_PANEL', panel: 'showSandbox', value: true }),
    });
  }
  if (state.showPrReady) {
    activities.push({
      id: 'prReady', icon: Activity, color: 'text-emerald-400', label: 'PR-Ready checks running',
      onClick: () => dispatch({ type: 'SET_PANEL', panel: 'showPrReady', value: true }),
    });
  }
  if (state.showSwarm) {
    activities.push({
      id: 'swarmDev', icon: Zap, color: 'text-pink-400', label: 'Swarm dev orchestrating',
      onClick: () => dispatch({ type: 'SET_PANEL', panel: 'showSwarm', value: true }),
    });
  }
  if (state.heatmapEnabled) {
    activities.push({
      id: 'heatmap', icon: Flame, color: 'text-amber-400', label: 'Heatmap on',
    });
  }

  if (activities.length === 0) return null;

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[995] pointer-events-none flex justify-center">
      <div className="flex items-center gap-1.5 lorica-glass rounded-full px-2.5 py-1 shadow-[0_0_30px_rgba(0,212,255,0.2)] pointer-events-auto animate-fadeIn">
        {activities.slice(0, 3).map((a) => {
          const Icon = a.icon;
          const Clickable = a.onClick ? 'button' : 'div';
          return (
            <Clickable
              key={a.id}
              onClick={a.onClick}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono ${a.color} ${a.onClick ? 'hover:bg-lorica-border/40 cursor-pointer' : ''} transition-colors`}
              title={a.label}
            >
              <Loader2 size={10} className="animate-spin" />
              <Icon size={10} />
              <span>{a.label}</span>
            </Clickable>
          );
        })}
        {activities.length > 3 && (
          <span className="text-[9px] text-lorica-textDim pl-1">+{activities.length - 3}</span>
        )}
      </div>
    </div>
  );
}
