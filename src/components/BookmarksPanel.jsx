// src/components/BookmarksPanel.jsx
//
// Cross-project bookmarks with per-bookmark notes and optional group
// tags. Bookmarks are grouped by user-assigned group first, then by
// file, so the panel can be sliced by "context" (reading task / fix-up
// list / exploration) instead of just by file.
//
// Stored layers:
//   • state.bookmarks          → [path]: number[]          (legacy, powers gutter)
//   • state.bookmarkDetails    → [path]: {[line]: {note, group}}
//
// Both persist to localStorage automatically via the reducer.

import React, { useMemo, useState } from 'react';
import { Star, X, FileText, Folder, Edit3, Check } from 'lucide-react';

export default function BookmarksPanel({ state, dispatch, onFileOpen }) {
  const bookmarks = state.bookmarks || {};
  const details = state.bookmarkDetails || {};
  const [filterGroup, setFilterGroup] = useState(null);
  const [editKey, setEditKey] = useState(null); // "path:line"
  const [editNote, setEditNote] = useState('');
  const [editGroup, setEditGroup] = useState('');

  const flat = useMemo(() => {
    const rows = [];
    for (const [filePath, lines] of Object.entries(bookmarks)) {
      const name = filePath.split(/[\\/]/).pop();
      for (const line of (lines || [])) {
        const meta = details[filePath]?.[line] || {};
        rows.push({ filePath, name, line, note: meta.note || '', group: meta.group || '' });
      }
    }
    rows.sort((a, b) =>
      (a.group || '~').localeCompare(b.group || '~') ||
      a.name.localeCompare(b.name) ||
      a.line - b.line
    );
    return rows;
  }, [bookmarks, details]);

  // Distinct groups — always include blank (ungrouped) at the end.
  const groups = useMemo(() => {
    const s = new Set();
    for (const r of flat) s.add(r.group || '');
    return [...s];
  }, [flat]);

  const visible = filterGroup != null ? flat.filter((r) => (r.group || '') === filterGroup) : flat;

  const jump = (row) => {
    window.lorica.fs.readFile(row.filePath).then((r) => {
      if (!r?.success) return;
      const ext = row.name.includes('.') ? row.name.split('.').pop() : '';
      dispatch({
        type: 'OPEN_FILE',
        file: {
          path: row.filePath, name: row.name, extension: ext,
          content: r.data.content, dirty: false,
          pendingGoto: { line: row.line },
        },
      });
    });
  };

  const remove = (row) => {
    dispatch({ type: 'TOGGLE_BOOKMARK', path: row.filePath, line: row.line });
  };

  const startEdit = (row) => {
    setEditKey(`${row.filePath}:${row.line}`);
    setEditNote(row.note);
    setEditGroup(row.group);
  };
  const saveEdit = (row) => {
    dispatch({ type: 'SET_BOOKMARK_DETAILS', path: row.filePath, line: row.line, note: editNote, group: editGroup.trim() });
    setEditKey(null);
  };

  // Group rows for rendering.
  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of visible) {
      const g = r.group || '';
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(r);
    }
    return m;
  }, [visible]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-lorica-border flex items-center gap-2 shrink-0">
        <Star size={14} className="text-lorica-accent" fill="currentColor" />
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Bookmarks</span>
        <span className="ml-auto text-[10px] text-lorica-textDim">{flat.length}</span>
      </div>

      {groups.length > 1 && (
        <div className="flex items-center flex-wrap gap-1 px-2 py-1.5 border-b border-lorica-border/50 bg-lorica-panel/40">
          <button
            onClick={() => setFilterGroup(null)}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${
              filterGroup == null ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
            }`}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGroup(filterGroup === g ? null : g)}
              className={`text-[9px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                filterGroup === g ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
              }`}
            >
              <Folder size={9} /> {g || 'Ungrouped'}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {flat.length === 0 && (
          <div className="p-4 text-[11px] text-lorica-textDim text-center">
            No bookmarks yet. Press <kbd className="px-1 bg-lorica-bg border border-lorica-border rounded text-[9px]">Ctrl+M</kbd> on any line.
          </div>
        )}
        {[...grouped.entries()].map(([group, rows]) => (
          <div key={group}>
            {groups.length > 1 && (
              <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-lorica-textDim font-semibold sticky top-0 bg-lorica-surface border-b border-lorica-border/30 flex items-center gap-1">
                <Folder size={9} /> {group || 'Ungrouped'}
                <span className="ml-auto text-lorica-textDim/60">{rows.length}</span>
              </div>
            )}
            {rows.map((row) => {
              const key = `${row.filePath}:${row.line}`;
              const isEditing = editKey === key;
              return (
                <div key={key} className="border-b border-lorica-border/30">
                  <div
                    className="group flex items-center gap-2 px-3 py-1.5 hover:bg-lorica-accent/10 cursor-pointer text-xs"
                    onClick={() => !isEditing && jump(row)}
                  >
                    <FileText size={11} className="text-lorica-textDim shrink-0" />
                    <span className="text-lorica-text font-medium truncate">{row.name}</span>
                    <span className="text-[10px] text-lorica-textDim">:{row.line}</span>
                    {row.note && !isEditing && (
                      <span className="text-[10px] text-lorica-accent italic truncate max-w-[160px]">— {row.note}</span>
                    )}
                    <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(row); }}
                        className="text-lorica-textDim hover:text-lorica-accent"
                        title="Edit note / group"
                      >
                        <Edit3 size={10} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(row); }}
                        className="text-lorica-textDim hover:text-red-400"
                        title="Remove bookmark"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                  {isEditing && (
                    <div className="px-3 py-2 space-y-1 bg-lorica-bg/40" onClick={(e) => e.stopPropagation()}>
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Note (optional)"
                        className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none focus:border-lorica-accent/50"
                      />
                      <div className="flex items-center gap-1">
                        <Folder size={10} className="text-lorica-textDim" />
                        <input
                          value={editGroup}
                          onChange={(e) => setEditGroup(e.target.value)}
                          placeholder="Group (optional)"
                          list="group-names"
                          className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none focus:border-lorica-accent/50"
                        />
                        <datalist id="group-names">
                          {groups.filter(Boolean).map((g) => <option key={g} value={g} />)}
                        </datalist>
                        <button onClick={() => saveEdit(row)} className="text-[10px] text-emerald-400 px-2 py-1 rounded hover:bg-emerald-400/10 flex items-center gap-1">
                          <Check size={10} /> Save
                        </button>
                        <button onClick={() => setEditKey(null)} className="text-[10px] text-lorica-textDim px-2 py-1 hover:text-lorica-text">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
