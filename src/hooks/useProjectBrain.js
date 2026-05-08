// src/hooks/useProjectBrain.js
//
// Loads the Project Brain entries for the current project and exposes a
// refresh function. The entries sit in redux state so any component
// (panel, agent context, omnibar) can consume them without refetching.

import { useCallback, useEffect } from 'react';
import { loadBrainEntries } from '../utils/projectBrain';

export function useProjectBrain(projectPath, dispatch) {
  const refresh = useCallback(async () => {
    if (!projectPath) {
      dispatch({ type: 'SET_BRAIN_ENTRIES', entries: [] });
      return;
    }
    const entries = await loadBrainEntries(projectPath);
    dispatch({ type: 'SET_BRAIN_ENTRIES', entries });
  }, [projectPath, dispatch]);

  // Defer the brain load to browser-idle time. The brain is consumed by
  // the Brain panel + the agent preamble — neither is on the first-paint
  // critical path. 200 ms setTimeout fallback for Safari.
  useEffect(() => {
    let idleId = null;
    let timeoutId = null;
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(() => refresh(), { timeout: 2000 });
    } else {
      timeoutId = setTimeout(refresh, 200);
    }
    return () => {
      if (idleId != null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [refresh]);

  return { refresh };
}
