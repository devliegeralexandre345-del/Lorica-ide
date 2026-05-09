// src/components/CollabPanel.jsx
//
// Real-time collaboration panel — Wave 11.5. Start or join a session,
// see connected peers + their active file + cursor position. Awareness
// only in v0; full text sync is queued for v1 (it requires
// y-codemirror.next which we deliberately haven't installed yet).

import React, { useEffect, useRef, useState } from 'react';
import {
  X, Users, Wifi, WifiOff, Copy, Play, Square, Link2, AlertTriangle, Check,
  Share2, FileText,
} from 'lucide-react';
import { generateRoomId } from '../utils/collab';

export default function CollabPanel({ state, dispatch, collab, activeFile }) {
  const [displayName, setDisplayName] = useState(() =>
    state.agentIdentity?.name || ''
  );
  const [joinId, setJoinId] = useState('');
  const [copied, setCopied] = useState(false);
  const linkInputRef = useRef(null);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showCollab', value: false });

  // Republish our cursor when the active file changes — peers see the
  // file we're focused on update without us having to type.
  useEffect(() => {
    if (!collab.active || !activeFile) return;
    collab.publishCursor({ file: activeFile.path || activeFile.name, line: 1, column: 1 });
  }, [collab, activeFile]);

  const handleStart = () => {
    const name = displayName.trim() || 'Anonymous';
    const id = collab.start({ displayName: name });
    if (!id) return;
    if (activeFile) {
      // Initial cursor publish so peers see what we're looking at right
      // away rather than waiting for the first selection change.
      collab.publishCursor({ file: activeFile.path || activeFile.name, line: 1, column: 1 });
    }
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'success', message: 'Live Share session started — share the room id', duration: 2500 },
    });
  };

  const handleJoin = () => {
    const id = joinId.trim();
    if (!id) return;
    const name = displayName.trim() || 'Anonymous';
    collab.start({ roomId: id, displayName: name });
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'info', message: `Joining ${id.slice(0, 18)}…`, duration: 2500 },
    });
  };

  const handleStop = () => {
    collab.stop();
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'info', message: 'Live Share session ended', duration: 1800 },
    });
  };

  const copyRoomId = async () => {
    if (!collab.roomId) return;
    try {
      await navigator.clipboard.writeText(collab.roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the input so the user can copy manually.
      linkInputRef.current?.select();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-2xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(34,211,238,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Users size={15} className="text-cyan-400" />
          <div className="text-sm font-semibold text-lorica-text">Live Share</div>
          <div className="text-[10px] text-lorica-textDim">Peer-to-peer · cursors + full text sync (Wave 17, v1).</div>
          <div className="flex-1" />
          {collab.active ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-300">
              <Wifi size={10} /> live · {collab.peers.length + 1} {collab.peers.length === 0 ? 'just you' : 'connected'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-lorica-textDim">
              <WifiOff size={10} /> offline
            </span>
          )}
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {collab.error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {collab.error}
          </div>
        )}

        <div className="px-5 py-4 border-b border-lorica-border space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Display name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name (peers see this)"
              disabled={collab.active}
              className="mt-1 w-full bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent disabled:opacity-60"
            />
          </div>

          {!collab.active ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleStart}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-400/15 border border-cyan-400/40 text-[11px] text-cyan-200 hover:bg-cyan-400/25"
              >
                <Play size={11} />
                Start a new session
              </button>
              <span className="text-[10px] text-lorica-textDim">or</span>
              <input
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="Paste a room id to join"
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
                className="flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-[11px] text-lorica-text font-mono outline-none focus:border-lorica-accent"
              />
              <button
                onClick={handleJoin}
                disabled={!joinId.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-lorica-accent/15 border border-lorica-accent/40 text-[11px] text-lorica-accent hover:bg-lorica-accent/25 disabled:opacity-40"
              >
                <Link2 size={11} />
                Join
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Link2 size={12} className="text-lorica-textDim" />
                <input
                  ref={linkInputRef}
                  readOnly
                  value={collab.roomId || ''}
                  className="flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-[11px] text-lorica-text font-mono outline-none"
                />
                <button
                  onClick={copyRoomId}
                  className={`flex items-center gap-1 px-3 py-2 rounded-lg text-[11px] border ${
                    copied
                      ? 'bg-emerald-400/15 border-emerald-400/40 text-emerald-300'
                      : 'bg-lorica-bg border-lorica-border text-lorica-textDim hover:text-lorica-text'
                  }`}
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-400/15 border border-red-400/40 text-[11px] text-red-300 hover:bg-red-400/25"
                >
                  <Square size={10} />
                  Stop
                </button>
              </div>
              <p className="text-[10px] text-lorica-textDim">
                Share this room id privately — anyone who has it can join. Signaling
                runs over public Yjs servers; the editor traffic is peer-to-peer
                WebRTC, not via Lorica.
              </p>

              {/* Wave 17 — pick ONE file to share live. The active file
                  the user opens in the main editor when they hit Share
                  becomes the synced doc. Other files stay private. */}
              <div className="mt-3 pt-3 border-t border-lorica-border/40 space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Shared file</div>
                {collab.sharedFile ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-emerald-400/10 border border-emerald-400/30 text-[11px]">
                    <FileText size={11} className="text-emerald-300" />
                    <span className="font-mono text-lorica-text truncate flex-1">{collab.sharedFile}</span>
                    <button
                      onClick={collab.unshareFile}
                      className="text-[10px] text-emerald-200 hover:text-emerald-100"
                    >
                      Unshare
                    </button>
                  </div>
                ) : activeFile?.path ? (
                  <button
                    onClick={() => {
                      collab.shareFile(activeFile.path, activeFile.content || '');
                      dispatch({
                        type: 'ADD_TOAST',
                        toast: { type: 'success', message: `Sharing ${activeFile.name || activeFile.path} live`, duration: 2500 },
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-400/15 border border-cyan-400/40 text-[11px] text-cyan-200 hover:bg-cyan-400/25"
                  >
                    <Share2 size={11} />
                    Share active file ({activeFile.name || activeFile.path.split(/[\\/]/).pop()})
                  </button>
                ) : (
                  <div className="text-[10px] text-lorica-textDim italic">Open a file to share it.</div>
                )}
                <p className="text-[10px] text-lorica-textDim">
                  Edits in the shared file sync to all peers in real time via CRDT
                  (Yjs). Peers join the existing content — no overwrite. Other open
                  files stay private to your machine.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-2">Peers</div>
          {collab.active ? (
            collab.peers.length === 0 ? (
              <div className="text-center py-8 text-[11px] text-lorica-textDim">
                You&apos;re the only one connected. Share the room id to invite a peer.
              </div>
            ) : (
              <ul className="space-y-2">
                {collab.peers.map((p) => (
                  <li
                    key={p.clientID}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-lorica-border bg-lorica-bg/40"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
                      style={{ background: p.color, boxShadow: `0 0 8px ${p.color}80` }}
                    />
                    <div className="text-[12px] font-semibold text-lorica-text">{p.name}</div>
                    <div className="flex-1" />
                    <div className="text-[10px] text-lorica-textDim font-mono truncate max-w-[260px]">
                      {p.file
                        ? `${p.file}${p.line ? `:${p.line}` : ''}`
                        : 'no active file'}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="text-center py-8 text-[11px] text-lorica-textDim">Start or join a session to see peers.</div>
          )}
        </div>
      </div>
    </div>
  );
}
