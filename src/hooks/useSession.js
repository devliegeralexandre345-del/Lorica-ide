// src/hooks/useSession.js
//
// Persist a minimal workspace session to localStorage so the IDE restores
// itself on next boot: last project path, list of open file paths, active
// tab, layout toggles (sidebar/terminal/agent visibility, theme, minimap).
//
// What we deliberately DON'T persist:
//   • File contents — they come from disk on open, which is the source of
//     truth. Persisting contents would make us fight the filesystem on
//     external edits.
//   • Agent conversations — these belong in an in-project store if we
//     ever want them durable; mixing user-specific chats with "workspace
//     session" feels wrong.
//   • Any secrets — API keys live in the vault, not here.
//
// Save is debounced (400 ms) so rapid changes (opening a project,
// opening 10 files in sequence) collapse to one write. Restore runs once
// on mount before the user can interact — so there's no flash of empty
// state.

import { useEffect, useRef } from 'react';

const SESSION_KEY = 'lorica.session.v1';
const SAVE_DEBOUNCE_MS = 400;

// Fields we pick off of state. If future state grows, we add fields here
// explicitly — blanket serialization would sneak in runtime-only data.
function captureSession(state) {
  return {
    // Workspace
    projectPath: state.projectPath || null,
    openFiles: (state.openFiles || []).map((f) => ({ path: f.path })),
    activeFileIndex: state.activeFileIndex ?? -1,

    // Appearance / layout
    theme: state.theme,
    showFileTree: state.showFileTree,
    showTerminal: state.showTerminal,
    showAIPanel: state.showAIPanel,
    showInstantPreview: state.showInstantPreview,
    showMinimap: state.showMinimap,

    // Behavior toggles the user sets in Settings — previously not
    // persisted, which is why checkboxes in Settings seemed to "forget"
    // their value on relaunch.
    autoSave: state.autoSave,
    autoSaveDelay: state.autoSaveDelay,
    autoLockMinutes: state.autoLockMinutes,
    blameEnabled: state.blameEnabled,
    aiInlineEnabled: state.aiInlineEnabled,
    aiProvider: state.aiProvider,
    heatmapEnabled: state.heatmapEnabled,
    heatmapRange: state.heatmapRange,
    semanticAutoEnabled: state.semanticAutoEnabled,

    // NOTE: `enabledFeatures` has its own localStorage key managed by
    // utils/features.js — no duplication here. Hydrated directly at
    // reducer init time.

    zenMode: false, // Always boot non-zen.
  };
}

/**
 * Hook into the app state. Debounce-persists session to localStorage on
 * every relevant change and restores once on mount.
 *
 * @param {object} state        — full app state
 * @param {Function} dispatch   — app reducer dispatch
 * @param {object} fs           — file-system helpers from useFileSystem
 */
export function useSession(state, dispatch, fs) {
  const hasRestoredRef = useRef(false);
  const saveTimerRef   = useRef(null);

  // ── Restore on first mount ──────────────────────────────────────────
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    let raw;
    try { raw = localStorage.getItem(SESSION_KEY); } catch { return; }
    if (!raw) return;
    let session;
    try { session = JSON.parse(raw); } catch { return; }

    // Apply layout + behavior toggles immediately — these are cheap and
    // don't depend on async operations. Each toggle uses its dedicated
    // action type; generic SET_PANEL only applies to visibility panels.
    const apply = (key, value) => {
      if (value == null) return;
      switch (key) {
        case 'theme':            dispatch({ type: 'SET_THEME', theme: value }); break;
        case 'aiProvider':       dispatch({ type: 'SET_AI_PROVIDER', provider: value }); break;
        case 'aiInlineEnabled':  dispatch({ type: 'SET_AI_INLINE_ENABLED', value }); break;
        case 'blameEnabled':     dispatch({ type: 'SET_BLAME_ENABLED', value }); break;
        case 'showMinimap':      dispatch({ type: 'SET_MINIMAP', value }); break;
        case 'autoSave':         dispatch({ type: 'SET_AUTO_SAVE', value }); break;
        case 'autoSaveDelay':    dispatch({ type: 'SET_AUTO_SAVE_DELAY', delay: value }); break;
        case 'autoLockMinutes':  dispatch({ type: 'SET_AUTO_LOCK_MINUTES', minutes: value }); break;
        // Toggle-style actions: only dispatch when the stored value
        // differs from the default-false initial state, otherwise we'd
        // accidentally flip it off on restore.
        case 'heatmapEnabled':
          if (value) dispatch({ type: 'TOGGLE_HEATMAP' });
          break;
        case 'semanticAutoEnabled':
          if (value) dispatch({ type: 'TOGGLE_SEMANTIC_AUTO' });
          break;
        case 'heatmapRange':
          if (typeof value === 'number') dispatch({ type: 'SET_HEATMAP_RANGE', days: value });
          break;
        // Anything else is a panel visibility boolean.
        default:
          dispatch({ type: 'SET_PANEL', panel: key, value: !!value });
      }
    };
    const restoreKeys = [
      'theme', 'showFileTree', 'showTerminal', 'showAIPanel',
      'showInstantPreview', 'showMinimap', 'blameEnabled',
      'aiInlineEnabled', 'aiProvider',
      'autoSave', 'autoSaveDelay', 'autoLockMinutes',
      'heatmapEnabled', 'heatmapRange', 'semanticAutoEnabled',
    ];
    for (const k of restoreKeys) apply(k, session[k]);

    // Re-open the project (loads fileTree, then re-opens tabs).
    if (session.projectPath) {
      (async () => {
        try {
          await fs.openProject?.(session.projectPath);
        } catch { return; }
        // Re-open tab list in original order.
        const paths = (session.openFiles || []).map((x) => x.path).filter(Boolean);
        for (const p of paths) {
          try { await fs.openFile?.(p); } catch {}
        }
        if (typeof session.activeFileIndex === 'number' && session.activeFileIndex >= 0) {
          dispatch({ type: 'SET_ACTIVE_FILE', index: session.activeFileIndex });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Debounced save on any relevant state change ─────────────────────
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(captureSession(state)));
      } catch {
        // Storage quota / privacy mode — silently skip. The IDE works
        // fine without persistence; the only cost is no restore.
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    state.projectPath,
    state.openFiles,
    state.activeFileIndex,
    state.theme,
    state.showFileTree,
    state.showTerminal,
    state.showAIPanel,
    state.showInstantPreview,
    state.showMinimap,
    state.blameEnabled,
    state.aiInlineEnabled,
    state.aiProvider,
    state.autoSave,
    state.autoSaveDelay,
    state.autoLockMinutes,
    state.heatmapEnabled,
    state.heatmapRange,
    state.semanticAutoEnabled,
  ]);
}
