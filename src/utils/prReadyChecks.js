// src/utils/prReadyChecks.js
//
// Runs a battery of AI-scored checks on the current branch before push.
// Each check is an independent, narrowly-scoped LLM call with a strict
// JSON output contract so the UI can render status + "fix with agent"
// actions deterministically.
//
// We intentionally keep each check small so they run in parallel and
// total wall-clock stays near the slowest. We also keep the prompt
// context capped — passing the full diff every time would be wasteful;
// the PR context is built once (via cmd_git_pr_context) and re-used
// across all checks.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT  = 'https://api.deepseek.com/v1/chat/completions';

const MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek:  'deepseek-chat',
};

const OUTPUT_CONTRACT = [
  'Respond with ONLY a JSON object — no prose, no markdown fences.',
  'Shape: { "status": "pass"|"warn"|"fail", "detail": "<1-2 sentences>", "fixPrompt": "<null or single-paragraph instruction for an agent to fix it>" }',
  '"pass" = the check is satisfied; "warn" = minor concern or noteworthy; "fail" = the PR should not ship as-is.',
  '"fixPrompt" should be null on "pass".',
].join('\n');

// Load any user-defined checks from `.lorica/pr-checks.json`. Each
// custom check has the same shape as built-ins: { id, label, system }.
// Users can override a built-in by reusing its id.
export async function loadCustomChecks(projectPath) {
  if (!projectPath) return [];
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const path = `${projectPath}${sep}.lorica${sep}pr-checks.json`;
  try {
    const r = await window.lorica.fs.readFile(path);
    if (!r?.success) return [];
    const parsed = JSON.parse(r.data.content);
    const arr = Array.isArray(parsed?.checks) ? parsed.checks : Array.isArray(parsed) ? parsed : [];
    return arr.filter((c) => c && c.id && c.label && c.system).map((c) => ({
      id: c.id, label: c.label, system: c.system, custom: true,
    }));
  } catch { return []; }
}

// Merge built-in checks with custom ones, letting custom override by id.
export function mergeChecks(built, custom) {
  const byId = new Map(built.map((c) => [c.id, c]));
  for (const c of custom || []) byId.set(c.id, c);
  return [...byId.values()];
}

export const BUILTIN_CHECKS = [
  {
    id: 'tests',
    label: 'Tests cover the change',
    system: 'You inspect a git diff and decide whether the change is accompanied by matching tests (new or updated). Framework-agnostic: any *test* file touching the changed subject counts. Non-code changes (docs, config) auto-pass.',
  },
  {
    id: 'docs',
    label: 'Docs / comments updated',
    system: 'You decide whether user-facing docs (README, CHANGELOG, inline docstrings for new public APIs) were updated when the diff introduces new public API or changes behavior. Internal-only refactors auto-pass.',
  },
  {
    id: 'secrets',
    label: 'No hardcoded secrets',
    system: 'You scan the diff for hardcoded credentials, API keys, tokens, .env values, or URL-embedded secrets. You flag ANY suspicious literal — false positives preferred over misses. Placeholder tokens in tests (XXXXXX, EXAMPLE) auto-pass.',
  },
  {
    id: 'todos',
    label: 'No leftover TODO/FIXME',
    system: 'You check whether the diff adds lines containing TODO, FIXME, HACK, XXX, or similar. One-liner TODOs with an issue ID reference pass with warn. New TODOs without rationale fail.',
  },
  {
    id: 'commit',
    label: 'Commit messages follow convention',
    system: 'You evaluate whether the branch commits follow a recognizable convention (Conventional Commits, imperative mood, < 72 chars subject). Mixed styles warn. Auto-generated "wip"/"fix" messages fail.',
  },
  {
    id: 'impact',
    label: 'Blast radius acknowledged',
    system: 'You estimate the change\'s blast radius (touches auth/payment/db schema/public API?). If the diff has high-risk touches and the commits/docs don\'t reflect the risk, you fail. Low-risk changes auto-pass.',
  },
  {
    id: 'dead-code',
    label: 'No obvious dead code',
    system: 'You scan the diff for code added but never referenced elsewhere in the diff or known to be referenced in the rest of the codebase. Exported-but-unused is a warn; file-local unused is a fail.',
  },
];

// CHECKS preserved as the default built-in list for back-compat.
export const CHECKS = BUILTIN_CHECKS;

async function robustFetch(url, opts, preferNative) {
  const init = { ...opts };
  if (preferNative) {
    try { return await fetch(url, init); } catch { return tauriFetch(url, init); }
  }
  try { return await tauriFetch(url, init); } catch { return fetch(url, init); }
}

function parseDecision(text) {
  if (!text) return null;
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try {
    const obj = JSON.parse(t.slice(s, e + 1));
    const status = ['pass', 'warn', 'fail'].includes(obj.status) ? obj.status : 'warn';
    return {
      status,
      detail: typeof obj.detail === 'string' ? obj.detail : '',
      fixPrompt: typeof obj.fixPrompt === 'string' ? obj.fixPrompt : null,
    };
  } catch { return null; }
}

function buildUserMessage(check, ctx) {
  // Trim the diff to stay well under the fast-model context budget.
  // Haiku handles ~200k but we don't need that much for a single check.
  const diff = (ctx.diff || '').slice(0, 40_000);
  const files = (ctx.files_changed || []).slice(0, 50).join('\n');
  const commits = (ctx.commits || []).slice(0, 30).map((c) => `- ${c.short_hash} ${c.message}`).join('\n');
  return [
    `Branch: ${ctx.current_branch}  →  ${ctx.base_branch}`,
    `Files changed (${(ctx.files_changed || []).length}):`,
    files,
    '',
    `Commits (${(ctx.commits || []).length}):`,
    commits,
    '',
    `Diff (first 40k chars):`,
    diff,
    '',
    `Check: ${check.label}`,
    OUTPUT_CONTRACT,
  ].join('\n');
}

async function runOne(check, prContext, provider, apiKey, signal) {
  const model = MODELS[provider] || MODELS.anthropic;
  const user = buildUserMessage(check, prContext);
  try {
    if (provider === 'anthropic') {
      const body = {
        model, max_tokens: 400, temperature: 0.1,
        system: check.system + '\n\n' + OUTPUT_CONTRACT,
        messages: [{ role: 'user', content: user }],
      };
      const r = await robustFetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal,
      }, false);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const text = (data?.content || []).map((b) => b.text || '').join('');
      return parseDecision(text) || { status: 'warn', detail: 'Model returned unparseable output', fixPrompt: null };
    } else {
      const body = {
        model, max_tokens: 400, temperature: 0.1,
        messages: [
          { role: 'system', content: check.system + '\n\n' + OUTPUT_CONTRACT },
          { role: 'user', content: user },
        ],
      };
      const r = await robustFetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }, true);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return parseDecision(text) || { status: 'warn', detail: 'Model returned unparseable output', fixPrompt: null };
    }
  } catch (e) {
    return { status: 'warn', detail: `Check errored: ${e.message}`, fixPrompt: null };
  }
}

/**
 * Run all checks in parallel against the current PR context.
 * `onUpdate(checkId, result)` fires as each check finishes.
 */
export async function runPrReadyChecks({ prContext, provider, apiKey, signal, onUpdate, checks }) {
  const list = Array.isArray(checks) && checks.length ? checks : CHECKS;
  const promises = list.map(async (c) => {
    onUpdate?.(c.id, { status: 'running' });
    const r = await runOne(c, prContext, provider, apiKey, signal);
    onUpdate?.(c.id, { status: r.status, detail: r.detail, fixPrompt: r.fixPrompt });
    return { id: c.id, ...r };
  });
  return Promise.all(promises);
}
