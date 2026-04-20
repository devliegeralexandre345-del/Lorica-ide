// src/utils/changeImpact.js
//
// Forecast which tests/files are likely affected by the pending PR. This
// is an LLM-reasoning pass, NOT an execution — we hand the diff plus a
// list of test files and ask the model to predict likely failures and
// explain the causal link. Fast model, strict JSON output.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK  = 'https://api.deepseek.com/v1/chat/completions';
const MODELS = { anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat' };

const SYSTEM = [
  'You predict the downstream impact of a code change before it is merged.',
  'Given a diff + file list, predict (a) which TESTS will likely fail, (b) which',
  'NON-TEST files might break at runtime. For each prediction, give a short',
  'causal chain from the diff to the impacted location.',
  '',
  'Return STRICT JSON, no prose, no fences:',
  '{',
  '  "tests_at_risk":   [{ "path": "...", "reason": "...", "confidence": "high"|"medium"|"low" }],',
  '  "files_at_risk":   [{ "path": "...", "reason": "...", "confidence": "high"|"medium"|"low" }],',
  '  "summary": "<1-2 sentence plain-English verdict>"',
  '}',
  '',
  'If the change is low-impact, return small arrays. Do not invent risks — false',
  'precision is worse than admitting uncertainty.',
].join('\n');

async function robustFetch(url, opts, preferNative) {
  try { return preferNative ? await fetch(url, opts) : await tauriFetch(url, opts); }
  catch { return preferNative ? await tauriFetch(url, opts) : await fetch(url, opts); }
}

function parse(text) {
  if (!text) return null;
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    return {
      tests_at_risk: Array.isArray(o.tests_at_risk) ? o.tests_at_risk : [],
      files_at_risk: Array.isArray(o.files_at_risk) ? o.files_at_risk : [],
      summary: typeof o.summary === 'string' ? o.summary : '',
    };
  } catch { return null; }
}

export async function forecastChangeImpact({ prContext, projectFiles, provider, apiKey, signal }) {
  const model = MODELS[provider] || MODELS.anthropic;
  // Narrow the candidate test files to names that look like tests.
  const testPaths = (projectFiles || [])
    .filter((p) => /(\.test\.|\.spec\.|_test\.|_spec\.|\/tests?\/)/.test(p))
    .slice(0, 100);
  const userMsg = [
    `Branch: ${prContext.current_branch} → ${prContext.base_branch}`,
    `Changed files (${(prContext.files_changed || []).length}):`,
    (prContext.files_changed || []).slice(0, 60).map((f) => `- ${f}`).join('\n'),
    '',
    `Known test files in the project (sample):`,
    testPaths.map((p) => `- ${p}`).join('\n') || '(none detected)',
    '',
    `Diff (first 30k chars):`,
    (prContext.diff || '').slice(0, 30000),
    '',
    'Return the JSON now.',
  ].join('\n');

  if (provider === 'anthropic') {
    const r = await robustFetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: 1500, temperature: 0.1,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal,
    }, false);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return parse((data?.content || []).map((b) => b.text || '').join(''));
  }
  const r = await robustFetch(DEEPSEEK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, max_tokens: 1500, temperature: 0.1,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
    }),
    signal,
  }, true);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return parse(data?.choices?.[0]?.message?.content || '');
}
