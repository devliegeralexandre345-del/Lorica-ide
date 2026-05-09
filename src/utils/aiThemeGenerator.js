// src/utils/aiThemeGenerator.js
//
// Wave 33 — AI theme generator. Takes a free-text description ("a
// theme inspired by tokyo at midnight, with neon pink accents") and
// asks the active AI provider to return a Lorica theme JSON. Returns
// a fully-validated theme object ready to drop into THEMES.
//
// Why: Lorica ships 13 themes today, but users always want their
// own. A 30-second AI roundtrip is faster than fiddling with hex
// codes by hand. The generator never persists — the caller owns
// "where does this go" (in-memory preview, save to localStorage,
// commit to themes.js).
//
// Privacy: same surface as every other Lorica AI call. With Ollama
// the description never leaves the local machine.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const SYSTEM_PROMPT = [
  'You design colour palettes for a desktop IDE.',
  'Given a free-text description, return STRICT JSON describing a single theme:',
  '{',
  '  "name":     "<short human label, 2-4 words>",',
  '  "bg":       "<dark canvas hex, e.g. #0a0e17>",',
  '  "surface":  "<one-step lighter than bg>",',
  '  "panel":    "<two-step lighter than bg>",',
  '  "border":   "<panel-tint divider>",',
  '  "accent":   "<the dominant colour from the description>",',
  '  "text":     "<near-white for dark themes, near-black for light>",',
  '  "textDim":  "<muted version of text>",',
  '  "logoBars": ["<5 hex colours forming a smooth gradient using the accent>"]',
  '}',
  '',
  'Rules:',
  '  • Output ONLY the JSON. No prose, no fences, no explanation.',
  '  • All hex values are 6 chars + leading #, lower-case.',
  '  • For dark themes: bg should be very dark, text very light.',
  '    For light themes: invert.',
  '  • The 5 logoBars colours must each be distinct hexes that read as a',
  '    smooth gradient when placed in order.',
  '  • Match the description\'s vibe — if the user says "neon", saturate.',
  '    If they say "muted" or "pastel", desaturate.',
].join('\n');

// Hex sanity check: must be exactly `#RRGGBB`. We're strict because a
// loosely-formatted hex (e.g. `rgb(...)`) breaks the CSS variable
// pipeline downstream.
const HEX = /^#[0-9a-f]{6}$/i;

export function isValidThemeShape(t) {
  if (!t || typeof t !== 'object') return false;
  if (typeof t.name !== 'string' || !t.name.trim()) return false;
  for (const k of ['bg', 'surface', 'panel', 'border', 'accent', 'text', 'textDim']) {
    if (typeof t[k] !== 'string' || !HEX.test(t[k])) return false;
  }
  if (!Array.isArray(t.logoBars) || t.logoBars.length < 5) return false;
  for (const c of t.logoBars.slice(0, 5)) {
    if (typeof c !== 'string' || !HEX.test(c)) return false;
  }
  return true;
}

// Parse the model output defensively — strip any code fences and
// extract the first {...} block. Returns null on parse failure so the
// caller can fall back gracefully.
function parseThemeJson(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return isValidThemeShape(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Generate a theme from a free-text description.
 *
 * @param {object} args
 * @param {string} args.description    — what the user typed
 * @param {string} args.provider       — 'anthropic' | 'deepseek' | 'ollama' | 'openrouter'
 * @param {string} args.apiKey         — null for ollama
 * @param {string} [args.model]
 * @param {string} [args.ollamaBaseUrl]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<object|null>}     — validated theme, or null on parse failure
 */
export async function generateTheme({
  description, provider, apiKey, model, ollamaBaseUrl, signal,
}) {
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw new Error('description is required');
  }
  if (!isKeyless(provider) && !apiKey) {
    throw new Error('Missing API key — configure your AI provider in Settings.');
  }

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Theme description: ${description.trim()}\n\nReturn the JSON now.` }],
    maxTokens: 600,
    temperature: 0.6,
  });

  // Anthropic prefers Tauri HTTP (CORS surprises in some builds);
  // everything else is CORS-friendly via native fetch.
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
  const raw = extractText(provider, data);
  return parseThemeJson(raw);
}

// Build a stable key for the user-generated theme in the THEMES dict.
// We slugify the name down to something safe (alphanumerics + camel-
// case continuation). Collisions append a numeric suffix so two
// "midnight neon" themes can coexist.
export function themeKeyForName(name, existingKeys = []) {
  const base = String(name || 'custom')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1))
    .join('') || 'custom';
  if (!existingKeys.includes(base)) return base;
  let n = 2;
  while (existingKeys.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}

// Exported for tests so we can validate without making a network call.
export const __testing__ = { parseThemeJson, isValidThemeShape };
