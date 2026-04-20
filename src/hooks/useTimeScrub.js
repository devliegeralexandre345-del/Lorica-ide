// src/hooks/useTimeScrub.js
//
// Periodic snapshot recorder for the active file. Writes compact JSON
// history to `.lorica/snapshots/<hash>/` — one file per file being
// watched, keyed by a hash of the absolute path. Each snapshot is a
// single entry appended to a JSONL log so we can grow cheaply without
// rewriting history.
//
// Record rules:
//   • One snapshot every 30s IF the file is dirty (changed since the
//     last snapshot).
//   • Immediate snapshot on save.
//   • Cap at 300 snapshots per file (rolling) — oldest dropped when we
//     exceed. 300 * ~10 KB = 3 MB worst case per file, acceptable.
//
// The reducer only holds a small index (count + last-entry timestamp)
// per file. Full history is read on demand when the user opens the
// scrubber UI.

import { useEffect, useRef } from 'react';

const SNAP_INTERVAL_MS = 30_000;
const MAX_PER_FILE = 300;

function hashPath(p) {
  // Fast 32-bit FNV-ish — only used for filenames, collisions are fine
  // because the file itself stores the source path.
  let h = 2166136261;
  for (let i = 0; i < p.length; i++) {
    h ^= p.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

function snapshotsDir(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}snapshots`;
}

function snapshotFile(projectPath, filePath) {
  const dir = snapshotsDir(projectPath);
  if (!dir) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${dir}${sep}${hashPath(filePath)}.jsonl`;
}

async function appendSnapshot(projectPath, filePath, content, reason = 'auto') {
  const file = snapshotFile(projectPath, filePath);
  if (!file) return null;
  const dir = snapshotsDir(projectPath);
  try { await window.lorica.fs.createDir(dir); } catch {}
  let prev = '';
  try {
    const r = await window.lorica.fs.readFile(file);
    if (r?.success) prev = r.data.content || '';
  } catch {}
  const entry = {
    t: Date.now(),
    reason,
    path: filePath,
    content,
  };
  const line = JSON.stringify(entry);
  let next = prev ? prev + '\n' + line : line;

  // Enforce the rolling cap — count lines, drop the oldest if we exceed.
  const lines = next.split('\n').filter(Boolean);
  if (lines.length > MAX_PER_FILE) {
    next = lines.slice(-MAX_PER_FILE).join('\n');
  }
  try { await window.lorica.fs.writeFile(file, next); } catch {}
  return entry;
}

export async function readSnapshotHistory(projectPath, filePath) {
  const file = snapshotFile(projectPath, filePath);
  if (!file) return [];
  try {
    const r = await window.lorica.fs.readFile(file);
    if (!r?.success) return [];
    return r.data.content.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function useTimeScrub(state, dispatch) {
  const timerRef = useRef(null);
  const lastSavedRef = useRef(new Map()); // filePath → last snapshotted content

  // Periodic snapshot tick: check the current active file; if dirty
  // relative to the last snapshot, write one.
  useEffect(() => {
    if (!state.projectPath) return;
    const tick = async () => {
      const file = state.openFiles[state.activeFileIndex];
      if (!file || !file.path || file.content == null) return;
      const last = lastSavedRef.current.get(file.path);
      if (last === file.content) return;
      lastSavedRef.current.set(file.path, file.content);
      await appendSnapshot(state.projectPath, file.path, file.content, 'auto');
    };
    timerRef.current = setInterval(tick, SNAP_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.projectPath, state.openFiles, state.activeFileIndex]);
}

/** Trigger a snapshot immediately (e.g. on save). */
export async function snapshotNow(projectPath, file, reason = 'save') {
  if (!projectPath || !file?.path || file.content == null) return null;
  return appendSnapshot(projectPath, file.path, file.content, reason);
}
