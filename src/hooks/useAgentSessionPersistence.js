// src/hooks/useAgentSessionPersistence.js
//
// Persists the current agent session to localStorage so the conversation
// survives app restarts. Lightweight — we don't index or list past
// sessions (that's a job for Project Brain exports); this is purely
// "continue where I left off" continuity.
//
// What's persisted:
//   • state.agentMessages  (array)
//   • state.agentConfig    (context, permissions, model, systemPromptOverride)
//   • state.agentUsage     (running token tally)
//   • state.agentSessionActive
//
// What's NOT persisted:
//   • In-flight loading state or approvals — discarded on reload so we
//     never restore a corrupt half-state.
//   • API keys (those live in the vault).
//
// Rehydration runs ONCE on mount, before the user can do anything that
// would otherwise blow away the draft — we gate on "no messages yet".

import { useEffect, useRef } from 'react';

const SESSION_KEY = 'lorica.agentSession.v1';
const SAVE_DEBOUNCE_MS = 500;

function capture(state) {
  return {
    agentMessages: state.agentMessages || [],
    agentConfig: state.agentConfig || null,
    agentUsage: state.agentUsage || null,
    agentSessionActive: !!state.agentSessionActive,
    savedAt: Date.now(),
  };
}

export function useAgentSessionPersistence(state, dispatch) {
  const hasRestoredRef = useRef(false);
  const timerRef = useRef(null);

  // Restore once on mount. We only restore if the live session is empty
  // — if the user is already mid-conversation (e.g. during a hot reload)
  // we don't clobber it.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      const live = state.agentMessages || [];
      if (live.length > 0) return;
      if (!Array.isArray(snap.agentMessages) || snap.agentMessages.length === 0) return;
      // Strip any in-flight loading markers from the saved snapshot.
      const clean = snap.agentMessages.map((m) => ({
        ...m,
        toolCalls: (m.toolCalls || []).map((tc) => ({
          ...tc,
          // Any tool call that was in 'pending' or 'running' at save
          // time is now stale — mark it as rejected so the user can see
          // the thread made progress without keeping them waiting.
          status: (tc.status === 'pending' || tc.status === 'running') ? 'rejected' : tc.status,
        })),
      }));
      dispatch({ type: 'AGENT_SET_MESSAGES', messages: clean });
      if (snap.agentConfig) dispatch({ type: 'AGENT_SET_CONFIG', config: snap.agentConfig });
      if (snap.agentUsage) dispatch({ type: 'AGENT_UPDATE_USAGE', usage: {} }); // trigger reducer
      dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Agent conversation restored', duration: 2500 } });
    } catch { /* corrupt snapshot, ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save on any relevant change.
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        // If the session has been cleared, wipe the snapshot too.
        if (!state.agentSessionActive && (!state.agentMessages || state.agentMessages.length === 0)) {
          localStorage.removeItem(SESSION_KEY);
        } else {
          localStorage.setItem(SESSION_KEY, JSON.stringify(capture(state)));
        }
      } catch { /* storage quota / privacy */ }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    state.agentMessages,
    state.agentConfig,
    state.agentSessionActive,
    state.agentUsage,
  ]);
}
