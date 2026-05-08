// src/hooks/useGitDiffGutter.js
//
// Drives the in-editor staged + unstaged diff gutter. Fetches `git diff`
// and `git diff --cached` for the currently-open file, parses the hunk
// ranges, and dispatches them into the editor's diff-gutter state field.
//
// Refresh triggers:
//   • file save (file.dirty flips false)
//   • Tauri `fs:change` event (external editor / build tool / git CLI)
//   • `lorica:git-changed` (in-app stage / unstage / commit)
//
// All triggers funnel through a 250ms debounce + single-flight so a
// `git pull` storm of fs:change events produces one round-trip per file
// rather than one per touched file.
//
// If the file is not in a git repo (or git isn't installed), the backend
// returns an error which we silently swallow — gutters are progressive
// enhancement, never an error surface.
//
// The hook owns no React state of its own; it pushes effects into the
// EditorView passed in by Editor.jsx. That keeps re-renders out of the
// hot path — only the gutter cell repaints.

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  setUnstagedDiffEffect,
  setStagedDiffEffect,
  parseDiffNewLineRanges,
} from '../extensions/gitDiffGutter';

const DEBOUNCE_MS = 250;

export function useGitDiffGutter({ view, projectPath, filePath, dirty }) {
  // Imperative refs so callbacks see fresh values without re-binding.
  const viewRef = useRef(view);
  const pathRef = useRef(filePath);
  const projRef = useRef(projectPath);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { pathRef.current = filePath; }, [filePath]);
  useEffect(() => { projRef.current = projectPath; }, [projectPath]);

  // Debounce + single-flight + cancellation token. Re-issuing while an
  // older request is still in-flight invalidates the older response so a
  // slow `git diff` for an old file can't overwrite a newer one.
  const debounceRef = useRef(null);
  const tokenRef = useRef(0);
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    const refresh = async () => {
      const v = viewRef.current;
      const pp = projRef.current;
      const fp = pathRef.current;
      if (!v || !pp || !fp) return;
      if (inflightRef.current) { pendingRef.current = true; return; }
      inflightRef.current = true;
      const myToken = ++tokenRef.current;

      try {
        // Run both diffs in parallel — they're independent subprocess
        // spawns and the staged side is usually empty so it returns fast.
        const [unstagedRes, stagedRes] = await Promise.all([
          window.lorica?.git?.diff?.(pp, fp).catch(() => null),
          window.lorica?.git?.diffStaged?.(pp, fp).catch(() => null),
        ]);

        // Stale-response guard — file changed while we were waiting.
        if (myToken !== tokenRef.current) return;
        // Mounted-view guard.
        if (!viewRef.current) return;

        const unstagedDiff = typeof unstagedRes === 'string'
          ? unstagedRes
          : (unstagedRes?.data || '');
        const stagedDiff = typeof stagedRes === 'string'
          ? stagedRes
          : (stagedRes?.data || '');

        const unstagedRanges = parseDiffNewLineRanges(unstagedDiff, fp);
        const stagedRanges   = parseDiffNewLineRanges(stagedDiff, fp);

        viewRef.current.dispatch({
          effects: [
            setUnstagedDiffEffect.of(unstagedRanges),
            setStagedDiffEffect.of(stagedRanges),
          ],
        });
      } catch {
        // Not a git repo / file untracked / git missing — silently zero
        // the ranges so any stale colours from a previous file vanish.
        if (viewRef.current && myToken === tokenRef.current) {
          viewRef.current.dispatch({
            effects: [
              setUnstagedDiffEffect.of([]),
              setStagedDiffEffect.of([]),
            ],
          });
        }
      } finally {
        inflightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          schedule();
        }
      }
    };

    const schedule = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        refresh();
      }, DEBOUNCE_MS);
    };

    // Initial paint when the file / view first appears or save lands.
    if (view && projectPath && filePath && !dirty) schedule();

    // External triggers — fs watcher + in-app git mutations.
    const onGitChanged = () => schedule();
    let unlistenFs = null;
    let cancelled = false;
    (async () => {
      try {
        unlistenFs = await listen('fs:change', () => {
          if (!cancelled) schedule();
        });
      } catch { /* listen may fail outside Tauri runtime — non-fatal */ }
    })();
    window.addEventListener('lorica:git-changed', onGitChanged);

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      window.removeEventListener('lorica:git-changed', onGitChanged);
      if (unlistenFs) { try { unlistenFs(); } catch { /* ignore */ } }
    };
  }, [view, projectPath, filePath, dirty]);
}
