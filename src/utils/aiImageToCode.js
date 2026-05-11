// src/utils/aiImageToCode.js
//
// Wave 63 — Image-to-code via AI vision. The user pastes a screenshot
// of code (e.g. from a blog post, a video screenshot, a whiteboard);
// we ask Anthropic's vision API to transcribe it back to plain source.
//
// This is currently Anthropic-only because:
//   - DeepSeek text endpoint doesn't accept images.
//   - Ollama vision support depends on the model the user has pulled.
//   - OpenRouter does support vision, but routes differ per model.
// We hard-gate on `provider === 'anthropic'` rather than try to detect
// at runtime — if the user wants vision they switch in Settings.
//
// Input: a data-URL string (`data:image/png;base64,...`). The caller
// is responsible for converting File / Blob / ClipboardItem to that.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody } from './aiProviders';

const SYSTEM_PROMPT = [
  'You transcribe code that is shown in an image (screenshot, photo,',
  'whiteboard) back to plain source code. The user will paste this',
  'into their editor verbatim, so your output MUST be ready to compile.',
  '',
  'Rules:',
  '  • Output ONLY the code. No prose, no fences, no commentary.',
  '  • Preserve indentation faithfully. If the image is ambiguous,',
  '    pick 2-space or 4-space consistently for the whole block.',
  '  • If the image contains non-code content (slides, prose), output',
  '    NOTHING and let the caller surface "no code detected".',
  '  • If a language hint is provided, prefer that dialect when',
  '    transcribing (e.g. distinguish TS vs JS, py3 vs py2).',
].join('\n');

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = DATA_URL_RE.exec(dataUrl.trim());
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

export async function transcribeImage({
  dataUrl, languageHint,
  provider, apiKey, model,
  signal,
}) {
  if (provider !== 'anthropic') {
    throw new Error('Image-to-code requires the Anthropic provider. Switch in Settings.');
  }
  if (!apiKey) {
    throw new Error('Anthropic API key required.');
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('Invalid image data — expected a data:image/...;base64,... URL.');
  }

  // Anthropic content blocks: text + image side-by-side in a single user
  // message. We use the raw block array because buildChatBody passes
  // content through unchanged for Anthropic.
  const messages = [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
      },
      {
        type: 'text',
        text: languageHint
          ? `Transcribe this code. Language hint: ${languageHint}.`
          : 'Transcribe this code.',
      },
    ],
  }];

  const body = buildChatBody({
    provider, model,
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 4000,
    temperature: 0.1,
  });
  const r = await tauriFetch(getEndpoint(provider), {
    method: 'POST',
    headers: getHeaders(provider, apiKey),
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.error?.message || j.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await r.json();
  // Anthropic shape; same as extractText but inlined so we don't pull
  // it in just for this caller. Text blocks only.
  const blocks = data?.content || [];
  return blocks
    .filter((b) => b?.type === 'text')
    .map((b) => b.text || '')
    .join('')
    .trim();
}

export const __testing__ = { parseDataUrl };
