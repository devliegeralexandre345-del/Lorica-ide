// Feature enablement — the "soft" extension system.
//
// Each command that's feature-gated has a `feature` key matching an ID
// here. The Omnibar, keyboard-shortcut handler, and Settings "Features"
// section all consult this catalog to decide what the user sees.
//
// Goal: a fresh `Ctrl+P` shouldn't require scrolling. v2.1 shipped with
// 49 commands visible by default — users complained it was overwhelming.
// v2.2 hides the ~20 niche-use ones behind a per-feature toggle that
// defaults to off, keeping ~26 commands (15 core + 11 popular features)
// visible out of the box.
//
// v2.3 will convert this into a real extension system (dynamic import
// per feature so disabled features don't even ship bytes to the
// browser). The API below is stable enough that v2.3 should be a
// drop-in upgrade — the `id`/`name`/`category` shape stays the same,
// only the resolution changes from "static table" to "manifest lookup".

// Categories drive the visual grouping in Settings.
export const FEATURE_CATEGORIES = {
  productivity: { label: 'Productivity', order: 1 },
  ai:           { label: 'AI & Agents',  order: 2 },
  visualization:{ label: 'Visualization',order: 3 },
  diagnostics:  { label: 'Diagnostics',  order: 4 },
  tools:        { label: 'Developer tools', order: 5 },
};

// The catalog. `defaultEnabled` picks the balanced "popular features"
// set — conservative defaults, user opts in to the rest.
//
// DO NOT list core commands here (file ops, settings, terminal, git,
// etc.). Those are always visible and shouldn't be togglable — Lorica
// is not an IDE without them.
export const FEATURES = {
  // Productivity — quick things users reach for daily
  focusTimer:        { id: 'focusTimer',        name: 'Focus Timer',        category: 'productivity', defaultEnabled: true,  desc: 'Pomodoro timer with stats' },
  scratchpad:        { id: 'scratchpad',        name: 'Scratchpad',         category: 'productivity', defaultEnabled: true,  desc: 'Project-scoped markdown notebooks' },
  todoBoard:         { id: 'todoBoard',         name: 'TODO Board',         category: 'productivity', defaultEnabled: true,  desc: 'Kanban board for project TODOs' },
  bookmarks:         { id: 'bookmarks',         name: 'Bookmarks',          category: 'productivity', defaultEnabled: true,  desc: 'Line bookmarks with notes' },
  clipboardHistory:  { id: 'clipboardHistory',  name: 'Clipboard History',  category: 'productivity', defaultEnabled: true,  desc: '30-item rolling clipboard' },

  // AI & Agents — core AI chat is always on; these are advanced layers
  brain:             { id: 'brain',             name: 'Project Brain',      category: 'ai', defaultEnabled: true,  desc: 'Persistent project memory' },
  swarmReview:       { id: 'swarmReview',       name: 'Swarm Review',       category: 'ai', defaultEnabled: false, desc: 'Parallel multi-agent code review' },
  swarmDev:          { id: 'swarmDev',          name: 'Swarm Dev',          category: 'ai', defaultEnabled: false, desc: 'Decompose features across parallel agents' },
  prReady:           { id: 'prReady',           name: 'PR Ready',           category: 'ai', defaultEnabled: false, desc: '7-check AI review before PR' },
  agentBuilder:      { id: 'agentBuilder',      name: 'Agent Builder',      category: 'ai', defaultEnabled: false, desc: 'Create custom agents' },
  agentIdentity:     { id: 'agentIdentity',     name: 'Agent Identity',     category: 'ai', defaultEnabled: false, desc: 'Persistent agent persona' },
  sandbox:           { id: 'sandbox',           name: 'Sandbox',            category: 'ai', defaultEnabled: false, desc: 'Isolated code execution with AI inputs' },
  inlineEditHistory: { id: 'inlineEditHistory', name: 'Inline Edit History',category: 'ai', defaultEnabled: false, desc: 'Log of Ctrl+K edits' },

  // Visualization — analytical / exploratory
  instantPreview:    { id: 'instantPreview',    name: 'Instant Preview',    category: 'visualization', defaultEnabled: true,  desc: 'Auto-preview for JSON/MD/HTML/etc' },
  codeCanvas:        { id: 'codeCanvas',        name: 'Code Canvas',        category: 'visualization', defaultEnabled: false, desc: 'Dependency graph visualization' },
  semanticTypes:     { id: 'semanticTypes',     name: 'Semantic Types',     category: 'visualization', defaultEnabled: false, desc: 'AI-inferred brand types' },
  timeScrub:         { id: 'timeScrub',         name: 'Time Scrub',         category: 'visualization', defaultEnabled: false, desc: 'Snapshot timeline per file' },
  heatmap:           { id: 'heatmap',           name: 'Code Heatmap',       category: 'visualization', defaultEnabled: false, desc: 'Churn + bus factor per file' },

  // Diagnostics
  gitBlame:          { id: 'gitBlame',          name: 'Git Blame Gutter',   category: 'diagnostics', defaultEnabled: true,  desc: 'Author per line in the gutter' },
  performanceHUD:    { id: 'performanceHUD',    name: 'Performance HUD',    category: 'diagnostics', defaultEnabled: false, desc: 'Live FPS / heap / latency' },
  problemsPanel:     { id: 'problemsPanel',     name: 'Problems Panel',     category: 'diagnostics', defaultEnabled: true,  desc: 'Aggregate errors & warnings' },
  auditLog:          { id: 'auditLog',          name: 'Audit Log',          category: 'diagnostics', defaultEnabled: false, desc: 'Security events history' },

  // Developer tools
  snippets:          { id: 'snippets',          name: 'Snippet Palette',    category: 'tools', defaultEnabled: true,  desc: 'Insert code snippets' },
  regexBuilder:      { id: 'regexBuilder',      name: 'Regex Builder',      category: 'tools', defaultEnabled: false, desc: 'Pattern library + tester' },
  apiTester:         { id: 'apiTester',         name: 'API Tester',         category: 'tools', defaultEnabled: false, desc: 'Postman-lite with envs' },
  diffViewer:        { id: 'diffViewer',        name: 'Diff Viewer',        category: 'tools', defaultEnabled: false, desc: 'Standalone two-pane diff' },
  keyboardCheatsheet:{ id: 'keyboardCheatsheet',name: 'Keyboard Cheatsheet',category: 'tools', defaultEnabled: false, desc: 'Searchable shortcut reference' },
};

const STORAGE_KEY = 'lorica.features.v1';

/**
 * Current enabled map. Reads user overrides from localStorage and
 * merges them onto the defaults. Missing features (e.g. added in a
 * newer version than the stored override) fall back to their default.
 */
export function loadEnabledFeatures() {
  let overrides = {};
  try {
    overrides = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch { overrides = {}; }

  const out = {};
  for (const [id, meta] of Object.entries(FEATURES)) {
    out[id] = typeof overrides[id] === 'boolean' ? overrides[id] : meta.defaultEnabled;
  }
  return out;
}

/** Persist the full enabled map. Call after every toggle. */
export function saveEnabledFeatures(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
}

/** Convenience — check a single feature. `true` when feature is unknown
 *  so new features default to visible if someone forgets to register. */
export function isFeatureEnabled(map, featureId) {
  if (!featureId) return true; // core command
  if (!(featureId in FEATURES)) return true;
  return !!map?.[featureId];
}

/** Reset to defaults — clears the override file. */
export function resetFeatures() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/** Count how many features are enabled vs total — for the Settings UI. */
export function featureStats(map) {
  const total = Object.keys(FEATURES).length;
  const on = Object.values(map || {}).filter(Boolean).length;
  return { on, total, off: total - on };
}
