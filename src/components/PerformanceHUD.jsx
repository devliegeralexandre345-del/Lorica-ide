// src/components/PerformanceHUD.jsx
//
// A floating diagnostic overlay for power users who want to feel how snappy
// the IDE is. Shows live frame time (FPS), JS heap usage (when the browser
// exposes `performance.memory` — Chromium does), and the measured latency
// of the last AI stream chunk. Fully CSS — no dependencies, no
// performance-observer overhead when it's off.
//
// Intentionally minimal. A bigger HUD would become a distraction; this one
// stays out of the way in the corner and only ticks on requestAnimationFrame
// batches, so the monitoring itself is cheap.

import React, { useEffect, useRef, useState } from 'react';
import { Activity, Cpu, Zap, Bot } from 'lucide-react';

// ── AI latency tracker ──
// A tiny global ring buffer that any HTTP call to Anthropic / DeepSeek
// can push into. The HUD reads it to show p50 / p95 of the last N calls.
// Module-scoped so it's singleton across components.
const MAX_AI_SAMPLES = 50;
const aiSamples = []; // [{ model, ms, at }]
const aiListeners = new Set();

/** Record a single AI call's latency. Safe to call from anywhere. */
export function recordAiLatency(ms, model = '?') {
  if (!Number.isFinite(ms) || ms < 0) return;
  aiSamples.push({ ms, model, at: Date.now() });
  if (aiSamples.length > MAX_AI_SAMPLES) aiSamples.shift();
  for (const fn of aiListeners) fn();
}
function useAiLatencyStats() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    aiListeners.add(fn);
    return () => aiListeners.delete(fn);
  }, []);
  if (aiSamples.length === 0) return null;
  const sorted = [...aiSamples].sort((a, b) => a.ms - b.ms);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]?.ms || 0;
  return { count: aiSamples.length, p50: p(0.5), p95: p(0.95) };
}

function usePerformanceStats(enabled) {
  const [fps, setFps] = useState(60);
  const [heapMB, setHeapMB] = useState(null);
  const [heapPct, setHeapPct] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let frames = 0;
    let start = performance.now();

    const tick = () => {
      frames++;
      const now = performance.now();
      const elapsed = now - start;
      // Refresh the reading every ~500 ms — more often than that just churns.
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        start = now;
        // Memory read is browser-specific — Chromium exposes it with
        // `performance.memory`. Missing on Firefox/Safari: just hide the chip.
        const mem = performance.memory;
        if (mem) {
          setHeapMB(Math.round(mem.usedJSHeapSize / (1024 * 1024)));
          setHeapPct(Math.min(100, Math.round(
            (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100
          )));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return { fps, heapMB, heapPct };
}

// Traffic-light color for FPS — 55+ is great, 30–54 is "ok", below is bad.
function fpsColor(fps) {
  if (fps >= 55) return 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10';
  if (fps >= 30) return 'text-amber-400 border-amber-400/40 bg-amber-400/10';
  return 'text-red-400 border-red-400/40 bg-red-400/10';
}

export default function PerformanceHUD({ visible, onClose }) {
  const { fps, heapMB, heapPct } = usePerformanceStats(visible);
  const aiStats = useAiLatencyStats();
  if (!visible) return null;

  return (
    <div
      className="fixed bottom-10 left-4 z-[998] flex items-center gap-1.5 bg-lorica-panel/80 backdrop-blur-xl border border-lorica-border rounded-full px-2.5 py-1 shadow-[0_0_20px_rgba(0,212,255,0.12)] animate-fadeIn pointer-events-auto"
      title="Performance HUD — click a chip for details"
    >
      {/* FPS */}
      <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-mono ${fpsColor(fps)}`}>
        <Zap size={9} />
        <span className="tabular-nums">{fps}</span>
        <span className="opacity-60">fps</span>
      </div>

      {/* Heap (only when browser exposes it) */}
      {heapMB !== null && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-lorica-border text-[10px] font-mono text-lorica-textDim">
          <Cpu size={9} />
          <span className="tabular-nums">{heapMB}</span>
          <span className="opacity-60">MB</span>
          {heapPct != null && (
            <span className={`opacity-60 ${heapPct > 80 ? 'text-amber-400' : ''}`}>
              · {heapPct}%
            </span>
          )}
        </div>
      )}

      {/* AI latency — shows up as soon as the first agent/inline call fires.
          Surface p50 and p95 of the last N samples so a transient spike
          doesn't drive the displayed number. */}
      {aiStats && (
        <div
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-mono ${
            aiStats.p95 > 5000
              ? 'text-red-400 border-red-400/40 bg-red-400/5'
              : aiStats.p95 > 2000
                ? 'text-amber-400 border-amber-400/40 bg-amber-400/5'
                : 'text-sky-400 border-sky-400/40 bg-sky-400/5'
          }`}
          title={`AI — p50 ${aiStats.p50}ms · p95 ${aiStats.p95}ms (last ${aiStats.count} calls)`}
        >
          <Bot size={9} />
          <span className="tabular-nums">{aiStats.p50}</span>
          <span className="opacity-60">·{aiStats.p95}ms</span>
        </div>
      )}

      {/* Close */}
      {onClose && (
        <button
          onClick={onClose}
          title="Hide HUD (Alt+Shift+P)"
          className="text-lorica-textDim hover:text-lorica-accent ml-1"
        >
          <Activity size={10} />
        </button>
      )}
    </div>
  );
}
