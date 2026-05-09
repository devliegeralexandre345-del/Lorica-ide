// src/utils/aiQueryExpand.js
//
// Wave 41 — AI query expansion for the semantic search panel. Takes
// a natural-language question ("where do we handle authentication?")
// and returns 2-4 specific semantic queries that the existing
// embedding index can answer well ("authentication middleware",
// "JWT validation", "session token decode", "login route handler").
//
// Why: cosine similarity over the embedding index works on phrasing.
// A user's high-level question often misses the specific terms a
// match would land on. Asking a fast LLM for query variants is a
// 1-2s tax that turns mediocre semantic results into great ones.
//
// Falls back gracefully (returns just the original query in an array)
// when the API call fails or the model returns gibberish.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You expand a single natural-language question into 2-4 short',
  'phrases that a code search would match on. Output STRICT JSON:',
  '  ["phrase 1", "phrase 2", ...]',
  'Rules:',
  '  • Each phrase 2-6 words, focused on identifiers or domain terms',
  '    a developer would actually type into a file ("validate jwt",',
  '    "session middleware", not full sentences).',
  '  • Order by likely relevance — most-likely-to-match first.',
  '  • Include the original phrase verbatim as one of the entries.',
  '  • No prose outside the JSON, no fences.',
].join('\n');

function parseQueriesJson(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end < 0) return null;
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Expand a natural-language question into 2-4 semantic-search-friendly
 * phrases. Returns an array of strings (always at least the original
 * query, even on failure).
 */
export async function expandQuery({
  question,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  const fallback = [question];
  if (!question || typeof question !== 'string' || !question.trim()) {
    return fallback;
  }
  if (!isKeyless(provider) && !apiKey) return fallback;

  try {
    const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
    const headers = getHeaders(provider, apiKey);
    const body = buildChatBody({
      provider, model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Question: ${question.trim()}\n\nReturn the JSON array now.` }],
      maxTokens: 200,
      temperature: 0.2,
    });
    const fetchFn = provider === 'anthropic' ? tauriFetch : fetch;
    const r = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) return fallback;
    const data = await r.json();
    const parsed = parseQueriesJson(extractText(provider, data));
    if (!parsed) return fallback;
    // Always make sure the original question is in there so we don't
    // accidentally lose results that the model failed to generalise.
    if (!parsed.some((p) => p.toLowerCase() === question.trim().toLowerCase())) {
      parsed.push(question.trim());
    }
    return parsed.slice(0, 4);
  } catch {
    return fallback;
  }
}

export const __testing__ = { parseQueriesJson };
