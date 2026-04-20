// src/components/TodoBoard.jsx
//
// Project-scoped kanban, now with real product features:
//   • Drag-and-drop between columns (HTML5 native DnD, no deps)
//   • Priority flags (P0/P1/P2) with colour-coded left border
//   • Due dates with an "overdue" / "due soon" badge derived live
//   • Free-form tags + filter chips at the top
//   • Archive flag — archived cards hidden by default, restorable
//
// Storage stays at `.lorica/todos.json`. The schema is additive: older
// files without priority/due/tags/archived still load; we just default
// missing fields on read.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck, Plus, X, Circle, Play, Check, FileText, Flag,
  Calendar, Tag, Archive, ArchiveRestore, Filter,
} from 'lucide-react';

const COLUMNS = [
  { id: 'todo',  label: 'Todo',  icon: Circle, color: 'text-sky-400',     bg: 'bg-sky-400/5' },
  { id: 'doing', label: 'Doing', icon: Play,   color: 'text-amber-400',   bg: 'bg-amber-400/5' },
  { id: 'done',  label: 'Done',  icon: Check,  color: 'text-emerald-400', bg: 'bg-emerald-400/5' },
];

const PRIORITIES = [
  { id: 'p0', label: 'P0', color: 'text-red-400',    ring: 'border-l-red-400' },
  { id: 'p1', label: 'P1', color: 'text-amber-400',  ring: 'border-l-amber-400' },
  { id: 'p2', label: 'P2', color: 'text-lorica-textDim', ring: 'border-l-lorica-border' },
];

const PERSIST_DEBOUNCE_MS = 250;

function normalizeCard(raw) {
  return {
    id: raw.id,
    title: raw.title || '',
    note: raw.note || '',
    status: ['todo', 'doing', 'done'].includes(raw.status) ? raw.status : 'todo',
    file: raw.file || null,
    line: raw.line || 0,
    priority: ['p0', 'p1', 'p2'].includes(raw.priority) ? raw.priority : 'p2',
    dueAt: raw.dueAt || null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    archived: !!raw.archived,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || raw.createdAt || Date.now(),
  };
}

function dueStatus(dueAt) {
  if (!dueAt) return null;
  const now = Date.now();
  const delta = dueAt - now;
  if (delta < 0) return { tone: 'overdue', label: `overdue ${fmtDelta(-delta)}` };
  if (delta < 24 * 3600 * 1000) return { tone: 'soon', label: `due in ${fmtDelta(delta)}` };
  return { tone: 'planned', label: `due ${new Date(dueAt).toLocaleDateString()}` };
}
function fmtDelta(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)       return `${s}s`;
  if (s < 3600)     return `${Math.floor(s / 60)}m`;
  if (s < 86400)    return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function TodoBoard({ state, dispatch }) {
  const [cards, setCards]         = useState([]);
  const [draft, setDraft]         = useState('');
  const [filterTag, setFilterTag] = useState(null);
  const [filterPrio, setFilterPrio] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const projectPath = state.projectPath;
  const saveTimerRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const dragIdRef    = useRef(null);

  const todoPath = useCallback(() => {
    if (!projectPath) return null;
    const sep = projectPath.includes('\\') ? '\\' : '/';
    return `${projectPath}${sep}.lorica${sep}todos.json`;
  }, [projectPath]);

  // Load on project change — tolerate legacy files missing the new fields.
  useEffect(() => {
    const p = todoPath();
    hasLoadedRef.current = false;
    if (!p) { setCards([]); hasLoadedRef.current = true; return; }
    (async () => {
      try {
        const r = await window.lorica.fs.readFile(p);
        if (r?.success) {
          try {
            const parsed = JSON.parse(r.data.content);
            const raw = Array.isArray(parsed?.cards) ? parsed.cards : [];
            setCards(raw.map(normalizeCard));
          } catch { setCards([]); }
        } else {
          setCards([]);
        }
      } catch { setCards([]); }
      hasLoadedRef.current = true;
    })();
  }, [projectPath, todoPath]);

  // Debounced persist.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const p = todoPath();
    if (!p) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try { await window.lorica.fs.createDir(p.replace(/[\\/]todos\.json$/, '')); } catch {}
      try { await window.lorica.fs.writeFile(p, JSON.stringify({ cards }, null, 2)); } catch {}
    }, PERSIST_DEBOUNCE_MS);
    return () => saveTimerRef.current && clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, projectPath]);

  // ── Derived tag list (sorted by frequency for useful filter order) ──
  const allTags = useMemo(() => {
    const count = new Map();
    for (const c of cards) for (const t of c.tags || []) count.set(t, (count.get(t) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [cards]);

  const visible = useMemo(() => {
    return cards.filter((c) =>
      (showArchived || !c.archived) &&
      (!filterTag || (c.tags || []).includes(filterTag)) &&
      (!filterPrio || c.priority === filterPrio)
    );
  }, [cards, filterTag, filterPrio, showArchived]);

  // Mutations — all go through these helpers so we can attach updatedAt.
  const update = (id, patch) =>
    setCards((cs) => cs.map((c) => c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c));
  const move    = (id, status) => update(id, { status });
  const setPrio = (id, priority) => update(id, { priority });
  const toggleArchived = (id) => setCards((cs) => cs.map((c) => c.id === id ? { ...c, archived: !c.archived, updatedAt: Date.now() } : c));
  const remove  = (id) => setCards((cs) => cs.filter((c) => c.id !== id));

  const addCard = (e) => {
    e?.preventDefault?.();
    const raw = draft.trim();
    if (!raw) return;
    // Quick-parse: support inline `@tag` and `!priority` syntax in the draft.
    const tags = [...raw.matchAll(/#([a-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase());
    let priority = 'p2';
    const prioMatch = raw.match(/\b!(p[0-2])\b/i);
    if (prioMatch) priority = prioMatch[1].toLowerCase();
    const cleaned = raw.replace(/#[a-z0-9_-]+/gi, '').replace(/\s*!p[0-2]\b/i, '').trim();
    setCards((cs) => [
      ...cs,
      normalizeCard({
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        title: cleaned, status: 'todo',
        priority, tags,
        createdAt: Date.now(),
      }),
    ]);
    setDraft('');
  };

  const linkActiveFile = (id) => {
    const f = state.openFiles[state.activeFileIndex];
    if (!f) return;
    update(id, { file: f.path, line: 1 });
  };

  const jumpToLink = (card) => {
    if (!card.file) return;
    window.lorica.fs.readFile(card.file).then((r) => {
      if (!r?.success) return;
      const name = card.file.split(/[\\/]/).pop();
      const ext = name.includes('.') ? name.split('.').pop() : '';
      dispatch({
        type: 'OPEN_FILE',
        file: {
          path: card.file, name, extension: ext,
          content: r.data.content, dirty: false,
          pendingGoto: { line: card.line || 1 },
        },
      });
    });
  };

  // ── Drag and drop ────────────────────────────────────────────────────
  const onDragStart = (id, e) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers require data to be set for dragend to fire.
    try { e.dataTransfer.setData('text/plain', id); } catch {}
  };
  const onDragOverCol = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDropCol = (status, e) => {
    e.preventDefault();
    const id = dragIdRef.current;
    dragIdRef.current = null;
    if (!id) return;
    move(id, status);
  };

  if (!projectPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[11px] text-lorica-textDim">
        <ClipboardCheck size={22} className="opacity-40 mb-2" />
        Open a project to enable the TODO board.
        <div className="opacity-60 mt-1">Cards are stored at <code>.lorica/todos.json</code>.</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-lorica-surface">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border shrink-0">
        <ClipboardCheck size={14} className="text-emerald-400" />
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">TODO Board</span>
        <span className="ml-auto text-[10px] text-lorica-textDim">
          {visible.length} / {cards.filter((c) => showArchived || !c.archived).length}
        </span>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`p-1 rounded text-[10px] transition-colors ${
            showArchived ? 'text-lorica-accent bg-lorica-accent/10' : 'text-lorica-textDim hover:text-lorica-text'
          }`}
          title={showArchived ? 'Hide archived' : 'Show archived'}
        >
          <Archive size={11} />
        </button>
      </div>

      {/* Compose row — supports #tag and !p0 inline shortcuts. */}
      <form onSubmit={addCard} className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border shrink-0">
        <Plus size={12} className="text-lorica-textDim" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New card — try: Fix login bug #auth !p0"
          className="flex-1 bg-transparent text-xs outline-none text-lorica-text placeholder:text-lorica-textDim/60"
        />
      </form>

      {/* Filter row — priorities + tags */}
      {(allTags.length > 0 || cards.length > 0) && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-lorica-border/50 bg-lorica-panel/30 flex-wrap">
          <Filter size={9} className="text-lorica-textDim" />
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterPrio(filterPrio === p.id ? null : p.id)}
              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                filterPrio === p.id ? `bg-lorica-bg/70 border-current ${p.color}` : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
              }`}
            >
              <Flag size={8} /> {p.label}
            </button>
          ))}
          {allTags.length > 0 && <span className="text-[9px] text-lorica-textDim mx-1">·</span>}
          {allTags.slice(0, 12).map((t) => (
            <button
              key={t}
              onClick={() => setFilterTag(filterTag === t ? null : t)}
              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                filterTag === t ? 'bg-lorica-accent/15 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
              }`}
            >
              <Tag size={8} /> {t}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-2 p-2">
        {COLUMNS.map((col) => {
          const Icon = col.icon;
          const colCards = visible.filter((c) => c.status === col.id);
          return (
            <div
              key={col.id}
              className={`flex flex-col rounded-lg border border-lorica-border ${col.bg} min-h-[200px]`}
              onDragOver={onDragOverCol}
              onDrop={(e) => onDropCol(col.id, e)}
            >
              <div className={`px-2 py-1.5 border-b border-lorica-border flex items-center gap-1.5 ${col.color}`}>
                <Icon size={11} />
                <span className="text-[10px] font-semibold uppercase tracking-widest">{col.label}</span>
                <span className="ml-auto text-[10px] opacity-60">{colCards.length}</span>
              </div>
              <div className="flex-1 p-1.5 space-y-1.5">
                {colCards.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    onDragStart={(e) => onDragStart(card.id, e)}
                    onRemove={() => remove(card.id)}
                    onArchive={() => toggleArchived(card.id)}
                    onSetPrio={(p) => setPrio(card.id, p)}
                    onSetDue={(d) => update(card.id, { dueAt: d })}
                    onSetTags={(tags) => update(card.id, { tags })}
                    onSetNote={(note) => update(card.id, { note })}
                    onMove={(s) => move(card.id, s)}
                    onLink={() => linkActiveFile(card.id)}
                    onJump={() => jumpToLink(card)}
                    activeFile={state.openFiles[state.activeFileIndex]}
                  />
                ))}
                {colCards.length === 0 && (
                  <div className="text-[10px] text-lorica-textDim/60 italic p-2 text-center">Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  card, onDragStart, onRemove, onArchive, onSetPrio, onSetDue, onSetTags, onSetNote,
  onMove, onLink, onJump, activeFile,
}) {
  const [expanded, setExpanded] = useState(false);
  const prioMeta = PRIORITIES.find((p) => p.id === card.priority) || PRIORITIES[2];
  const due = dueStatus(card.dueAt);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`bg-lorica-panel border border-lorica-border rounded p-2 group hover:border-lorica-accent/40 transition-colors border-l-4 ${prioMeta.ring} ${card.archived ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-1">
        <div className="flex-1 text-[11px] text-lorica-text leading-tight">{card.title}</div>
        <button onClick={() => setExpanded((v) => !v)} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-lorica-accent transition-opacity text-[10px]">
          {expanded ? '−' : '…'}
        </button>
        <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-red-400 transition-opacity">
          <X size={10} />
        </button>
      </div>

      {card.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {card.tags.map((t) => (
            <span key={t} className="text-[9px] px-1 py-[1px] rounded bg-lorica-border/40 text-lorica-textDim">#{t}</span>
          ))}
        </div>
      )}

      {card.file && (
        <button
          onClick={onJump}
          className="mt-1 flex items-center gap-1 text-[9px] text-lorica-accent hover:underline truncate"
        >
          <FileText size={8} /> {card.file.split(/[\\/]/).pop()}:{card.line || 1}
        </button>
      )}

      {due && (
        <div className={`mt-1 text-[9px] flex items-center gap-1 ${
          due.tone === 'overdue' ? 'text-red-400' : due.tone === 'soon' ? 'text-amber-400' : 'text-lorica-textDim'
        }`}>
          <Calendar size={8} /> {due.label}
        </div>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-lorica-border/50 space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={card.note}
            onChange={(e) => onSetNote(e.target.value)}
            rows={2}
            placeholder="Notes…"
            className="w-full bg-lorica-bg border border-lorica-border rounded px-1.5 py-1 text-[11px] outline-none focus:border-lorica-accent/50 resize-none"
          />
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] text-lorica-textDim">Priority:</span>
            {PRIORITIES.map((p) => (
              <button
                key={p.id}
                onClick={() => onSetPrio(p.id)}
                className={`text-[9px] px-1 py-0.5 rounded border ${
                  card.priority === p.id ? `bg-lorica-bg/70 border-current ${p.color}` : 'border-lorica-border text-lorica-textDim'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Calendar size={10} className="text-lorica-textDim" />
            <input
              type="date"
              value={card.dueAt ? new Date(card.dueAt).toISOString().slice(0, 10) : ''}
              onChange={(e) => onSetDue(e.target.value ? new Date(e.target.value).getTime() : null)}
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1 py-0.5 text-[10px] text-lorica-text outline-none"
            />
            {card.dueAt && (
              <button onClick={() => onSetDue(null)} className="text-[9px] text-lorica-textDim hover:text-red-400">
                clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tag size={10} className="text-lorica-textDim" />
            <input
              value={(card.tags || []).join(', ')}
              onChange={(e) => onSetTags(e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))}
              placeholder="tag1, tag2"
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            {COLUMNS.filter((c) => c.id !== card.status).map((c) => (
              <button key={c.id} onClick={() => onMove(c.id)}
                className={`text-[9px] px-1.5 py-0.5 rounded border border-lorica-border ${c.color} opacity-70 hover:opacity-100 hover:bg-lorica-border/40`}
                title={`Move to ${c.label}`}
              >
                → {c.label}
              </button>
            ))}
            {!card.file && activeFile && (
              <button onClick={onLink} className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-lorica-border text-lorica-textDim hover:text-lorica-accent">
                <FileText size={9} />
              </button>
            )}
            <button
              onClick={onArchive}
              className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-lorica-border text-lorica-textDim hover:text-lorica-accent flex items-center gap-1"
              title={card.archived ? 'Restore' : 'Archive'}
            >
              {card.archived ? <ArchiveRestore size={9} /> : <Archive size={9} />}
              {card.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
