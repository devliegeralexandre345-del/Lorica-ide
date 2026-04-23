// Language Server Protocol integration.
//
// Lifecycle:
//   - When a file opens: ensure a session for its language is running.
//     First file of a given language spawns the server; subsequent
//     files reuse the same session (one server process per language,
//     not per file, since LSPs handle multi-file workspaces natively).
//   - Send `textDocument/didOpen` when a file's content first hits us.
//   - Send `textDocument/didChange` (debounced) on each edit.
//   - Send `textDocument/didClose` when a tab is closed.
//
// If the language server binary isn't installed, `startSession` surfaces
// an informative error including the install command. We store that in
// state so the UI can show it once, and then the static completion
// fallback takes over.

import { useCallback, useEffect, useRef, useState } from 'react';

// Map file extension → LSP language id. The backend `get_lsp_server`
// function uses the same mapping — keep this in sync or LSP never
// launches for the given file type.
const LANGUAGE_BY_EXT = {
  py: 'python', pyi: 'python',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  rs: 'rust',
  go: 'go',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  java: 'java',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css',
  sql: 'sql',
  php: 'php',
  json: 'json', jsonc: 'json',
};

/** File path → sanitized file URI (LSP servers accept `file://` URIs). */
function pathToUri(filePath) {
  if (!filePath) return null;
  // Windows paths need forward slashes and a leading `file:///`.
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.startsWith('/')
    ? `file://${normalized}`
    : `file:///${normalized}`;
}

/** Shared state — one session per language across all files. */
export function useLSP(state) {
  // Map language-id → { sessionId, status, error }.
  const [sessions, setSessions] = useState({});
  // Map filePath → { language, version }. Tracks files we've already
  // sent `didOpen` for so we can send `didChange` instead next time.
  const openedRef = useRef(new Map());
  const debounceRef = useRef(new Map());

  const projectPath = state.projectPath;
  const activeFile = state.openFiles?.[state.activeFileIndex];
  const activeLanguage = activeFile
    ? LANGUAGE_BY_EXT[(activeFile.extension || '').toLowerCase()] || null
    : null;

  // Ensure a session exists for the given language. Idempotent — if one
  // is already running, returns its id; if a previous attempt failed,
  // doesn't retry automatically (user would have to re-trigger after
  // installing the server).
  const ensureSession = useCallback(async (language) => {
    if (!language || !projectPath) return null;
    const current = sessions[language];
    if (current?.sessionId) return current.sessionId;
    if (current?.status === 'failed') return null; // don't retry silently

    // Mark "starting" synchronously so parallel callers don't race
    // into spawning two servers.
    setSessions((prev) => ({ ...prev, [language]: { status: 'starting' } }));
    try {
      const uri = pathToUri(projectPath);
      const res = await window.lorica.lsp.start({
        language,
        root_uri: uri,
        workspace_folders: [{ uri, name: projectPath.split(/[\\/]/).pop() || 'workspace' }],
      });
      if (res?.success === false || !res?.data) {
        setSessions((prev) => ({
          ...prev,
          [language]: { status: 'failed', error: res?.error || 'LSP server not available' },
        }));
        return null;
      }
      const sessionId = res.data;
      setSessions((prev) => ({ ...prev, [language]: { sessionId, status: 'ready' } }));
      return sessionId;
    } catch (e) {
      setSessions((prev) => ({
        ...prev,
        [language]: { status: 'failed', error: String(e) },
      }));
      return null;
    }
  }, [projectPath, sessions]);

  // Notify the server that a file is open.
  const didOpen = useCallback(async (file) => {
    if (!file?.path || file.content == null) return;
    const language = LANGUAGE_BY_EXT[(file.extension || '').toLowerCase()];
    if (!language) return;
    const sessionId = await ensureSession(language);
    if (!sessionId) return;
    const uri = pathToUri(file.path);
    if (openedRef.current.has(file.path)) return; // already open server-side
    openedRef.current.set(file.path, { language, version: 1 });
    await window.lorica.lsp.notify(sessionId, 'textDocument/didOpen', {
      textDocument: { uri, languageId: language, version: 1, text: file.content },
    });
  }, [ensureSession]);

  // Notify the server that a file changed. Full-document sync for
  // simplicity — incremental sync is faster but requires tracking
  // per-edit ranges which adds complexity we don't need yet.
  const didChange = useCallback((file) => {
    if (!file?.path || file.content == null) return;
    const state = openedRef.current.get(file.path);
    if (!state) return; // never opened — ignore
    // Debounce per-file so rapid typing doesn't flood the server.
    const prior = debounceRef.current.get(file.path);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(async () => {
      const sess = sessions[state.language];
      if (!sess?.sessionId) return;
      const nextVersion = state.version + 1;
      openedRef.current.set(file.path, { ...state, version: nextVersion });
      await window.lorica.lsp.notify(sess.sessionId, 'textDocument/didChange', {
        textDocument: { uri: pathToUri(file.path), version: nextVersion },
        contentChanges: [{ text: file.content }],
      });
    }, 200);
    debounceRef.current.set(file.path, timer);
  }, [sessions]);

  const didClose = useCallback(async (file) => {
    if (!file?.path) return;
    const state = openedRef.current.get(file.path);
    if (!state) return;
    openedRef.current.delete(file.path);
    const timer = debounceRef.current.get(file.path);
    if (timer) { clearTimeout(timer); debounceRef.current.delete(file.path); }
    const sess = sessions[state.language];
    if (!sess?.sessionId) return;
    await window.lorica.lsp.notify(sess.sessionId, 'textDocument/didClose', {
      textDocument: { uri: pathToUri(file.path) },
    });
  }, [sessions]);

  // Completion — returns an array of LSP CompletionItems or null if
  // no server is available. The caller (CodeMirror extension) maps
  // these into the CodeMirror completion shape.
  const requestCompletion = useCallback(async (file, line, character) => {
    const language = LANGUAGE_BY_EXT[(file.extension || '').toLowerCase()];
    if (!language) return null;
    const sess = sessions[language];
    if (!sess?.sessionId) return null;
    const res = await window.lorica.lsp.request(
      sess.sessionId,
      'textDocument/completion',
      {
        textDocument: { uri: pathToUri(file.path) },
        position: { line, character },
        context: { triggerKind: 1 /* Invoked */ },
      },
    );
    if (res?.success === false) return null;
    const data = res?.data;
    // Spec says responses are `CompletionItem[] | CompletionList | null`.
    if (Array.isArray(data)) return data;
    if (data?.items) return data.items;
    return null;
  }, [sessions]);

  const requestHover = useCallback(async (file, line, character) => {
    const language = LANGUAGE_BY_EXT[(file.extension || '').toLowerCase()];
    if (!language) return null;
    const sess = sessions[language];
    if (!sess?.sessionId) return null;
    const res = await window.lorica.lsp.request(
      sess.sessionId,
      'textDocument/hover',
      {
        textDocument: { uri: pathToUri(file.path) },
        position: { line, character },
      },
    );
    if (res?.success === false) return null;
    return res?.data || null;
  }, [sessions]);

  const requestDefinition = useCallback(async (file, line, character) => {
    const language = LANGUAGE_BY_EXT[(file.extension || '').toLowerCase()];
    if (!language) return null;
    const sess = sessions[language];
    if (!sess?.sessionId) return null;
    const res = await window.lorica.lsp.request(
      sess.sessionId,
      'textDocument/definition',
      {
        textDocument: { uri: pathToUri(file.path) },
        position: { line, character },
      },
    );
    if (res?.success === false) return null;
    return res?.data || null;
  }, [sessions]);

  // Poll diagnostics for the active file. Servers push these via
  // `publishDiagnostics` notifications; the backend caches them by URI
  // and we pull-style fetch them on a slow interval.
  const [diagnostics, setDiagnostics] = useState([]);
  useEffect(() => {
    if (!activeFile || !activeLanguage) { setDiagnostics([]); return; }
    const sess = sessions[activeLanguage];
    if (!sess?.sessionId) { setDiagnostics([]); return; }
    const uri = pathToUri(activeFile.path);
    const tick = async () => {
      const res = await window.lorica.lsp.diagnostics(sess.sessionId);
      if (res?.success === false) return;
      // Filter by URI — the backend returns diagnostics across all
      // files the server has reported on.
      const all = Array.isArray(res?.data) ? res.data : [];
      setDiagnostics(all.filter((d) => !d.uri || d.uri === uri));
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => clearInterval(iv);
  }, [activeFile?.path, activeLanguage, sessions]);

  // When a file becomes active, send didOpen if we haven't already.
  useEffect(() => {
    if (activeFile) didOpen(activeFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path]);

  // On content change (saved or typed), notify the server.
  useEffect(() => {
    if (activeFile) didChange(activeFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.content]);

  // Cleanup all sessions on unmount / project change.
  useEffect(() => {
    return () => {
      for (const s of Object.values(sessions)) {
        if (s?.sessionId) {
          window.lorica.lsp.stop(s.sessionId).catch(() => {});
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  return {
    sessions,
    diagnostics,
    activeLanguage,
    requestCompletion,
    requestHover,
    requestDefinition,
    didOpen,
    didClose,
  };
}
