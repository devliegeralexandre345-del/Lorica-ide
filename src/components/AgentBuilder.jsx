// src/components/AgentBuilder.jsx
//
// A wizard modal that lets a user define a custom agent: name, description,
// system prompt, model, permissions, auto-approve, context mode. The result
// is saved to `<project>/.lorica/agents/<slug>.json`, loaded on project
// open, and presented alongside the default "Start" button so the user
// can one-click into a domain-specific chat (e.g. "Rust refactor bot",
// "Test-writer", "Security reviewer").
//
// Saving to disk (not localStorage) is deliberate:
//   • Agents committed with the project travel with the repo — whole team
//     picks up the same assistant defaults.
//   • They can be edited outside the IDE in a code review if needed.
//   • They're trivially exportable (just a JSON file).
//
// The template library below seeds the wizard with a few starting points
// so the first-time user doesn't face a blank canvas.

import React, { useMemo, useState } from 'react';
import { Wand2, Save, Trash2, X, Play, AlertTriangle, ChevronRight, Zap, Save as SaveIcon, Terminal } from 'lucide-react';

const PERM_LABELS = {
  canRead: 'Read files',
  canWrite: 'Modify files',
  canCreate: 'Create files',
  canDelete: 'Delete files',
  canTerminal: 'Run terminal commands',
  canSearch: 'Search project',
  canWeb: 'Fetch URLs',
};

const DEFAULT_PERMS = {
  canRead: true, canWrite: false, canCreate: false, canDelete: false,
  canTerminal: false, canSearch: true, canWeb: false,
};

const MODELS = {
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (strongest)' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5 (fastest)' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
  ],
};

// Ready-made templates — each demonstrates a realistic specialization.
// Teams are meant to tweak, not adopt as-is.
const TEMPLATES = [
  {
    name: 'Test Writer',
    description: 'Writes unit tests in the project\'s existing style.',
    systemPrompt:
      'You are a senior test engineer for this codebase. When asked to add tests, first read_file the target, then read a sibling test file to mirror the framework, naming, and assertion style. Produce runnable tests only — no placeholders. Never delete existing tests.',
    icon: '🧪', color: '#10b981',
    permissions: { ...DEFAULT_PERMS, canRead: true, canWrite: true, canCreate: true, canSearch: true },
    autoApprove: false,
    context: 'active',
  },
  {
    name: 'Security Reviewer',
    description: 'Reviews code for OWASP-class vulnerabilities only.',
    systemPrompt:
      'You are a security auditor. You never modify files — you only read them. For any change you are shown, flag concrete vulnerabilities (injection, SSRF, XSS, IDOR, hardcoded secrets, weak crypto, unsafe deserialization) with the exact line and a concrete fix. Skip style and general bugs.',
    icon: '🛡️', color: '#f59e0b',
    permissions: { canRead: true, canWrite: false, canCreate: false, canDelete: false, canTerminal: false, canSearch: true, canWeb: false },
    autoApprove: true,
    context: 'active',
  },
  {
    name: 'Refactor Bot',
    description: 'Restructures code while keeping behavior identical.',
    systemPrompt:
      'You refactor code. Your invariant: behavior must be identical before and after. Always read_file first. Prefer small, composable refactors — extract helpers, simplify control flow, remove dead code, unify naming. Never add new features. Never remove tests.',
    icon: '🛠️', color: '#8b5cf6',
    permissions: { ...DEFAULT_PERMS, canWrite: true },
    autoApprove: false,
    context: 'active',
  },
  {
    name: 'Doc Writer',
    description: 'Adds JSDoc/docstring comments without touching logic.',
    systemPrompt:
      'You add documentation comments (JSDoc, Python docstrings, Rust doc-comments) to files. You DO NOT change executable code. Preserve every line\'s behavior. Focus on what/why, not restating the code.',
    icon: '📘', color: '#0ea5e9',
    permissions: { ...DEFAULT_PERMS, canWrite: true },
    autoApprove: true,
    context: 'active',
  },
  {
    name: 'Blank — from scratch',
    description: 'Start from an empty system prompt.',
    systemPrompt: '',
    icon: '✨', color: '#a855f7',
    permissions: DEFAULT_PERMS,
    autoApprove: false,
    context: 'none',
  },
];

function slugify(name) {
  return String(name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
}

export default function AgentBuilder({ state, dispatch, onSaved }) {
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showAgentBuilder', value: false });

  const [tpl, setTpl] = useState(TEMPLATES[0]);
  const [name, setName] = useState(TEMPLATES[0].name);
  const [description, setDescription] = useState(TEMPLATES[0].description);
  const [systemPrompt, setSystemPrompt] = useState(TEMPLATES[0].systemPrompt);
  const [icon, setIcon] = useState(TEMPLATES[0].icon);
  const [color, setColor] = useState(TEMPLATES[0].color);
  const [permissions, setPermissions] = useState(TEMPLATES[0].permissions);
  const [autoApprove, setAutoApprove] = useState(TEMPLATES[0].autoApprove);
  const [context, setContext] = useState(TEMPLATES[0].context);
  const [modelProvider] = useState(state.aiProvider || 'anthropic');
  const [model, setModel] = useState(MODELS[state.aiProvider || 'anthropic'][0].value);
  const [saving, setSaving] = useState(false);
  // Triggers — optional; empty means the agent runs only when the user
  // picks it manually. Supported forms:
  //   { kind: 'onSave', globs: ['src/**/*.ts'], prompt: '…' }
  //   { kind: 'shortcut', key: 'Ctrl+Alt+1', prompt: '…' }
  const [triggers, setTriggers] = useState([]);

  const loadTemplate = (t) => {
    setTpl(t);
    setName(t.name);
    setDescription(t.description);
    setSystemPrompt(t.systemPrompt);
    setIcon(t.icon);
    setColor(t.color);
    setPermissions(t.permissions);
    setAutoApprove(t.autoApprove);
    setContext(t.context);
    setTriggers(t.triggers || []);
  };

  const addTrigger = (kind) => {
    const base = kind === 'onSave'
      ? { kind: 'onSave', globs: '**/*.ts', prompt: '' }
      : { kind: 'shortcut', key: 'Ctrl+Alt+1', prompt: '' };
    setTriggers((cur) => [...cur, base]);
  };
  const updateTrigger = (i, patch) => setTriggers((cur) => cur.map((t, j) => i === j ? { ...t, ...patch } : t));
  const removeTrigger = (i) => setTriggers((cur) => cur.filter((_, j) => j !== i));

  const togglePerm = (k) => setPermissions((p) => ({ ...p, [k]: !p[k] }));

  const configObj = useMemo(() => ({
    name: name.trim() || 'agent',
    slug: slugify(name),
    description: description.trim(),
    icon, color,
    systemPrompt: systemPrompt.trim(),
    model,
    permissions,
    autoApprove,
    context,
    triggers: triggers.map((t) => ({
      kind: t.kind,
      ...(t.kind === 'onSave' ? { globs: String(t.globs || '').split(',').map((g) => g.trim()).filter(Boolean) } : {}),
      ...(t.kind === 'shortcut' ? { key: t.key } : {}),
      prompt: t.prompt || '',
    })),
    createdAt: new Date().toISOString(),
  }), [name, description, icon, color, systemPrompt, model, permissions, autoApprove, context, triggers]);

  const canSave = !!state.projectPath && name.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const sep = state.projectPath.includes('\\') ? '\\' : '/';
    const dir = `${state.projectPath}${sep}.lorica${sep}agents`;
    const file = `${dir}${sep}${slugify(name)}.json`;
    try {
      await window.lorica.fs.createDir(dir);
    } catch {}
    try {
      await window.lorica.fs.writeFile(file, JSON.stringify(configObj, null, 2));
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Agent saved: ${configObj.name}`, duration: 2500 } });
      onSaved?.();
      close();
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Save failed: ${e.message}`, duration: 4000 } });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-4xl h-full max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.25)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Wand2 size={14} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Custom Agent Builder</div>
          <div className="text-[10px] text-lorica-textDim">
            {state.projectPath
              ? <>Saves to <code>.lorica/agents/{slugify(name)}.json</code></>
              : 'Open a project to save agents per-repo'}
          </div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Templates rail */}
          <div className="w-56 border-r border-lorica-border overflow-y-auto shrink-0">
            <div className="px-3 py-2 text-[9px] uppercase tracking-widest text-lorica-textDim sticky top-0 bg-lorica-panel/80 backdrop-blur border-b border-lorica-border">
              Templates
            </div>
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => loadTemplate(t)}
                className={`w-full text-left px-3 py-2 border-b border-lorica-border/40 hover:bg-lorica-accent/10 transition-colors ${
                  tpl.name === t.name ? 'bg-lorica-accent/10 text-lorica-accent' : 'text-lorica-text'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{t.icon}</span>
                  <span className="text-[11px] font-semibold">{t.name}</span>
                </div>
                <div className="text-[10px] text-lorica-textDim mt-0.5 line-clamp-2">{t.description}</div>
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-[1fr,auto] gap-3">
              <div>
                <Label>Name</Label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent/50"
                />
              </div>
              <div>
                <Label>Icon</Label>
                <input
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  maxLength={3}
                  className="w-16 bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-center outline-none focus:border-lorica-accent/50"
                />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent/50"
                placeholder="One-line summary of what this agent does"
              />
            </div>

            <div>
              <Label>System prompt</Label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={7}
                placeholder="You are a …"
                className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-[11px] font-mono text-lorica-text outline-none focus:border-lorica-accent/50 resize-none"
              />
              <div className="text-[10px] text-lorica-textDim/80 mt-1">
                This is prepended to every turn. Be specific about invariants and constraints — the more explicit, the more consistent the agent.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Model</Label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent/50"
                >
                  {(MODELS[modelProvider] || []).map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Initial context</Label>
                <select
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs text-lorica-text outline-none focus:border-lorica-accent/50"
                >
                  <option value="none">None</option>
                  <option value="active">Active file</option>
                  <option value="tree">Project tree</option>
                  <option value="tree_keys">Tree + key files</option>
                </select>
              </div>
            </div>

            <div>
              <Label>Permissions</Label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(PERM_LABELS).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-[11px] text-lorica-text cursor-pointer hover:bg-lorica-border/30 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={!!permissions[k]}
                      onChange={() => togglePerm(k)}
                      className="accent-lorica-accent"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-lorica-text cursor-pointer">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={() => setAutoApprove((v) => !v)}
                className="accent-lorica-accent"
              />
              <span>Auto-approve destructive actions</span>
              {autoApprove && (
                <span className="text-amber-400 text-[10px] flex items-center gap-1">
                  <AlertTriangle size={10} /> no prompts, use with care
                </span>
              )}
            </label>

            {/* Triggers — the agent can be invoked automatically by
                Lorica when certain events fire. The useCustomAgents hook
                registers listeners for each enabled trigger at load time. */}
            <div>
              <Label>Triggers</Label>
              <div className="text-[10px] text-lorica-textDim mb-1.5">
                Let Lorica invoke this agent automatically. Empty = manual only.
              </div>
              <div className="space-y-1.5">
                {triggers.length === 0 && (
                  <div className="text-[11px] text-lorica-textDim italic">No triggers configured.</div>
                )}
                {triggers.map((t, i) => (
                  <div key={i} className="rounded border border-lorica-border bg-lorica-bg/40 p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      {t.kind === 'onSave'
                        ? <SaveIcon size={11} className="text-emerald-400" />
                        : <Terminal size={11} className="text-amber-400" />}
                      <span className="text-[10px] uppercase tracking-widest text-lorica-textDim">
                        {t.kind === 'onSave' ? 'On save' : 'Shortcut'}
                      </span>
                      <button onClick={() => removeTrigger(i)} className="ml-auto text-lorica-textDim hover:text-red-400">
                        <Trash2 size={10} />
                      </button>
                    </div>
                    {t.kind === 'onSave' && (
                      <input
                        value={t.globs}
                        onChange={(e) => updateTrigger(i, { globs: e.target.value })}
                        placeholder="src/**/*.ts, lib/*.js (comma-separated globs)"
                        className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] font-mono outline-none"
                      />
                    )}
                    {t.kind === 'shortcut' && (
                      <input
                        value={t.key}
                        onChange={(e) => updateTrigger(i, { key: e.target.value })}
                        placeholder="Ctrl+Alt+1"
                        className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] font-mono outline-none"
                      />
                    )}
                    <input
                      value={t.prompt || ''}
                      onChange={(e) => updateTrigger(i, { prompt: e.target.value })}
                      placeholder='Prompt to send (optional; defaults to "{event} triggered this agent")'
                      className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none"
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => addTrigger('onSave')}
                    className="flex items-center gap-1 text-[10px] text-emerald-400 border border-emerald-400/30 rounded px-2 py-0.5 hover:bg-emerald-400/10">
                    <SaveIcon size={10} /> + On save
                  </button>
                  <button onClick={() => addTrigger('shortcut')}
                    className="flex items-center gap-1 text-[10px] text-amber-400 border border-amber-400/30 rounded px-2 py-0.5 hover:bg-amber-400/10">
                    <Zap size={10} /> + Shortcut
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-lorica-border bg-lorica-panel/60">
          <div className="text-[10px] text-lorica-textDim flex-1">
            Slug: <code className="text-lorica-accent">{slugify(name)}</code>
          </div>
          <button onClick={close} className="px-3 py-1.5 rounded border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="px-3 py-1.5 rounded bg-lorica-accent/20 border border-lorica-accent/50 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30 transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            <Save size={11} /> {saving ? 'Saving…' : 'Save agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1">{children}</div>;
}
