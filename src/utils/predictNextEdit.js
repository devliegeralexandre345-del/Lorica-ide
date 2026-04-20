// src/utils/predictNextEdit.js
//
// After the user makes an edit, propose the *follow-up* edits that would
// naturally come next. Cursor calls this "Tab-to-jump"; Lorica exposes it
// as a subtle ghost chip in the editor corner that reads
//   "3 related edits predicted — press ⌥↵ to review"
//
// The model is given:
//   • The diff (old selection → new selection) the user just accepted
//   • A listing of project symbols/files that match tokens in the diff
//   • The output contract: a JSON list of suggestions
//
// This is deliberately a *suggestion*, not an auto-apply. The user
// reviews, then applies each one individually via the standard Cmd+K
// inline-edit flow.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT  = 'https://api.deepseek.com/v1/chat/completions';

const FAST_MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek:  'deepseek-chat',
};

async function robustFetch(url, opts, preferNative) {
  const init = { ...opts };
  if (preferNative) {
    try { return await fetch(url, init); } catch (_) { return tauriFetch(url, init); }
  }
  try { return await tauriFetch(url, init); } catch (_) { return fetch(url, init); }
}

const SYSTEM_PROMPT = [
  'You are an edit-prediction engine for an IDE. The user just made a code change.',
  'Your job is to predict other edits in the codebase that naturally follow from this one.',
  'Examples of follow-up edits: usage sites of a renamed symbol, matching test updates,',
  'config entries, docs referencing the symbol, imports in sibling files.',
  '',
  'Return STRICT JSON: an array of suggestion objects, no markdown fences, no prose.',
  'Each suggestion: { "path": "relative/path.ext", "reason": "why this file", "instruction": "single-line instruction for an inline refactor" }.',
  'Return at most 4 suggestions. If the edit is self-contained, return [].',
  'Do NOT suggest edits to the file that was just modified unless there\'s a strong reason.',
].join('\n');

// Feedback store — capped list of recent acceptance/rejection events,
// used to teach the predictor about the user's patterns on subsequent
// calls. Purely localStorage so it stays on the user's machine.
const FEEDBACK_KEY = 'lorica.nextEditFeedback.v1';
const FEEDBACK_MAX = 50;

export function loadFeedback() {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]'); } catch { return []; }
}
function saveFeedback(list) {
  try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list.slice(-FEEDBACK_MAX))); } catch {}
}

/**
 * Record a single feedback event. `outcome` is 'accepted' or 'rejected'.
 * We persist only the suggestion metadata (path, reason, instruction) —
 * never the file content, to keep privacy/storage bounded.
 */
export function recordEditFeedback({ outcome, suggestion, editSummary }) {
  if (!suggestion) return;
  const list = loadFeedback();
  list.push({
    at: Date.now(),
    outcome,
    path: suggestion.path,
    reason: suggestion.reason,
    instruction: suggestion.instruction,
    editSummary: String(editSummary || '').slice(0, 200),
  });
  saveFeedback(list);
}

// Build a compact feedback-bias preamble. We pick the most recent entries
// and present accepted / rejected patterns separately so the model can
// condition on them. Kept short: 5 of each.
function feedbackPreamble() {
  const list = loadFeedback();
  if (list.length === 0) return '';
  const accepted = list.filter((f) => f.outcome === 'accepted').slice(-5);
  const rejected = list.filter((f) => f.outcome === 'rejected').slice(-5);
  const lines = ['## Past user feedback (bias your suggestions accordingly)'];
  if (accepted.length) {
    lines.push('Recently ACCEPTED suggestions:');
    for (const f of accepted) lines.push(`- ${f.path}: ${f.instruction}`);
  }
  if (rejected.length) {
    lines.push('Recently REJECTED suggestions (avoid similar):');
    for (const f of rejected) lines.push(`- ${f.path}: ${f.instruction}`);
  }
  return lines.join('\n');
}

function buildUserMessage({ filePath, oldText, newText, candidatePaths }) {
  const feedback = feedbackPreamble();
  return [
    feedback,
    feedback ? '' : null,
    `File just edited: ${filePath}`,
    '',
    '<old>',
    oldText || '(no previous content)',
    '</old>',
    '<new>',
    newText,
    '</new>',
    '',
    'Candidate files in the project (relative paths, a sample):',
    candidatePaths.slice(0, 40).map((p) => `- ${p}`).join('\n'),
    '',
    'Output JSON array now:',
  ].filter((x) => x !== null).join('\n');
}

function parseSuggestions(text) {
  if (!text) return [];
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = t.indexOf('[');
  const end   = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === 'object' && typeof x.path === 'string')
      .map((x) => ({
        path: x.path,
        reason: typeof x.reason === 'string' ? x.reason : '',
        instruction: typeof x.instruction === 'string' ? x.instruction : '',
      }))
      .slice(0, 4);
  } catch {
    return [];
  }
}

/**
 * Ask the model for next-edit suggestions.
 *
 * @param {object} args
 * @param {string} args.filePath
 * @param {string} args.oldText        — the previously selected region
 * @param {string} args.newText        — the accepted replacement
 * @param {string[]} args.candidatePaths — shallow list of project files
 * @param {string} args.provider
 * @param {string} args.apiKey
 * @param {AbortSignal=} args.signal
 */
export async function predictNextEdits({
  filePath, oldText, newText, candidatePaths,
  provider, apiKey, signal,
}) {
  if (!apiKey) return [];
  const model = FAST_MODELS[provider] || FAST_MODELS.anthropic;
  const userMsg = buildUserMessage({ filePath, oldText, newText, candidatePaths });

  try {
    if (provider === 'anthropic') {
      const body = {
        model, max_tokens: 600, temperature: 0.15,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      };
      const r = await robustFetch(ANTHROPIC_ENDPOINT, {
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
      if (!r.ok) return [];
      const data = await r.json();
      const text = (data?.content || []).map((b) => b.text || '').join('');
      return parseSuggestions(text);
    } else {
      const body = {
        model, max_tokens: 600, temperature: 0.15,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
      };
      const r = await robustFetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }, true);
      if (!r.ok) return [];
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return parseSuggestions(text);
    }
  } catch {
    return [];
  }
}
