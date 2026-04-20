// src/utils/aiInlineEdit.js
//
// Inline AI *transform* — the user highlights a block of code, presses
// Cmd+K (Ctrl+K on Windows/Linux), types an instruction in plain English
// ("turn this into a reducer", "add error handling", "translate to TypeScript")
// and the AI rewrites that block in place. Cursor popularized this pattern;
// it's the fastest path from "I want to change this" to "it's changed" in a
// modern IDE — no copy/paste to a chat window, no context juggling.
//
// Unlike the ghost-text completer (which autocompletes at a cursor), this
// expects a *selection* and returns a rewritten replacement. Streaming is
// supported so the user sees the transformation build up.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

const EDIT_MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek: 'deepseek-chat',
};

// Context window budget around the selection. Keeping this moderate keeps
// latency low and avoids drowning the model in unrelated code.
const CONTEXT_BEFORE_MAX = 1500;
const CONTEXT_AFTER_MAX  = 500;

// Persistent history of accepted inline edits per file. Stored in
// localStorage under a hashed-path key so entries don't leak across
// projects. The Editor surfaces "Recent inline edits" affordance from
// this log; non-memoization intentional so the array keeps its order.
const EDIT_HISTORY_KEY = 'lorica.inlineEditHistory.v1';
const EDIT_HISTORY_MAX_PER_FILE = 20;

function loadEditHistory() {
  try { return JSON.parse(localStorage.getItem(EDIT_HISTORY_KEY) || '{}'); } catch { return {}; }
}
function saveEditHistory(map) {
  try { localStorage.setItem(EDIT_HISTORY_KEY, JSON.stringify(map)); } catch {}
}
export function recordInlineEdit({ filePath, instruction, before, after, accepted }) {
  if (!filePath) return;
  const map = loadEditHistory();
  const list = map[filePath] || [];
  list.unshift({
    at: Date.now(),
    instruction: String(instruction || '').slice(0, 200),
    before: String(before || '').slice(0, 500),
    after: String(after || '').slice(0, 500),
    accepted: !!accepted,
  });
  map[filePath] = list.slice(0, EDIT_HISTORY_MAX_PER_FILE);
  saveEditHistory(map);
}
export function readInlineEditHistory(filePath) {
  if (!filePath) return [];
  const map = loadEditHistory();
  return map[filePath] || [];
}
export function clearInlineEditHistory(filePath) {
  const map = loadEditHistory();
  if (filePath) delete map[filePath];
  else Object.keys(map).forEach((k) => delete map[k]);
  saveEditHistory(map);
}

const SYSTEM_PROMPT = [
  'You are an inline code refactoring engine embedded in an IDE.',
  'The user has highlighted a region of code and asked you to transform it.',
  'You are given: the surrounding file (<context_before> and <context_after>),',
  'the exact selected code (<selection>), and the user\'s instruction.',
  '',
  'Output ONLY the replacement code — nothing else.',
  '',
  'Rules:',
  '  • No Markdown fences, no backticks, no commentary, no leading/trailing prose.',
  '  • The output replaces <selection> verbatim — match the indentation of the first selected line.',
  '  • Preserve the surrounding style (quotes, semicolons, import style, naming conventions).',
  '  • Do NOT re-output any code from <context_before> or <context_after>.',
  '  • If the instruction is impossible or destructive, return the original selection unchanged.',
].join('\n');

function buildUserMessage({ contextBefore, selection, contextAfter, language, filePath, instruction }) {
  return [
    filePath ? `// File: ${filePath}` : '',
    language ? `// Language: ${language}` : '',
    '',
    '<context_before>',
    contextBefore,
    '</context_before>',
    '<selection>',
    selection,
    '</selection>',
    '<context_after>',
    contextAfter,
    '</context_after>',
    '',
    `Instruction: ${instruction}`,
    '',
    'Replacement code for <selection> (raw, no fences):',
  ].filter(Boolean).join('\n');
}

// Strip any code fences the model accidentally emitted, along with common
// leading prose like "Here's the refactored code:" that slips through.
function sanitize(text) {
  if (!text) return '';
  let out = text;
  // Drop leading "Sure, here is ..." style preamble, up to the first code fence
  // or to EOL if no fence.
  const fenceStart = out.indexOf('```');
  if (fenceStart !== -1) {
    out = out.slice(fenceStart);
    out = out.replace(/^\s*```[a-zA-Z0-9_+-]*\n?/, '');
    const lastFence = out.lastIndexOf('```');
    if (lastFence !== -1) out = out.slice(0, lastFence);
  }
  return out.replace(/\r\n/g, '\n');
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
 * Stream an inline edit transformation.
 *
 * @param {object} args
 * @param {string} args.contextBefore
 * @param {string} args.selection
 * @param {string} args.contextAfter
 * @param {string} args.language
 * @param {string} args.filePath
 * @param {string} args.instruction     — free-form user request
 * @param {string} args.provider        — 'anthropic' | 'deepseek'
 * @param {string} args.apiKey
 * @param {AbortSignal=} args.signal
 * @param {(chunk: string, accum: string) => void=} args.onDelta
 * @returns {Promise<string>} the full replacement text (sanitized)
 */
export async function streamInlineEdit({
  contextBefore, selection, contextAfter,
  language, filePath, instruction,
  provider, apiKey, signal, onDelta,
}) {
  if (!apiKey) throw new Error('No API key configured');
  if (!instruction?.trim()) throw new Error('Empty instruction');

  const clippedBefore = contextBefore.length > CONTEXT_BEFORE_MAX
    ? contextBefore.slice(-CONTEXT_BEFORE_MAX) : contextBefore;
  const clippedAfter  = contextAfter.length > CONTEXT_AFTER_MAX
    ? contextAfter.slice(0, CONTEXT_AFTER_MAX) : contextAfter;
  const model = EDIT_MODELS[provider] || EDIT_MODELS.anthropic;

  const userMsg = buildUserMessage({
    contextBefore: clippedBefore,
    selection,
    contextAfter: clippedAfter,
    language, filePath, instruction,
  });

  if (provider === 'anthropic') {
    const body = {
      model, max_tokens: 2048, temperature: 0.15, stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    };
    const response = await robustFetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    }, false);
    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try { const e = await response.json(); msg = e.error?.message || msg; } catch {}
      throw new Error(msg);
    }
    return await consumeAnthropicStream(response, onDelta);
  }

  // DeepSeek / OpenAI-compatible
  const body = {
    model, max_tokens: 2048, temperature: 0.15, stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  };
  const response = await robustFetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  }, true);
  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { const e = await response.json(); msg = e.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return await consumeOpenAIStream(response, onDelta);
}

async function consumeAnthropicStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accum = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          accum += ev.delta.text;
          onDelta?.(ev.delta.text, accum);
        }
      } catch {}
    }
  }
  return sanitize(accum);
}

async function consumeOpenAIStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accum = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        const delta = ev.choices?.[0]?.delta?.content;
        if (delta) {
          accum += delta;
          onDelta?.(delta, accum);
        }
      } catch {}
    }
  }
  return sanitize(accum);
}
