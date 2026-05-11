// src/utils/aiCommitGrouping.js
//
// Wave 65 — AI-assisted commit grouping. Takes a unified diff (the
// full staged + unstaged set of changes) and proposes splitting it
// into N atomic commits, each with a subject + the list of files /
// hunks that should go into it.
//
// Output is "suggestions" — we don't actually rewrite git's index.
// The user reviews and decides which commits to make manually.
// Doing the index rewrite blindly would be too easy to get wrong
// and the safety story isn't worth the convenience for v1.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You group a unified git diff into 1-5 atomic commits.',
  '',
  'Return STRICT JSON:',
  '{',
  '  "groups": [',
  '    {',
  '      "subject": "<conventional-commit subject, ≤72 chars>",',
  '      "body":    "<optional body, may be empty>",',
  '      "files":   ["<file1>", "<file2>", ...],',
  '      "rationale": "<one sentence why these files belong together>"',
  '    },',
  '    ...',
  '  ]',
  '}',
  '',
  'Rules:',
  '  • Output ONLY the JSON. No prose, no fences.',
  '  • Each group must contain at least one file path.',
  '  • Group by theme: keep refactor + feature + bugfix changes',
  '    separate even if they touch the same file.',
  '  • Subject uses imperative mood ("add", "fix", "remove"); pick a',
  '    Conventional Commit prefix when obvious (`feat:`, `fix:`,',
  '    `refactor:`, `docs:`, `test:`, `chore:`).',
  '  • If the whole diff IS atomic, return one group.',
  '  • Cap at 5 groups so the user isn\'t overwhelmed.',
].join('\n');

function parseGroupingJson(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    const arr = Array.isArray(obj.groups) ? obj.groups : null;
    if (!arr || arr.length === 0) return null;
    const cleaned = arr
      .filter((g) => g && typeof g === 'object'
        && typeof g.subject === 'string' && g.subject.trim()
        && Array.isArray(g.files) && g.files.length > 0
        && g.files.every((f) => typeof f === 'string' && f.trim()))
      .map((g) => ({
        subject: g.subject.trim(),
        body: typeof g.body === 'string' ? g.body.trim() : '',
        files: g.files.map((f) => f.trim()),
        rationale: typeof g.rationale === 'string' ? g.rationale.trim() : '',
      }));
    if (cleaned.length === 0) return null;
    return { groups: cleaned.slice(0, 5) };
  } catch {
    return null;
  }
}

export async function suggestCommitGroups({
  diff,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!diff || typeof diff !== 'string' || !diff.trim()) {
    throw new Error('Empty diff.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  // Cap the diff payload at 24k chars so we don't blow the context
  // window on huge change sets. Beyond that the model usually starts
  // hallucinating non-existent files anyway.
  const clipped = diff.length <= 24000
    ? diff
    : diff.slice(0, 24000) + '\n…/* diff truncated */';

  const userMsg = [
    'Unified diff:',
    '```diff',
    clipped,
    '```',
    '',
    'Return the JSON now.',
  ].join('\n');

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider, model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 2000,
    temperature: 0.3,
  });
  const fetchFn = provider === 'anthropic' ? tauriFetch : fetch;
  const r = await fetchFn(endpoint, {
    method: 'POST', headers, body: JSON.stringify(body), signal,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.error?.message || j.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await r.json();
  return parseGroupingJson(extractText(provider, data));
}

export const __testing__ = { parseGroupingJson };
