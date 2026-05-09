// src/utils/brainAutoExtract.js
//
// Given an agent conversation, ask a fast model to distill it into a
// single Brain entry draft. The user always reviews before saving — we
// never write silently. The extractor is a one-shot LLM call with a
// strict JSON contract so the caller can hand the result straight into
// the editor form.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getEndpoint, getHeaders, buildChatBody, extractText, isKeyless } from './aiProviders';

const MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek:  'deepseek-chat',
};

const SYSTEM_PROMPT = [
  'You summarize a developer\'s agent session into a single durable Brain entry.',
  'The Brain is a persistent project memory — decisions, facts, glossary, milestones.',
  'Keep only what future-you (or a new teammate) would want to know *without* re-reading the chat.',
  '',
  'Output STRICT JSON, no markdown, no prose outside JSON:',
  '{',
  '  "type": "decision"|"fact"|"glossary"|"milestone"|"note",',
  '  "title": "<concise, imperative or noun phrase, under 80 chars>",',
  '  "tags": ["kebab-case", "tag-list", ...],',
  '  "body": "<markdown body — 3-8 short paragraphs, no fluff>"',
  '}',
  '',
  'Rules:',
  '  • If the session explored multiple unrelated things, pick the ONE most significant.',
  '  • Skip pleasantries, debugging-noise, false starts. Only record signal.',
  '  • "decision" = we chose X over Y and why. "fact" = a surprising truth we learned.',
  '    "glossary" = a project-specific term. "milestone" = notable change shipped.',
  '    "note" = catch-all for anything useful but not the above.',
  '  • Body must stand alone — do not say "as discussed in the chat".',
  '  • If the session contains nothing worth remembering, return {"type":"note","title":"","tags":[],"body":""}.',
].join('\n');

function transcriptFromMessages(messages) {
  const lines = [];
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push(`USER: ${(m.content || '').slice(0, 4000)}`);
    } else if (m.role === 'assistant') {
      lines.push(`ASSISTANT: ${(m.content || '').slice(0, 4000)}`);
      for (const tc of (m.toolCalls || [])) {
        lines.push(`  [tool: ${tc.name}${tc.input?.path ? ` ${tc.input.path}` : ''}]`);
      }
    }
  }
  // Keep the most recent 30 KB of transcript — older context is less
  // likely to carry the session's key learning.
  return lines.join('\n\n').slice(-30_000);
}

function parseDraft(text) {
  if (!text) return null;
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return {
      type: ['decision', 'fact', 'glossary', 'milestone', 'note'].includes(parsed.type) ? parsed.type : 'note',
      title: typeof parsed.title === 'string' ? parsed.title : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string') : [],
      body: typeof parsed.body === 'string' ? parsed.body : '',
    };
  } catch { return null; }
}

async function robustFetch(url, opts, preferNative) {
  const init = { ...opts };
  if (preferNative) {
    try { return await fetch(url, init); } catch { return tauriFetch(url, init); }
  }
  try { return await tauriFetch(url, init); } catch { return fetch(url, init); }
}

export async function autoExtractBrainEntry({
  messages, provider, apiKey, ollamaBaseUrl, model, signal,
}) {
  if (!isKeyless(provider) && !apiKey) throw new Error('Missing API key');
  const chosenModel = model || MODELS[provider] || MODELS.anthropic;
  const transcript = transcriptFromMessages(messages || []);
  if (!transcript) return null;

  const endpoint = getEndpoint(provider, provider === 'ollama' ? ollamaBaseUrl : undefined);
  const headers = getHeaders(provider, apiKey);
  const body = buildChatBody({
    provider, model: chosenModel,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
    maxTokens: 1500, temperature: 0.2,
  });
  const r = await robustFetch(
    endpoint,
    { method: 'POST', headers, body: JSON.stringify(body), signal },
    provider !== 'anthropic',
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return parseDraft(extractText(provider, data));
}
