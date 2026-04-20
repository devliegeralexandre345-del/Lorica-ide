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

  useEffect(() => { refresh(); }, [refresh]);

  return { refresh };
}
