// src/utils/collab.js
//
// Real-time collaboration session manager — Wave 11.5 (alpha).
//
// Stack: Yjs (CRDT engine) + y-webrtc (peer-to-peer transport, no
// server required, signaling via the public free WebRTC signaling
// servers Yjs ships defaults for). The peer connection is direct
// browser-to-browser; signaling only carries connection-setup
// metadata, not editor content.
//
// Lorica's privacy posture: collab requires the user to enable it
// explicitly, and the data never lands on a Lorica-owned server. The
// signaling URLs are public Yjs defaults — replace via Settings if
// you want to run your own.
//
// v1 scope (Wave 17):
//   • Awareness — each peer publishes their name, active file,
//     cursor row/col (rendered as a panel row + a coloured caret).
//   • Full text sync via Y.Text bound to CodeMirror with
//     y-codemirror.next. Edits made by any peer propagate to all
//     others; concurrent edits merge cleanly (CRDT). Bind one file at
//     a time: the user picks a file to "share" and we expose its
//     Y.Text to the editor; other files stay private.
//
// Room id: `lorica-<pseudo-uuid>`. Users either create a session
// (random id, copy invite) or join one (paste id). The id is the
// shared secret — anyone who has it can join the session.

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

// Pseudo-uuid: 16 bytes of randomness, hex-encoded. Good enough as a
// shared secret for short-lived collab sessions; not a security claim.
export function generateRoomId() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return 'lorica-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Color generator — assign a stable color to a peer based on their
// userId so their cursor always renders in the same hue.
const PEER_COLORS = [
  '#ff6b9d', '#00d4ff', '#a78bfa', '#34d399', '#f59e0b',
  '#fb7185', '#22d3ee', '#c084fc', '#10b981', '#f472b6',
];
export function colorForUser(userId) {
  let h = 0;
  const s = String(userId || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length];
}

// Build a session. Returns:
//   {
//     ydoc, provider, awareness,
//     setLocalState(partial),  // shallow-merge into local awareness state
//     onPeersChange(cb),       // (peers: Array) => void
//     leave(),
//   }
//
// `displayName` is what other peers see in their panel + above their
// remote cursor. `signaling` overrides the default y-webrtc signaling
// URLs — e.g. for an air-gapped LAN setup.
export function createCollabSession({ roomId, displayName, signaling }) {
  if (!roomId) throw new Error('roomId is required');

  const ydoc = new Y.Doc();
  const provider = new WebrtcProvider(roomId, ydoc, {
    // Public signaling servers shipped by Yjs as defaults. Override via
    // Settings → Collab → Signaling URLs if needed.
    signaling: Array.isArray(signaling) && signaling.length
      ? signaling
      : [
          'wss://signaling.yjs.dev',
          'wss://y-webrtc-signaling-eu.herokuapp.com',
          'wss://y-webrtc-signaling-us.herokuapp.com',
        ],
    // No password by default — the room id is the shared secret.
    password: null,
  });

  const awareness = provider.awareness;
  // Seed our local awareness with the user-visible identity.
  awareness.setLocalStateField('user', {
    name: displayName || 'Anonymous',
    color: colorForUser(awareness.clientID),
  });

  // setLocalState — partial-merge into our awareness payload. Awareness
  // is one object per client; we keep it shallow-flat so updates from
  // multiple call sites (cursor move, file change) compose without
  // clobbering each other.
  function setLocalState(partial) {
    if (!partial || typeof partial !== 'object') return;
    const cur = awareness.getLocalState() || {};
    awareness.setLocalState({ ...cur, ...partial });
  }

  // Convert the awareness map to a plain peer-list snapshot the UI can
  // render directly. Filters out our own clientID — no point listing
  // ourselves as a peer.
  function snapshotPeers() {
    const out = [];
    awareness.getStates().forEach((state, clientID) => {
      if (clientID === awareness.clientID) return;
      out.push({
        clientID,
        name: state.user?.name || `peer-${clientID}`,
        color: state.user?.color || colorForUser(clientID),
        file: state.cursor?.file || null,
        line: state.cursor?.line ?? null,
        column: state.cursor?.column ?? null,
      });
    });
    return out;
  }

  // Subscribe to awareness updates with a small debouncer — y-webrtc
  // can fire several updates per cursor move. The debounce keeps the
  // React render rate sane.
  function onPeersChange(cb) {
    if (typeof cb !== 'function') return () => {};
    let timer = null;
    const handler = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        cb(snapshotPeers());
      }, 60);
    };
    awareness.on('change', handler);
    // Fire once with the current snapshot so the UI doesn't sit empty
    // until the next change.
    cb(snapshotPeers());
    return () => {
      awareness.off('change', handler);
      if (timer) clearTimeout(timer);
    };
  }

  function leave() {
    try { provider.disconnect(); } catch {}
    try { provider.destroy(); } catch {}
    try { ydoc.destroy(); } catch {}
  }

  // ── Wave 17 — shared text binding ──────────────────────────────────
  //
  // Expose a Y.Text keyed by a stable id (typically a file path) so the
  // editor can bind to it and edits propagate to all peers. The Y.Doc
  // already enforces last-writer-wins per character offset under
  // concurrent edits — y-codemirror.next handles the CodeMirror side.
  //
  // We seed the Y.Text with the local file's contents the FIRST time
  // someone in the session asks for that key. Subsequent peers join an
  // already-populated Y.Text and don't re-seed (prevents the duplicate-
  // content bug where two peers both insert the file body).
  //
  // A small `Y.Map` named `_meta` tracks which keys have been seeded so
  // the seed-once decision is itself a CRDT (no race between two peers
  // seeding simultaneously).
  const meta = ydoc.getMap('_meta');

  function getSharedText(key, initialContent) {
    const ytext = ydoc.getText(`file:${key}`);
    // Seed only if no peer has done it yet AND we have a non-empty
    // initial value to seed with. Without the meta gate, two peers
    // joining at the same time would each insert the file body and
    // we'd end up with double content.
    if (typeof initialContent === 'string' && !meta.get(key)) {
      // Mark first to short-circuit a concurrent seed attempt.
      meta.set(key, { seededAt: Date.now() });
      if (ytext.length === 0 && initialContent.length > 0) {
        ytext.insert(0, initialContent);
      }
    }
    return ytext;
  }

  // ── Wave 27 — Code-review mode ─────────────────────────────────
  //
  // A shared Y.Array of review notes. Each entry: { id, author, color,
  // file, line, text, at }. Peers append; everyone observes. Distinct
  // from the per-file Y.Texts so review notes don't pollute the
  // synced document content.
  const reviewNotes = ydoc.getArray('review-notes');

  function appendReviewNote(note) {
    if (!note || typeof note !== 'object') return;
    const safe = {
      id: note.id || ('rn_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)),
      author: String(note.author || awareness.getLocalState()?.user?.name || 'anonymous'),
      color: String(note.color || awareness.getLocalState()?.user?.color || '#fbbf24'),
      file: String(note.file || ''),
      line: typeof note.line === 'number' ? note.line : 1,
      text: String(note.text || ''),
      at: Date.now(),
      // Wave 35 — replies live as a Y.Array INSIDE the note's slot.
      // We store a placeholder array on the JS-side snapshot so peers
      // joining late see the right shape; the actual mutable list is
      // an entry in the `review-replies` Y.Map keyed by note id.
      replies: [],
    };
    reviewNotes.push([safe]);
    return safe;
  }

  // Wave 35 — replies stored as a plain Y.Map of arrays so adding a
  // reply doesn't rewrite the entire review-notes array (Y.Array push
  // would otherwise be the only mutation primitive).
  const reviewReplies = ydoc.getMap('review-replies');

  function appendReviewReply(noteId, reply) {
    if (!noteId || !reply || typeof reply !== 'object') return null;
    const safe = {
      id: reply.id || ('rr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)),
      author: String(reply.author || awareness.getLocalState()?.user?.name || 'anonymous'),
      color: String(reply.color || awareness.getLocalState()?.user?.color || '#fbbf24'),
      text: String(reply.text || ''),
      at: Date.now(),
    };
    const cur = reviewReplies.get(noteId);
    const next = Array.isArray(cur) ? [...cur, safe] : [safe];
    reviewReplies.set(noteId, next);
    return safe;
  }

  // Snapshot the Y.Array + the per-note replies into a plain JS list.
  function snapshotReviewNotes() {
    return reviewNotes.toArray().map((n) => ({
      ...n,
      replies: reviewReplies.get(n.id) || [],
    }));
  }

  function onReviewNotesChange(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = () => cb(snapshotReviewNotes());
    reviewNotes.observe(handler);
    reviewReplies.observe(handler);
    cb(snapshotReviewNotes());
    return () => {
      reviewNotes.unobserve(handler);
      reviewReplies.unobserve(handler);
    };
  }

  // ── Wave 51 — Shared bookmarks ────────────────────────────────
  //
  // A shared Y.Map keyed by clientID → { author, color, bookmarks }.
  // bookmarks itself is the local app shape:
  //   { [filePath]: { lines: number[], details: { [line]: {note,group} } } }
  // We share the WHOLE per-peer snapshot rather than a flat array so
  // a peer can ungroup themselves later (i.e. publish empty) without
  // affecting other peers' contributions.
  const sharedBookmarks = ydoc.getMap('shared-bookmarks');

  function publishBookmarks(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const cid = String(awareness.clientID);
    const safe = {
      author: String(awareness.getLocalState()?.user?.name || 'anonymous'),
      color: String(awareness.getLocalState()?.user?.color || '#fbbf24'),
      bookmarks: snapshot,
      at: Date.now(),
    };
    sharedBookmarks.set(cid, safe);
  }

  function clearMyBookmarks() {
    const cid = String(awareness.clientID);
    sharedBookmarks.delete(cid);
  }

  function snapshotSharedBookmarks() {
    const out = [];
    sharedBookmarks.forEach((entry, cid) => {
      if (!entry || typeof entry !== 'object') return;
      out.push({ clientId: cid, ...entry });
    });
    return out;
  }

  function onSharedBookmarksChange(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = () => cb(snapshotSharedBookmarks());
    sharedBookmarks.observe(handler);
    cb(snapshotSharedBookmarks());
    return () => sharedBookmarks.unobserve(handler);
  }

  return {
    ydoc,
    provider,
    awareness,
    setLocalState,
    snapshotPeers,
    onPeersChange,
    leave,
    getSharedText,
    // Wave 27 — review mode
    appendReviewNote,
    onReviewNotesChange,
    // Wave 35 — review-note replies
    appendReviewReply,
    // Wave 51 — shared bookmarks
    publishBookmarks,
    clearMyBookmarks,
    onSharedBookmarksChange,
  };
}
