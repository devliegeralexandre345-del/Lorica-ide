// src/hooks/useCustomAgents.js
//
// Scans `<projectPath>/.lorica/agents/` for JSON agent definitions and
// exposes the parsed list through the reducer. Refresh triggers:
//   • project path changes
//   • explicit refresh() call (from the AgentBuilder after saving)
//
// Each JSON file should conform to the schema written by AgentBuilder:
//   { name, slug, description, icon, color, systemPrompt,
//     model, permissions, autoApprove, context, createdAt }
//
// Invalid / non-parseable files are skipped silently — we don't want a
// broken file to block the whole list.

import { useCallback, useEffect } from 'react';

export function useCustomAgents(projectPath, dispatch) {
  const refresh = useCallback(async () => {
    if (!projectPath) {
      dispatch({ type: 'SET_CUSTOM_AGENTS', agents: [] });
      return;
    }
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const dir = `${projectPath}${sep}.lorica${sep}agents`;
    try {
      const r = await window.lorica.fs.readDir(dir);
      if (!r?.success) {
        dispatch({ type: 'SET_CUSTOM_AGENTS', agents: [] });
        return;
      }
      const entries = Array.isArray(r.data) ? r.data : [];
      const jsons = entries.filter((e) => !e.isDirectory && e.name.endsWith('.json'));
      const agents = [];
      for (const f of jsons) {
        try {
          const res = await window.lorica.fs.readFile(f.path);
          if (!res?.success) continue;
          const parsed = JSON.parse(res.data.content);
          if (parsed && typeof parsed.systemPrompt === 'string' && parsed.name) {
            agents.push({ ...parsed, _path: f.path });
          }
        } catch { /* skip bad file */ }
      }
      // Sort by createdAt descending so the newest appears first.
      agents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      dispatch({ type: 'SET_CUSTOM_AGENTS', agents });
    } catch {
      dispatch({ type: 'SET_CUSTOM_AGENTS', agents: [] });
    }
  }, [projectPath, dispatch]);

  useEffect(() => { refresh(); }, [refresh]);

  return { refresh };
}
