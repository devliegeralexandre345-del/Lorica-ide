// src/hooks/useAnnotations.js
//
// In-memory cache + persistence for spatial annotations (Wave 11.4).
// Owns the load-on-project-change → mutate-in-memory → debounced-save
// loop. Components consume `annotations`, `addAnnotation`,
// `updateAnnotation`, `removeAnnotation`, and `byFile` (memoised
// per-file map for cheap lookups in the editor extension).
//
// Save is debounced 400 ms so a rapid sequence of edits (typing into
// a sticky note) collapses to one write. Loads run once per project
// switch; we don't watch the file for external edits because Lorica's
// annotations are an in-IDE concept — if the user wants to share, they
// commit the JSON.

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  loadAnnotations,
  saveAnnotations,
  makeAnnotation,
  groupByFile,
  normalizeFilePath,
} from '../utils/annotations';

const SAVE_DEBOUNCE_MS = 400;

export function useAnnotations(projectPath) {
  const [annotations, setAnnotations] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef(null);
  const lastProjectRef = useRef(null);

  // Load on project change.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setAnnotations([]);
    if (!projectPath) {
      lastProjectRef.current = null;
      setLoaded(true);
      return undefined;
    }
    (async () => {
      const list = await loadAnnotations(projectPath);
      if (cancelled) return;
      setAnnotations(list);
      lastProjectRef.current = projectPath;
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  // Debounced save on any change after the initial load. We skip the
  // initial setAnnotations(list) write by checking the `loaded` flag.
  useEffect(() => {
    if (!loaded || !projectPath) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveAnnotations(projectPath, annotations);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [annotations, projectPath, loaded]);

  const addAnnotation = useCallback(({ file, line, text = '', color = 'amber', author = '' }) => {
    const ann = makeAnnotation({
      file: normalizeFilePath(file, projectPath),
      line,
      text,
      color,
      author,
    });
    setAnnotations((cur) => [...cur, ann]);
    return ann;
  }, [projectPath]);

  const updateAnnotation = useCallback((id, patch) => {
    setAnnotations((cur) =>
      cur.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a))
    );
  }, []);

  const removeAnnotation = useCallback((id) => {
    setAnnotations((cur) => cur.filter((a) => a.id !== id));
  }, []);

  const removeAllForFile = useCallback((file) => {
    const norm = normalizeFilePath(file, projectPath);
    setAnnotations((cur) => cur.filter((a) => a.file !== norm));
  }, [projectPath]);

  const byFile = useMemo(() => groupByFile(annotations), [annotations]);

  return {
    annotations,
    byFile,
    loaded,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    removeAllForFile,
  };
}
