// src/utils/aiNameSuggestions.js
//
// Wave 64 — AI naming suggestions. Given an identifier + a small
// context window, asks the active provider for 3 alternative names
// with rationale. The UI surfaces them; the user picks one and
// applies via the existing inline-edit pipeline (smartInsert event).
//
// Strict JSON contract — same defensive pattern as the refactor and
// test generators. The replacement is just a name (no code body), so
// the parser is simpler than aiRefactorSuggestions but follows the
// same shape for predictability.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You suggest THREE alternative names for a single identifier in code.',
  '',
  'Return STRICT JSON:',
  '{',
  '  "suggestions": [',
  '    { "name": "<new identifier>", "rationale": "<one sentence>" },',
  '    ... (exactly 3 entries)',
  '  ]',
  '}',
  '',
  'Rules:',
  '  • Output ONLY the JSON. No prose, no fences.',
  '  • Names must respect the language\'s naming convention shown in',
  '    the surrounding code (camelCase, snake_case, PascalCase, etc.).',
  '  • Aim for DIFFERENT angles: (1) shorter / more direct, (2) more',
  '    descriptive / role-emphasising, (3) domain-language alternative.',
  '  • Never propose the original name back unchanged.',
  '  • Skip generic names (`data`, `item`, `value`) unless context demands.',
].join('\n');

function parseNameJson(raw) {
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
        && typeof s.name === 'string' && s.name.trim()
        // Defensive: model occasionally returns a multi-word phrase
        // for `name`. Reject anything containing whitespace because
        // splicing it into the editor would break the surrounding code.
        && !/\s/.test(s.name.trim()))
      .map((s) => ({
        name: s.name.trim(),
        rationale: typeof s.rationale === 'string' ? s.rationale.trim() : '',
      }));
    if (cleaned.length === 0) return null;
    return { suggestions: cleaned };
  } catch {
    return null;
  }
}

export async function suggestNames({
  identifier, snippet, fileName, language,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
    throw new Error('No identifier to rename.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const userMsg = [
    fileName ? `File: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    `Identifier to rename: \`${identifier.trim()}\``,
    '',
    'Surrounding code:',
    '```',
    String(snippet || '').slice(0, 4000),
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
    maxTokens: 1000,
    temperature: 0.4,
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
  return parseNameJson(extractText(provider, data));
}

export const __testing__ = { parseNameJson };
