// src/components/AgentIdentityModal.jsx
//
// Modal to edit the agent's persistent identity. Fields are grouped into
// three sections: who the agent is (name/tone), how it behaves (verbosity
// /proactivity), and what it remembers about the user. Saving scope is a
// toggle at the bottom — project-scoped lives in `.lorica/identity.json`
// and travels with the repo; global lives in localStorage and applies
// when no project is open.

import React, { useEffect, useState } from 'react';
import { X, Save, Plus, Trash2, UserCircle2 } from 'lucide-react';
import { DEFAULT_IDENTITY, loadIdentity, saveIdentity } from '../utils/agentIdentity';

const TONES     = ['warm', 'terse', 'neutral', 'playful'];
const VERBS     = ['concise', 'normal', 'detailed'];
const PROACTS   = ['passive', 'balanced', 'proactive'];

export default function AgentIdentityModal({ state, dispatch }) {
  const [identity, setIdentity] = useState(DEFAULT_IDENTITY);
  const [scope, setScope] = useState('project'); // 'project' | 'global'
  const [newMemory, setNewMemory] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const loaded = await loadIdentity(state.projectPath);
      setIdentity(loaded);
      setLoaded(true);
    })();
  }, [state.projectPath]);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showAgentIdentity', value: false });

  const save = async () => {
    const saved = await saveIdentity(state.projectPath, identity, { scope });
    dispatch({ type: 'SET_AGENT_IDENTITY', identity: saved });
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Identity saved (${scope})`, duration: 2000 } });
    close();
  };

  const addMemory = (e) => {
    e?.preventDefault?.();
    const m = newMemory.trim();
    if (!m) return;
    setIdentity((id) => ({ ...id, personalMemory: [...(id.personalMemory || []), m] }));
    setNewMemory('');
  };
  const removeMemory = (i) => {
    setIdentity((id) => ({ ...id, personalMemory: id.personalMemory.filter((_, j) => j !== i) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-2xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_40px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <UserCircle2 size={15} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Agent Identity</div>
          <div className="text-[10px] text-lorica-textDim">Persistent across every session</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {!loaded ? (
          <div className="flex-1 flex items-center justify-center text-[11px] text-lorica-textDim">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <Section title="Who the agent is">
              <Field label="Name">
                <input
                  value={identity.name}
                  onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
                  className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-xs outline-none focus:border-lorica-accent/50"
                />
              </Field>
              <Field label="Tone">
                <PickGroup value={identity.tone} options={TONES} onChange={(v) => setIdentity({ ...identity, tone: v })} />
              </Field>
            </Section>

            <Section title="How it behaves">
              <Field label="Verbosity">
                <PickGroup value={identity.verbosity} options={VERBS} onChange={(v) => setIdentity({ ...identity, verbosity: v })} />
              </Field>
              <Field label="Proactivity">
                <PickGroup value={identity.proactivity} options={PROACTS} onChange={(v) => setIdentity({ ...identity, proactivity: v })} />
              </Field>
              <Field label="Style notes">
                <textarea
                  value={identity.styleNotes || ''}
                  onChange={(e) => setIdentity({ ...identity, styleNotes: e.target.value })}
                  rows={3}
                  placeholder="Anything else that shapes how the agent responds…"
                  className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-xs outline-none focus:border-lorica-accent/50 resize-none"
                />
              </Field>
            </Section>

            <Section title="What it knows about you">
              <div className="text-[10px] text-lorica-textDim mb-1.5">
                Short facts added here are injected into every session preamble.
              </div>
              <form onSubmit={addMemory} className="flex items-center gap-2 mb-2">
                <input
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder='e.g. "I prefer semicolons in JS"'
                  className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-xs outline-none focus:border-lorica-accent/50"
                />
                <button type="submit" className="flex items-center gap-1 text-[11px] text-lorica-accent hover:bg-lorica-accent/10 px-2 py-1 rounded">
                  <Plus size={11} /> Add
                </button>
              </form>
              {(identity.personalMemory || []).length === 0 && (
                <div className="text-[11px] text-lorica-textDim italic">No memories yet.</div>
              )}
              <div className="space-y-1">
                {(identity.personalMemory || []).map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-lorica-text bg-lorica-bg/40 border border-lorica-border/50 rounded px-2 py-1 group">
                    <span className="flex-1">{m}</span>
                    <button onClick={() => removeMemory(i)} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-red-400 transition-opacity">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        <div className="flex items-center gap-3 px-5 py-3 border-t border-lorica-border bg-lorica-panel/60">
          <div className="flex gap-1 text-[10px]">
            <button
              onClick={() => setScope('project')}
              disabled={!state.projectPath}
              className={`px-2 py-0.5 rounded border transition-colors ${
                scope === 'project' ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim'
              } disabled:opacity-40`}
            >
              This project
            </button>
            <button
              onClick={() => setScope('global')}
              className={`px-2 py-0.5 rounded border transition-colors ${
                scope === 'global' ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim'
              }`}
            >
              Global (every project)
            </button>
          </div>
          <div className="flex-1" />
          <button onClick={close} className="px-3 py-1 rounded border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">Cancel</button>
          <button onClick={save} className="flex items-center gap-1 px-3 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/50 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30">
            <Save size={11} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[100px,1fr] items-center gap-2">
      <div className="text-[10px] text-lorica-textDim">{label}</div>
      {children}
    </div>
  );
}
function PickGroup({ value, options, onChange }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 rounded border text-[11px] capitalize ${
            value === o ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
