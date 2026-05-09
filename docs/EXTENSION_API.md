# Lorica Extension API — v0 Draft

_Drafted 2026-05-09 as part of Wave 9 of the v2.3 program. **Status: spec_
_only.** v2.3 doesn't ship a runtime that loads extensions; the goal here is_
_to nail the surface so v2.4 can implement against a frozen contract._

This document specifies the v0 (alpha) extension surface that v2.4 will
ship. The 28 features currently in `src/utils/features.js` are an
in-tree "soft catalog" — many of them are perfectly cleanly-encapsulated
and could become extensions on day one. We extract one (Focus Timer) as
the reference implementation under `extensions/focus-timer/` to validate
that the API as drafted is sufficient to express a real feature.

## Goals (v0)

1. **Single-file extensions are easy.** A 60-line `extension.js` plus a
   `manifest.json` is enough to ship a panel.
2. **No re-bundle to install.** Extensions are loaded via dynamic
   `import()` at runtime from a per-user directory. No webpack rebuild.
3. **Permission-scoped.** Extensions declare their capabilities in the
   manifest. Lorica builds a sandboxed `lorica` object for them that
   only exposes the surface they asked for.
4. **Theme-native.** Extensions read CSS custom properties
   (`var(--color-*)`) and stay theme-aware automatically — no theme
   plumbing in the API.
5. **Explicit lifecycle.** `activate()` / `deactivate()` hooks bracket
   every extension. Lorica owns when they fire so reload / disable
   behaves consistently.

Non-goals for v0 (deferred to v0.1+):

- Custom file decorations (lint markers, gutter icons).
- DAP / LSP server contributions.
- Inter-extension messaging.
- Marketplace UX with ratings, screenshots, install counts.

## Filesystem layout

Extensions live under the user's Lorica config dir (resolved via the
existing `dirs::data_local_dir` lookup in `src-tauri/src/extensions.rs`):

```
~/.local/share/Lorica/extensions/
  focus-timer/
    manifest.json
    extension.js
    icon.svg          (optional, 24×24 SVG used in the dock)
    README.md         (optional)
```

Lorica scans this directory at boot, parses each `manifest.json`, and
queues the extension for activation. A built-in directory ships in-tree
under `extensions/` for reference extensions (Focus Timer, soon Spotify).
Built-in and user-installed extensions use the exact same loader path.

## `manifest.json` schema

```json
{
  "id": "focus-timer",
  "name": "Focus Timer",
  "description": "A 25/5/15-minute Pomodoro chip in the status bar.",
  "version": "1.0.0",
  "lorica_api_version": "0",
  "entry": "./extension.js",
  "icon": "./icon.svg",
  "author": "Lorica core",
  "license": "MIT",
  "homepage": "https://github.com/.../extensions/focus-timer",
  "permissions": [
    "ui.statusBar",
    "ui.dock",
    "storage.local",
    "events.editor"
  ],
  "contributes": {
    "settings": [
      { "key": "focusTimer.focusMins", "type": "number", "default": 25 },
      { "key": "focusTimer.shortBreakMins", "type": "number", "default": 5 },
      { "key": "focusTimer.longBreakMins", "type": "number", "default": 15 }
    ],
    "commands": [
      { "id": "focusTimer.toggle", "title": "Focus: Start / Pause" },
      { "id": "focusTimer.reset", "title": "Focus: Reset" }
    ]
  }
}
```

### Required fields

| Field | Notes |
|---|---|
| `id` | Stable kebab-case identifier. Used as the directory name and as the prefix for command ids and storage keys. Must match `^[a-z0-9-]+$`. |
| `name` | Human label. Shown in Settings > Extensions and in the dock tooltip when the extension contributes a dock entry. |
| `version` | SemVer. Surfaced when the user needs to file a bug. |
| `lorica_api_version` | The major API version the extension targets. v2.4 ships `"0"`; future Lorica releases that break the API bump this number. |
| `entry` | Relative path to the JS module. The module's `default` export is the activator described in [`activate()`](#extension-module-shape) below. |
| `permissions` | See [Permissions](#permissions). Every entry must be one of the documented strings; unknown permissions cause the extension to refuse to load with a clear error. |

### Optional fields

`description`, `icon` (SVG path, recommended 24×24), `author`,
`license`, `homepage`, `contributes.settings`,
`contributes.commands`. All optional — a minimal extension is just `id`,
`name`, `version`, `lorica_api_version`, `entry`, and `permissions`.

## Extension module shape

```js
// extension.js — minimal contract.
export default {
  // Called once after the manifest validates and the user has either
  // explicitly enabled the extension OR (for built-ins) it's enabled by
  // default. `ctx` is the sandboxed `lorica` object scoped to the
  // permissions declared in the manifest.
  activate(ctx) { /* … register UI, listeners, commands … */ },

  // Called when the user disables the extension, when Lorica shuts down,
  // or when the extension is hot-reloaded during development. Must
  // synchronously release every disposable obtained from the API
  // (every register* call returns one).
  deactivate() {},
};
```

`activate()` may return a `Promise`; Lorica awaits it before considering
the extension "ready". Long-running setup (downloading data, starting a
worker) goes here. `deactivate()` MUST be synchronous-safe — Lorica calls
it during shutdown where async work isn't reliable.

## Permissions

An extension only sees surfaces it asks for. Requesting more than it
needs is a red flag in review (and surfaced in the install dialog).

### `ui.statusBar`

`ctx.statusBar.register({ render })` adds a chip on the right side of
the status bar. `render(node)` is called with a host DOM node owned by
Lorica; the extension paints whatever it wants inside. Returns a
disposable that removes the chip on `dispose()`.

### `ui.dock`

`ctx.dock.register({ id, label, icon, panel })` adds an icon to the
left dock. Clicking opens `panel` in a full-window overlay. The panel
is a function `(host) => disposable` — same shape as `statusBar.register`.

### `ui.settingsTab`

Adds a new tab in the Settings modal. Reuses Lorica's settings storage
(see `storage.settings` below).

### `ui.commandPalette`

Anything declared under `contributes.commands` is automatically inserted
into the command palette / Omnibar. The runtime calls
`ctx.commands.dispatch(commandId)` — the extension registers handlers
via `ctx.commands.register('focusTimer.toggle', () => …)`.

### `storage.local`

`ctx.storage.get(key)`, `ctx.storage.set(key, value)`,
`ctx.storage.remove(key)`. Backed by `localStorage` but namespaced under
`lorica.ext.<extId>.<key>` so extensions can't see each other's data and
can't accidentally clobber Lorica's own keys.

### `storage.settings`

`ctx.settings.get(key)`, `ctx.settings.set(key, value)`. Read-write
access to the values declared in `contributes.settings`. The Settings
modal renders editors for these automatically.

### `events.editor`

Subscribe to editor lifecycle events. Each subscription is a disposable.

```js
ctx.editor.onActiveFileChange((file) => { /* file: { path, language } | null */ });
ctx.editor.onSave((file) => {});
ctx.editor.onSelectionChange((info) => {});
```

### `events.git`

Subscribe to git status changes. Useful for chips that reflect
working-tree state.

```js
ctx.git.onStatusChange((status) => {});
ctx.git.onBranchChange((branch) => {});
```

### `agent.tools`

Contribute a tool that the agent can call. Out-of-scope for v0 — earmarked
for v0.1.

## Sandboxing model

Each extension runs in the renderer process (no separate VM in v0). The
sandbox is API-shaped: extensions only see what their permissions
declare. Direct DOM access is allowed within the host node Lorica
gives them; access outside that node (`document.querySelector`, etc.)
is technically possible but explicitly disallowed by the API contract
and will be enforced by a Proxy wrapper in v0.1.

What v0 does enforce:

- Extensions cannot read or write `localStorage` directly. The runtime
  hides `localStorage` from the extension's module scope by passing
  `ctx.storage` instead and stripping `localStorage` from the iframe-
  like execution environment (when v0.1 lands real isolation).
- Extensions cannot reach `window.lorica` directly. Their only
  Lorica-facing surface is `ctx`.
- Extensions cannot mutate the manifest of another extension.
- Extensions cannot spawn child processes (`child_process` is not
  exposed). Tauri-backend privileges are off-limits.

What v0 does NOT enforce (yet):

- Network access. The extension can `fetch()` anywhere. v0.1 will gate
  this behind a `network.outbound` permission with allow-listed origins.
- CPU / memory budgets. A runaway extension can hang the renderer.
  Mitigation in v0: hot-reload makes "kill the misbehaving extension"
  one click. v0.1 will move execution into a Web Worker.

## Lifecycle: install → enable → activate → deactivate → remove

| Event | Trigger | Lorica behaviour |
|---|---|---|
| Install | User picks an extension from the marketplace OR drops a folder under `~/.local/share/Lorica/extensions/` | Manifest validated, permissions reviewed, extension appears in Settings > Extensions as **disabled** |
| Enable | User toggles the extension in Settings | `activate(ctx)` fires |
| Disable | User toggles off | `deactivate()` fires; all disposables auto-released |
| Reload | User clicks "Reload" in dev tools | `deactivate()` then `activate()` |
| Remove | User deletes the directory or clicks "Uninstall" | If active, `deactivate()`; then directory removed |

## Reference implementation: `extensions/focus-timer`

The Focus Timer (`src/components/FocusTimer.jsx`) is the simplest
candidate to extract because it has no shared state, no DAP / LSP /
agent integration, and only writes to localStorage under a single key
(`lorica.focus.log.v1`). Its surface is exactly:

- A status-bar chip (`ui.statusBar`).
- A right-click reset / left-click toggle (`ui.commandPalette` for the
  same actions, so users can bind keys via the existing keymap).
- Persistent log under one key (`storage.local`).

Translated to the API:

```json
// extensions/focus-timer/manifest.json
{
  "id": "focus-timer",
  "name": "Focus Timer",
  "version": "1.0.0",
  "lorica_api_version": "0",
  "entry": "./extension.js",
  "permissions": ["ui.statusBar", "storage.local", "ui.commandPalette"],
  "contributes": {
    "commands": [
      { "id": "focusTimer.toggle", "title": "Focus: Start / Pause" },
      { "id": "focusTimer.reset",  "title": "Focus: Reset" }
    ]
  }
}
```

```js
// extensions/focus-timer/extension.js
let dispose = null;

export default {
  activate(ctx) {
    let phase = 'idle';
    let secondsLeft = 25 * 60;
    let timer = null;

    // Status-bar chip — renders the phase + countdown.
    const chip = ctx.statusBar.register({
      render(host) {
        const el = document.createElement('button');
        el.style.cssText = 'background:transparent;color:var(--color-textDim);font:11px monospace';
        el.textContent = '🍅 25:00';
        el.onclick = () => ctx.commands.dispatch('focusTimer.toggle');
        el.oncontextmenu = (e) => { e.preventDefault(); ctx.commands.dispatch('focusTimer.reset'); };
        host.appendChild(el);
        return () => host.removeChild(el);
      }
    });

    ctx.commands.register('focusTimer.toggle', () => {
      // … real implementation here, omitted for spec brevity
    });
    ctx.commands.register('focusTimer.reset', () => { /* … */ });

    dispose = () => { chip.dispose(); };
  },
  deactivate() {
    if (dispose) dispose();
    dispose = null;
  },
};
```

The full reference implementation lives under `extensions/focus-timer/`
in this repo so the v2.4 implementation can lift it directly when the
loader lands.

## Versioning policy

- `lorica_api_version: "0"` — the alpha. Breaking changes allowed
  during v0 with deprecation notices in the changelog. Lorica will
  refuse to load extensions whose `lorica_api_version` doesn't match
  the major version it ships.
- `lorica_api_version: "1"` — first stable. Breaking changes from v0
  are batched into the v1 cut. After v1, semver applies.

Lorica core itself ships as a single binary; the API version is
independent of Lorica's marketing version (e.g. Lorica v2.4 may ship
API v0; Lorica v2.6 may bump to v1 once the surface is proven).

## Open questions for v2.4 implementation

1. **Module loader.** v0 needs a way to dynamic-`import()` an
   extension's `entry` from a path that isn't bundled. Webpack's
   `import()` only resolves paths it knows at build time. Two options:
   (a) ship an `import-map` polyfill, (b) read the file via Tauri's
   `cmd_read_file`, blob-URL it, and `import()` the blob URL. (b) is
   simpler and what we'll likely ship.
2. **CSS isolation.** Each extension owns its host node — but global
   styles can still leak. Option: wrap extension hosts in a shadow
   DOM. Adds a small per-extension footprint; keeps theme variables
   working because CSS custom properties traverse shadow boundaries.
3. **Hot reload.** During development the extension dir should be
   watched; on file change Lorica calls `deactivate()` + reimports
   `activate()`. Cheap with the existing `notify` watcher in
   `src-tauri/src/watcher.rs`.
4. **Marketplace UX.** v2.4 ships only the loader + reference
   extension; the in-IDE marketplace (browse, screenshots, ratings)
   is queued for v2.5. The current Extensions panel can grow an
   `"extension"` category in the meantime.
5. **Signing.** Until we have signed extension bundles the install
   flow trusts the user's filesystem (the user copied this folder in,
   they vouch for it). Once the SignPath certificate lands (Phase C4
   of v2.2 ship plan) we can expand to signed marketplace bundles.

## References

- `docs/V2.3_ROADMAP.md` — C2 row defining this work.
- `docs/V2.2_SHIP_PLAN.md` — Phase C definitions.
- `src/utils/features.js` — current 28-feature in-tree catalog; future
  extraction candidates.
- `src/components/FocusTimer.jsx` — current implementation, mirrored
  by `extensions/focus-timer/`.
- VS Code Extension API (https://code.visualstudio.com/api) — surface
  reference.
- Cursor `.cursorrules` model — minimal-config baseline we want to
  beat for the simple cases.
