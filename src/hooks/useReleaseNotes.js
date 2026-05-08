// src/hooks/useReleaseNotes.js
//
// Shows the release-notes modal once per major version bump. We stamp
// the last-seen version in localStorage; when the current version
// differs, we open the modal and update the stamp so it never shows
// again unless the user upgrades.
//
// The user can also reopen it manually from Settings or the Omnibar at
// any time — that path bypasses this hook.

import { useEffect } from 'react';
import { APP_VERSION } from '../version';

const KEY = 'lorica.lastSeenVersion.v1';

export function useReleaseNotes(dispatch) {
  useEffect(() => {
    let lastSeen = '';
    try { lastSeen = localStorage.getItem(KEY) || ''; } catch {}
    if (lastSeen === APP_VERSION) return;
    // Defer the dispatch to browser-idle time so first-paint isn't
    // racing the modal open. The 1500 ms setTimeout is still used as a
    // fallback for browsers (Safari) lacking requestIdleCallback.
    const run = () => {
      dispatch({ type: 'SET_PANEL', panel: 'showReleaseNotes', value: true });
      try { localStorage.setItem(KEY, APP_VERSION); } catch {}
    };
    let idleId = null;
    let timeoutId = null;
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(run, 1500);
    }
    return () => {
      if (idleId != null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [dispatch]);
}
