// src/utils/recentFiles.js
//
// Wave 49 — Recent files quick-switch. Tracks files the user opened
// during the current session (or persisted across sessions if we
// localStorage them later). The list is intentionally separate from
// `lorica.recentProjects` — that one is per-project, this one is per-
// FILE inside the active project. Used by the Ctrl+E quick-switch.
//
// Storage: in-memory + localStorage namespaced per project so
// switching projects doesn't bleed history. Capped at 50.

const STORAGE_PREFIX = 'lorica.recentFiles.';
const CAP = 50;

function storageKey(projectPath) {
  return STORAGE_PREFIX + (projectPath || '__default__');
}

export function loadRecentFiles(projectPath) {
  try {
    const raw = localStorage.getItem(storageKey(projectPath));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.path === 'string').slice(0, CAP);
  } catch {
    return [];
  }
}

export function recordFileOpen(projectPath, file) {
  if (!file || typeof file.path !== 'string') return;
  try {
    const list = loadRecentFiles(projectPath);
    const filtered = list.filter((e) => e.path !== file.path);
    filtered.unshift({
      path: file.path,
      name: file.name || file.path.split(/[\\/]/).pop(),
      extension: file.extension || '',
      ts: Date.now(),
    });
    const trimmed = filtered.slice(0, CAP);
    localStorage.setItem(storageKey(projectPath), JSON.stringify(trimmed));
  } catch {
    // localStorage may be full or unavailable — silently ignore.
  }
}

export function clearRecentFiles(projectPath) {
  try { localStorage.removeItem(storageKey(projectPath)); } catch {}
}

// Pure helper used by the quick-switch UI: dedupe currently-open files
// onto the top of the list, append recently-closed below.
export function mergeOpenAndRecent(openFiles, recent) {
  const seen = new Set();
  const out = [];
  for (const f of openFiles || []) {
    if (!f?.path || seen.has(f.path)) continue;
    seen.add(f.path);
    out.push({
      path: f.path,
      name: f.name,
      extension: f.extension || '',
      open: true,
    });
  }
  for (const e of recent || []) {
    if (!e?.path || seen.has(e.path)) continue;
    seen.add(e.path);
    out.push({ ...e, open: false });
  }
  return out;
}
