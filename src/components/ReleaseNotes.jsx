// src/components/ReleaseNotes.jsx
//
// One-time release-notes modal. Triggered from useReleaseNotes on first
// boot after a Lorica upgrade. We record the last-seen version in
// localStorage; when `APP_VERSION` changes, we flip the reducer flag to
// show this modal. Users can always reopen it from Settings or the
// Omnibar.

import React from 'react';
import {
  Rocket, X, Brain, Wand2, Zap, FileCode, Network, Flame, Eye,
  Clock, Star, StickyNote, ClipboardCheck, Clipboard, Send, Regex, Clock3,
  ShieldCheck, Layers, Keyboard, Tag, UserCircle2, Activity,
} from 'lucide-react';

const HIGHLIGHTS = [
  {
    title: 'Omnibar everywhere',
    desc: 'Ctrl+P — one surface covers files, commands, symbols, semantic search, agent Q&A, saved searches, and recent queries. Prefix with > @ # ? or :',
    Icon: Keyboard, color: 'text-lorica-accent',
  },
  {
    title: 'Multi-agent Swarm Review & Development',
    desc: 'Deep-review a file with 4 parallel specialists. Or decompose a feature into tiered sub-tasks, each running in its own git worktree with a final merge phase.',
    Icon: Zap, color: 'text-pink-400',
  },
  {
    title: 'Project Brain — durable memory',
    desc: 'Decisions, facts, glossary, milestones committed with the repo. Wiki-style [[links]], timeline and graph views. Auto-extract from agent conversations.',
    Icon: Brain, color: 'text-purple-400',
  },
  {
    title: 'Auto-Fix Loop with escalation',
    desc: 'Terminal error? One click — agent diagnoses, patches, re-runs. Escalates Haiku → Sonnet → Opus on retry and writes successful fixes to the Brain.',
    Icon: Wand2, color: 'text-red-300',
  },
  {
    title: 'Sandbox · Run · Replay · Probe',
    desc: 'JS sandbox (Web Worker) with three modes: run with AI-generated inputs, baseline then diff behaviour after refactor, record probe values across runs.',
    Icon: FileCode, color: 'text-purple-400',
  },
  {
    title: 'Code Canvas, Heatmap, Architecture Diff',
    desc: 'Dependency graph with filter/search/minimap. Churn heatmap with author attribution and bus-factor warnings. Per-PR architectural delta.',
    Icon: Network, color: 'text-sky-400',
  },
  {
    title: 'Custom Agents with triggers',
    desc: 'Build agents with your system prompt / permissions / model. Fire them on file save (globs) or a custom shortcut. Stored per-project, commit with the repo.',
    Icon: UserCircle2, color: 'text-amber-300',
  },
  {
    title: 'Semantic Types',
    desc: 'AI-inferred brand types (UserId vs GroupId) with mismatch underlines in the editor. Auto-infer on save. One-click export to brands.ts.',
    Icon: Layers, color: 'text-sky-400',
  },
  {
    title: 'PR Ready? checklist',
    desc: 'Pre-push: 7 AI checks + Impact forecast + Architecture diff. Custom checks from .lorica/pr-checks.json. "Fix with agent" per failure.',
    Icon: ShieldCheck, color: 'text-emerald-400',
  },
  {
    title: 'Time Scrub + snapshot diff',
    desc: 'Slider through snapshots of every file. Side-by-side diff. Intent-based rewind — describe what you want to undo and the AI picks the snapshot.',
    Icon: Clock, color: 'text-lorica-accent',
  },
  {
    title: 'Productivity extensions',
    desc: 'Bookmarks (notes + groups), Scratchpad (multi-notebook), TODO Board (drag/priority/due), API Tester (envs + collections + asserts), Regex Builder (saved patterns), Focus Timer (stats), Clipboard history (pinning).',
    Icon: Star, color: 'text-amber-400',
  },
];

export default function ReleaseNotes({ state, dispatch }) {
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showReleaseNotes', value: false });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.25)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Rocket size={16} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">What's new in Lorica v2.2</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="text-[11px] text-lorica-textDim leading-relaxed">
            This release turns Lorica from an IDE with AI features into an IDE <b className="text-lorica-text">built around</b> AI.
            Every piece listed below is native, local-first, and wired into a common state — nothing phones home beyond the LLM call you asked for.
          </div>
          {HIGHLIGHTS.map((h, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-lorica-border bg-lorica-bg/40 p-3">
              <h.Icon size={16} className={`shrink-0 mt-0.5 ${h.color}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-lorica-text">{h.title}</div>
                <div className="text-[11px] text-lorica-text/80 mt-0.5 leading-relaxed">{h.desc}</div>
              </div>
            </div>
          ))}
          <div className="text-[10px] text-lorica-textDim pt-2">
            Press <kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">?</kbd> anytime for the keyboard cheatsheet.
            Explore the Dock on the left for every panel.
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-lorica-border bg-lorica-panel/60">
          <div className="text-[10px] text-lorica-textDim flex-1">Reopen from Settings → About</div>
          <button onClick={close} className="px-4 py-1.5 rounded bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
