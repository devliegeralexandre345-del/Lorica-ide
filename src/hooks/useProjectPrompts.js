// src/hooks/useProjectPrompts.js
//
// Loads project-level AI configuration from `.lorica/`:
//
//   • `.lorica/instructions.md`  → auto-prepended to every agent message
//                                  (think Cursor's `.cursorrules`).
//   • `.lorica/prompts/*.md`     → reusable prompt library, surfaced in
//                                  the agent slash-command menu as
//                                  `/<filename>` entries.
//
// Each prompt file may carry a tiny YAML-ish frontmatter (`name:` and
// `description:`) — see `utils/promptTemplates.js` for the parser. The
// filename (sans `.md`) becomes the slash-command name; frontmatter
// `name` is just a friendlier display label.
//
// Refresh policy:
//   • on project change (mount / projectPath swap)
//   • on file watcher events targeting `.lorica/` (best-effort — the
//     backend filters most `.lorica/` noise out, but markdown changes
//     under the user's own prompts dir may still fire)
//   • imperatively via the returned `refresh()` (callers can pull this
//     before opening the slash menu to be safe)
//
// We intentionally re-read instructions.md at SEND time too (see
// `useAgent.js`) so that even if the watcher missed the change the
// next agent message picks up the latest text from disk.
//
// Returns: { instructions, prompts, refresh }
//   - instructions: string | null
//   - prompts:      Array<{ slug, name, description, body, path }>
//   - refresh:      () => Promise<void>

import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { parsePromptFile } from '../utils/promptTemplates';

function joinPath(projectPath, ...segments) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return [projectPath, ...segments].join(sep);
}

async function readInstructions(projectPath) {
  const path = joinPath(projectPath, '.lorica', 'instructions.md');
  if (!path) return null;
  try {
    const r = await window.lorica?.fs?.readFile(path);
    if (!r?.success) return null;
    const text = String(r.data?.content ?? '');
    // Treat empty / whitespace-only as "no instructions" so we never
    // prepend a hollow "Project instructions:" header.
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function readPrompts(projectPath) {
  const dir = joinPath(projectPath, '.lorica', 'prompts');
  if (!dir) return [];
  try {
    const r = await window.lorica?.fs?.readDir(dir);
    if (!r?.success) return [];
    const entries = Array.isArray(r.data) ? r.data : [];
    const mdFiles = entries.filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.md'));
    const out = [];
    for (const f of mdFiles) {
      try {
        const fr = await window.lorica.fs.readFile(f.path);
        if (!fr?.success) continue;
        const { meta, body } = parsePromptFile(fr.data?.content ?? '');
        const slug = f.name.replace(/\.md$/i, '');
        out.push({
          slug,
          name: meta.name || slug,
          description: meta.description || '',
          body,
          path: f.path,
        });
      } catch { /* skip bad file */ }
    }
    // Alphabetical by slug — predictable order in the slash menu so
    // muscle memory works once the user has picked their favorites.
    out.sort((a, b) => a.slug.localeCompare(b.slug));
    return out;
  } catch {
    return [];
  }
}

export function useProjectPrompts(projectPath) {
  const [instructions, setInstructions] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const debounceRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setInstructions(null);
      setPrompts([]);
      return;
    }
    const [inst, pr] = await Promise.all([
      readInstructions(projectPath),
      readPrompts(projectPath),
    ]);
    setInstructions(inst);
    setPrompts(pr);
  }, [projectPath]);

  // Initial load + reload on project change. Deferred to browser-idle
  // time — the slash menu it powers is only opened when the user types
  // `/` in the agent input, which is well after first paint. 200 ms
  // setTimeout fallback for Safari.
  useEffect(() => {
    let idleId = null;
    let timeoutId = null;
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(() => refresh(), { timeout: 2000 });
    } else {
      timeoutId = setTimeout(refresh, 200);
    }
    return () => {
      if (idleId != null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [refresh]);

  // Re-read on file watcher events. We piggyback on the global
  // `fs:change` event the existing useFileWatcher already subscribes
  // to — no need to spin up a second watcher. The backend filters most
  // `.lorica/` noise out (semantic indexes are chatty), so this fires
  // less often than for user code, but markdown saves directly under
  // `.lorica/prompts/` may still slip through. Worst case, the user
  // reopens the slash menu and we pick up changes via the on-open
  // refresh path the AgentCopilot triggers.
  useEffect(() => {
    if (!projectPath) return;
    let unlisten = null;
    let cancelled = false;

    (async () => {
      try {
        unlisten = await listen('fs:change', (event) => {
          // Only react if at least one path looks like it lives under
          // `.lorica/` (instructions or prompts). Cheap string check —
          // we don't want a save in `src/` to thrash this hook.
          const paths = Array.isArray(event?.payload?.paths) ? event.payload.paths : [];
          const touched = paths.some((p) =>
            typeof p === 'string' && /[\/\\]\.lorica[\/\\](instructions\.md|prompts[\/\\])/i.test(p)
          );
          if (!touched) return;
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            if (!cancelled) refresh();
          }, 200);
        });
      } catch (e) {
        // Non-fatal — we still get the on-mount + on-demand refreshes.
        // eslint-disable-next-line no-console
        console.warn('[project-prompts] listen(fs:change) failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (unlisten) {
        try { unlisten(); } catch { /* ignore */ }
      }
    };
  }, [projectPath, refresh]);

  return { instructions, prompts, refresh };
}
