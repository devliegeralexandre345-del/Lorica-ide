// src/components/ProjectBrainPanel.jsx
//
// The Project Brain panel. Left column: entry list grouped by type with
// search + filter. Right column: selected entry read/edit view. A "new
// entry" button drops into an empty form; "auto-extract" asks the agent
// to summarize the last session into a new entry the user can accept.
//
// All mutations persist immediately to `.lorica/brain/<slug>.md`. The
// state (entries list) is re-loaded via the useProjectBrain hook after
// each save.

import React, { useMemo, useState, useEffect } from 'react';
import {
  Brain, Plus, Trash2, Save, Search, RefreshCw, Sparkles,
  FileText as FileIcon, Check, X as XIcon, List, Calendar, Network,
  ArrowRight, Link2, ArrowLeft,
} from 'lucide-react';
import {
  BRAIN_TYPES, searchBrain, saveBrainEntry, deleteBrainEntry,
  buildBrainGraph, resolveLink, extractLinks,
} from '../utils/projectBrain';
import MarkdownMessage from './MarkdownMessage';
import { autoExtractBrainEntry } from '../utils/brainAutoExtract';

const BLANK_DRAFT = {
  title: '',
  type: 'note',
  tags: [],
  body: '',
};

export default function ProjectBrainPanel({ state, dispatch, brainRefresh }) {
  const entries = state.brainEntries || [];
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedPath, setSelectedPath] = useState(null);
  const [editing, setEditing] = useState(null); // draft {title, type, tags, body, path?}
  const [mode, setMode] = useState('read'); // 'read' | 'edit'
  const [extracting, setExtracting] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'timeline' | 'graph'

  const filtered = useMemo(() => {
    let out = typeFilter === 'all' ? entries : entries.filter((e) => e.type === typeFilter);
    out = searchBrain(out, query);
    return out;
  }, [entries, query, typeFilter]);

  const selected = filtered.find((e) => e.path === selectedPath)
    || entries.find((e) => e.path === selectedPath)
    || null;

  // When the list changes and nothing's selected, pick the first entry.
  useEffect(() => {
    if (!selected && filtered.length > 0) setSelectedPath(filtered[0].path);
  }, [filtered, selected]);

  const startNew = () => {
    setEditing({ ...BLANK_DRAFT });
    setMode('edit');
    setSelectedPath(null);
  };

  const startEdit = () => {
    if (!selected) return;
    setEditing({
      title: selected.title,
      type: selected.type,
      tags: selected.tags || [],
      body: selected.body,
      path: selected.path,
    });
    setMode('edit');
  };

  const cancelEdit = () => {
    setEditing(null);
    setMode('read');
  };

  const save = async () => {
    if (!editing) return;
    try {
      const saved = await saveBrainEntry(state.projectPath, editing, editing.path || null);
      await brainRefresh?.();
      setEditing(null);
      setMode('read');
      setSelectedPath(saved.path);
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Saved: ${saved.title}`, duration: 2000 } });
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Save failed: ${e.message}`, duration: 4000 } });
    }
  };

  const remove = async () => {
    if (!selected) return;
    const ok = await deleteBrainEntry(selected.path);
    if (ok) {
      await brainRefresh?.();
      setSelectedPath(null);
      dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Entry deleted', duration: 1500 } });
    }
  };

  // Auto-extract: asks the agent to summarize the last session into a
  // proposed entry. The user always gets the draft first — no silent
  // writes to the brain.
  const doExtract = async () => {
    const provider = state.aiProvider || 'anthropic';
    const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
    if (!apiKey) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Configure an API key first', duration: 2500 } });
      return;
    }
    if (!state.agentMessages || state.agentMessages.length < 2) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'No agent conversation to extract from', duration: 2500 } });
      return;
    }
    setExtracting(true);
    try {
      const draft = await autoExtractBrainEntry({
        messages: state.agentMessages,
        provider, apiKey,
      });
      if (!draft) throw new Error('empty extraction');
      setEditing(draft);
      setMode('edit');
      setSelectedPath(null);
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Draft ready — review before saving', duration: 2500 } });
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Extract failed: ${e.message}`, duration: 4000 } });
    } finally {
      setExtracting(false);
    }
  };

  // Group filtered entries by type for the sidebar.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      if (!map.has(e.type)) map.set(e.type, []);
      map.get(e.type).push(e);
    }
    return map;
  }, [filtered]);

  if (!state.projectPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[11px] text-lorica-textDim">
        <Brain size={22} className="opacity-40 mb-2" />
        Open a project to use the Brain.
        <div className="opacity-60 mt-1">Entries live at <code>.lorica/brain/*.md</code>.</div>
      </div>
    );
  }

  // What to render in the main body area.
  //   - `edit`     : EntryEditor (new or existing entry being edited)
  //   - `detail`   : EntryView (an entry is selected)
  //   - `timeline` : TimelineView (chrono grid of all entries)
  //   - `graph`    : GraphView (link graph of all entries)
  //   - `list`     : entry list (default — used to be the left sidebar)
  //
  // The previous layout rendered the list AND the detail side-by-side
  // in a 240px + flex-1 flex row. When the Brain panel was docked in
  // the narrow app sidebar, the flex-1 detail column still wanted its
  // content width, leaked past `overflow-hidden`, and text bled through
  // the editor. Stacking them resolves the overflow for good.
  const bodyMode =
    mode === 'edit' ? 'edit'
    : selected && mode === 'read' ? 'detail'
    : view === 'timeline' ? 'timeline'
    : view === 'graph' ? 'graph'
    : 'list';

  const goBackToList = () => {
    setSelectedPath(null);
    setMode('read');
    setView('list');
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top toolbar — always visible. Shows either navigation chrome
          for the list view, or a back-to-list button when drilled in. */}
      <div className="px-3 py-2 border-b border-lorica-border flex items-center gap-2 shrink-0">
        {bodyMode === 'list' ? (
          <>
            <Brain size={13} className="text-lorica-accent" />
            <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Brain</span>
            <button
              onClick={brainRefresh}
              className="ml-auto p-1 rounded text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 transition-colors"
              title="Reload from disk"
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={startNew}
              className="p-1 rounded text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 transition-colors"
              title="New entry"
            >
              <Plus size={12} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={goBackToList}
              className="flex items-center gap-1 p-1 rounded text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 transition-colors"
              title="Back to list"
            >
              <ArrowLeft size={12} />
              <span className="text-[10px]">Back</span>
            </button>
            <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">
              {bodyMode === 'edit' ? 'Edit' : bodyMode === 'timeline' ? 'Timeline' : bodyMode === 'graph' ? 'Graph' : 'Entry'}
            </span>
          </>
        )}
      </div>

      {/* View switcher — only meaningful in the list view (timeline /
          graph are overlay modes over the same set of entries). */}
      {bodyMode === 'list' && (
        <div className="flex border-b border-lorica-border shrink-0">
          {[
            { id: 'list',     label: 'Entries',  Icon: List },
            { id: 'timeline', label: 'Timeline', Icon: Calendar },
            { id: 'graph',    label: 'Graph',    Icon: Network },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] transition-colors ${
                view === t.id
                  ? 'text-lorica-accent border-b border-lorica-accent bg-lorica-accent/5'
                  : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/30'
              }`}
            >
              <t.Icon size={10} /> {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Search + filters — only when browsing the list. */}
      {bodyMode === 'list' && view === 'list' && (
        <div className="px-2 py-1.5 border-b border-lorica-border shrink-0">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-lorica-textDim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search brain…"
              className="w-full bg-lorica-bg border border-lorica-border rounded pl-6 pr-2 py-1 text-[11px] text-lorica-text outline-none focus:border-lorica-accent/50"
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <button
              onClick={() => setTypeFilter('all')}
              className={`text-[9px] px-1.5 py-0.5 rounded border ${typeFilter === 'all' ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim'}`}
            >
              All
            </button>
            {BRAIN_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTypeFilter(typeFilter === t.id ? 'all' : t.id)}
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  typeFilter === t.id ? `${t.bg} ${t.color}` : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
                }`}
                title={t.label}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={doExtract}
            disabled={extracting}
            className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-2 py-1 rounded border border-lorica-accent/30 bg-lorica-accent/10 text-lorica-accent text-[10px] hover:bg-lorica-accent/20 transition-colors disabled:opacity-40"
          >
            <Sparkles size={10} />
            {extracting ? 'Extracting…' : 'Auto-extract from last chat'}
          </button>
        </div>
      )}

      {/* Main body — fills remaining space, scrolls internally. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {bodyMode === 'edit' && editing && (
          <EntryEditor
            draft={editing}
            onChange={setEditing}
            onSave={save}
            onCancel={cancelEdit}
          />
        )}

        {bodyMode === 'detail' && selected && (
          <EntryView
            entry={selected}
            entries={entries}
            onEdit={startEdit}
            onDelete={() => { remove(); goBackToList(); }}
            onOpenEntry={(e) => { setSelectedPath(e.path); setMode('read'); setView('list'); }}
          />
        )}

        {bodyMode === 'timeline' && (
          <TimelineView entries={entries} onOpenEntry={(e) => { setSelectedPath(e.path); setMode('read'); setView('list'); }} />
        )}

        {bodyMode === 'graph' && (
          <GraphView entries={entries} onOpenEntry={(e) => { setSelectedPath(e.path); setMode('read'); setView('list'); }} />
        )}

        {bodyMode === 'list' && (
          <>
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-[10px] text-lorica-textDim">
                {entries.length === 0 ? 'No brain entries yet.' : 'No matches.'}
              </div>
            ) : (
              Array.from(grouped.entries()).map(([typeId, list]) => {
                const t = BRAIN_TYPES.find((x) => x.id === typeId) || BRAIN_TYPES[4];
                return (
                  <div key={typeId}>
                    <div className={`px-2.5 py-1 text-[9px] uppercase tracking-widest font-semibold ${t.color} border-b border-lorica-border/50 bg-lorica-bg/40 sticky top-0`}>
                      {t.emoji} {t.label} · {list.length}
                    </div>
                    {list.map((e) => (
                      <button
                        key={e.path}
                        onClick={() => { setSelectedPath(e.path); setMode('read'); }}
                        className="w-full text-left px-3 py-1.5 border-b border-lorica-border/30 transition-colors hover:bg-lorica-border/30"
                      >
                        <div className="text-[11px] font-medium truncate text-lorica-text">
                          {e.title}
                        </div>
                        <div className="text-[9px] text-lorica-textDim truncate">
                          {e.date}{e.tags.length ? ` · ${e.tags.slice(0, 2).join(', ')}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Footer toggle — only in list mode. */}
      {bodyMode === 'list' && (
        <div className="px-3 py-1.5 border-t border-lorica-border text-[9px] text-lorica-textDim shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!state.brainInAgent}
              onChange={() => dispatch({ type: 'TOGGLE_BRAIN_IN_AGENT' })}
              className="accent-lorica-accent"
            />
            <span>Include in agent context</span>
          </label>
        </div>
      )}
    </div>
  );
}

function EntryView({ entry, entries, onEdit, onDelete, onOpenEntry }) {
  const t = BRAIN_TYPES.find((x) => x.id === entry.type) || BRAIN_TYPES[4];

  // Resolve outgoing + incoming links for this entry. We walk the full
  // graph because entries is small; a sparse per-entry lookup would
  // complicate state without meaningful perf gains.
  const links = useMemo(() => {
    const graph = buildBrainGraph(entries || []);
    const node = graph.get(entry.path);
    if (!node) return { outgoing: [], incoming: [] };
    const byPath = new Map(entries.map((e) => [e.path, e]));
    return {
      outgoing: [...node.outgoing].map((p) => byPath.get(p)).filter(Boolean),
      incoming: [...node.incoming].map((p) => byPath.get(p)).filter(Boolean),
    };
  }, [entry.path, entries]);

  // Preprocess the body to make [[links]] clickable. We convert them
  // into a custom marker that MarkdownMessage renders as a link.
  // Simpler approach: substitute [[Target]] → [Target](lorica-brain://target)
  // then override the anchor click.
  const bodyWithLinks = useMemo(() => {
    if (!entry.body) return '';
    return entry.body.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => {
      const t = target.trim();
      return `[${t}](lorica-brain://${encodeURIComponent(t)})`;
    });
  }, [entry.body]);

  // Intercept clicks on brain:// links and navigate inside the panel.
  const onContentClick = (e) => {
    const el = e.target.closest('a');
    if (!el) return;
    const href = el.getAttribute('href');
    if (!href || !href.startsWith('lorica-brain://')) return;
    e.preventDefault();
    const target = decodeURIComponent(href.replace('lorica-brain://', ''));
    const hit = resolveLink(target, entries);
    if (hit && onOpenEntry) onOpenEntry(hit);
  };

  return (
    <>
      <div className="px-4 py-2 border-b border-lorica-border flex items-center gap-2 shrink-0">
        <span className="text-lg">{t.emoji}</span>
        <span className={`text-xs font-semibold text-lorica-text truncate`}>{entry.title}</span>
        <span className="text-[9px] text-lorica-textDim">{entry.date}</span>
        <div className="flex-1" />
        <button onClick={onEdit} className="text-[10px] text-lorica-accent hover:underline px-2 py-0.5">Edit</button>
        <button onClick={onDelete} className="text-[10px] text-red-400 hover:underline px-2 py-0.5">Delete</button>
      </div>
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 py-1.5 border-b border-lorica-border/50">
          {entry.tags.map((t) => (
            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-lorica-border/30 text-lorica-textDim">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 text-[12px]" onClick={onContentClick}>
        <MarkdownMessage content={bodyWithLinks || '_(empty)_'} isStreaming={false} />
      </div>
      {(links.outgoing.length > 0 || links.incoming.length > 0) && (
        <div className="border-t border-lorica-border px-4 py-2 bg-lorica-panel/40 shrink-0">
          {links.outgoing.length > 0 && (
            <div className="mb-1">
              <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1 flex items-center gap-1">
                <Link2 size={9} /> Links to ({links.outgoing.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {links.outgoing.map((e) => (
                  <button key={e.path} onClick={() => onOpenEntry(e)} className="text-[10px] px-1.5 py-0.5 rounded border border-lorica-accent/30 bg-lorica-accent/10 text-lorica-accent hover:bg-lorica-accent/20">
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {links.incoming.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1 flex items-center gap-1">
                <ArrowRight size={9} /> Linked from ({links.incoming.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {links.incoming.map((e) => (
                  <button key={e.path} onClick={() => onOpenEntry(e)} className="text-[10px] px-1.5 py-0.5 rounded border border-sky-400/30 bg-sky-400/10 text-sky-400 hover:bg-sky-400/20">
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Timeline view — groups entries by month, renders a scrollable column.
// Each entry is a small card; click to open in the List view.
function TimelineView({ entries, onOpenEntry }) {
  const byMonth = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = (e.date || 'unknown').slice(0, 7) || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  if (entries.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-[11px] text-lorica-textDim">No entries yet.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {byMonth.map(([month, list]) => (
        <div key={month}>
          <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-2 sticky top-0 bg-lorica-surface py-1">
            {month === 'unknown' ? 'No date' : new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}
          </div>
          <div className="space-y-1.5 border-l-2 border-lorica-border/50 pl-3 ml-1">
            {list.map((e) => {
              const t = BRAIN_TYPES.find((x) => x.id === e.type) || BRAIN_TYPES[4];
              return (
                <button
                  key={e.path}
                  onClick={() => onOpenEntry(e)}
                  className="w-full text-left block py-1 px-2 rounded hover:bg-lorica-accent/10 transition-colors group relative"
                >
                  <span className={`absolute -left-[18px] top-2 w-2.5 h-2.5 rounded-full border-2 border-lorica-surface ${t.bg.replace('bg-', 'bg-').replace('/10', '/60')}`} />
                  <div className="flex items-center gap-2">
                    <span>{t.emoji}</span>
                    <span className="text-[11px] font-semibold text-lorica-text">{e.title}</span>
                    <span className="text-[9px] text-lorica-textDim ml-auto">{e.date}</span>
                  </div>
                  {e.body && (
                    <div className="text-[10px] text-lorica-textDim line-clamp-1 pl-5 mt-0.5">{e.body.replace(/\s+/g, ' ').slice(0, 100)}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Graph view — circular force-less placement of all entries, edges are
// [[links]] between them. Same simple approach as the Code Canvas mini-
// graph (SVG), keeps bundle lean.
function GraphView({ entries, onOpenEntry }) {
  const width = 900, height = 500;
  const graph = useMemo(() => buildBrainGraph(entries), [entries]);
  const nodes = useMemo(() => {
    const arr = entries.map((e, i) => ({ entry: e, deg: (graph.get(e.path)?.outgoing.size || 0) + (graph.get(e.path)?.incoming.size || 0) }));
    arr.sort((a, b) => b.deg - a.deg);
    const cx = width / 2, cy = height / 2, r = Math.min(cx, cy) - 40;
    return arr.map((n, i) => {
      const t = (i / arr.length) * 2 * Math.PI;
      return { ...n, x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
    });
  }, [entries, graph]);
  const pathIndex = useMemo(() => new Map(nodes.map((n) => [n.entry.path, n])), [nodes]);

  if (entries.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-[11px] text-lorica-textDim">No entries yet.</div>;
  }

  const edges = [];
  for (const e of entries) {
    for (const tgt of (graph.get(e.path)?.outgoing || [])) {
      edges.push([e.path, tgt]);
    }
  }

  const color = (typeId) => (BRAIN_TYPES.find((t) => t.id === typeId) || BRAIN_TYPES[4]).bg.replace('bg-', '').replace('/10', '');

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="p-2 text-[10px] text-lorica-textDim flex items-center gap-3">
        <span>{entries.length} entries · {edges.length} links</span>
        <span className="ml-auto">Click a node to open · hover for title</span>
      </div>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="flex-1">
        {edges.map(([a, b], i) => {
          const na = pathIndex.get(a), nb = pathIndex.get(b);
          if (!na || !nb) return null;
          return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="var(--color-accent)" strokeOpacity={0.3} strokeWidth={0.8} />;
        })}
        {nodes.map((n) => {
          const r = 5 + Math.min(8, Math.sqrt(n.deg) * 3);
          const typeMeta = BRAIN_TYPES.find((x) => x.id === n.entry.type) || BRAIN_TYPES[4];
          const stroke = typeMeta.color.replace('text-', '').replace('/', '-');
          return (
            <g key={n.entry.path} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'pointer' }} onClick={() => onOpenEntry(n.entry)}>
              <title>{n.entry.title}</title>
              <circle r={r} fill="var(--color-panel)" stroke="currentColor" className={typeMeta.color} strokeWidth={1.5} />
              <text x={0} y={r + 10} textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill="var(--color-textDim)">
                {n.entry.title.length > 18 ? n.entry.title.slice(0, 17) + '…' : n.entry.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EntryEditor({ draft, onChange, onSave, onCancel }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-lorica-border flex items-center gap-2 shrink-0">
        <FileIcon size={12} className="text-lorica-accent" />
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">
          {draft.path ? 'Editing' : 'New entry'}
        </span>
        <div className="flex-1" />
        <button onClick={onCancel} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
          <XIcon size={10} /> Cancel
        </button>
        <button onClick={onSave} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/30">
          <Check size={10} /> Save
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-lorica-border/50">
        <select
          value={draft.type}
          onChange={(e) => onChange({ ...draft, type: e.target.value })}
          className="bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] text-lorica-text outline-none"
        >
          {BRAIN_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>
          ))}
        </select>
        <input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          placeholder="Title"
          className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-xs text-lorica-text outline-none focus:border-lorica-accent/50"
        />
      </div>

      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-lorica-border/50">
        <span className="text-[9px] uppercase tracking-widest text-lorica-textDim">Tags:</span>
        <input
          value={draft.tags.join(', ')}
          onChange={(e) => onChange({ ...draft, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          placeholder="comma, separated"
          className="flex-1 bg-transparent text-[10px] text-lorica-text outline-none"
        />
      </div>

      <textarea
        value={draft.body}
        onChange={(e) => onChange({ ...draft, body: e.target.value })}
        placeholder={'# Context\n\nWhat led to this decision / fact / learning.\n\n# Decision\n\nWhat we chose and why.'}
        className="flex-1 bg-lorica-bg font-mono text-[12px] text-lorica-text outline-none p-4 resize-none"
      />
    </div>
  );
}
