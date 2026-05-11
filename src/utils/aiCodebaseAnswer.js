// src/utils/aiCodebaseAnswer.js
//
// Wave 56 — "Ask the codebase". Takes a natural-language question plus
// the top-K semantic-search hits (already cosine-ranked, possibly
// AI-reranked) and asks the active provider to synthesize a one-
// paragraph answer with file:line citations.
//
// The output is plain text, NOT JSON. We deliberately don't force a
// JSON envelope here because the answer is a narrative — the citations
// live inline in the prose and the UI doesn't need structured fields.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You answer a question about a code base using the provided snippets.',
  '',
  'Rules:',
  '  • One short paragraph (2-5 sentences). No headings, no bullet lists.',
  '  • Cite specific files inline as `path/to/file.ext:LINE` whenever',
  '    you reference what the code does. The reader uses these to jump.',
  '  • If the snippets are insufficient to answer with confidence, say',
  '    so in one sentence rather than inventing details.',
  '  • Plain prose. Use `code` for identifiers when it helps readability.',
].join('\n');

// We cap each snippet at ~40 lines + budget total to ~12k chars so
// big result sets don't blow the model's context window. Cosine hits
// are usually 20-40 lines each, so this fits ~10-15 hits comfortably.
const MAX_SNIPPET_LINES = 40;
const MAX_TOTAL_CHARS = 12000;

function formatHits(hits) {
  let used = 0;
  const blocks = [];
  for (const h of hits || []) {
    const path = h.path || h.relative || '<unknown>';
    const start = h.start_line ?? 1;
    const code = (h.snippet || h.text || h.content || '').split('\n').slice(0, MAX_SNIPPET_LINES).join('\n');
    const block = `--- ${path}:${start}\n${code}`;
    if (used + block.length > MAX_TOTAL_CHARS) break;
    blocks.push(block);
    used += block.length + 1;
  }
  return blocks.join('\n\n');
}

export async function answerCodebaseQuestion({
  question, hits,
  provider, apiKey, model, ollamaBaseUrl,
  signal,
}) {
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('Question is empty.');
  }
  if (!Array.isArray(hits) || hits.length === 0) {
    throw new Error('Run a search first — no snippets to reason over.');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Configure your AI provider in Settings first.');
  }

  const userMsg = [
    `Question: ${question}`,
    '',
    'Snippets (cosine-ranked from the project index):',
    formatHits(hits),
    '',
    'Answer the question now.',
  ].join('\n');

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider, model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 500,
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
  return String(extractText(provider, data) || '').trim();
}

// Pure helpers exported for tests — formatHits' chunking + truncation
// invariants are the part most likely to drift.
export const __testing__ = { formatHits, MAX_TOTAL_CHARS, MAX_SNIPPET_LINES };
