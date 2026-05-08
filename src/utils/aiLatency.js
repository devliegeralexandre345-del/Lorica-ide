// src/utils/aiLatency.js
//
// Shared ring-buffer for AI-call latency samples. Extracted from
// PerformanceHUD.jsx so eager hooks (useAgent) can record samples
// without forcing the whole HUD component (and its React/lucide graph)
// into the initial bundle. PerformanceHUD.jsx stays the only reader —
// it subscribes to `aiListeners` and renders p50/p95 chips when visible.
//
// Module-scoped so the buffer is a singleton across the app. Cheap
// writes (array push + bounded shift + fan-out to a tiny listener set),
// no React involved.

const MAX_AI_SAMPLES = 50;

export const aiSamples = []; // [{ model, ms, at }]
export const aiListeners = new Set();

/** Record a single AI call's latency. Safe to call from anywhere. */
export function recordAiLatency(ms, model = '?') {
  if (!Number.isFinite(ms) || ms < 0) return;
  aiSamples.push({ ms, model, at: Date.now() });
  if (aiSamples.length > MAX_AI_SAMPLES) aiSamples.shift();
  for (const fn of aiListeners) fn();
}
