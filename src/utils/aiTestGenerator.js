// src/utils/aiTestGenerator.js
//
// Wave 44 — AI test generator. Takes a source snippet (typically the
// active editor selection or full file) and asks the active provider
// to draft a test file appropriate for the language. Returns the
// suggested test file's content + a relative path the user can
// inspect before saving.
//
// Output shape (strict JSON):
//   { "path": "tests/foo.test.js", "content": "...", "framework": "vitest" }
// The path is a SUGGESTION — the caller chooses where to drop it via
// a save dialog, so a bogus path doesn't write somewhere unexpected.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You generate a unit test file for a source snippet.',
  'Return STRICT JSON:',
  '{',
  '  "path":      "<suggested path, e.g. tests/foo.test.js>",',
  '  "framework": "<vitest | pytest | rspec | cargo-test | jest | go-test | ... pick from the source language>",',
  '  "content":   "<the COMPLETE test file content, including imports>"',
  '}',
  'Rules:',
  '  • Output ONLY the JSON. No prose, no fences.',
  '  • Pick the test framework that matches the language convention',
  '    (vitest/jest for JS/TS, pytest for Python, cargo test for Rust,',
  '    go test for Go, junit for Java, etc.).',
  '  • Cover the visible behaviours of the source: happy path,',
  '    edge cases, error conditions. Aim for 5-10 tests.',
  '  • Test names describe behaviour ("returns the empty string when',
  '    input is null"), not implementation.',
  '  • Import paths assume the test file sits in a sibling `tests/`',
  '    folder (e.g. `import { foo } from "../src/foo.js"`). Adjust',
  '    if the source clearly lives elsewhere.',
].join('\n');

function parseTestJson(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.path !== 'string' || !obj.path.trim()) return null;
    if (typeof obj.content !== 'string' || !obj.content.trim()) return null;
    return {
      path: obj.path.trim(),
      content: obj.content,
      framework: typeof obj.framework === 'string' ? obj.framework.trim() : 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Ask the active provider to draft a test file for the given source.
 */
export async function generateTests({
  source, fileName, language,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new Error('Empty source snippet.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const userMsg = [
    fileName ? `Source file: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    '',
    'Source:',
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
  return parseTestJson(extractText(provider, data));
}

export const __testing__ = { parseTestJson };
