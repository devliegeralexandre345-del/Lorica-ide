// src/utils/agentSwarm.js
//
// "Multi-Agent Swarm Review" — we spawn N specialized model calls in
// parallel, each with a narrow role and a strict output contract. The
// results are merged into a single structured report that lives in its
// own panel (AgentSwarmPanel).
//
// Why this isn't just "one agent with a longer prompt":
//   • Each role gets its own system prompt focused on a single dimension
//     (bugs / security / perf / architecture / tests). No cross-
//     contamination of priorities.
//   • The calls run in parallel. Wall-clock = slowest agent, not the sum.
//   • Output is STRUCTURED JSON (not free-text) so the UI can render
//     severity chips, line numbers, and "apply fix" suggestions.
//
// Each role returns an array of findings:
//   { severity: 'critical'|'high'|'medium'|'low'|'info',
//     title:    string,
//     line:     number | null,
//     body:     string,          — markdown explanation, 1-3 sentences
//     suggest:  string | null }  — concrete action the user can take
//
// Consumers display them grouped-by-role or flat-by-severity. The panel
// picks the latter by default because "show me the scariest thing first"
// is what users actually want.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT  = 'https://api.deepseek.com/v1/chat/completions';

const MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek:  'deepseek-chat',
};

// Load user-defined roles from `.lorica/swarm-roles.json`. File shape:
//   [{ id, label, system, color?, bg? }, …]
// User roles are appended to the built-ins; a role with the same `id` as
// a built-in OVERRIDES it. This lets teams customise the review without
// re-building Lorica.
export async function loadCustomSwarmRoles(projectPath) {
  if (!projectPath) return [];
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const path = `${projectPath}${sep}.lorica${sep}swarm-roles.json`;
  try {
    const r = await window.lorica.fs.readFile(path);
    if (!r?.success) return [];
    const parsed = JSON.parse(r.data.content);
    const arr = Array.isArray(parsed?.roles) ? parsed.roles
             : Array.isArray(parsed) ? parsed : [];
    return arr.filter((x) => x && x.id && x.label && x.system).map((x) => ({
      id: x.id, label: x.label, system: x.system,
      color: x.color || 'text-sky-300',
      bg: x.bg || 'bg-sky-300/10 border-sky-300/30',
    }));
  } catch { return []; }
}

/** Merge built-in roles with custom roles (custom override by id). */
export function mergeSwarmRoles(built, custom) {
  const byId = new Map(built.map((r) => [r.id, r]));
  for (const r of custom || []) byId.set(r.id, r);
  return [...byId.values()];
}

// ── Role catalogue. Each entry drives one parallel model call. ──────────
// Keep the prompts tight; verbosity slows the call and dilutes focus.
export const SWARM_ROLES = [
  {
    id: 'bugs',
    label: 'Bug Hunter',
    color: 'text-red-400',
    bg: 'bg-red-400/10 border-red-400/30',
    system: [
      'You are a rigorous bug hunter reviewing one file.',
      'Surface concrete, reproducible bugs — logic errors, off-by-one, incorrect null/undefined handling,',
      'race conditions, incorrect assumptions about input, type coercion bugs, broken control flow.',
      'Do NOT flag style, formatting, or architectural concerns — those belong to other reviewers.',
      'Every finding MUST cite a line number and propose a concrete fix.',
    ].join(' '),
  },
  {
    id: 'security',
    label: 'Security Auditor',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10 border-amber-400/30',
    system: [
      'You are a security auditor reviewing one file.',
      'Focus only on security issues: injection (SQL/shell/template), XSS, SSRF, path traversal, hardcoded',
      'secrets/keys, unsafe deserialization, insecure crypto, missing authorization, weak randomness,',
      'dangerous eval/exec, unsafe file operations, unvalidated user input.',
      'Ignore style, performance, and generic bugs.',
      'Be precise about the attack vector — say WHAT an attacker does, not just "sanitize input".',
    ].join(' '),
  },
  {
    id: 'perf',
    label: 'Performance Profiler',
    color: 'text-sky-400',
    bg: 'bg-sky-400/10 border-sky-400/30',
    system: [
      'You are a performance reviewer. Focus on concrete performance problems:',
      'N+1 queries, accidental quadratic loops, unnecessary re-renders, blocking I/O in hot paths,',
      'redundant work, memory allocation in tight loops, missing caching opportunities.',
      'Skip micro-optimizations that the compiler / runtime already handles.',
      'Cite the line that causes the hot path and estimate the cost pattern (O(n²), per-keystroke, per-frame, etc.).',
    ].join(' '),
  },
  {
    id: 'arch',
    label: 'Architect',
    color: 'text-purple-400',
    bg: 'bg-purple-400/10 border-purple-400/30',
    system: [
      'You are a senior architect reviewing one file for structural issues.',
      'Focus on: unclear abstractions, god objects/functions, tight coupling, leaky abstractions,',
      'misplaced responsibilities, dead code, duplicated logic that should be extracted.',
      'Skip petty refactors and naming bike-sheds. Only flag issues that would concretely hurt future maintainers.',
    ].join(' '),
  },
];

const OUTPUT_CONTRACT = [
  'Return ONLY a JSON array (no prose, no markdown fences) of findings.',
  'Each finding has this exact shape:',
  '{ "severity": "critical"|"high"|"medium"|"low"|"info",',
  '  "title":    "short one-line summary",',
  '  "line":     <integer line number in the original file, or null>,',
  '  "body":     "1-3 sentence explanation, markdown allowed (no fences)",',
  '  "suggest":  "concrete fix the user can apply, or null" }',
  'If nothing concerning is found, return [].',
  'Do NOT invent issues just to fill the list. Empty is a valid answer.',
].join('\n');

// ── Transport — same robust-fetch pattern as the rest of the codebase ──
async function robustFetch(url, opts, preferNative) {
  const init = { ...opts };
  if (preferNative) {
    try { return await fetch(url, init); } catch (e) {
      try { return await tauriFetch(url, init); } catch (e2) {
        throw new Error(`fetch failed: ${e.message}; tauri fetch failed: ${e2.message}`);
      }
    }
  }
  try { return await tauriFetch(url, init); } catch (e) {
    try { return await fetch(url, init); } catch (e2) {
      throw new Error(`tauri fetch failed: ${e.message}; native fetch failed: ${e2.message}`);
    }
  }
}

function buildUserMessage({ file, role }) {
  return [
    `File: ${file.path || file.name}`,
    `Language: ${file.extension || 'plain'}`,
    '',
    '```' + (file.extension || ''),
    file.content,
    '```',
    '',
    `Your role: ${role.label}.`,
    '',
    OUTPUT_CONTRACT,
  ].join('\n');
}

// ── Parse a model response that is supposed to be a JSON array. We're ──
// tolerant here: the model sometimes wraps it in code fences or prepends
// a one-line summary. We strip fences and grab the first `[...]` block.
function parseFindings(text) {
  if (!text) return [];
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  // Find the outermost JSON array.
  const start = t.indexOf('[');
  const end   = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = t.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (!Array.isArray(parsed)) return [];
    // Minimal validation + normalization so the UI doesn't blow up on
    // malformed fields.
    return parsed.map((f) => ({
      severity: typeof f.severity === 'string' ? f.severity : 'info',
      title:    typeof f.title === 'string' ? f.title : '(untitled)',
      line:     Number.isFinite(f.line) ? f.line : null,
      body:     typeof f.body === 'string' ? f.body : '',
      suggest:  typeof f.suggest === 'string' ? f.suggest : null,
    }));
  } catch (_) {
    return [];
  }
}

// ── Run ONE role call (Anthropic or DeepSeek). Returns { findings, error } ──
async function runRoleCall({ role, file, provider, apiKey, signal }) {
  const model = MODELS[provider] || MODELS.anthropic;
  const userMsg = buildUserMessage({ file, role });
  try {
    if (provider === 'anthropic') {
      const body = {
        model, max_tokens: 1500, temperature: 0.1,
        system: role.system + '\n\n' + OUTPUT_CONTRACT,
        messages: [{ role: 'user', content: userMsg }],
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
      return { findings: parseFindings(text) };
    } else {
      const body = {
        model, max_tokens: 1500, temperature: 0.1,
        messages: [
          { role: 'system', content: role.system + '\n\n' + OUTPUT_CONTRACT },
          { role: 'user',   content: userMsg },
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
      return { findings: parseFindings(text) };
    }
  } catch (e) {
    return { findings: [], error: e.message };
  }
}

/**
 * Run the full swarm in parallel. Returns a report object:
 *   {
 *     roles: [{ id, label, status: 'done'|'error', findings, error? }],
 *     totalFindings, startedAt, finishedAt,
 *   }
 *
 * `onRoleUpdate(role, state)` fires as each role finishes so the UI can
 * progressively fill in results rather than wait for the slowest one.
 */
export async function runSwarm({ file, provider, apiKey, signal, onRoleUpdate, roles: rolesOverride }) {
  const startedAt = Date.now();
  const list = (Array.isArray(rolesOverride) && rolesOverride.length) ? rolesOverride : SWARM_ROLES;
  const promises = list.map(async (role) => {
    onRoleUpdate?.(role, { status: 'running' });
    const res = await runRoleCall({ role, file, provider, apiKey, signal });
    const state = {
      status: res.error ? 'error' : 'done',
      findings: res.findings || [],
      error: res.error,
    };
    onRoleUpdate?.(role, state);
    return { role, ...state };
  });
  const results = await Promise.all(promises);
  const roles = results.map((r) => ({
    id: r.role.id,
    label: r.role.label,
    color: r.role.color,
    bg: r.role.bg,
    status: r.status,
    findings: r.findings,
    error: r.error,
  }));
  return {
    roles,
    totalFindings: roles.reduce((n, r) => n + r.findings.length, 0),
    startedAt,
    finishedAt: Date.now(),
  };
}

// Severity → sort priority (higher = more urgent)
export const SEVERITY_RANK = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};
