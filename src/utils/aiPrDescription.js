// src/utils/aiPrDescription.js
//
// Generate a PR description (markdown body) from a branch's commits +
// cumulative diff. Mirrors the structure of aiCommitMessage.js — fast
// model, single round-trip, no streaming, safe to abort.
//
// Output shape: plain markdown suitable to paste into a GitHub / GitLab
// PR body. Sections:
//   • one-line TL;DR
//   • ## Summary — 2-5 bullets of what changed and why
//   • ## Changes — grouped bullets (optional, model's discretion)
//   • ## Test plan — checklist of things the reviewer should verify

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

const FAST_MODELS = {
  anthropic: 'claude-3-5-haiku-20241022',
  deepseek: 'deepseek-chat',
};

// PR diffs can be huge. We clip aggressively — the commit messages give
// the model a lot of signal already, and a clipped diff with the most
// relevant hunks outperforms an over-long prompt the model skims.
const DIFF_MAX_CHARS = 30000;
const COMMITS_MAX = 40;

const SYSTEM_PROMPT = [
  'You are an expert engineer writing a pull-request description for code review.',
  'Input: the current branch name, the commits introduced since branching off the base, and the cumulative diff.',
  'Output: a concise, ready-to-paste markdown PR body. No preamble, no code fences wrapping the whole response.',
  'Format:',
  '  1. First line: a short title-like summary (under 80 chars). No leading `#`, just plain text.',
  '  2. Blank line.',
  '  3. `## Summary` — 2-5 bullet points explaining WHAT changed and WHY. Focus on intent and trade-offs, not a file-by-file restatement.',
  '  4. `## Test plan` — 3-6 checkbox bullets (`- [ ] …`) of concrete things a reviewer should verify. Prefer user-visible behaviour over unit tests.',
  '  5. Optionally `## Notes` — edge cases, migrations, or follow-ups.',
  'Rules:',
  '  • Derive the summary from the COMMITS first; use the diff to cross-check. If commits contradict the diff, trust the diff.',
  '  • Do not hallucinate breaking changes, deprecations, or migrations that aren\'t in the diff.',
  '  • Plain markdown. Keep it under ~30 lines.',
  '  • If there are no commits at all, return exactly: `chore: no changes on this branch`.',
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

function clipDiff(diff) {
  if (!diff) return '';
  if (diff.length <= DIFF_MAX_CHARS) return diff;
  return diff.slice(0, DIFF_MAX_CHARS) + `\n\n[... diff truncated, ${diff.length - DIFF_MAX_CHARS} chars omitted ...]`;
}

function formatCommits(commits) {
  if (!Array.isArray(commits) || commits.length === 0) return '(no commits)';
  const slice = commits.slice(0, COMMITS_MAX);
  const lines = slice.map((c) => `- ${c.short_hash || c.shortHash || ''} ${c.message || ''}`.trim());
  if (commits.length > COMMITS_MAX) {
    lines.push(`... and ${commits.length - COMMITS_MAX} more commits`);
  }
  return lines.join('\n');
}

function buildUserMessage({ currentBranch, baseBranch, commits, diff, filesChanged }) {
  const parts = [
    `Branch: ${currentBranch} (against ${baseBranch})`,
    '',
    `## Commits (${commits?.length || 0})`,
    formatCommits(commits),
  ];
  if (Array.isArray(filesChanged) && filesChanged.length > 0) {
    parts.push('', `## Files changed (${filesChanged.length})`);
    const shown = filesChanged.slice(0, 60);
    parts.push(shown.map((f) => `- ${f}`).join('\n'));
    if (filesChanged.length > 60) parts.push(`... and ${filesChanged.length - 60} more`);
  }
  parts.push('', '## Diff', clipDiff(diff || ''));
  parts.push('', 'Write the PR description now.');
  return parts.join('\n');
}

function cleanOutput(text) {
  if (!text) return '';
  let out = text.replace(/\r\n/g, '\n').trim();
  // Strip an accidental wrapping code fence the model sometimes adds
  // around the whole response.
  out = out.replace(/^```(?:markdown|md)?\n?/i, '').replace(/```[\s]*$/, '').trim();
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

/**
 * Generate a PR description from a PrContext object.
 *
 * @param {object}  args
 * @param {object}  args.context  — { currentBranch, baseBranch, commits, diff, filesChanged }
 * @param {string}  args.provider — 'anthropic' | 'deepseek'
 * @param {string}  args.apiKey
 * @param {string=} args.model
 * @param {AbortSignal=} args.signal
 * @returns {Promise<string>}
 */
export async function generatePrDescription({
  context, provider, apiKey, model, signal,
}) {
  if (!apiKey) throw new Error('API key missing — configure it in Settings.');
  if (!context || !context.currentBranch) throw new Error('Missing PR context.');
  if (!context.commits || context.commits.length === 0) return 'chore: no changes on this branch';

  const chosenModel = model || FAST_MODELS[provider] || FAST_MODELS.anthropic;
  const userMsg = buildUserMessage(context);

  if (provider === 'anthropic') {
    const body = {
      model: chosenModel,
      max_tokens: 900,
      temperature: 0.3,
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
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await safeErrorText(r)}`);
    const data = await r.json();
    return cleanOutput((data?.content || []).map((b) => b.text || '').join(''));
  }

  const body = {
    model: chosenModel,
    max_tokens: 900,
    temperature: 0.3,
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
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${await safeErrorText(r)}`);
  const data = await r.json();
  return cleanOutput(data?.choices?.[0]?.message?.content || '');
}
