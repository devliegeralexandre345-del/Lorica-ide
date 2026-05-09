// FloatingViewer.jsx
//
// Editor running inside a Tauri floating window (see
// `cmd_window_open_floating` in src-tauri/src/lib.rs). The main app
// invokes the Rust command which spawns a new WebviewWindow pointed at
// `index.html#floating=<base64-path>`. index.jsx detects the hash and
// mounts THIS component instead of `App` so the floating bundle stays
// minimal — no menu bar, no tabs, no panels.
//
// Wave 16 — read-write mode. The viewer is now editable; Ctrl+S writes
// back to disk via the Lorica filesystem bridge. Sync with the main
// window happens "via disk":
//   1. User edits in floating window → Ctrl+S → writes file
//   2. Tauri's fs watcher emits `fs:change` for that path
//   3. Main window's useFileWatcher picks it up and re-reads the buffer
// This avoids the "two editors fight over state" problem that an
// in-memory bidirectional sync would create. A Read-only toggle is
// still available for users who want the v1 behaviour.
//
// Theme is read fresh from localStorage at mount because each Tauri
// WebviewWindow runs its own React tree — the shared `tauri://localhost`
// origin means localStorage is the same store, so re-opening reflects
// any theme change on next mount.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, drawSelection, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { bracketMatching, indentOnInput, foldGutter } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { RefreshCw, X, FileText, AlertCircle, Save, Lock, Unlock, CheckCircle2 } from 'lucide-react';
import { LANGUAGE_MAP } from './utils/languages';
import { createEditorTheme, THEMES } from './utils/themes';

function decodeFloatingHash() {
  const m = /^#floating=([A-Za-z0-9_-]+)$/.exec(window.location.hash || '');
  if (!m) return null;
  try {
    const std = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

function fileNameFromPath(p) {
  if (!p) return '';
  const norm = p.replace(/\\/g, '/');
  return norm.slice(norm.lastIndexOf('/') + 1);
}

function extensionFromPath(p) {
  const name = fileNameFromPath(p);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function applyThemeCssVars(themeName) {
  const t = THEMES[themeName] || THEMES.midnight;
  const root = document.documentElement;
  root.style.setProperty('--color-bg', t.bg);
  root.style.setProperty('--color-surface', t.surface);
  root.style.setProperty('--color-panel', t.panel);
  root.style.setProperty('--color-border', t.border);
  root.style.setProperty('--color-accent', t.accent);
  root.style.setProperty('--color-text', t.text);
  root.style.setProperty('--color-textDim', t.textDim);
  root.style.background = t.bg;
  root.style.color = t.text;
}

export default function FloatingViewer() {
  const filePath = decodeFloatingHash();
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Wave 16 — write state. `dirty` flips on any local edit; `saving`
  // gates the Ctrl+S handler so a slow disk doesn't double-fire.
  // `readOnly` is user-controlled — defaults to writable, but the user
  // can lock the window with the lock toggle if they just want to read.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const editorRef = useRef(null);
  const viewRef = useRef(null);
  // Track the version of `content` we last applied to the editor so an
  // incoming fs:change refresh doesn't clobber unsaved edits.
  const lastAppliedContentRef = useRef('');
  // Compartment so we can swap the editable state without rebuilding
  // the whole editor.
  const editableCompartment = useRef(new Compartment());

  const themeName = (() => {
    try {
      const raw = localStorage.getItem('lorica.session.v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.theme && THEMES[parsed.theme]) return parsed.theme;
      }
    } catch {}
    return 'midnight';
  })();

  useEffect(() => {
    applyThemeCssVars(themeName);
  }, [themeName]);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!filePath) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await window.lorica.fs.readFile(filePath);
      if (r?.success) {
        const next = r.data?.content ?? '';
        // Refuse to clobber dirty edits — show a warning instead.
        if (dirty && next !== lastAppliedContentRef.current) {
          setError('File changed on disk while you have unsaved edits. Save or click Reload to override.');
        } else {
          setContent(next);
          lastAppliedContentRef.current = next;
          setDirty(false);
        }
      } else if (!silent) {
        setError(r?.error || 'Failed to read file');
      }
    } catch (e) {
      if (!silent) setError(String(e?.message || e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filePath, dirty]);

  // Initial load + listen for fs:change events. Skip our own writes
  // (we just wrote: the next event is us, not external).
  const skipNextFsEventRef = useRef(false);
  useEffect(() => {
    reload();
    let unlisten = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('fs:change', (ev) => {
          const changed = ev?.payload?.path || ev?.payload;
          if (typeof changed !== 'string' || changed !== filePath) return;
          if (skipNextFsEventRef.current) {
            skipNextFsEventRef.current = false;
            return;
          }
          reload({ silent: true });
        });
      } catch {}
    })();
    return () => { if (unlisten) try { unlisten(); } catch {} };
  }, [filePath, reload]);

  // Save handler — writes the editor's current content to disk via the
  // Lorica fs bridge. Sets `skipNextFsEvent` so the file watcher doesn't
  // round-trip our own write back into a confusing reload.
  const save = useCallback(async () => {
    if (!viewRef.current || !filePath || saving) return;
    const text = viewRef.current.state.doc.toString();
    setSaving(true);
    try {
      skipNextFsEventRef.current = true;
      const r = await window.lorica.fs.writeFile(filePath, text);
      if (r?.success) {
        lastAppliedContentRef.current = text;
        setContent(text);
        setDirty(false);
        setSavedAt(Date.now());
        setError(null);
      } else {
        setError(r?.error || 'Failed to save');
        skipNextFsEventRef.current = false;
      }
    } catch (e) {
      setError(String(e?.message || e));
      skipNextFsEventRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [filePath, saving]);

  // Build / rebuild the CodeMirror editor when content first loads.
  // We DON'T rebuild on every content change — we only push fresh
  // content into the existing view via a transaction, so cursor and
  // undo history survive.
  useEffect(() => {
    if (loading || error || !editorRef.current) return;

    if (!viewRef.current) {
      const ext = extensionFromPath(filePath);
      const lang = LANGUAGE_MAP[ext];
      const langExt = lang ? lang() : null;

      const extensions = [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        foldGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        closeBrackets(),
        highlightSelectionMatches(),
        editableCompartment.current.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
        createEditorTheme(themeName),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
          // Ctrl+S / Cmd+S → save. We register through a "Mod-s"
          // binding so both platforms work. CodeMirror's keymap stops
          // propagation when the handler returns true, so the browser
          // doesn't get a chance to open its native Save dialog.
          { key: 'Mod-s', run: () => { save(); return true; } },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const cur = u.state.doc.toString();
            setDirty(cur !== lastAppliedContentRef.current);
          }
        }),
      ];
      if (langExt) extensions.push(langExt);

      viewRef.current = new EditorView({
        state: EditorState.create({ doc: content, extensions }),
        parent: editorRef.current,
      });
      lastAppliedContentRef.current = content;
    } else {
      // Existing editor — replace doc only if it diverged from outside
      // edits and the user has no unsaved changes.
      const cur = viewRef.current.state.doc.toString();
      if (cur !== content && !dirty) {
        viewRef.current.dispatch({
          changes: { from: 0, to: cur.length, insert: content },
        });
        lastAppliedContentRef.current = content;
      }
    }

    return () => {
      // We don't destroy the view here — only on unmount. The first-
      // load path returns from the `if (!viewRef.current)` arm; the
      // subsequent-update path doesn't replace it. Cleanup runs in the
      // outer unmount effect below.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, loading, error, filePath, themeName, save]);

  // Swap the editable compartment whenever readOnly toggles, without
  // rebuilding the editor.
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: editableCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // Final destroy on unmount.
  useEffect(() => {
    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []);

  // Beforeunload guard — if the user has unsaved edits, warn before
  // closing the floating window.
  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  if (!filePath) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-textDim)' }}>
        <div className="text-sm">No file path provided.</div>
      </div>
    );
  }

  const name = fileNameFromPath(filePath);

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <div
        className="flex items-center gap-2 px-3 py-2 border-b text-xs"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <FileText size={13} style={{ color: 'var(--color-accent)' }} />
        <span className="font-semibold truncate">
          {name}
          {dirty && <span style={{ color: 'var(--color-accent)' }}> ●</span>}
        </span>
        <span style={{ color: 'var(--color-textDim)' }} className="truncate text-[10px]">{filePath}</span>
        <span style={{ color: readOnly ? '#fbbf24' : 'var(--color-textDim)' }} className="text-[10px]">
          {readOnly ? 'read-only' : (dirty ? 'unsaved' : savedAt ? 'saved' : 'live')}
        </span>
        <div className="flex-1" />
        <button
          onClick={save}
          disabled={saving || readOnly || !dirty}
          title="Save (Ctrl/Cmd+S)"
          className="p-1 rounded hover:opacity-80 disabled:opacity-30 transition-opacity"
          style={{ color: dirty ? 'var(--color-accent)' : 'var(--color-textDim)' }}
        >
          {savedAt && !dirty ? <CheckCircle2 size={12} /> : <Save size={12} />}
        </button>
        <button
          onClick={() => setReadOnly((v) => !v)}
          title={readOnly ? 'Switch to read-write' : 'Lock to read-only'}
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-textDim)' }}
        >
          {readOnly ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button
          onClick={() => reload()}
          title="Reload from disk (drops unsaved edits)"
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-textDim)' }}
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => {
            if (dirty && !window.confirm('Unsaved edits will be lost. Close anyway?')) return;
            window.lorica.window.close();
          }}
          title="Close"
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-textDim)' }}
        >
          <X size={12} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: '#ff8080' }}>
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}

      <div ref={editorRef} className="flex-1 overflow-auto" />
    </div>
  );
}
