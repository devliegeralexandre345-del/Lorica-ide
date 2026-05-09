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
// v0 scope (this session):
//   • Awareness only: each peer publishes their name, active file,
//     cursor row/col. Peers see each other in a panel + as cursor
//     decorations in the editor.
//   • NO automatic content sync (Y.Text bound to CodeMirror) — that
//     requires y-codemirror.next which we deliberately don't install
//     yet. Adding shared editing without a UX for diverging documents
//     would lose the user's work. Documented as v1 follow-up.
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

  return { ydoc, provider, awareness, setLocalState, snapshotPeers, onPeersChange, leave };
}
