// src/utils/swarmOrchestrator.js
//
// MVP of Swarm Development orchestration. The user describes a feature
// in natural language; we ask the LLM to decompose it into parallelizable
// sub-tasks with a minimal dependency DAG. The orchestrator then runs
// each sub-task as an isolated agent invocation, tracks its status on a
// Kanban board, and surfaces progress to the UI.
//
// Caveats for this MVP:
//   • No git-worktree isolation (would require Tauri backend support for
//     `git worktree add/remove`). Sub-tasks run sequentially on the SAME
//     working tree — the decomposer is instructed to produce tasks that
//     don't conflict on files.
//   • Each sub-task is a single non-streaming agent call (not a full
//     tool-using loop). Keeps costs predictable. Future versions can
//     swap in the full agent runtime.
//   • Dependencies are honored: we only start task B after task A if B
//     has A in its `dependsOn`.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK  = 'https://api.deepseek.com/v1/chat/completions';
const FAST = { anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat' };
const STRONG = { anthropic: 'claude-sonnet-4-20250514', deepseek: 'deepseek-chat' };

const DECOMPOSE_SYSTEM = [
  'You decompose a feature request into parallelizable implementation sub-tasks.',
  'Return STRICT JSON: an array of sub-tasks. Each task is:',
  '{ "id": "<short-slug>",',
  '  "title": "<imperative phrase>",',
  '  "description": "<1-3 sentences, what this task actually does>",',
  '  "files": ["<relative paths that this task will TOUCH>"],',
  '  "dependsOn": ["<task-id>", ...],',
  '  "role": "api" | "ui" | "tests" | "docs" | "refactor" | "glue" }',
  '',
  'Rules:',
  '  • Split by FILE ownership — no two parallel tasks should write the same file.',
  '  • Declare dependencies honestly: docs depend on code, tests usually depend on code,',
  '    glue depends on api/ui.',
  '  • Prefer 3-6 tasks. If the feature is trivial, return a single task.',
  '  • If paths are unknown, make a best guess — agents will refine them.',
].join('\n');

async function robustFetch(url, opts, preferNative) {
  try { return preferNative ? await fetch(url, opts) : await tauriFetch(url, opts); }
  catch { return preferNative ? await tauriFetch(url, opts) : await fetch(url, opts); }
}

function parse(text, startChar, endChar) {
  if (!text) return null;
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const s = t.indexOf(startChar); const e = t.lastIndexOf(endChar);
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

export async function decomposeFeature({ featureRequest, projectTreeSummary, provider, apiKey, signal }) {
  const model = FAST[provider] || FAST.anthropic;
  const userMsg = [
    `Feature request: ${featureRequest}`,
    '',
    `Project tree sample:`,
    projectTreeSummary.slice(0, 3000),
    '',
    'Return the JSON array now.',
  ].join('\n');
  const body = provider === 'anthropic' ? {
    model, max_tokens: 1800, temperature: 0.2,
    system: DECOMPOSE_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  } : {
    model, max_tokens: 1800, temperature: 0.2,
    messages: [{ role: 'system', content: DECOMPOSE_SYSTEM }, { role: 'user', content: userMsg }],
  };
  const r = await robustFetch(
    provider === 'anthropic' ? ANTHROPIC : DEEPSEEK,
    {
      method: 'POST',
      headers: provider === 'anthropic' ? {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      } : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    },
    provider !== 'anthropic',
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const text = provider === 'anthropic'
    ? (data?.content || []).map((b) => b.text || '').join('')
    : (data?.choices?.[0]?.message?.content || '');
  const arr = parse(text, '[', ']');
  if (!Array.isArray(arr)) return [];
  return arr.map((t, i) => ({
    id: t.id || `task-${i + 1}`,
    title: t.title || `Task ${i + 1}`,
    description: t.description || '',
    files: Array.isArray(t.files) ? t.files : [],
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
    role: ['api', 'ui', 'tests', 'docs', 'refactor', 'glue'].includes(t.role) ? t.role : 'glue',
    status: 'todo',
    result: null,
  }));
}

// Execute one sub-task as a plain one-shot agent call. We do not loop or
// use tools here — the agent is asked to produce a unified diff or
// complete file content. The orchestrator applies writes only after
// user-confirmation.
const EXECUTE_SYSTEM = [
  'You implement a single sub-task of a larger feature. Output ONLY the',
  'final code/doc for each file you need to create or modify — no prose.',
  '',
  'Return STRICT JSON:',
  '{ "notes": "<optional 1-sentence summary>",',
  '  "changes": [',
  '    { "path": "<relative path>",',
  '      "action": "create" | "rewrite" | "append",',
  '      "content": "<full file content for create/rewrite, OR suffix for append>" }',
  '  ] }',
  '',
  'Rules:',
  '  • Touch ONLY the files listed in your task. Do not expand scope.',
  '  • Respect existing project conventions (naming, imports, framework).',
  '  • If a file in your task doesn\'t exist, use "create".',
].join('\n');

export async function executeTask({ task, projectContext, provider, apiKey, signal }) {
  const model = STRONG[provider] || STRONG.anthropic;
  const userMsg = [
    `Task: ${task.title}`,
    `Description: ${task.description}`,
    `Files to touch: ${task.files.join(', ') || '(you decide)'}`,
    '',
    'Project context:',
    projectContext.slice(0, 8000),
    '',
    'Return the JSON now.',
  ].join('\n');
  const body = provider === 'anthropic' ? {
    model, max_tokens: 4000, temperature: 0.2,
    system: EXECUTE_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  } : {
    model, max_tokens: 4000, temperature: 0.2,
    messages: [{ role: 'system', content: EXECUTE_SYSTEM }, { role: 'user', content: userMsg }],
  };
  const r = await robustFetch(
    provider === 'anthropic' ? ANTHROPIC : DEEPSEEK,
    {
      method: 'POST',
      headers: provider === 'anthropic' ? {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      } : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    },
    provider !== 'anthropic',
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const text = provider === 'anthropic'
    ? (data?.content || []).map((b) => b.text || '').join('')
    : (data?.choices?.[0]?.message?.content || '');
  const parsed = parse(text, '{', '}');
  if (!parsed || !Array.isArray(parsed.changes)) return { notes: 'Parse failed', changes: [] };
  return parsed;
}

// Order tasks so that a task appears only after all its dependencies.
// Returns an array of tiers — each tier is a list of tasks that can run
// in parallel (in our MVP, sequentially within a tier, tier after tier).
export function tierTasks(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const done = new Set();
  const tiers = [];
  let remaining = [...tasks];
  while (remaining.length) {
    const ready = remaining.filter((t) => (t.dependsOn || []).every((d) => done.has(d)));
    if (!ready.length) {
      // Dependency cycle — dump the rest into one tier to avoid a lockup.
      tiers.push(remaining);
      break;
    }
    tiers.push(ready);
    ready.forEach((t) => done.add(t.id));
    remaining = remaining.filter((t) => !ready.includes(t));
  }
  return tiers;
}
