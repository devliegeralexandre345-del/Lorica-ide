# Focus Timer — Lorica reference extension

A 25/5/15-minute Pomodoro chip that lives in the status bar. Click to
start or pause, right-click to reset. After 4 focus cycles the next
break is a long one (15 minutes by default).

This folder is the **reference implementation** for the Lorica
Extension API v0 — see [`docs/EXTENSION_API.md`](../../docs/EXTENSION_API.md)
in the repo. It mirrors the in-tree component
[`src/components/FocusTimer.jsx`](../../src/components/FocusTimer.jsx)
but only uses the API surface that v2.4 will expose to extensions, so it
serves both as a teaching example and as a sanity check that the v0
surface is enough to express a real feature.

## Status

- **Lorica v2.3** — extension loader is **not yet shipped**. This folder
  exists so reviewers can read the API doc alongside a concrete example,
  and so the v2.4 work has a target to lift directly.
- **Lorica v2.4** — drop this folder under
  `~/.local/share/Lorica/extensions/focus-timer/` (or the OS-specific
  data dir; Lorica will print the resolved path on first boot) to load
  it. Settings → Extensions will list it once detected.

## Permissions used

- `ui.statusBar` — paints the chip on the right side of the status bar.
- `ui.commandPalette` — registers `focusTimer.toggle`, `focusTimer.reset`,
  and `focusTimer.skip` so the palette and keymap can drive them.
- `storage.local` — persists the per-cycle log under `lorica.ext.focus-timer.log`.
- `storage.settings` — reads the four user-configurable durations.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `focusMins` | 25 | Length of a focus phase, in minutes |
| `shortBreakMins` | 5 | Length of a short break |
| `longBreakMins` | 15 | Length of a long break |
| `longBreakEvery` | 4 | Number of focus cycles between long breaks |

## Why Focus Timer was picked

Of the 28 features currently in `src/utils/features.js`, Focus Timer is
the cleanest extraction candidate:

- **No shared state.** It writes to one localStorage key and reads no
  other Lorica state.
- **Single panel surface.** A status-bar chip and three commands. No DAP /
  LSP / agent integration.
- **Self-contained UI.** A single `<button>` in a host node, no React,
  no theme plumbing — just CSS custom properties.

Anything more entangled (Git Panel, AI Copilot, Sandbox) won't extract
without API surface that v0 doesn't yet have. Focus Timer is the proof
that v0 is enough for at least one real feature; once v2.4 ships the
loader, more features can graduate from `features.js` toggles into
extensions.
