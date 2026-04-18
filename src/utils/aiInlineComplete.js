// src/utils/aiInlineComplete.js
//
// Inline AI ghost-text completion — fast, short, single-shot. Purposely
// separate from useAgent (which handles multi-turn chat with tools). This
// just asks a small model for the next few tokens given surrounding code.
//
// Providers:
//   • Anthropic  → Claude Haiku 3.5 via tauri-plugin-http (CORS-safe).
//   • DeepSeek   → deepseek-chat via native fetch (DeepSeek allows CORS).

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

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
 * @param {string}   args.provider   — 'anthropic' | 'deepseek'
 * @param {string}   args.apiKey
 * @param {string=}  args.model      — override (optional)
 * @param {AbortSignal=} args.signal
 * @returns {Promise<string>} completion text (may be empty)
 */
export async function fetchInlineCompletion({
  prefix, suffix, language, filePath, provider, apiKey, model, signal,
}) {
  if (!apiKey) return '';
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
    if (provider === 'anthropic') {
      const body = {
        model: chosenModel,
        max_tokens: 200,
        temperature: 0.2,
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
        false, // prefer tauri — Anthropic is CORS-hostile
      );
      if (!r.ok) return '';
      const data = await r.json();
      const raw = (data?.content || []).map((b) => b.text || '').join('');
      return cleanCompletion(raw, { prefix: clippedPrefix, suffix: clippedSuffix });
    }

    // DeepSeek / OpenAI-shaped
    const body = {
      model: chosenModel,
      max_tokens: 200,
      temperature: 0.2,
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
      true, // prefer native — DeepSeek has friendly CORS
    );
    if (!r.ok) return '';
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    return cleanCompletion(raw, { prefix: clippedPrefix, suffix: clippedSuffix });
  } catch (e) {
    if (e?.name === 'AbortError') return '';
    console.warn('[inline-ai] request failed:', e.message);
    return '';
  }
}
