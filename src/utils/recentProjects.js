// src/utils/recentProjects.js
//
// Tracks the projects the user has opened most recently so they can jump
// back without redoing "File → Open Folder → navigate filesystem". The
// list is stored in localStorage, capped at 10, and re-ordered on each
// open (MRU).

const KEY = 'lorica.recentProjects.v1';
const MAX = 10;

export function loadRecentProjects() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
}

/**
 * Record a project as the most recently opened. If already in the list,
 * its entry gets bubbled to the top. Missing `name`s are derived from
 * the path leaf.
 */
export function pushRecentProject(path) {
  if (!path) return;
  const cur = loadRecentProjects();
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  const entry = { path, name, at: Date.now() };
  const filtered = cur.filter((p) => p.path !== path);
  save([entry, ...filtered]);
}

export function removeRecentProject(path) {
  save(loadRecentProjects().filter((p) => p.path !== path));
}

export function clearRecentProjects() {
  try { localStorage.removeItem(KEY); } catch {}
}
