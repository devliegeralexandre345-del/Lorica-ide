// src/components/FocusTimer.jsx
//
// A minimal Pomodoro timer baked into the status-bar edge of the IDE. A
// single chip: click to start/pause, right-click to reset. 25-minute
// focus → 5-minute break → 25 → 15-minute long break every 4 cycles.
// Visually stays calm — no color explosions, just an accent bar that
// drains down.
//
// Why in-process and not a system notification: a system tray timer gets
// ignored when the developer is heads-down in code. Sticking it on the
// status bar means it's ALWAYS visible next to the running work, and
// finishing a cycle nudges zen mode off / on so the ambient UI matches
// the brain state.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Play, Pause, RotateCcw, Coffee, Brain, BarChart3, X } from 'lucide-react';

const FOCUS_SECS = 25 * 60;
const SHORT_BREAK = 5 * 60;
const LONG_BREAK  = 15 * 60;

// Session log — each completed focus phase is logged. We don't log
// aborted focus sessions (resets) to avoid polluting "time focused" with
// noise; only the phases that reached 0 count.
const LOG_KEY = 'lorica.focus.log.v1';
function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}
function saveLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500))); } catch {}
}

function statsForLog(log) {
  const dayMs = 24 * 3600 * 1000;
  const now = Date.now();
  const buckets = { today: 0, week: 0, month: 0, total: 0 };
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  for (const entry of log) {
    if (entry.kind !== 'focus') continue;
    const age = now - entry.at;
    buckets.total += entry.seconds;
    if (entry.at >= startOfDay.getTime()) buckets.today += entry.seconds;
    if (age <= 7 * dayMs)  buckets.week  += entry.seconds;
    if (age <= 30 * dayMs) buckets.month += entry.seconds;
  }
  return buckets;
}
function fmtDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export default function FocusTimer({ state, dispatch }) {
  const [phase, setPhase] = useState('focus'); // 'focus' | 'break'
  const [cyclesDone, setCyclesDone] = useState(0);
  const [remaining, setRemaining] = useState(FOCUS_SECS);
  const [running, setRunning] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [log, setLog] = useState(() => loadLog());
  const intervalRef = useRef(null);
  const phaseLengthRef = useRef(FOCUS_SECS);
  const stats = useMemo(() => statsForLog(log), [log]);

  const startPause = () => setRunning((r) => !r);
  const reset = (e) => {
    e?.preventDefault?.();
    setRunning(false);
    setPhase('focus');
    setRemaining(FOCUS_SECS);
    setCyclesDone(0);
    phaseLengthRef.current = FOCUS_SECS;
  };

  // Phase transition — called when timer hits 0. We also log the just-
  // completed phase to the session log for stats purposes.
  const advancePhase = () => {
    if (phase === 'focus') {
      const nextCycles = cyclesDone + 1;
      setCyclesDone(nextCycles);
      const isLong = nextCycles % 4 === 0;
      const next = isLong ? LONG_BREAK : SHORT_BREAK;
      // Log the completed focus phase.
      const entry = { at: Date.now(), kind: 'focus', seconds: FOCUS_SECS };
      const nextLog = [...log, entry];
      setLog(nextLog); saveLog(nextLog);
      phaseLengthRef.current = next;
      setPhase('break');
      setRemaining(next);
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Focus cycle done — ${isLong ? '15' : '5'} min break`, duration: 4000 } });
    } else {
      const wasLong = phaseLengthRef.current === LONG_BREAK;
      const entry = { at: Date.now(), kind: 'break', seconds: wasLong ? LONG_BREAK : SHORT_BREAK };
      const nextLog = [...log, entry];
      setLog(nextLog); saveLog(nextLog);
      phaseLengthRef.current = FOCUS_SECS;
      setPhase('focus');
      setRemaining(FOCUS_SECS);
      dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Break over — back to focus', duration: 4000 } });
    }
  };

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          // Schedule phase change on next tick to avoid setState cascades.
          queueMicrotask(() => advancePhase());
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase]);

  const pct = Math.max(0, Math.min(1, remaining / phaseLengthRef.current));
  const isBreak = phase === 'break';

  return (
    <div className="relative">
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono transition-colors relative overflow-hidden ${
        isBreak
          ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
          : running
            ? 'border-lorica-accent/40 bg-lorica-accent/10 text-lorica-accent'
            : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
      }`}
      onContextMenu={reset}
      onClick={startPause}
      title={`${isBreak ? 'Break' : 'Focus'} · ${running ? 'Click to pause' : 'Click to start'} · Right-click to reset · Shift+click for stats`}
    >
      {/* Progress bar drains as the phase runs out. */}
      <div
        className={`absolute inset-y-0 left-0 ${isBreak ? 'bg-emerald-400/20' : 'bg-lorica-accent/20'}`}
        style={{ width: `${pct * 100}%`, transition: 'width 1s linear' }}
      />
      <div className="relative flex items-center gap-1.5">
        {isBreak ? <Coffee size={10} /> : <Brain size={10} />}
        <span className="tabular-nums">{fmt(remaining)}</span>
        {running
          ? <Pause size={9} />
          : <Play size={9} />}
        {cyclesDone > 0 && (
          <span className="opacity-60 ml-1">·{cyclesDone}</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setShowStats((v) => !v); }}
          className="ml-1 opacity-60 hover:opacity-100"
          title="Show stats"
        >
          <BarChart3 size={9} />
        </button>
      </div>
    </div>
    {showStats && (
      <div
        className="absolute bottom-full right-0 mb-2 w-[240px] lorica-glass rounded-xl shadow-[0_0_20px_rgba(0,212,255,0.15)] p-3 z-50 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3 size={11} className="text-lorica-accent" />
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Focus stats</span>
          <button onClick={() => setShowStats(false)} className="ml-auto text-lorica-textDim hover:text-lorica-text">
            <X size={10} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <StatCell label="Today"      value={fmtDuration(stats.today)} />
          <StatCell label="This week"  value={fmtDuration(stats.week)} />
          <StatCell label="This month" value={fmtDuration(stats.month)} />
          <StatCell label="Total"      value={fmtDuration(stats.total)} />
        </div>
        <div className="mt-2 pt-2 border-t border-lorica-border text-[9px] text-lorica-textDim">
          {log.filter((e) => e.kind === 'focus').length} focus cycles completed lifetime
        </div>
        <button
          onClick={() => { setLog([]); saveLog([]); }}
          className="mt-1.5 text-[9px] text-lorica-textDim hover:text-red-400"
        >
          Reset history
        </button>
      </div>
    )}
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div className="rounded border border-lorica-border bg-lorica-bg/40 p-2">
      <div className="text-sm font-mono text-lorica-accent">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-lorica-textDim">{label}</div>
    </div>
  );
}
