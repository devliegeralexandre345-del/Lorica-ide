// src/hooks/useSemanticAuto.js
//
// Auto-runs semantic-type inference when:
//   • User saves a JS/TS file (dirty → clean transition)
//   • Only if state.semanticAutoEnabled is on
//
// To avoid hammering the API, we debounce per-file (5s) and skip files
// we've already analyzed at the same content hash.

import { useEffect, useRef } from 'react';
import { inferSemanticTypes, loadSemanticStore, saveSemanticStore } from '../utils/semanticTypes';

const SUPPORTED_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py']);

function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

export function useSemanticAuto(state, dispatch) {
  const prevDirtyRef = useRef(new Map()); // path → lastSeenDirty boolean
  const lastHashRef  = useRef(new Map()); // path → last analysed hash
  const timersRef    = useRef(new Map()); // path → debounce timer

  useEffect(() => {
    if (!state.semanticAutoEnabled) return;
    if (!state.projectPath) return;
    const provider = state.aiProvider || 'anthropic';
    const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
    if (!apiKey) return;

    for (const file of state.openFiles) {
      if (!file || !file.path || !SUPPORTED_EXT.has(file.extension)) continue;
      const wasDirty = prevDirtyRef.current.get(file.path);
      prevDirtyRef.current.set(file.path, !!file.dirty);
      // Trigger when the file transitions from dirty → clean (i.e. a save).
      if (wasDirty && !file.dirty) {
        const hash = fnv1a(file.content || '');
        if (lastHashRef.current.get(file.path) === hash) continue;
        if (timersRef.current.has(file.path)) clearTimeout(timersRef.current.get(file.path));
        const timer = setTimeout(async () => {
          timersRef.current.delete(file.path);
          try {
            const result = await inferSemanticTypes({
              filePath: file.path,
              code: file.content,
              provider, apiKey,
            });
            if (!result) return;
            lastHashRef.current.set(file.path, hash);
            const store = await loadSemanticStore(state.projectPath);
            store[file.path] = {
              inferredAt: Date.now(),
              brands: result.brands || [],
              mismatches: result.mismatches || [],
              codeHash: hash,
            };
            await saveSemanticStore(state.projectPath, store);
            dispatch({ type: 'UPDATE_SEMANTIC_FILE', path: file.path, entry: store[file.path] });
          } catch { /* silent */ }
        }, 2500);
        timersRef.current.set(file.path, timer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.openFiles, state.semanticAutoEnabled, state.projectPath, state.aiProvider, state.aiApiKey, state.aiDeepseekKey]);
}
