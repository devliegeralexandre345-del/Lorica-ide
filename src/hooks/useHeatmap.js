// src/hooks/useHeatmap.js
//
// Fetches per-file churn stats and normalizes them into a 0-1 intensity
// score per project-relative path. The FileTree reads the resulting map
// to tint entries. Re-runs when the user changes the time window or when
// the project itself changes.
//
// Normalization: we use log1p of (added + removed) to compress the tail
// — a single mega-refactor shouldn't make everything else look cold. The
// score is that log-value divided by the max log-value in the window.

import { useEffect, useMemo, useRef, useState } from 'react';

export function useHeatmap({ projectPath, enabled, rangeDays }) {
  const [raw, setRaw] = useState([]);       // [GitChurn] from backend
  const [loading, setLoading] = useState(false);
  const abortKeyRef = useRef(0);

  useEffect(() => {
    if (!enabled || !projectPath) { setRaw([]); return; }
    const key = ++abortKeyRef.current;
    setLoading(true);
    (async () => {
      try {
        const r = await window.lorica.git.churn(projectPath, rangeDays);
        if (key !== abortKeyRef.current) return;
        setRaw(r?.success && Array.isArray(r.data) ? r.data : []);
      } catch {
        if (key === abortKeyRef.current) setRaw([]);
      } finally {
        if (key === abortKeyRef.current) setLoading(false);
      }
    })();
  }, [projectPath, enabled, rangeDays]);

  // Build a lookup by both relative and absolute path so the FileTree
  // (which holds absolute paths) can query without reconstructing
  // relative paths on every render.
  const index = useMemo(() => {
    const byRel = new Map();
    const byAbs = new Map();
    let maxLog = 0;
    for (const entry of raw) {
      const lines = entry.lines_added + entry.lines_removed;
      const logVal = Math.log1p(lines);
      if (logVal > maxLog) maxLog = logVal;
      entry._log = logVal;
    }
    for (const entry of raw) {
      const score = maxLog > 0 ? entry._log / maxLog : 0;
      // Bus factor = minimum number of authors needed to cover >= 50% of
      // the commits on this file. A bus-factor of 1 means a single person
      // owns the majority of the file's change history — that's risky.
      const authors = entry.authors || [];
      const totalCommits = authors.reduce((n, [, c]) => n + c, 0) || entry.commits || 1;
      let running = 0; let busFactor = 0;
      for (const [, c] of authors) {
        busFactor++;
        running += c;
        if (running * 2 >= totalCommits) break;
      }
      const row = {
        relative: entry.path,
        commits: entry.commits,
        linesAdded: entry.lines_added,
        linesRemoved: entry.lines_removed,
        lastChange: entry.last_change,
        score, // 0..1
        authors: authors.map(([name, count]) => ({ name, count })),
        busFactor: busFactor || 1,
      };
      byRel.set(entry.path.replace(/\\/g, '/'), row);
      if (projectPath) {
        const sep = projectPath.includes('\\') ? '\\' : '/';
        byAbs.set((projectPath + sep + entry.path).replace(/\\/g, '/').toLowerCase(), row);
      }
    }
    return { byRel, byAbs };
  }, [raw, projectPath]);

  return { data: index, loading };
}
