// src/utils/extensionRuntime.js
//
// Wave 23 — Extension loader v0 phase 2: the actual JS runtime that
// loads an extension's `entry` file and hands it a sandboxed `ctx`
// object scoped to its declared permissions. Builds on Wave 22's
// `cmd_extension_scan` + `cmd_extension_read_entry` Rust commands.
//
// Loading strategy: fetch the entry source via the Tauri bridge,
// wrap it in a Blob URL, and `import(blob:…)` it dynamically. This
// works in both dev and bundled Tauri builds because the blob: URL
// is treated as a same-origin module by the WebView.
//
// Sandboxing: `ctx` is constructed PER extension. Each method only
// exists if the extension declared the matching permission in its
// manifest. The shared host functions (statusBar host slot, command
// registry, storage namespace) live in `extensionHost.js`.
//
// What's deliberately NOT here yet (queued for v0.1+):
//   - CSS isolation via shadow DOM
//   - Web Worker isolation for CPU budgets
//   - Network gating (`network.outbound` permission)
// These are documented in EXTENSION_API.md as v0.1 follow-ups.

import { mountStatusBarChip, unmountStatusBarChip } from './extensionHost';
import { dispatchCommand, registerCommand } from './extensionHost';
import { extStorageGet, extStorageSet, extStorageRemove } from './extensionHost';
import { extSettingsGet, extSettingsSet } from './extensionHost';

// Track loaded extensions so we can deactivate cleanly + avoid
// double-loading. Keyed by manifest.id.
const loaded = new Map(); // id → { manifest, module, disposables: Disposable[] }

class Disposable {
  constructor(dispose) { this.dispose = dispose; }
}

// Build the sandboxed ctx surface for ONE extension. Methods are only
// added when the extension declared the matching permission, so a
// faulty extension can't reach surfaces it didn't ask for.
function buildContext(manifest) {
  const perms = new Set(manifest.permissions || []);
  const ctx = {};

  // ─ ui.statusBar ────────────────────────────────────────────────
  if (perms.has('ui.statusBar')) {
    ctx.statusBar = {
      register({ render, side } = {}) {
        // Wave 36 — `side: 'left' | 'right'` (default 'right').
        const host = mountStatusBarChip(manifest.id, { side });
        const teardown = typeof render === 'function' ? render(host) : null;
        return new Disposable(() => {
          try { if (typeof teardown === 'function') teardown(); } catch {}
          unmountStatusBarChip(manifest.id);
        });
      },
    };
  }

  // ─ ui.commandPalette ───────────────────────────────────────────
  if (perms.has('ui.commandPalette')) {
    ctx.commands = {
      register(commandId, handler) {
        if (typeof handler !== 'function') {
          throw new Error('commands.register requires a function handler');
        }
        const off = registerCommand(commandId, handler, manifest.id);
        return new Disposable(off);
      },
      dispatch(commandId, ...args) {
        return dispatchCommand(commandId, ...args);
      },
    };
  }

  // ─ storage.local ───────────────────────────────────────────────
  if (perms.has('storage.local')) {
    ctx.storage = {
      get: (key) => extStorageGet(manifest.id, key),
      set: (key, value) => extStorageSet(manifest.id, key, value),
      remove: (key) => extStorageRemove(manifest.id, key),
    };
  }

  // ─ storage.settings ────────────────────────────────────────────
  if (perms.has('storage.settings')) {
    ctx.settings = {
      get: (key) => extSettingsGet(manifest, key),
      set: (key, value) => extSettingsSet(manifest, key, value),
    };
  }

  return ctx;
}

// Activate a single extension. Idempotent — if already loaded we
// short-circuit. Returns the loaded record so the caller can present
// status (e.g. "Failed to activate: <error>").
export async function activateExtension(manifest) {
  if (loaded.has(manifest.id)) return loaded.get(manifest.id);
  const record = { manifest, module: null, disposables: [], error: null };
  loaded.set(manifest.id, record);
  try {
    const r = await window.lorica.extensionLoader.readEntry(manifest.rootPath, manifest.entry);
    if (!r?.success) throw new Error(r?.error || 'failed to read entry');
    const src = r.data;

    // Create a Blob URL for the entry source and dynamic-import it.
    // `type: 'text/javascript'` tells the WebView to interpret as a
    // module; ESM works because the user-authored extension uses
    // `export default { activate, deactivate }`.
    const blob = new Blob([src], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    let mod;
    try {
      mod = await import(/* webpackIgnore: true */ url);
    } finally {
      // Free the URL right after import so we don't leak object refs.
      URL.revokeObjectURL(url);
    }

    const def = mod?.default || mod;
    if (typeof def?.activate !== 'function') {
      throw new Error('extension.js must export a default object with an activate() method');
    }
    record.module = def;

    const ctx = buildContext(manifest);
    const ret = def.activate(ctx);
    if (ret && typeof ret.then === 'function') await ret;
    return record;
  } catch (e) {
    record.error = String(e?.message || e);
    return record;
  }
}

// Deactivate a loaded extension. Calls its `deactivate()` (if any),
// disposes everything it registered, and frees the slot.
export async function deactivateExtension(id) {
  const record = loaded.get(id);
  if (!record) return false;
  try {
    if (typeof record.module?.deactivate === 'function') {
      try { record.module.deactivate(); } catch {}
    }
  } finally {
    for (const d of record.disposables) {
      try { d?.dispose?.(); } catch {}
    }
    loaded.delete(id);
  }
  return true;
}

// Snapshot the currently loaded extensions for the Settings UI.
export function listLoadedExtensions() {
  return Array.from(loaded.values()).map((r) => ({
    id: r.manifest.id,
    name: r.manifest.name,
    version: r.manifest.version,
    error: r.error,
  }));
}

// Convenience for boot: scan + activate every extension that the
// user enabled (per `lorica.extensions.enabled` localStorage list).
// Built-in reference extensions in `<repo>/extensions/` are off by
// default — the user opts them in from Settings.
export async function bootEnabledExtensions({ projectPath, builtinDir } = {}) {
  const r = await window.lorica.extensionLoader.scan(projectPath, builtinDir);
  if (!r?.success) return { activated: [], errors: ['scan failed: ' + (r?.error || 'unknown')] };
  let enabled;
  try {
    const raw = localStorage.getItem('lorica.extensions.enabled');
    enabled = new Set(JSON.parse(raw || '[]'));
  } catch { enabled = new Set(); }

  const activated = [];
  const errors = [...(r.data?.errors || [])];
  for (const m of r.data?.manifests || []) {
    if (!enabled.has(m.id)) continue;
    const rec = await activateExtension(m);
    if (rec.error) errors.push(`${m.id}: ${rec.error}`);
    else activated.push(rec);
  }
  return { manifests: r.data?.manifests || [], activated, errors };
}
