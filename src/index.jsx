// Lorica — Tauri Entry Point
// The bridge must load first to create window.lorica
window.global = window;

// Boot-time perf marks — read by PerformanceHUD's "Boot times" subsection.
// Stamped at three milestones so power users can see how long each phase
// takes on their machine: module evaluation start (here), first React
// commit (in App's mount effect), and project tree ready (after
// useFileSystem reports its first non-empty tree).
try { performance.mark('lorica:boot:start'); } catch {}

import './loricaBridge';

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// --------------------------------------------------------------------
// Suppress noisy unhandled rejections coming from Tauri internals.
//
// `@tauri-apps/plugin-http` leaks a "The resource id N is invalid." error
// when a fetch is aborted while its response body is still being read
// (e.g. the inline-AI completion cancels its request on every keystroke).
// Those errors are harmless — the request is legitimately cancelled —
// but webpack-dev-server's overlay treats them as unhandled and plasters
// the screen with a red modal. Swallow them specifically, log elsewhere.
// --------------------------------------------------------------------
function isBenignTauriAbort(reason) {
  const msg = reason?.message || (typeof reason === 'string' ? reason : '');
  return (
    /resource id \d+ is invalid/i.test(msg) ||
    reason?.name === 'AbortError'
  );
}

window.addEventListener('unhandledrejection', (ev) => {
  if (isBenignTauriAbort(ev.reason)) {
    ev.preventDefault();
    // eslint-disable-next-line no-console
    console.debug('[lorica] swallowed benign async cancel:', ev.reason?.message || ev.reason);
  }
});
window.addEventListener('error', (ev) => {
  if (isBenignTauriAbort(ev.error)) {
    ev.preventDefault();
    // eslint-disable-next-line no-console
    console.debug('[lorica] swallowed benign error:', ev.error?.message || ev.error);
  }
});

// Floating-window routing.
//
// `cmd_window_open_floating` (Rust) spawns a new Tauri WebviewWindow
// pointed at `index.html#floating=<base64-path>`. We detect that hash
// here and lazy-load the FloatingViewer instead of rendering App so the
// floating window doesn't paint the full IDE chrome. App stays as a
// static import so the existing webpack chunk graph (codemirror /
// vendors split with `chunks: 'initial'`) is preserved — moving App to
// dynamic would force every codemirror module into the App chunk and
// undo the perf passes from Waves 2+5.
const root = createRoot(document.getElementById('root'));

if (/^#floating=/.test(window.location.hash || '')) {
  import(/* webpackChunkName: "floating-viewer" */ './FloatingViewer')
    .then(({ default: FloatingViewer }) => root.render(<FloatingViewer />))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[lorica] floating viewer failed to load:', e);
      document.getElementById('root').innerHTML =
        `<pre style="color:#f87171;padding:24px;font:12px monospace">Floating viewer failed to load:\n${String(e?.stack || e)}</pre>`;
    });
} else {
  root.render(<App />);
}
