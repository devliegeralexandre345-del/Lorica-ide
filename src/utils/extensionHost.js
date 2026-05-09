// src/utils/extensionHost.js
//
// Wave 23 — host-side helpers for the extension runtime. These are
// the implementations behind the sandboxed `ctx` surface in
// `extensionRuntime.js`. They intentionally live in the regular
// renderer (no Worker isolation in v0) so the extension can reach
// CodeMirror DOM nodes if it needs to — but only via host-mediated
// surfaces (`statusBar.register({render})` etc.).
//
// Persistence model:
//   - `storage.local`     → localStorage under `lorica.ext.<id>.<key>`
//   - `storage.settings`  → localStorage under
//                           `lorica.ext.<id>.settings.<key>`, with
//                           per-key defaults read from the extension's
//                           `manifest.contributes.settings[].default`
// Both buckets are namespaced so two extensions can't trample each
// other's data.

// ─────────────────────────────────────────────────────────────────
// Status-bar host slot
// ─────────────────────────────────────────────────────────────────
//
// The StatusBar component renders an `id="lorica-ext-statusbar-host"`
// container; extensions append their chip into a child div whose id
// includes the manifest.id. This indirection lets us mount/unmount
// per-extension chips without touching the rest of the StatusBar.

export function mountStatusBarChip(extId) {
  const root = document.getElementById('lorica-ext-statusbar-host');
  if (!root) {
    // Host slot isn't in the DOM yet (StatusBar may not have rendered
    // when the extension activates). Create a detached node and adopt
    // it later — cheap, safe, and avoids a race where activate fails
    // because of timing.
    const detached = document.createElement('div');
    detached.dataset.extId = extId;
    detached.dataset.detached = 'true';
    return detached;
  }
  let host = document.getElementById(`lorica-ext-${extId}`);
  if (host) return host;
  host = document.createElement('div');
  host.id = `lorica-ext-${extId}`;
  host.className = 'lorica-ext-chip';
  host.dataset.extId = extId;
  root.appendChild(host);
  return host;
}

export function unmountStatusBarChip(extId) {
  const host = document.getElementById(`lorica-ext-${extId}`);
  if (host && host.parentNode) host.parentNode.removeChild(host);
}

// ─────────────────────────────────────────────────────────────────
// Command registry
// ─────────────────────────────────────────────────────────────────
//
// Map<commandId, { handler, ext }>. We track the extension id so
// deactivate can sweep all the commands an extension registered
// without the extension having to remember its disposables.

const commandHandlers = new Map();

export function registerCommand(commandId, handler, extId) {
  if (commandHandlers.has(commandId)) {
    // Conflict: two extensions claim the same id. Last-wins is the
    // simplest policy; document it once we add an extension manager
    // UI that can warn the user.
  }
  commandHandlers.set(commandId, { handler, ext: extId });
  return () => {
    const cur = commandHandlers.get(commandId);
    if (cur && cur.ext === extId) commandHandlers.delete(commandId);
  };
}

export function dispatchCommand(commandId, ...args) {
  const entry = commandHandlers.get(commandId);
  if (!entry) return undefined;
  try {
    return entry.handler(...args);
  } catch (e) {
    console.warn(`[ext:${entry.ext}] command ${commandId} threw:`, e);
    return undefined;
  }
}

export function listExtensionCommands() {
  const out = [];
  commandHandlers.forEach((v, k) => out.push({ id: k, ext: v.ext }));
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Storage helpers (local + settings)
// ─────────────────────────────────────────────────────────────────

function localKey(extId, key) {
  return `lorica.ext.${extId}.${key}`;
}
function settingsKey(extId, key) {
  return `lorica.ext.${extId}.settings.${key}`;
}

export function extStorageGet(extId, key) {
  try {
    const raw = localStorage.getItem(localKey(extId, key));
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
export function extStorageSet(extId, key, value) {
  try { localStorage.setItem(localKey(extId, key), JSON.stringify(value)); } catch {}
}
export function extStorageRemove(extId, key) {
  try { localStorage.removeItem(localKey(extId, key)); } catch {}
}

// Settings: typed values declared in manifest.contributes.settings.
// We read the per-key default from the manifest the first time
// .get() is called, then track user overrides in localStorage.
export function extSettingsGet(manifest, key) {
  try {
    const stored = localStorage.getItem(settingsKey(manifest.id, key));
    if (stored != null) return JSON.parse(stored);
  } catch {}
  // Fall back to the manifest default.
  const decl = (manifest?.contributes?.settings || []).find((s) => s.key === key);
  return decl ? decl.default : undefined;
}
export function extSettingsSet(manifest, key, value) {
  try {
    localStorage.setItem(settingsKey(manifest.id, key), JSON.stringify(value));
  } catch {}
}
