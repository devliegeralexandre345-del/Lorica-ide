// src/utils/aiDocGenerator.js
//
// Wave 45 — AI documentation generator. Reads a source file and asks
// the active provider to draft a Markdown reference page: overview,
// public API table, examples, and any caveats it spotted while
// reading. Output is plain Markdown (no JSON envelope) because the
// caller's only job is to drop it next to the source.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You write a Markdown reference page for a source file. The reader is',
  'a developer scanning the doc to decide whether the module fits their need.',
  '',
  'Output shape (plain Markdown, no fences around the whole reply):',
  '  # <ModuleName>',
  '  <one-paragraph overview>',
  '',
  '  ## Public API',
  '  Table with columns: Name | Kind | Signature | What it does',
  '  Only list EXPORTED symbols. Skip helpers / internals.',
  '',
  '  ## Examples',
  '  1-2 code blocks demonstrating the most-likely use case.',
  '',
  '  ## Notes',
  '  Optional. Caveats, edge cases, perf gotchas you spotted.',
  '  Skip entirely if nothing is worth flagging.',
  '',
  'Rules:',
  '  • Plain Markdown. No prose preamble like "Sure".',
  '  • No code fences wrapping the WHOLE reply.',
  '  • Inline `code` for identifiers in narrative; ``` fences for example blocks.',
  '  • Match the source\'s language conventions for the example fence',
  '    (`python`, `js`, `rust`, `go`, etc.).',
].join('\n');

/**
 * Generate a Markdown reference page for a file's source.
 *
 * @param {object} args
 * @param {string} args.source          — the file contents
 * @param {string} args.fileName        — file name shown in the header
 * @param {string} [args.language]
 * @param {string} args.provider
 * @param {string} args.apiKey
 * @param {string} [args.model]
 * @param {string} [args.ollamaBaseUrl]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<string>}           — the markdown
 */
export async function generateDocs({
  source, fileName, language,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new Error('Empty source.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  // Cap source at 16k chars to keep token usage sane on huge files.
  // The top of the file (imports, exports, top-level defs) is the
  // most signal-rich slice — that's what we want the model focused on.
  const clipped = source.length <= 16000 ? source : source.slice(0, 16000) + '\n…/* truncated */';

  const userMsg = [
    fileName ? `File: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    '',
    '```',
    clipped,
    '```',
    '',
    'Write the Markdown reference page now.',
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
  return cleanOutput(extractText(provider, data));
}

// Strip leading / trailing code fences if the model wrapped the
// whole reply despite instructions. Preserves inner fences (they're
// example blocks we want to keep).
function cleanOutput(text) {
  let out = String(text || '').trim();
  // Only strip the FIRST opening fence if it's at the very start and
  // pairs with the LAST closing fence at the very end (whole-reply
  // wrap). A leading "```markdown" or "```md" is the common case.
  const startFence = /^```(?:markdown|md)?\n/i;
  const endFence = /\n```$/;
  if (startFence.test(out) && endFence.test(out)) {
    out = out.replace(startFence, '').replace(endFence, '');
  }
  return out;
}

export const __testing__ = { cleanOutput };
