// src/utils/aiHoverDoc.js
//
// Wave 55 — AI hover-doc lookup. Given an identifier + a small
// surrounding code window, asks the active AI provider for a one-
// paragraph explanation of what the identifier is and what it does
// in that context. Cached per (file, identifier) for the lifetime of
// the session to avoid re-firing on every hover.
//
// Cache shape:
//   Map<`${file}::${identifier}`, { text: string, at: number }>
//
// The cache is module-scoped on purpose — we want it to survive
// re-renders but not navigation away from the IDE. A persistent
// store would risk serving stale docs after the user changed the
// underlying code.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You explain a single identifier (function, variable, type, class…)',
  'in ONE short paragraph (2-4 sentences). The reader has the surrounding',
  'code already, so do NOT restate it — explain WHAT this is and what role',
  'it plays. Plain prose. No code blocks, no headings, no bullet lists.',
  'If the identifier is generic (e.g. "i", "x") and you can\'t tell from',
  'context, say so in one sentence rather than guessing.',
].join('\n');

const CACHE = new Map();

export function clearHoverDocCache() {
  CACHE.clear();
}

export function __cacheKey(file, identifier) {
  return `${file || ''}::${identifier || ''}`;
}

export function getCachedHoverDoc(file, identifier) {
  return CACHE.get(__cacheKey(file, identifier))?.text || null;
}

export async function fetchHoverDoc({
  identifier, snippet, fileName, language,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error('No identifier under cursor.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const key = __cacheKey(fileName, identifier);
  const cached = CACHE.get(key);
  if (cached?.text) return cached.text;

  const userMsg = [
    fileName ? `File: ${fileName}` : '',
    language ? `Language: ${language}` : '',
    `Identifier: \`${identifier}\``,
    '',
    'Surrounding code (≈40 lines):',
    '```',
    String(snippet || '').slice(0, 4000),
    '```',
    '',
    'Explain the identifier in one short paragraph.',
  ].filter(Boolean).join('\n');

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider, model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 250,
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
  const text = String(extractText(provider, data) || '').trim();
  if (!text) throw new Error('Empty model output.');
  CACHE.set(key, { text, at: Date.now() });
  return text;
}

export const __testing__ = { __cacheKey, CACHE };
