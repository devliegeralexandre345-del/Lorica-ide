// src/utils/aiSemanticRerank.js
//
// LLM re-rank of semantic search results. Takes the top N hits from cosine
// similarity (cheap but dumb — matches embedding vibes, not semantic intent)
// and asks a fast model to reorder them by actual relevance to the query,
// adding a one-line explanation per hit.
//
// Trade-off: adds ~1-3 s latency to a query but turns "close embedding
// vector" into "this snippet actually answers the question". The cost is
// bounded: one round-trip, JSON-only output, small prompt.
//
// Falls back to the original cosine order if the API key is missing, the
// model misbehaves, or the network call fails. The caller decides whether
// to surface the failure to the user.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

const FAST_MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek: 'deepseek-chat',
};

// Per-snippet char cap. The backend already returns a ~6-line snippet
// (180 chars per line cap), so most land around 600-1000 chars. Clipping at
// 1200 leaves headroom for an occasional long line without exploding the
// total prompt.
const SNIPPET_CHAR_CAP = 1200;

// Hard cap on candidates sent to the model. 50 is a sweet spot: enough
// coverage to recover from cosine mis-ranking, small enough to stay cheap.
const MAX_CANDIDATES = 50;

const SYSTEM_PROMPT = [
  'You are a code search relevance ranker.',
  'Given a user query and numbered code snippets, rank the snippets by how well they answer the query.',
  'Return ONLY a JSON array. No preamble, no explanations outside the JSON, no code fences.',
  'Schema: [{ "id": <integer from the snippet number>, "score": <0.0-1.0>, "why": "<one concise sentence>" }, ...]',
  'Rules:',
  '  • Return AT MOST the number of items requested. Omit irrelevant snippets entirely.',
  '  • Order the array from most to least relevant.',
  '  • `why` must be under 100 chars and describe what this snippet actually does in relation to the query.',
  '  • If no snippet is relevant, return [].',
].join('\n');

async function robustFetch(url, opts, preferNative) {
  const init = { ...opts };
  if (preferNative) {
    try { return await fetch(url, init); } catch (e) {
      try { return await tauriFetch(url, init); } catch (e2) {
        throw new Error(`fetch failed: ${e.message}; tauri fetch failed: ${e2.message}`);
      }
    }
  }
  try { return await tauriFetch(url, init); } catch (e) {
    try { return await fetch(url, init); } catch (e2) {
      throw new Error(`tauri fetch failed: ${e.message}; native fetch failed: ${e2.message}`);
    }
  }
}

async function safeErrorText(response) {
  try {
    const body = await response.json();
    return body.error?.message || body.message || response.statusText;
  } catch {
    return response.statusText || 'unknown error';
  }
}

function clipSnippet(text) {
  if (!text) return '';
  if (text.length <= SNIPPET_CHAR_CAP) return text;
  return text.slice(0, SNIPPET_CHAR_CAP) + '\n…';
}

function buildUserMessage(query, candidates, maxReturn) {
  const lines = [
    `Query: ${query.trim()}`,
    '',
    `Return the top ${maxReturn} most relevant snippets (or fewer if nothing else is relevant).`,
    '',
    'Snippets:',
  ];
  candidates.forEach((hit, i) => {
    const id = i + 1;
    const loc = `${hit.relative || hit.path}:L${hit.start_line}-${hit.end_line}`;
    lines.push(`[${id}] ${loc}`);
    lines.push(clipSnippet(hit.snippet || ''));
    lines.push('');
  });
  return lines.join('\n');
}

// Defensive JSON parser — the model occasionally wraps the array in prose
// or code fences despite instructions. Try plain parse first, then fish out
// the first `[...]` block.
function parseRankedJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(/^```json\s*/i, '').replace(/```[\s]*$/, '').trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const match = stripped.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { return null; }
  }
  return null;
}

/**
 * Re-rank a list of semantic search hits using a fast LLM.
 *
 * @param {object}  args
 * @param {string}  args.query       — the user's query
 * @param {Array}   args.hits        — hits from semanticSearch ({ path, relative, start_line, end_line, snippet, score })
 * @param {string}  args.provider    — 'anthropic' | 'deepseek'
 * @param {string}  args.apiKey
 * @param {string=} args.model       — override
 * @param {AbortSignal=} args.signal
 * @param {number=} args.maxReturn   — upper bound on returned hits (default 10)
 * @returns {Promise<{
 *   ranked: Array,                  — hits in new order, each annotated with .rerankScore and .rerankWhy
 *   usedFallback: boolean,          — true if we fell back to cosine order
 *   fallbackReason?: string,
 * }>}
 */
export async function rerankSemanticHits({
  query, hits, provider, apiKey, model, signal, maxReturn = 10,
}) {
  const fallback = (reason) => ({
    ranked: (hits || []).slice(0, maxReturn),
    usedFallback: true,
    fallbackReason: reason,
  });

  if (!apiKey) return fallback('missing API key');
  if (!Array.isArray(hits) || hits.length === 0) {
    return { ranked: [], usedFallback: false };
  }
  if (!query || !query.trim()) return fallback('empty query');

  const candidates = hits.slice(0, MAX_CANDIDATES);
  const userMsg = buildUserMessage(query, candidates, maxReturn);
  const chosenModel = model || FAST_MODELS[provider] || FAST_MODELS.anthropic;

  let raw = '';
  try {
    if (provider === 'anthropic') {
      const body = {
        model: chosenModel,
        max_tokens: 1400,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      };
      const r = await robustFetch(
        ANTHROPIC_ENDPOINT,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
          signal,
        },
        false,
      );
      if (!r.ok) return fallback(`Anthropic ${r.status}: ${await safeErrorText(r)}`);
      const data = await r.json();
      raw = (data?.content || []).map((b) => b.text || '').join('');
    } else {
      const body = {
        model: chosenModel,
        max_tokens: 1400,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
      };
      const r = await robustFetch(
        DEEPSEEK_ENDPOINT,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        },
        true,
      );
      if (!r.ok) return fallback(`DeepSeek ${r.status}: ${await safeErrorText(r)}`);
      const data = await r.json();
      raw = data?.choices?.[0]?.message?.content || '';
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return fallback(`network error: ${err.message || err}`);
  }

  const parsed = parseRankedJson(raw);
  if (!Array.isArray(parsed)) return fallback('model returned non-JSON');

  // Map ids (1-based) back to original hits, dedupe, clamp to maxReturn.
  const seen = new Set();
  const ranked = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const id = Number(item.id);
    if (!Number.isFinite(id) || id < 1 || id > candidates.length) continue;
    const idx = id - 1;
    if (seen.has(idx)) continue;
    seen.add(idx);
    const score = Number(item.score);
    const why = typeof item.why === 'string' ? item.why.trim() : '';
    ranked.push({
      ...candidates[idx],
      rerankScore: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : null,
      rerankWhy: why || null,
    });
    if (ranked.length >= maxReturn) break;
  }

  if (ranked.length === 0) return fallback('model returned no matches');
  return { ranked, usedFallback: false };
}
