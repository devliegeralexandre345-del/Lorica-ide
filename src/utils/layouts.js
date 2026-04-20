// src/utils/layouts.js
//
// Named layout profiles — snapshot of "which panels are visible, which
// sidebar is selected, terminal height, theme". The user can create
// profiles like "Coding", "Reviewing", "Debugging" and switch between
// them with one click. Local-only (localStorage) because these express
// personal preferences, not project artifacts.
//
// Ships with three built-in layouts you can apply immediately; any new
// layout the user saves is appended.

const KEY = 'lorica.layouts.v1';

export const BUILTIN_LAYOUTS = [
  {
    id: 'coding',
    name: 'Coding',
    emoji: '💻',
    fields: {
      showFileTree: true,
      showTerminal: true,
      showAIPanel: false,
      showProblems: false,
      showInstantPreview: false,
      showSearch: false,
      showGit: false,
      showBookmarksPanel: false,
      showMinimap: true,
      blameEnabled: false,
      showPerformanceHUD: false,
      showFocusTimer: false,
      showTimeScrub: false,
      showScratchpad: false,
      showTodoBoard: false,
      showProjectBrain: false,
    },
  },
  {
    id: 'review',
    name: 'Reviewing',
    emoji: '🔍',
    fields: {
      showFileTree: true,
      showTerminal: false,
      showAIPanel: true,
      showProblems: true,
      showInstantPreview: false,
      showGit: true,
      showMinimap: true,
      blameEnabled: true,
      showPerformanceHUD: false,
      showFocusTimer: false,
      showTimeScrub: false,
    },
  },
  {
    id: 'deep-work',
    name: 'Deep work',
    emoji: '🧘',
    fields: {
      showFileTree: false,
      showTerminal: false,
      showAIPanel: false,
      showProblems: false,
      showInstantPreview: false,
      showSearch: false,
      showGit: false,
      showMinimap: false,
      blameEnabled: false,
      showPerformanceHUD: false,
      showFocusTimer: true,
      showTimeScrub: false,
      showScratchpad: false,
      showTodoBoard: false,
      showProjectBrain: false,
    },
  },
];

export function loadLayouts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export function saveLayout(layout) {
  const list = loadLayouts();
  const idx = list.findIndex((l) => l.id === layout.id);
  if (idx !== -1) list[idx] = layout;
  else list.push(layout);
  save(list);
  return layout;
}
export function deleteLayout(id) {
  save(loadLayouts().filter((l) => l.id !== id));
}

// Capture current layout-relevant fields from app state.
export function captureCurrentLayout(state, name) {
  return {
    id: `custom-${Date.now()}`,
    name: name || 'Custom layout',
    emoji: '✨',
    fields: {
      showFileTree: !!state.showFileTree,
      showTerminal: !!state.showTerminal,
      showAIPanel: !!state.showAIPanel,
      showProblems: !!state.showProblems,
      showInstantPreview: !!state.showInstantPreview,
      showSearch: !!state.showSearch,
      showGit: !!state.showGit,
      showBookmarksPanel: !!state.showBookmarksPanel,
      showScratchpad: !!state.showScratchpad,
      showTodoBoard: !!state.showTodoBoard,
      showProjectBrain: !!state.showProjectBrain,
      showMinimap: state.showMinimap !== false,
      blameEnabled: !!state.blameEnabled,
      showPerformanceHUD: !!state.showPerformanceHUD,
      showFocusTimer: !!state.showFocusTimer,
      showTimeScrub: !!state.showTimeScrub,
    },
    createdAt: Date.now(),
  };
}

// Apply a layout by dispatching SET_PANEL for each field. Only fields
// present in the layout are set; others are untouched so the user
// doesn't lose an in-flight modal when switching profiles.
export function applyLayout(layout, dispatch) {
  if (!layout?.fields) return;
  for (const [key, value] of Object.entries(layout.fields)) {
    if (key === 'showMinimap') {
      dispatch({ type: 'SET_MINIMAP', value });
    } else if (key === 'blameEnabled') {
      dispatch({ type: 'SET_BLAME_ENABLED', value });
    } else {
      dispatch({ type: 'SET_PANEL', panel: key, value });
    }
  }
}
