// FloatingViewer.jsx
//
// Standalone read-only viewer that renders inside a Tauri floating window
// (see `cmd_window_open_floating` in src-tauri/src/lib.rs). The main app
// invokes the Rust command which spawns a new WebviewWindow pointed at
// `index.html#floating=<base64-path>`. index.jsx detects the hash and
// mounts THIS component instead of `App` so the floating bundle stays
// minimal — no menu bar, no tabs, no panels.
//
// Read-only first pass per V2.3_ROADMAP.md ("scope to read-only floating
// preview first"). Future revisions can plumb writes back through the
// main window, but the v1 contract is "show this file, in syntax-aware
// CodeMirror, with the user's current theme".
//
// Theme is read fresh from localStorage at mount because each Tauri
// WebviewWindow runs its own React tree — the shared `tauri://localhost`
// origin means localStorage is the same store, so re-opening reflects
// any theme change on next mount.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { bracketMatching, indentOnInput, foldGutter } from '@codemirror/language';
import { history } from '@codemirror/commands';
import { highlightSelectionMatches } from '@codemirror/search';
import { RefreshCw, X, FileText, AlertCircle } from 'lucide-react';
import { LANGUAGE_MAP } from './utils/languages';
import { createEditorTheme, THEMES } from './utils/themes';

function decodeFloatingHash() {
  const m = /^#floating=([A-Za-z0-9_-]+)$/.exec(window.location.hash || '');
  if (!m) return null;
  try {
    // URL-safe base64 → standard base64 → utf-8 string.
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
  const editorRef = useRef(null);
  const viewRef = useRef(null);

  // The main App persists its session as a JSON blob under
  // `lorica.session.v1` (see hooks/useSession.js). Read the theme out of
  // that blob so the floating window matches whatever theme the user has
  // active in the main window. Fall back to midnight if the session
  // hasn't been written yet (very first launch).
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

  const reload = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const r = await window.lorica.fs.readFile(filePath);
      if (r?.success) {
        setContent(r.data?.content ?? '');
      } else {
        setError(r?.error || 'Failed to read file');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  // Initial load + watch for fs:change events on this exact path so the
  // floating viewer auto-refreshes when the file changes on disk. This is
  // the same firehose the main window listens to via useFileWatcher.
  useEffect(() => {
    reload();
    let unlisten = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('fs:change', (ev) => {
          const changed = ev?.payload?.path || ev?.payload;
          if (typeof changed === 'string' && changed === filePath) {
            reload();
          }
        });
      } catch {}
    })();
    return () => { if (unlisten) try { unlisten(); } catch {} };
  }, [filePath, reload]);

  // Build / rebuild the CodeMirror editor whenever content arrives. The
  // language extension comes from LANGUAGE_MAP — we wrap it in a Promise
  // because the extension functions are sync but defensively normalized.
  useEffect(() => {
    if (loading || error || !editorRef.current) return;
    const ext = extensionFromPath(filePath);
    const lang = LANGUAGE_MAP[ext];
    const langExt = lang ? lang() : null;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      foldGutter(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      createEditorTheme(themeName),
    ];
    if (langExt) extensions.push(langExt);

    viewRef.current = new EditorView({
      state: EditorState.create({ doc: content, extensions }),
      parent: editorRef.current,
    });

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [content, loading, error, filePath, themeName]);

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
        <span className="font-semibold truncate">{name}</span>
        <span style={{ color: 'var(--color-textDim)' }} className="truncate text-[10px]">{filePath}</span>
        <span style={{ color: 'var(--color-textDim)' }} className="text-[10px]">read-only</span>
        <div className="flex-1" />
        <button
          onClick={reload}
          title="Reload from disk"
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-textDim)' }}
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => window.lorica.window.close()}
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
