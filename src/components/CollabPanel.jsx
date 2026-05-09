// src/components/CollabPanel.jsx
//
// Real-time collaboration panel — Wave 11.5. Start or join a session,
// see connected peers + their active file + cursor position. Awareness
// only in v0; full text sync is queued for v1 (it requires
// y-codemirror.next which we deliberately haven't installed yet).

import React, { useEffect, useRef, useState } from 'react';
import {
  X, Users, Wifi, WifiOff, Copy, Play, Square, Link2, AlertTriangle, Check,
  Share2, FileText, MessageSquare, MapPin, Send, CornerDownRight,
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

              {/* Wave 18 — multi-file shares. Toggle each open file
                  in or out of the session independently. Active file
                  has a one-click "Share" button at the top. */}
              <div className="mt-3 pt-3 border-t border-lorica-border/40 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold flex-1">
                    Shared files {collab.sharedFiles?.size > 0 && `(${collab.sharedFiles.size})`}
                  </div>
                  {activeFile?.path && !collab.isFileShared(activeFile.path) && (
                    <button
                      onClick={() => {
                        collab.shareFile(activeFile.path, activeFile.content || '');
                        dispatch({
                          type: 'ADD_TOAST',
                          toast: { type: 'success', message: `Sharing ${activeFile.name || activeFile.path}`, duration: 2200 },
                        });
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-400/15 border border-cyan-400/40 text-[10px] text-cyan-200 hover:bg-cyan-400/25"
                    >
                      <Share2 size={10} />
                      Share active
                    </button>
                  )}
                </div>
                {collab.sharedFiles?.size === 0 ? (
                  <div className="text-[10px] text-lorica-textDim italic">No files shared yet. Click "Share active" above.</div>
                ) : (
                  <div className="space-y-1">
                    {Array.from(collab.sharedFiles || []).map((p) => (
                      <div key={p} className="flex items-center gap-2 px-2 py-1 rounded bg-emerald-400/10 border border-emerald-400/30 text-[10px]">
                        <FileText size={10} className="text-emerald-300" />
                        <span className="font-mono text-lorica-text truncate flex-1" title={p}>
                          {p.split(/[\\/]/).slice(-2).join('/')}
                        </span>
                        <button
                          onClick={() => collab.unshareFile(p)}
                          className="text-[9px] text-emerald-200 hover:text-emerald-100"
                        >
                          Unshare
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-lorica-textDim">
                  Each shared file syncs to peers via CRDT. Peers see your remote
                  cursor as a coloured caret in their editor. Other open files stay
                  private to your machine.
                </p>
              </div>

              {/* Wave 27 — code-review mode. When enabled, peers can
                  drop review notes that everyone in the session sees
                  in a shared feed. Independent of the per-file Y.Texts
                  so the live document stays clean. */}
              <div className="mt-3 pt-3 border-t border-lorica-border/40 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold flex-1">
                    Review mode
                  </div>
                  <button
                    onClick={() => collab.reviewMode ? collab.disableReviewMode() : collab.enableReviewMode()}
                    className={`relative w-9 h-4 rounded-full transition-colors ${collab.reviewMode ? 'bg-violet-400' : 'bg-lorica-border'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${collab.reviewMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {collab.reviewMode ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-lorica-textDim">
                      Drop a review note at the active cursor — everyone in the session sees it live.
                    </p>
                    <button
                      onClick={() => {
                        const f = activeFile;
                        if (!f?.path) {
                          dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Open a file first', duration: 1800 } });
                          return;
                        }
                        const text = window.prompt(`Review note on ${f.name || f.path}:`);
                        if (!text || !text.trim()) return;
                        const note = collab.postReviewNote({ file: f.path, line: 1, text: text.trim() });
                        if (note) {
                          dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Review note posted', duration: 1800 } });
                        }
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-violet-400/15 border border-violet-400/40 text-[10px] text-violet-200 hover:bg-violet-400/25"
                    >
                      <MessageSquare size={10} />
                      Post review note on active file
                    </button>
                    {collab.reviewNotes?.length > 0 && (
                      <ReviewNoteFeed notes={collab.reviewNotes} postReviewReply={collab.postReviewReply} />
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-lorica-textDim">
                    Off. Toggle on to leave inline notes peers see live in the panel.
                  </p>
                )}
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

// Wave 35 — review-note feed with per-note reply input. Pulled out of
// the main render so the input state stays scoped (one open
// composer per note id rather than a shared draft).
function ReviewNoteFeed({ notes, postReviewReply }) {
  const [replyDrafts, setReplyDrafts] = React.useState({});
  const [openId, setOpenId] = React.useState(null);

  const setDraft = (id, text) => setReplyDrafts((cur) => ({ ...cur, [id]: text }));
  const submit = (id) => {
    const text = (replyDrafts[id] || '').trim();
    if (!text || typeof postReviewReply !== 'function') return;
    postReviewReply(id, { text });
    setReplyDrafts((cur) => ({ ...cur, [id]: '' }));
  };

  return (
    <div className="space-y-1 max-h-72 overflow-y-auto">
      {notes.slice().reverse().slice(0, 30).map((n) => {
        const replyOpen = openId === n.id;
        return (
          <div key={n.id} className="px-2 py-1 rounded bg-lorica-bg/40 border border-lorica-border text-[10px]">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: n.color }} />
              <span className="font-semibold text-lorica-text">{n.author}</span>
              <span className="text-lorica-textDim text-[9px] ml-1">{new Date(n.at).toLocaleTimeString()}</span>
              <div className="flex-1" />
              <span className="text-lorica-textDim text-[9px] font-mono truncate max-w-[180px]" title={n.file}>
                <MapPin size={8} className="inline mr-0.5" />
                {(n.file || '').split(/[\\/]/).pop()}:{n.line}
              </span>
            </div>
            <div className="text-lorica-text">{n.text}</div>

            {/* Existing replies */}
            {Array.isArray(n.replies) && n.replies.length > 0 && (
              <div className="mt-1.5 ml-2 pl-2 border-l border-lorica-border/50 space-y-0.5">
                {n.replies.map((r) => (
                  <div key={r.id} className="text-[10px]">
                    <CornerDownRight size={8} className="inline mr-1 text-lorica-textDim" />
                    <span className="font-semibold text-lorica-text" style={{ color: r.color }}>{r.author}</span>
                    <span className="text-lorica-textDim mx-1">·</span>
                    <span className="text-lorica-text">{r.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Reply composer — collapsed by default to keep the
                feed dense; clicking "reply" expands one row at a time. */}
            <div className="mt-1 flex items-center gap-1">
              <button
                onClick={() => setOpenId(replyOpen ? null : n.id)}
                className="text-[9px] text-lorica-textDim hover:text-lorica-accent"
              >
                {replyOpen ? 'cancel' : 'reply'}
              </button>
            </div>
            {replyOpen && (
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  autoFocus
                  value={replyDrafts[n.id] || ''}
                  onChange={(e) => setDraft(n.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(n.id); setOpenId(null); }
                    if (e.key === 'Escape') setOpenId(null);
                  }}
                  placeholder="reply…"
                  className="flex-1 bg-lorica-bg/60 border border-lorica-border rounded px-2 py-0.5 text-[10px] text-lorica-text outline-none focus:border-lorica-accent"
                />
                <button
                  onClick={() => { submit(n.id); setOpenId(null); }}
                  disabled={!(replyDrafts[n.id] || '').trim()}
                  className="p-1 rounded text-lorica-textDim hover:text-lorica-accent disabled:opacity-30"
                >
                  <Send size={9} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
