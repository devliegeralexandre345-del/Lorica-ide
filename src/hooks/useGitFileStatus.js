// src/hooks/useGitFileStatus.js
//
// Per-file git decoration source for the FileTree. Reuses
// `cmd_git_status` (the same Tauri command that powers GitPanel) and
// reshapes the output into an absolute-path → {status,staged} map.
//
// Refresh triggers: project change, `fs:change` (file watcher),
// `lorica:git-changed` (panel mutations). All paths funnel through a
// 500ms debounce + single-flight so a `git pull` storm of events
// produces exactly one subprocess spawn.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

const DEBOUNCE_MS = 500;

// Priority string — index = priority (lower wins). A staged-then-edited
// file should show "M" not "A" so the user sees the most-recent state.
const PRIORITY = 'UDMRCA?';

function dominant(a, b) {
  if (!a) return b;
  if (!b) return a;
  return PRIORITY.indexOf(a) <= PRIORITY.indexOf(b) ? a : b;
}

function buildMap(files, projectPath) {
  const map = new Map();
  if (!projectPath || !Array.isArray(files)) return map;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const projRoot = projectPath.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');

  for (const f of files) {
    if (!f?.path) continue;
    let rel = f.path;
    // Renames in porcelain v1 surface as "old -> new"; attribute to new.
    const arrow = rel.indexOf(' -> ');
    if (arrow >= 0) rel = rel.slice(arrow + 4);
    rel = rel.trim().replace(/^"(.*)"$/, '$1');

    const abs = (projectPath + sep + rel).replace(/\\/g, '/').toLowerCase();
    const prev = map.get(abs);
    map.set(abs, {
      status: dominant(prev?.status, f.status),
      staged: prev?.staged || !!f.staged,
    });

    // Untracked dirs appear as "dir/" — mark dir itself so rollup paints
    // even before user expands it.
    if (rel.endsWith('/')) {
      const dirAbs = abs.replace(/\/$/, '');
      if (!map.has(dirAbs)) map.set(dirAbs, { status: '?', staged: false });
    }
  }
  map.__root = projRoot;
  return map;
}

export function useGitFileStatus(projectPath) {
  const [statusMap, setStatusMap] = useState(() => new Map());
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);
  const debounceRef = useRef(null);
  const mountedRef = useRef(true);
  const pathRef = useRef(null);

  useEffect(() => () => {
    mountedRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const doRefresh = useCallback(async () => {
    const pp = pathRef.current;
    if (!pp) return;
    if (inflightRef.current) { pendingRef.current = true; return; }
    inflightRef.current = true;
    try {
      const res = await window.lorica?.git?.status(pp);
      if (!mountedRef.current || pathRef.current !== pp) return;
      const payload = res?.data || res;
      if (payload?.is_repo === false) { setStatusMap(new Map()); return; }
      setStatusMap(buildMap(payload?.files || [], pp));
    } catch (e) {
      console.warn('[useGitFileStatus] refresh failed:', e);
    } finally {
      inflightRef.current = false;
      if (pendingRef.current && mountedRef.current) {
        pendingRef.current = false;
        scheduleRefresh();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      doRefresh();
    }, DEBOUNCE_MS);
  }, [doRefresh]);

  useEffect(() => { pathRef.current = projectPath; }, [projectPath]);

  useEffect(() => {
    setStatusMap(new Map());
    if (projectPath) doRefresh();
  }, [projectPath, doRefresh]);

  useEffect(() => {
    if (!projectPath) return;
    let unlistenFs = null;
    let cancelled = false;
    (async () => {
      try {
        unlistenFs = await listen('fs:change', () => {
          if (!cancelled) scheduleRefresh();
        });
      } catch (e) {
        console.warn('[useGitFileStatus] listen failed:', e);
      }
    })();
    const onGitChanged = () => scheduleRefresh();
    window.addEventListener('lorica:git-changed', onGitChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('lorica:git-changed', onGitChanged);
      if (unlistenFs) { try { unlistenFs(); } catch { /* ignore */ } }
    };
  }, [projectPath, scheduleRefresh]);

  return useMemo(() => {
    const root = statusMap.__root || '';
    const norm = (p) => (p || '').replace(/\\/g, '/').toLowerCase();
    return {
      getStatus: (absPath) => (absPath ? statusMap.get(norm(absPath)) || null : null),
      hasModifiedDescendant: (absDir) => {
        if (!absDir || statusMap.size === 0) return false;
        const n = norm(absDir);
        if (root && !n.startsWith(root)) return false;
        const prefix = n + '/';
        for (const key of statusMap.keys()) {
          if (key.startsWith(prefix)) return true;
        }
        return false;
      },
      refresh: scheduleRefresh,
    };
  }, [statusMap, scheduleRefresh]);
}
