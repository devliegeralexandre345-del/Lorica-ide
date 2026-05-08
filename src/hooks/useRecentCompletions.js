// src/hooks/useRecentCompletions.js
//
// Boots the per-language recency cache from localStorage early in app
// lifecycle so the first time the static autocomplete source queries
// `getRecencyMap('javascript')`, the data is already in memory.
//
// This hook is intentionally tiny — it does not own any React state.
// All persistence and lookup logic lives in
// `src/utils/completions/recencyStore.js` so the static completion
// source factory (which has no React context) can read the same store
// synchronously on every keystroke.
//
// Falls back gracefully if localStorage throws (incognito / private
// mode); the recency feature simply becomes "session-only" rather
// than persistent.

import { useEffect } from 'react';
import { hydrateLanguage } from '../utils/completions/recencyStore';

// Languages worth pre-warming. Picking the heavy hitters keeps
// localStorage reads off the keystroke critical path even on the very
// first completion of a session. Languages not in this list still
// hydrate lazily on first lookup — same code path, just a tick later.
const PREWARM = [
  'javascript', 'typescript', 'jsx', 'tsx',
  'python', 'rust', 'go', 'java', 'cpp', 'c',
];

export function useRecentCompletions() {
  useEffect(() => {
    // Hydrate at idle so we don't compete with first paint. Keystrokes
    // can still race ahead of this — the store auto-hydrates on first
    // read, so prewarming is only a latency optimization, not a
    // correctness requirement.
    const boot = () => {
      for (const lang of PREWARM) {
        try { hydrateLanguage(lang); } catch { /* incognito → ignored */ }
      }
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(boot, { timeout: 1500 });
      return () => { try { cancelIdleCallback(id); } catch {} };
    } else {
      const id = setTimeout(boot, 250);
      return () => clearTimeout(id);
    }
  }, []);
}
