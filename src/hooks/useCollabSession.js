// src/hooks/useCollabSession.js
//
// React hook that owns a single live Yjs/y-webrtc session (Wave 11.5).
// Components consume `peers` (the live array of connected peers
// excluding self), `start({ roomId, displayName })`, `stop()`, and
// `publishCursor({ file, line, column })` for awareness updates.
//
// The session object lives in a ref — re-renders don't recreate it,
// and the cleanup runs exactly once when the user clicks Stop or the
// component unmounts.
//
// Bundle note: the collab utility module imports yjs + y-webrtc, which
// together weigh ~200 KiB minified. We lazy-import the module from
// inside `start()` so those bytes don't land in the eager `vendors`
// chunk — the cost is paid only when the user actually clicks "Start"
// in the CollabPanel.

import { useCallback, useEffect, useRef, useState } from 'react';

export function useCollabSession() {
  const [active, setActive] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [peers, setPeers] = useState([]);
  const [error, setError] = useState(null);
  const sessionRef = useRef(null);
  const unsubscribeRef = useRef(null);

  const cursorListenerRef = useRef(null);

  const stop = useCallback(() => {
    if (unsubscribeRef.current) {
      try { unsubscribeRef.current(); } catch {}
      unsubscribeRef.current = null;
    }
    if (cursorListenerRef.current) {
      try { window.removeEventListener('lorica:cursorMoved', cursorListenerRef.current); } catch {}
      cursorListenerRef.current = null;
    }
    if (reviewUnsubRef.current) {
      try { reviewUnsubRef.current(); } catch {}
      reviewUnsubRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.leave(); } catch {}
      sessionRef.current = null;
    }
    // Flip the global flag the cursorBeacon extension reads — turns
    // beacon emission off so we don't waste CPU on selection changes
    // while no session is live.
    window.__loricaCollabActive = false;
    setActive(false);
    setRoomId(null);
    setPeers([]);
    setError(null);
    setReviewMode(false);
    setReviewNotes([]);
  }, []);

  // Wave 40 — recent rooms persistence. The room id is the shared
  // secret; storing it locally (the user already trusted it once)
  // saves them digging through Slack DMs to re-join. Capped at 8.
  const RECENT_KEY = 'lorica.collab.recentRooms';
  const RECENT_MAX = 8;
  const readRecent = () => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };
  const pushRecent = (entry) => {
    const list = readRecent().filter((e) => e?.roomId !== entry.roomId);
    list.unshift(entry);
    while (list.length > RECENT_MAX) list.pop();
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
    setRecentRooms(list);
  };
  const forgetRecent = (roomId) => {
    const list = readRecent().filter((e) => e?.roomId !== roomId);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
    setRecentRooms(list);
  };
  const [recentRooms, setRecentRooms] = useState(readRecent);

  const start = useCallback(async ({ roomId: explicitId, displayName, signaling } = {}) => {
    // Clean up any in-flight session before starting a new one.
    if (sessionRef.current) stop();
    // Lazy-load the heavy yjs / y-webrtc bundle on first use. Until
    // then it never enters the entrypoint graph.
    let createCollabSession, generateRoomId;
    try {
      ({ createCollabSession, generateRoomId } = await import(
        /* webpackChunkName: "collab-engine" */ '../utils/collab'
      ));
    } catch (e) {
      setError(`Failed to load collab module: ${String(e?.message || e)}`);
      return null;
    }
    const id = explicitId || generateRoomId();
    try {
      const session = createCollabSession({ roomId: id, displayName, signaling });
      sessionRef.current = session;
      unsubscribeRef.current = session.onPeersChange((next) => setPeers(next));
      // Hook the cursor beacon: every selection change in the editor
      // pumps awareness updates to peers. The flag below tells the
      // cursorBeacon extension it's worth firing.
      window.__loricaCollabActive = true;
      const handleCursor = (ev) => {
        const d = ev?.detail;
        if (!d) return;
        try {
          session.setLocalState({
            cursor: { file: d.file || null, line: d.line ?? null, column: d.column ?? null },
          });
        } catch {}
      };
      window.addEventListener('lorica:cursorMoved', handleCursor);
      cursorListenerRef.current = handleCursor;
      setRoomId(id);
      setActive(true);
      setError(null);
      // Wave 40 — record this session in the recent-rooms list. We
      // skip when the user explicitly opted into a "throwaway" room
      // (signaling override is the proxy: a custom signaling list
      // means an air-gapped LAN session that probably shouldn't
      // accumulate history).
      if (!Array.isArray(signaling) || signaling.length === 0) {
        pushRecent({
          roomId: id,
          displayName: displayName || 'Anonymous',
          lastSeen: Date.now(),
        });
      }
      return id;
    } catch (e) {
      setError(String(e?.message || e));
      return null;
    }
  }, [stop]);

  // Publish our cursor to peers. Called from the editor's selection-
  // change handler.
  const publishCursor = useCallback(({ file, line, column }) => {
    const s = sessionRef.current;
    if (!s) return;
    s.setLocalState({
      cursor: { file: file || null, line: line ?? null, column: column ?? null },
    });
  }, []);

  // ── Live Share text sync (Wave 17 v1, Wave 18 v2 multi-file) ──────
  //
  // v2: any number of files can be shared in parallel. The user toggles
  // share-on / share-off per file from the CollabPanel; each shared file
  // gets its own Y.Text inside the session's Y.Doc. A single Y.Doc is
  // enough because Y.Text instances are independent — they don't fight
  // for ops as long as they have distinct keys.
  const [sharedFiles, setSharedFiles] = useState(new Set());
  const sharedTextsRef = useRef(new Map());

  // Wave 27 — review-mode state. `reviewMode` flips when the user
  // toggles the review-mode toggle in CollabPanel. `reviewNotes`
  // mirrors the session's shared Y.Array.
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewNotes, setReviewNotes] = useState([]);
  const reviewUnsubRef = useRef(null);

  const shareFile = useCallback(async (filePath, initialContent) => {
    if (!sessionRef.current || !filePath) return null;
    let ytext = sharedTextsRef.current.get(filePath);
    if (!ytext) {
      ytext = sessionRef.current.getSharedText(filePath, initialContent);
      sharedTextsRef.current.set(filePath, ytext);
    }
    setSharedFiles((cur) => {
      const next = new Set(cur);
      next.add(filePath);
      return next;
    });
    return ytext;
  }, []);

  const unshareFile = useCallback((filePath) => {
    if (!filePath) {
      // Backwards-compatible fallback for callers that still expect the
      // v1 "stop sharing whatever was shared" behaviour. Drops every
      // share so the editor flips back to private mode for all files.
      setSharedFiles(new Set());
      return;
    }
    setSharedFiles((cur) => {
      if (!cur.has(filePath)) return cur;
      const next = new Set(cur);
      next.delete(filePath);
      return next;
    });
  }, []);

  // Editor.jsx asks for the binding extension at build time. Returns
  // null when no session is live or this file isn't shared.
  const getBindingFor = useCallback(async (filePath, initialContent) => {
    if (!sessionRef.current || !filePath || !sharedFiles.has(filePath)) return null;
    let ytext = sharedTextsRef.current.get(filePath);
    if (!ytext) {
      ytext = sessionRef.current.getSharedText(filePath, initialContent);
      sharedTextsRef.current.set(filePath, ytext);
    }
    const { buildYjsBinding } = await import(
      /* webpackChunkName: "yjs-binding-loader" */ '../extensions/yjsBinding'
    );
    return buildYjsBinding({
      ytext,
      awareness: sessionRef.current.awareness,
    });
  }, [sharedFiles]);

  // Backwards-compatible single-file accessor for legacy callers.
  const sharedFile = sharedFiles.size > 0 ? Array.from(sharedFiles)[0] : null;

  // ── Wave 27 — review-mode helpers ─────────────────────────────────
  const enableReviewMode = useCallback(() => {
    if (!sessionRef.current) return;
    setReviewMode(true);
    if (reviewUnsubRef.current) return;
    reviewUnsubRef.current = sessionRef.current.onReviewNotesChange((notes) => {
      setReviewNotes(notes);
    });
  }, []);

  const disableReviewMode = useCallback(() => {
    setReviewMode(false);
    if (reviewUnsubRef.current) {
      try { reviewUnsubRef.current(); } catch {}
      reviewUnsubRef.current = null;
    }
    setReviewNotes([]);
  }, []);

  const postReviewNote = useCallback(({ file, line, text } = {}) => {
    if (!sessionRef.current || !reviewMode) return null;
    return sessionRef.current.appendReviewNote({ file, line, text });
  }, [reviewMode]);

  // Wave 35 — append a reply to an existing review note. Both the
  // note and the reply live inside the session's Y.Doc, so peers see
  // it land in real time via the `onReviewNotesChange` listener.
  const postReviewReply = useCallback((noteId, { text } = {}) => {
    if (!sessionRef.current || !reviewMode || !noteId) return null;
    return sessionRef.current.appendReviewReply(noteId, { text });
  }, [reviewMode]);

  // Final cleanup on unmount — guards against the user closing the IDE
  // mid-session without clicking Stop.
  useEffect(() => {
    return () => {
      try {
        if (unsubscribeRef.current) unsubscribeRef.current();
        if (sessionRef.current) sessionRef.current.leave();
      } catch {}
    };
  }, []);

  return {
    active,
    roomId,
    peers,
    error,
    start,
    stop,
    publishCursor,
    // Wave 17/18 — text sync surface (multi-file in v2)
    sharedFile,                    // legacy single-file accessor
    sharedFiles,                   // new: Set of every shared path
    isFileShared: (p) => sharedFiles.has(p),
    shareFile,
    unshareFile,
    getBindingFor,
    // Wave 27/35 — code-review mode
    reviewMode,
    reviewNotes,
    enableReviewMode,
    disableReviewMode,
    postReviewNote,
    postReviewReply,
    // Wave 40 — recent rooms history
    recentRooms,
    forgetRecent,
  };
}
