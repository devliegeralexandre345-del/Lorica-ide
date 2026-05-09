// src/utils/aiInlineComplete.js
//
// Inline AI ghost-text completion — fast, short, single-shot. Purposely
// separate from useAgent (which handles multi-turn chat with tools). This
// just asks a small model for the next few tokens given surrounding code.
//
// Providers (Wave 12.3 routes through aiProviders.js):
//   • Anthropic  → Claude Haiku 3.5 via tauri-plugin-http (CORS-safe).
//   • DeepSeek   → deepseek-chat via native fetch (DeepSeek allows CORS).
//   • Ollama     → user-configured local model via native fetch.
//
// Ollama models smaller than ~7B will produce noisier completions than
// Haiku — for inline completion the speed/quality tradeoff favours
// 7-13B coder models (codellama:7b, qwen2.5-coder:7b, etc.).

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  getEndpoint,
  getHeaders,
  buildChatBody,
  extractText,
  isKeyless,
} from './aiProviders';

const FAST_MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek: 'deepseek-chat',
};

// How much surrounding code to include (chars, not tokens). Rough budget:
// ~4 chars/token, so 2000 chars ≈ 500 tokens of prefix context.
const PREFIX_MAX = 2000;
const SUFFIX_MAX = 600;

const SYSTEM_PROMPT = [
  'You are an inline code completion engine inside an IDE.',
  'You are given the code BEFORE the cursor (<prefix>) and the code AFTER (<suffix>).',
  'Output ONLY the raw characters that should be inserted at the cursor — nothing else.',
  'Rules:',
  '  • No Markdown, no code fences, no language tags, no explanations.',
  '  • Do NOT repeat any characters that are already in <prefix> or <suffix>.',
  '  • Complete the current line or small block; keep it short (1–5 lines max).',
  '  • Match the surrounding indentation and coding style exactly.',
  '  • If the cursor context doesn\'t invite a completion, return an empty string.',
].join('\n');

/**
 * Build the user message containing the code context.
 */
function buildUserMessage({ prefix, suffix, language, filePath }) {
  return [
    filePath ? `// File: ${filePath}` : '',
    language ? `// Language: ${language}` : '',
    '<prefix>',
    prefix,
    '</prefix>',
    '<suffix>',
    suffix,
    '</suffix>',
    '',
    'Respond with only the text to insert at the cursor.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Sanitize the model's output: strip accidental code fences, trim leading
 * whitespace that duplicates the prefix's trailing whitespace, and cap length.
 */
function cleanCompletion(text, { prefix, suffix }) {
  if (!text) return '';

  // Strip code fences if the model ignored instructions.
  let out = text.replace(/^\s*```[a-zA-Z0-9_+-]*\n?/, '').replace(/```[\s]*$/, '');

  // If the model prefixed with characters already present at the end of
  // prefix, chop them off.
  const prefTail = prefix.slice(-80);
  for (let n = Math.min(out.length, prefTail.length); n > 0; n--) {
    if (prefTail.endsWith(out.slice(0, n))) {
      out = out.slice(n);
      break;
    }
  }

  // If the model suffixed with characters that match the start of suffix,
  // drop them so accepting doesn't duplicate.
  const sufHead = suffix.slice(0, 80);
  for (let n = Math.min(out.length, sufHead.length); n > 0; n--) {
    if (sufHead.startsWith(out.slice(-n))) {
      out = out.slice(0, -n);
      break;
    }
  }

  // Cap: never insert more than 400 chars in one shot.
  if (out.length > 400) out = out.slice(0, 400);

  return out;
}

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

/**
 * Fetch a single inline completion.
 *
 * @param {object}   args
 * @param {string}   args.prefix     — code before the cursor
 * @param {string}   args.suffix     — code after the cursor
 * @param {string}   args.language   — language id (e.g. 'javascript')
 * @param {string}   args.filePath   — optional file path for context
 * @param {string}   args.provider   — 'anthropic' | 'deepseek' | 'ollama'
 * @param {string}   args.apiKey     — ignored when provider is 'ollama'
 * @param {string=}  args.model      — override (optional)
 * @param {string=}  args.ollamaBaseUrl
 * @param {AbortSignal=} args.signal
 * @returns {Promise<string>} completion text (may be empty)
 */
export async function fetchInlineCompletion({
  prefix, suffix, language, filePath, provider, apiKey, model, ollamaBaseUrl, signal,
}) {
  // Keyless providers (Ollama) skip the API-key gate; everything else
  // returns empty so we don't surface auth errors on every keystroke.
  if (!isKeyless(provider) && !apiKey) return '';
  if (signal?.aborted) return '';
  const chosenModel = model || FAST_MODELS[provider] || FAST_MODELS.anthropic;

  const clippedPrefix = prefix.length > PREFIX_MAX ? prefix.slice(-PREFIX_MAX) : prefix;
  const clippedSuffix = suffix.length > SUFFIX_MAX ? suffix.slice(0, SUFFIX_MAX) : suffix;
  const userMsg = buildUserMessage({
    prefix: clippedPrefix,
    suffix: clippedSuffix,
    language,
    filePath,
  });

  try {
    const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
    const headers = getHeaders(provider, apiKey);
    const body = buildChatBody({
      provider,
      model: chosenModel,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 200,
      temperature: 0.2,
    });
    // Anthropic is CORS-hostile in some builds; everything else is
    // CORS-friendly and faster via native fetch.
    const preferNative = provider !== 'anthropic';
    const r = await robustFetch(
      endpoint,
      { method: 'POST', headers, body: JSON.stringify(body), signal },
      preferNative,
    );
    if (!r.ok) return '';
    const data = await r.json();
    const raw = extractText(provider, data);
    return cleanCompletion(raw, { prefix: clippedPrefix, suffix: clippedSuffix });
  } catch (e) {
    // Benign: AbortError fires when the user types during an inflight call.
    // Benign: "resource id N is invalid" fires when tauri-plugin-http tears
    // down the response after the same abort — we already have the abort
    // info, nothing to salvage. Everything else is logged.
    const msg = e?.message || '';
    if (e?.name === 'AbortError' || /resource id \d+ is invalid/i.test(msg)) {
      return '';
    }
    console.warn('[inline-ai] request failed:', msg);
    return '';
  }
}
