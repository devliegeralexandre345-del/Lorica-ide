// src/utils/aiCodeExplain.js
//
// Wave 38 — "explain this snippet". Pure helper that calls the active
// AI provider with a system prompt scoped to "explain code, no
// rewrite". The caller controls the streaming UX; we expose a
// non-streaming one-shot call for simplicity.
//
// Output is plain markdown — the caller renders it via the existing
// MarkdownMessage component.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You explain code to a developer who asked for help.',
  'Output: a concise Markdown explanation, 4–10 lines.',
  'Rules:',
  '  • Open with one sentence: what this code does at a high level.',
  '  • Then 2–4 bullets covering: notable techniques, edge cases,',
  '    likely pitfalls. Use `inline code` for identifiers.',
  '  • Optional final line: "⚠️" + a single concrete bug / improvement',
  '    if you spot one. Skip when nothing stands out.',
  '  • No fences around the whole reply, no preamble like "Sure".',
  '  • Match the user’s language preference (default English; if the',
  '    surrounding code or comments are French, reply in French).',
].join('\n');

/**
 * Ask the active AI provider to explain a snippet.
 *
 * @param {object} args
 * @param {string} args.code            — the snippet to explain
 * @param {string} [args.language]      — file extension or language id
 * @param {string} [args.fileName]
 * @param {string} args.provider
 * @param {string} args.apiKey          — null when provider is ollama
 * @param {string} [args.model]
 * @param {string} [args.ollamaBaseUrl]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<string>}           — the markdown explanation
 */
export async function explainCode({
  code, language, fileName,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new Error('Empty code selection.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const userMsg = [
    fileName ? `File: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    '',
    '```',
    code,
    '```',
  ].filter(Boolean).join('\n');

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider, model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 800,
    temperature: 0.2,
  });
  const fetchFn = provider === 'anthropic' ? tauriFetch : fetch;
  const r = await fetchFn(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.error?.message || j.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await r.json();
  return extractText(provider, data).trim();
}
