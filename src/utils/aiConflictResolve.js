// src/utils/aiConflictResolve.js
//
// Wave 61 — AI conflict resolution. Given a single conflict block
// (OURS / THEIRS strings + a few lines of surrounding code), asks the
// active provider for a proposed merged version + a one-sentence
// rationale. The caller previews + accepts before the resolution
// actually rewrites the conflict in the document.
//
// We send a strict JSON contract because the editor will splice the
// `replacement` directly into the conflict block's range. Anything
// that doesn't fit the contract is rejected and the caller falls back
// to the manual ours/theirs/both buttons that already exist in the
// conflictExtension.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You merge a single git merge-conflict block.',
  '',
  'Input format:',
  '  • OURS: the local side of the conflict',
  '  • THEIRS: the incoming side',
  '  • CONTEXT_BEFORE / CONTEXT_AFTER: a few lines around the block',
  '',
  'Return STRICT JSON:',
  '{',
  '  "replacement": "<the merged code that should replace BOTH sides>",',
  '  "rationale":   "<one sentence explaining the merge choice>"',
  '}',
  '',
  'Rules:',
  '  • Output ONLY the JSON. No prose, no fences.',
  '  • The replacement must compile / parse in the file\'s language.',
  '  • Preserve indentation of the surrounding context.',
  '  • Do NOT include the conflict markers (<<<<<<< / ======= / >>>>>>>).',
  '  • If one side is a strict superset of the other, prefer the superset.',
  '  • If the two sides change DIFFERENT things, include both changes.',
  '  • If the two sides contradict each other directly, pick whichever',
  '    looks like the more recent / more correct one and explain why.',
].join('\n');

function parseResolveJson(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.replacement !== 'string' || !obj.replacement.length) return null;
    return {
      replacement: obj.replacement,
      rationale: typeof obj.rationale === 'string' ? obj.rationale.trim() : '',
    };
  } catch {
    return null;
  }
}

export async function resolveConflict({
  ours, theirs, contextBefore, contextAfter,
  fileName, language,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (typeof ours !== 'string' || typeof theirs !== 'string') {
    throw new Error('Conflict sides missing.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const userMsg = [
    fileName ? `File: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    '',
    'CONTEXT_BEFORE:',
    '```',
    (contextBefore || '').slice(-2000),
    '```',
    '',
    'OURS:',
    '```',
    ours,
    '```',
    '',
    'THEIRS:',
    '```',
    theirs,
    '```',
    '',
    'CONTEXT_AFTER:',
    '```',
    (contextAfter || '').slice(0, 2000),
    '```',
    '',
    'Return the JSON now.',
  ].filter(Boolean).join('\n');

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider, model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 2000,
    temperature: 0.2,
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
  return parseResolveJson(extractText(provider, data));
}

export const __testing__ = { parseResolveJson };
