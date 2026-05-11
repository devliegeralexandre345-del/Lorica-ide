// src/utils/aiRefactorSuggestions.js
//
// Wave 48 — AI refactor suggestions. Asks the active provider for 3
// alternative refactors of a snippet, each with a short rationale.
// The caller previews them in a side-by-side modal and applies one
// via the existing inline-edit pipeline.
//
// Strict JSON contract:
//   {
//     "suggestions": [
//       { "title": "Extract helper", "rationale": "...", "replacement": "..." },
//       ...
//     ]
//   }
// Anything that doesn't parse to this shape is rejected — the caller
// shouldn't have to second-guess a partial reply.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You suggest THREE alternative refactors of a code snippet.',
  'Each refactor must be independently applicable in place of the original.',
  '',
  'Return STRICT JSON:',
  '{',
  '  "suggestions": [',
  '    {',
  '      "title":       "<short label, 2-5 words>",',
  '      "rationale":   "<one-sentence why this version is better>",',
  '      "replacement": "<the new code that REPLACES the original snippet verbatim>"',
  '    },',
  '    ... (exactly 3 entries)',
  '  ]',
  '}',
  '',
  'Rules:',
  '  • Output ONLY the JSON. No prose, no fences.',
  '  • Each replacement must be drop-in: same language, same exported',
  '    symbols, same overall contract. Do not introduce new dependencies.',
  '  • Aim for DIFFERENT angles: e.g. (1) shorter / more idiomatic,',
  '    (2) better error handling, (3) split into smaller helpers.',
  '  • Preserve original indentation level and final newline behaviour.',
].join('\n');

function parseSuggestionsJson(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    const arr = Array.isArray(obj.suggestions) ? obj.suggestions : null;
    if (!arr || arr.length === 0) return null;
    const cleaned = arr
      .filter((s) => s && typeof s === 'object'
        && typeof s.title === 'string' && s.title.trim()
        && typeof s.replacement === 'string' && s.replacement.trim())
      .map((s) => ({
        title: s.title.trim(),
        rationale: typeof s.rationale === 'string' ? s.rationale.trim() : '',
        replacement: s.replacement,
      }));
    if (cleaned.length === 0) return null;
    return { suggestions: cleaned };
  } catch {
    return null;
  }
}

export async function suggestRefactors({
  source, fileName, language,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new Error('Empty snippet.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const userMsg = [
    fileName ? `Source file: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    '',
    'Original snippet:',
    '```',
    source,
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
    maxTokens: 3000,
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
  return parseSuggestionsJson(extractText(provider, data));
}

export const __testing__ = { parseSuggestionsJson };
