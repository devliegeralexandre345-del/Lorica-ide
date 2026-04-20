// src/components/Scratchpad.jsx
//
// Project-scoped notebook. Was a single file; now a directory of
// notebooks at `.lorica/scratchpad/*.md`, each with its own content.
// A sidebar lists notebooks, with new / rename / delete affordances.
//
// Default notebook "main" is auto-created on first use to preserve
// behaviour from the single-file version.
//
// Saves stay debounced (600 ms). Markdown preview toggle unchanged.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StickyNote, Eye, Edit3, Plus, Trash2, Check, X, BookOpen,
} from 'lucide-react';
import MarkdownMessage from './MarkdownMessage';

const DEBOUNCE_MS = 600;

function dirPath(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}scratchpad`;
}
function filePath(projectPath, slug) {
  const d = dirPath(projectPath);
  if (!d) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${d}${sep}${slug}.md`;
}
function slugify(name) {
  return String(name || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';
}

export default function Scratchpad({ state, dispatch }) {
  const [notebooks, setNotebooks] = useState([]); // [{slug, name, path}]
  const [activeSlug, setActiveSlug] = useState(null);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState('edit');
  const [status, setStatus] = useState('idle');
  const [renamingSlug, setRenamingSlug] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const saveTimerRef = useRef(null);
  const loadedRef = useRef(false);
  const projectPath = state.projectPath;

  // Single-file migration hook. If `.lorica/scratchpad.md` exists (legacy
  // location) we copy it into the new directory as "main.md" on load and
  // leave the original in place — user can delete it manually if they
  // want. Runs once per project.
  const loadNotebooks = useCallback(async () => {
    loadedRef.current = false;
    if (!projectPath) { setNotebooks([]); setActiveSlug(null); setContent(''); return; }
    const dir = dirPath(projectPath);
    try { await window.lorica.fs.createDir(dir); } catch {}

    // Migrate legacy file if present AND no notebook exists yet.
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const legacyPath = `${projectPath}${sep}.lorica${sep}scratchpad.md`;
    try {
      const listed = await window.lorica.fs.readDir(dir);
      const already = (listed?.data || []).some((e) => !e.isDirectory && e.name.endsWith('.md'));
      if (!already) {
        const legacy = await window.lorica.fs.readFile(legacyPath);
        if (legacy?.success && legacy.data.content) {
          await window.lorica.fs.writeFile(`${dir}${sep}main.md`, legacy.data.content);
        } else {
          // No legacy either — seed with an empty "main.md".
          await window.lorica.fs.writeFile(`${dir}${sep}main.md`, '');
        }
      }
    } catch {}

    const r = await window.lorica.fs.readDir(dir).catch(() => null);
    if (!r?.success) { setNotebooks([]); return; }
    const mds = (Array.isArray(r.data) ? r.data : [])
      .filter((e) => !e.isDirectory && e.name.endsWith('.md'))
      .map((e) => ({
        slug: e.name.replace(/\.md$/, ''),
        name: e.name.replace(/\.md$/, ''),
        path: e.path,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setNotebooks(mds);
    // Pick the first notebook if none active, or keep the current one if
    // it still exists after a rename/delete.
    setActiveSlug((cur) => mds.some((n) => n.slug === cur) ? cur : (mds[0]?.slug || null));
    loadedRef.current = true;
  }, [projectPath]);

  useEffect(() => { loadNotebooks(); }, [loadNotebooks]);

  // Load active notebook content.
  useEffect(() => {
    if (!activeSlug || !projectPath) { setContent(''); return; }
    const p = filePath(projectPath, activeSlug);
    (async () => {
      try {
        const r = await window.lorica.fs.readFile(p);
        setContent(r?.success ? (r.data.content || '') : '');
      } catch { setContent(''); }
    })();
  }, [activeSlug, projectPath]);

  // Debounced save of active notebook.
  useEffect(() => {
    if (!loadedRef.current || !activeSlug || !projectPath) return;
    const p = filePath(projectPath, activeSlug);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try { await window.lorica.fs.writeFile(p, content); setStatus('saved'); setTimeout(() => setStatus('idle'), 1200); }
      catch { setStatus('idle'); }
    }, DEBOUNCE_MS);
    return () => saveTimerRef.current && clearTimeout(saveTimerRef.current);
  }, [content, activeSlug, projectPath]);

  const createNotebook = async () => {
    const base = prompt('Notebook name?', 'new-notebook');
    if (!base) return;
    const slug = slugify(base);
    if (notebooks.some((n) => n.slug === slug)) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Notebook already exists', duration: 2000 } });
      return;
    }
    const path = filePath(projectPath, slug);
    try {
      await window.lorica.fs.writeFile(path, `# ${base}\n\n`);
      await loadNotebooks();
      setActiveSlug(slug);
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Create failed: ${e.message}`, duration: 3000 } });
    }
  };

  const deleteNotebook = async (slug) => {
    if (!confirm(`Delete notebook "${slug}"?`)) return;
    const p = filePath(projectPath, slug);
    try {
      await window.lorica.fs.deletePath(p);
      if (activeSlug === slug) setActiveSlug(null);
      await loadNotebooks();
    } catch {}
  };

  const startRename = (slug) => { setRenamingSlug(slug); setRenameDraft(slug); };
  const commitRename = async (slug) => {
    const fresh = slugify(renameDraft);
    if (!fresh || fresh === slug) { setRenamingSlug(null); return; }
    if (notebooks.some((n) => n.slug === fresh)) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Name already taken', duration: 2000 } });
      return;
    }
    const oldPath = filePath(projectPath, slug);
    const newPath = filePath(projectPath, fresh);
    try {
      // Tauri rename is available; fallback to read+write+delete if not.
      if (window.lorica.fs.rename) {
        await window.lorica.fs.rename(oldPath, newPath);
      } else {
        const r = await window.lorica.fs.readFile(oldPath);
        if (r?.success) {
          await window.lorica.fs.writeFile(newPath, r.data.content);
          await window.lorica.fs.deletePath(oldPath);
        }
      }
      if (activeSlug === slug) setActiveSlug(fresh);
      setRenamingSlug(null);
      await loadNotebooks();
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Rename failed: ${e.message}`, duration: 3000 } });
    }
  };

  const insertTimestamp = () => {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    setContent((c) => `${c}${c.endsWith('\n') || !c ? '' : '\n'}## ${stamp}\n\n`);
  };

  const activeNotebook = notebooks.find((n) => n.slug === activeSlug);

  if (!projectPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[11px] text-lorica-textDim">
        <StickyNote size={22} className="opacity-40 mb-2" />
        Open a project to use the Scratchpad.
      </div>
    );
  }

  return (
    <div className="h-full flex bg-lorica-surface">
      {/* Notebook sidebar */}
      <div className="w-40 border-r border-lorica-border flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-lorica-border flex items-center gap-2">
          <BookOpen size={12} className="text-amber-400" />
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Notebooks</span>
          <button onClick={createNotebook} className="ml-auto p-0.5 rounded text-lorica-textDim hover:text-amber-400" title="New notebook">
            <Plus size={11} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notebooks.length === 0 && (
            <div className="p-3 text-[10px] text-lorica-textDim">No notebooks yet.</div>
          )}
          {notebooks.map((n) => (
            <div key={n.slug} className={`group flex items-center gap-1 px-2 py-1.5 border-b border-lorica-border/30 ${
              activeSlug === n.slug ? 'bg-amber-400/10' : 'hover:bg-lorica-border/30'
            }`}>
              {renamingSlug === n.slug ? (
                <>
                  <input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(n.slug); if (e.key === 'Escape') setRenamingSlug(null); }}
                    autoFocus
                    className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1 py-0.5 text-[11px] outline-none"
                  />
                  <button onClick={() => commitRename(n.slug)} className="text-emerald-400"><Check size={10} /></button>
                  <button onClick={() => setRenamingSlug(null)} className="text-lorica-textDim"><X size={10} /></button>
                </>
              ) : (
                <>
                  <button onClick={() => setActiveSlug(n.slug)} className={`flex-1 text-left text-[11px] truncate ${
                    activeSlug === n.slug ? 'text-amber-400 font-semibold' : 'text-lorica-text'
                  }`}>
                    {n.name}
                  </button>
                  <button onClick={() => startRename(n.slug)} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-amber-400" title="Rename">
                    <Edit3 size={9} />
                  </button>
                  <button onClick={() => deleteNotebook(n.slug)} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-red-400" title="Delete">
                    <Trash2 size={9} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border shrink-0">
          <StickyNote size={14} className="text-amber-400" />
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">
            {activeNotebook?.name || 'Scratchpad'}
          </span>
          <span className="text-[9px] text-lorica-textDim/70">
            {status === 'saving' ? 'saving…' : status === 'saved' ? 'saved' : activeNotebook ? `.lorica/scratchpad/${activeNotebook.slug}.md` : '—'}
          </span>
          <div className="flex-1" />
          <button onClick={insertTimestamp} className="text-[10px] text-lorica-textDim hover:text-amber-400 px-2 py-0.5 rounded hover:bg-lorica-border/40">
            + timestamp
          </button>
          <div className="flex rounded border border-lorica-border overflow-hidden">
            <button
              onClick={() => setMode('edit')}
              className={`px-2 py-0.5 text-[10px] flex items-center gap-1 ${
                mode === 'edit' ? 'bg-amber-400/20 text-amber-400' : 'text-lorica-textDim hover:text-lorica-text'
              }`}
            >
              <Edit3 size={10} /> Edit
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`px-2 py-0.5 text-[10px] flex items-center gap-1 ${
                mode === 'preview' ? 'bg-amber-400/20 text-amber-400' : 'text-lorica-textDim hover:text-lorica-text'
              }`}
            >
              <Eye size={10} /> Preview
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {!activeNotebook && (
            <div className="h-full flex items-center justify-center text-[11px] text-lorica-textDim">
              Create a notebook to start writing.
            </div>
          )}
          {activeNotebook && mode === 'edit' && (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Jot ideas, links, todos…"
              className="w-full h-full bg-lorica-bg text-xs text-lorica-text font-mono resize-none outline-none p-3 placeholder:text-lorica-textDim/50"
            />
          )}
          {activeNotebook && mode === 'preview' && (
            <div className="h-full overflow-y-auto p-3">
              {content ? <MarkdownMessage content={content} isStreaming={false} /> : <div className="text-[11px] text-lorica-textDim">Nothing to preview yet.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
