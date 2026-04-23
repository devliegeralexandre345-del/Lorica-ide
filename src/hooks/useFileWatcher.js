// File tree auto-refresh on external filesystem changes.
//
// Starts the backend file watcher when a project opens, listens for
// `fs:change` events, and debounced-calls `refreshTree(projectPath)` so
// the sidebar picks up files that were created/deleted/renamed outside
// Lorica (git checkout, npm install, another editor, etc.).
//
// Prior to this hook the watcher only fired for the semantic-reindex
// path, which is off by default. Users reported needing to hit Refresh
// manually to see files they'd just created — this fixes that.
//
// Debounced at 200ms to collapse the storms of events emitted during
// batch operations (e.g. unpacking an archive). The backend already
// drops events inside noisy dirs (node_modules / .git / target / …) so
// the frontend only sees changes the user would want to notice.

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

const DEBOUNCE_MS = 200;

export function useFileWatcher(projectPath, refreshTree) {
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    if (!projectPath) return;

    let unlisten = null;
    let cancelled = false;

    (async () => {
      try {
        await window.lorica?.fs?.watchProject(projectPath);
      } catch (e) {
        console.warn('[file-watcher] watchProject failed:', e);
        return;
      }
      if (cancelled) return;

      try {
        unlisten = await listen('fs:change', () => {
          // Coalesce bursts of events: the last one in a 200ms window
          // wins, so a single refresh is triggered instead of N.
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            refreshTree(projectPath).catch((err) => {
              console.warn('[file-watcher] refreshTree failed:', err);
            });
          }, DEBOUNCE_MS);
        });
      } catch (e) {
        console.warn('[file-watcher] listen(fs:change) failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (unlisten) {
        try { unlisten(); } catch { /* ignore */ }
      }
      // Don't unwatch on unmount — useSemanticAutoReindex may still
      // need it, and the backend treats `watchProject(same_path)` as a
      // no-op so re-subscribing later is free. Full unwatch happens
      // when the user closes the project (handled elsewhere).
    };
  }, [projectPath, refreshTree]);
}
