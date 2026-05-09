// src/utils/aiSmartPaste.js
//
// "Smart paste" — Wave 11. The flow:
//   1. User invokes the Smart Paste command (palette / shortcut).
//   2. We read the clipboard contents.
//   3. Heuristics detect the source language.
//   4. If the source != the active file's language, we ask the AI to
//      translate the snippet into the target language.
//   5. The translation is inserted at the cursor (or replaces the
//      selection if there was one).
//
// This is the kind of "feels magical" feature that fits Lorica's DNA —
// you copy a Python helper from a Stack Overflow answer, paste it into
// a Rust file, and Lorica hands you idiomatic Rust instead of asking
// you to rewrite it manually.
//
// Privacy note: with the Ollama provider (Wave 11.1), the snippet
// never leaves the user's machine. With Anthropic / DeepSeek the
// snippet is sent to the configured cloud provider — same surface as
// every other AI call in Lorica.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  getEndpoint,
  getHeaders,
  buildChatBody,
  extractText,
  resolveModel,
  resolveOllamaBase,
  isKeyless,
} from './aiProviders';

// ----------------------------------------------------------------------
// Language detection
// ----------------------------------------------------------------------
//
// Cheap heuristic — we look at top-of-file shebangs, characteristic
// keywords, and brace style. We don't try to compete with a real
// parser; the goal is "is this clearly Python vs Rust" which is
// usually obvious from the first few lines. If we can't tell with
// reasonable confidence we return null and the caller skips the
// translation prompt.

const LANGUAGE_FINGERPRINTS = [
  // Each entry: { lang, score(text) -> 0..1 }. Order matters only for
  // ties — the highest-scoring lang wins.
  {
    lang: 'python',
    test: (t) =>
      (/^#!.*python/m.test(t) ? 1 : 0) +
      (/\bdef\s+\w+\s*\(/.test(t) ? 0.5 : 0) +
      (/^from\s+\w+\s+import\b/m.test(t) ? 0.4 : 0) +
      (/^import\s+\w+\b/m.test(t) ? 0.2 : 0) +
      (/:\s*$/m.test(t) && !/[{};]/.test(t) ? 0.3 : 0) +
      (/\bself\b/.test(t) ? 0.2 : 0),
  },
  {
    lang: 'javascript',
    test: (t) =>
      (/\bconst\s+\w+\s*=/.test(t) ? 0.3 : 0) +
      (/\bfunction\s+\w+\s*\(/.test(t) ? 0.3 : 0) +
      (/=>\s*[{(]/.test(t) ? 0.3 : 0) +
      (/\brequire\s*\(/.test(t) ? 0.2 : 0) +
      (/\bconsole\.(log|error|warn)\b/.test(t) ? 0.2 : 0) +
      (/\bawait\b/.test(t) ? 0.1 : 0),
  },
  {
    lang: 'typescript',
    test: (t) =>
      (/\binterface\s+\w+\s*\{/.test(t) ? 0.4 : 0) +
      (/:\s*(string|number|boolean|void|any|unknown)\b/.test(t) ? 0.3 : 0) +
      (/\bas\s+\w+/.test(t) ? 0.1 : 0) +
      (/\benum\s+\w+\s*\{/.test(t) ? 0.3 : 0) +
      (/\bimport\s+type\b/.test(t) ? 0.2 : 0),
  },
  {
    lang: 'rust',
    test: (t) =>
      (/\bfn\s+\w+\s*\(/.test(t) ? 0.4 : 0) +
      (/\blet\s+(?:mut\s+)?\w+\s*[:=]/.test(t) ? 0.3 : 0) +
      (/\bimpl\b/.test(t) ? 0.3 : 0) +
      (/\b(?:&str|String|Vec<|Option<|Result<)/.test(t) ? 0.3 : 0) +
      (/->\s*\w+/.test(t) ? 0.2 : 0) +
      (/\b::\w+/.test(t) ? 0.2 : 0),
  },
  {
    lang: 'go',
    test: (t) =>
      (/\bpackage\s+\w+/m.test(t) ? 0.4 : 0) +
      (/\bfunc\s+\w+\s*\(/.test(t) ? 0.3 : 0) +
      (/\binterface\s*\{/.test(t) ? 0.2 : 0) +
      (/\bgo\s+\w+\s*\(/.test(t) ? 0.2 : 0) +
      (/\b:=\s/.test(t) ? 0.2 : 0),
  },
  {
    lang: 'java',
    test: (t) =>
      (/\bpublic\s+(?:static\s+)?(?:class|interface)\b/.test(t) ? 0.5 : 0) +
      (/\bSystem\.out\.println\b/.test(t) ? 0.4 : 0) +
      (/\bnew\s+\w+\s*\(/.test(t) ? 0.1 : 0) +
      (/\bpackage\s+[\w.]+;/.test(t) ? 0.3 : 0),
  },
  {
    lang: 'csharp',
    test: (t) =>
      (/\busing\s+System\b/.test(t) ? 0.4 : 0) +
      (/\bnamespace\s+\w+/.test(t) ? 0.3 : 0) +
      (/\bConsole\.WriteLine\b/.test(t) ? 0.4 : 0) +
      (/\bvar\s+\w+\s*=/.test(t) && /[;{}]/.test(t) ? 0.1 : 0),
  },
  {
    lang: 'cpp',
    test: (t) =>
      (/^#include\s*[<"]/m.test(t) ? 0.5 : 0) +
      (/\bstd::\w+/.test(t) ? 0.4 : 0) +
      (/\bnamespace\s+\w+\s*\{/.test(t) ? 0.2 : 0),
  },
  {
    lang: 'sql',
    test: (t) =>
      // `s` flag (dotall) so the SELECT…FROM pair survives a newline
      // — typical formatted SQL spans multiple lines.
      (/\bSELECT\b[\s\S]+\bFROM\b/i.test(t) ? 0.6 : 0) +
      (/\bINSERT\s+INTO\b/i.test(t) ? 0.4 : 0) +
      (/\bWHERE\b/i.test(t) ? 0.2 : 0) +
      (/\bORDER\s+BY\b/i.test(t) ? 0.2 : 0),
  },
  {
    lang: 'bash',
    test: (t) =>
      (/^#!.*\b(?:bash|sh|zsh)\b/m.test(t) ? 1 : 0) +
      (/\$\{?\w+/.test(t) ? 0.2 : 0) +
      (/\b(?:if|while|for)\b\s+\[/.test(t) ? 0.3 : 0) +
      (/\b(?:echo|export|source)\b/.test(t) ? 0.2 : 0),
  },
];

// Return { lang, confidence } or null when nothing is confident enough.
// `confidence` is roughly 0..1 — 0.5 is "probably right", 0.8+ is
// "almost certainly right". The caller decides what threshold to use.
export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length < 10) return null;

  let best = { lang: null, score: 0 };
  for (const { lang, test } of LANGUAGE_FINGERPRINTS) {
    const score = test(trimmed);
    if (score > best.score) best = { lang, score };
  }
  if (best.score < 0.3) return null;
  // Cap confidence at 1.0 — heuristics can stack above and we don't
  // want to advertise certainty we don't have.
  return { lang: best.lang, confidence: Math.min(1, best.score) };
}

// True when both a clearly-detected source AND a known target are
// present, AND they differ. The Smart Paste command shells out to the
// AI only in this case.
export function shouldOfferTranslation(detected, targetLanguage) {
  if (!detected || !targetLanguage) return false;
  if (detected.confidence < 0.4) return false;
  // Normalise common aliases: 'ts' → 'typescript', etc.
  const norm = (l) => {
    const map = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      cc: 'cpp', cxx: 'cpp', 'c++': 'cpp', h: 'cpp', hpp: 'cpp',
      cs: 'csharp',
      sh: 'bash', zsh: 'bash',
    };
    return map[l] || l;
  };
  return norm(detected.lang) !== norm(targetLanguage);
}

// ----------------------------------------------------------------------
// AI translation
// ----------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You translate code snippets between programming languages.',
  'Output ONLY the translated code — no prose, no markdown fences, no leading/trailing blank lines.',
  'Match the idioms of the target language (e.g. snake_case in Python, camelCase in JS, type annotations where idiomatic).',
  'Preserve comments. Translate them into the target language’s comment syntax.',
  'If the snippet relies on a library that doesn’t exist in the target, leave a single-line comment marking the gap.',
].join('\n');

/**
 * Ask the active AI provider to translate `code` from `fromLang` into
 * `toLang`. Returns the translated code as a plain string (no fences).
 *
 * Failure modes:
 *   • Provider not configured (no key, Ollama unreachable) → throws.
 *   • Network failure → throws.
 *   • Empty / nonsense response → throws.
 */
export async function translateSnippet({
  code,
  fromLang,
  toLang,
  provider,
  apiKey,
  model,
  state,
  signal,
}) {
  if (!code || !toLang) throw new Error('code and toLang are required');
  if (!provider) provider = state?.aiProvider || 'anthropic';

  // Skip the API key check entirely for keyless providers (Ollama).
  if (!isKeyless(provider) && !apiKey) {
    throw new Error(`No API key configured for ${provider}`);
  }

  const userMsg = [
    `Source language: ${fromLang || 'unknown'}`,
    `Target language: ${toLang}`,
    '',
    'Code:',
    '```',
    code,
    '```',
  ].join('\n');

  const baseUrl = provider === 'ollama' ? resolveOllamaBase(state) : null;
  const endpoint = getEndpoint(provider, baseUrl);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider,
    model: model || resolveModel(provider, state),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 2048,
    temperature: 0.1,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    response = await tauriFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const j = await response.json();
      msg = j.error?.message || j.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const json = await response.json();
  const text = extractText(provider, json);
  return stripCodeFences(String(text || '').trim());
}

// Strip leading / trailing markdown code fences if the model ignored
// our "no fences" instruction. Preserves inner content verbatim.
export function stripCodeFences(text) {
  let t = String(text || '');
  t = t.replace(/^\s*```[\w-]*\s*\n?/, '');
  t = t.replace(/\n?\s*```\s*$/, '');
  return t;
}
