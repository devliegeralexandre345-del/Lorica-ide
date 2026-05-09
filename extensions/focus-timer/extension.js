// extensions/focus-timer/extension.js
//
// Reference extension for the Lorica Extension API v0 (see
// docs/EXTENSION_API.md). Mirrors the in-tree FocusTimer.jsx but only
// touches the API surface available to extensions — no React, no
// `window.lorica`, no direct localStorage. The whole point of this file
// is to prove that the v0 surface is enough to express a real feature.
//
// When the v2.4 extension loader lands, dropping this folder under
// `~/.local/share/Lorica/extensions/focus-timer/` makes Lorica boot
// the chip identically to the bundled component.

let host = null;        // Lorica-owned status-bar host node (when active)
let chipEl = null;      // <button> we paint inside `host`
let phase = 'idle';     // 'idle' | 'focus' | 'short' | 'long'
let secondsLeft = 0;
let cycles = 0;         // completed focus cycles since boot (for long-break math)
let interval = null;
let chipDisposable = null;
let cmdDisposables = [];

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function paint() {
  if (!chipEl) return;
  const labels = { idle: 'idle', focus: 'focus', short: 'break', long: 'long break' };
  const phaseLabel = labels[phase] || phase;
  const time = phase === 'idle' ? '' : ' ' + fmt(secondsLeft);
  chipEl.textContent = `🍅 ${phaseLabel}${time}`;
  chipEl.style.color = phase === 'focus'
    ? 'var(--color-accent)'
    : phase === 'idle'
    ? 'var(--color-textDim)'
    : 'var(--color-text)';
}

function logCompleted(ctx, kind, seconds) {
  const log = (ctx.storage.get('log') || []).slice(-499);
  log.push({ kind, seconds, at: Date.now() });
  ctx.storage.set('log', log);
}

function tick(ctx) {
  if (phase === 'idle') return;
  secondsLeft = Math.max(0, secondsLeft - 1);
  paint();
  if (secondsLeft === 0) {
    if (phase === 'focus') {
      logCompleted(ctx, 'focus', ctx.settings.get('focusMins') * 60);
      cycles += 1;
      const longEvery = ctx.settings.get('longBreakEvery') || 4;
      const nextBreak = cycles % longEvery === 0 ? 'long' : 'short';
      phase = nextBreak;
      secondsLeft =
        nextBreak === 'long'
          ? (ctx.settings.get('longBreakMins') || 15) * 60
          : (ctx.settings.get('shortBreakMins') || 5) * 60;
    } else {
      // Break finished → swing back into focus
      phase = 'focus';
      secondsLeft = (ctx.settings.get('focusMins') || 25) * 60;
    }
    paint();
  }
}

function startInterval(ctx) {
  if (interval) return;
  interval = setInterval(() => tick(ctx), 1000);
}

function stopInterval() {
  if (interval) { clearInterval(interval); interval = null; }
}

function toggle(ctx) {
  if (phase === 'idle') {
    phase = 'focus';
    secondsLeft = (ctx.settings.get('focusMins') || 25) * 60;
    startInterval(ctx);
  } else if (interval) {
    stopInterval();
  } else {
    startInterval(ctx);
  }
  paint();
}

function reset() {
  stopInterval();
  phase = 'idle';
  secondsLeft = 0;
  cycles = 0;
  paint();
}

function skip(ctx) {
  if (phase === 'idle') return;
  secondsLeft = 1;
  // Force one tick to advance the phase right now rather than wait a sec.
  tick(ctx);
}

export default {
  activate(ctx) {
    chipDisposable = ctx.statusBar.register({
      render(h) {
        host = h;
        chipEl = document.createElement('button');
        chipEl.style.cssText =
          'background:transparent;border:none;cursor:pointer;font:11px/1 "JetBrains Mono",monospace;padding:0 6px;';
        chipEl.title = 'Click: start / pause · Right-click: reset';
        chipEl.addEventListener('click', () => ctx.commands.dispatch('focusTimer.toggle'));
        chipEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          ctx.commands.dispatch('focusTimer.reset');
        });
        host.appendChild(chipEl);
        paint();
        return () => {
          if (chipEl && chipEl.parentNode) chipEl.parentNode.removeChild(chipEl);
          host = null;
          chipEl = null;
        };
      },
    });

    cmdDisposables.push(ctx.commands.register('focusTimer.toggle', () => toggle(ctx)));
    cmdDisposables.push(ctx.commands.register('focusTimer.reset', () => reset()));
    cmdDisposables.push(ctx.commands.register('focusTimer.skip', () => skip(ctx)));
  },

  deactivate() {
    stopInterval();
    if (chipDisposable) { try { chipDisposable.dispose(); } catch {} }
    chipDisposable = null;
    for (const d of cmdDisposables) { try { d.dispose(); } catch {} }
    cmdDisposables = [];
    phase = 'idle';
    secondsLeft = 0;
    cycles = 0;
  },
};
