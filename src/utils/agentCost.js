// src/utils/agentCost.js
//
// Rough cost estimator for agent sessions. The prices below are the
// per-million-token rates published by each provider at time of
// writing; they drift, so we expose them as a plain table anyone can
// edit. Values are USD.
//
// We don't try to be accounting-accurate — the goal is to give the user
// a "is this a $0.02 session or a $2 session" ballpark so they can
// course-correct before running up a bill.

export const PRICES = {
  // Anthropic
  'claude-3-5-haiku-20241022':   { input: 0.80,  output: 4.00 },
  'claude-sonnet-4-20250514':    { input: 3.00,  output: 15.00 },
  'claude-opus-4-20250514':      { input: 15.00, output: 75.00 },
  // DeepSeek
  'deepseek-chat':               { input: 0.27,  output: 1.10 },
  'deepseek-reasoner':           { input: 0.55,  output: 2.19 },
};

// Compute a cost estimate from a usage object. Returns { cost, currency }.
// Missing model → we fall back to Sonnet pricing (conservative middle).
export function estimateCost(model, usage) {
  if (!usage) return { cost: 0, currency: 'USD' };
  const table = PRICES[model] || PRICES['claude-sonnet-4-20250514'];
  const inputTokens  = usage.input_tokens  ?? usage.prompt_tokens     ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cost = (inputTokens / 1_000_000) * table.input
             + (outputTokens / 1_000_000) * table.output;
  return { cost, currency: 'USD' };
}

export function formatCost(cost) {
  if (!cost || cost < 0.0001) return '< $0.01';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1)    return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
