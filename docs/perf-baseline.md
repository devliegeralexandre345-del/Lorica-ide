# Lorica Performance Baseline

**Captured:** 2026-04-25
**Lorica version:** 2.2.0 (from `package.json`)
**Build tooling:** webpack 5.106.2, production mode, code-split via `splitChunks.cacheGroups`
**Pass:** post-pass-2 (FilePreview nested lazy-split landed)

---

## Why this doc exists

Per `docs/V2.2_SHIP_PLAN.md` C1, we want a measurable target for "Lorica
plus léger": **cold start under 2.5 s, idle RAM under 250 MB**. To know
when we hit it we need a baseline. This file is the static-bundle half
of that baseline — the runtime numbers (cold start, RAM, paint timings)
must be captured by running the signed binary, which is outside what a
build-time agent can observe.

Pass 1 already shipped: `main.bundle` 321 → 304 KiB, lazy-loaded
`TimeScrubBar`, `PerformanceHUD`, `AIConsentModal`, `FocusTimer`, plus
4 idle-deferred background hooks.

Pass 2 (this doc) adds: `FilePreview` nested splits — `HtmlPreview`,
`PdfPreview`, `DocxPreview`, `XmlPreview`, `SqlSchemaPreview` are now
each their own chunk. The FileTree was inspected and **not** virtualized
(see "Skipped" below). The git log is already paginated (`logCount: 20`)
so it doesn't need virtualization either.

---

## Bundle size — current state

### Entrypoint chunks (loaded on first paint)

| Chunk                | Size (bytes) | Size (KiB) |
| -------------------- | ------------ | ---------- |
| `vendors.bundle.js`  | 463 016      | 452.2      |
| `codemirror.bundle.js` | 455 799    | 445.1      |
| `xterm.bundle.js`    | 289 898      | 283.1      |
| `main.bundle.js`     | 290 789      | 283.9      |
| `styles.css`         | 109 726      | 107.2      |
| **Entrypoint total** | **1 609 228** | **1 571.5** (≈ 1.53 MiB) |

Webpack reports this as: `Entrypoint main 1.53 MiB`.

### Pass 2 deltas (vs end of pass 1)

| Metric              | Pass 1 end | Pass 2 end | Δ        |
| ------------------- | ---------- | ---------- | -------- |
| `main.bundle.js`    | 304 KiB    | 284 KiB    | **-20 KiB** |
| Entrypoint total    | 1.56 MiB   | 1.53 MiB   | -32 KiB  |
| Chunk count (`*.js`) | 87         | 92         | +5 (preview-*) |

### New chunks created in pass 2

| Chunk                   | Size (bytes) | Notes |
| ----------------------- | ------------ | ----- |
| `preview-html.chunk.js` | 3 270        | Loaded only when user opens .html / .htm |
| `preview-pdf.chunk.js`  | 2 013        | .pdf files |
| `preview-docx.chunk.js` | 2 965        | .docx (the heavy mammoth dep is already in `mammoth.chunk.js`) |
| `preview-xml.chunk.js`  | 4 334        | .xml files |
| `preview-sql.chunk.js`  | 10 542       | .sql schema viewer |

These five chunks total 23 KiB but never load on first paint, so the
saving is the full 23 KiB for any user who never opens those file
types — the typical case.

### Top 10 chunks by size

| Rank | Chunk                  | Size (bytes) | Loaded eagerly? |
| ---- | ---------------------- | ------------ | --------------- |
| 1    | `mammoth.chunk.js`     | 492 409      | No — async only when DocxPreview mounts |
| 2    | `vendors.bundle.js`    | 463 016      | Yes (entrypoint) |
| 3    | `codemirror.bundle.js` | 455 799      | Yes (entrypoint) |
| 4    | `xterm.bundle.js`      | 289 898      | Yes (entrypoint) |
| 5    | `main.bundle.js`       | 290 789      | Yes (entrypoint) |
| 6    | `cmpl-python.chunk.js` | 240 607      | No — async, loaded when a .py file is opened |
| 7    | `cmpl-jsts.chunk.js`   | 240 507      | No — async, .js / .ts |
| 8    | `cmpl-go.chunk.js`     | 171 819      | No — async, .go |
| 9    | `cmpl-rust.chunk.js`   | 168 827      | No — async, .rs |
| 10   | `cmpl-csharp.chunk.js` | 164 489      | No — async, .cs |

Most of the heavy chunks past rank 5 are language autocompletion
parsers. They're already lazy-loaded per file extension — see
`webpack.config.js` cacheGroup config and `src/utils/completions/*.js`
dynamic imports.

### Build performance

* `webpack --mode production`: ~110 s on this dev machine.
* No bundle-size errors. The webpack `Entrypoint main [big]` warning is
  expected: the 500 KiB threshold in `performance.maxEntrypointSize`
  was set conservatively when the entrypoint was much smaller. After
  pass 2 the entry is 1.53 MiB — bumping that threshold to ~1.7 MiB
  (or removing it for now) is reasonable, but out of scope for this pass.
* No runtime errors. `webpack 5.106.2 compiled successfully`.

---

## How to reproduce

From a clean checkout with `npm install` already done:

```bash
# Production bundle (the numbers in this doc)
npm run build

# Then look at:
ls -la dist/*.js dist/*.css
```

Sort by size:

```bash
du -b dist/*.js dist/*.css | sort -rn | head -25
```

Total entrypoint size:

```bash
du -bc dist/main.bundle.js dist/codemirror.bundle.js \
       dist/xterm.bundle.js dist/vendors.bundle.js \
       dist/styles.css | tail -1
```

The webpack output line `Entrypoint main` reports the same number in MiB.

### Webpack dev server (frontend hot reload)

```bash
npm run dev          # webpack-dev-server on :3000
```

Useful for measuring HMR perf, not bundle perf.

### Tauri dev (full app boot)

```bash
npm run tauri:dev    # builds Rust + boots the app window
```

This is the only way to measure cold-start and RAM (see "Runtime
metrics — to capture" below). It is NOT runnable from a build-time
agent: it spawns a desktop window, blocks on Rust compilation
(several minutes on first run), and captures GUI metrics that have to
come from the running binary. Capture these on a real workstation,
ideally with the Performance HUD (`Ctrl+Shift+P`) open.

---

## Runtime metrics — to capture (manual)

These can only be measured from the actual running binary. Plug them in
once you have a release build:

| Metric                                     | Target | How to measure |
| ------------------------------------------ | ------ | -------------- |
| Time to first paint                        | < 1.5 s | DevTools → Performance |
| Time to welcome tab interactive            | < 2.5 s | Performance HUD `firstInteractive` |
| Idle RAM (5 min, 1 project open, no edits) | < 250 MB | Task Manager / `tauri-app.exe` |
| RAM during typing in a 2 000-line file     | < 350 MB | Same |
| RAM during git heatmap on a 5 000-file repo | < 400 MB | Same |

Targets come from `docs/V2.2_SHIP_PLAN.md` Phase C1 ("cold startup
under 2.5 s, idle RAM under 250 MB").

---

## What this pass deliberately did NOT change

* **FileTree (`src/components/FileTree.jsx`)** — recursive tree, where
  only currently-expanded directories actually render `<TreeNode>`
  children. By default the root expands at depth 0 and every child
  starts collapsed, so the visible-row count is small for typical use.
  Virtualizing a recursive tree without flattening the data shape would
  be a non-trivial rewrite (well over what pass 2 should risk), and the
  per-task spec says "skip if the tree is already self-windowed". The
  one pathological case — the user types into the quick filter and
  every match auto-expands — is rare and bounded by the filter result
  set. Re-evaluate if profiling on a large repo (> 50k files) shows it
  regress.
* **Git log (`src/components/GitPanel.jsx`)** — already paginated to
  20 commits via the `logCount: 20` argument on the `git.summary` IPC
  call. The list never grows past 20 rows, so there's nothing to
  virtualize. If pagination is ever extended we should revisit.
* **Editor / completions / LSP** — out of scope per the task.

---

## Suggested next perf passes (later)

Stack-ranked roughly by ROI:

1. **Tree-shake `lucide-react`** — every icon import is a separate ESM
   module already, but verify webpack actually strips the unused ones
   from `vendors.bundle.js`. Audit with `webpack-bundle-analyzer`.
2. **Split `xterm` to async** — terminal isn't visible at first paint
   for many users. Wrapping `Terminal.jsx` in `React.lazy` would cut
   ≈ 283 KiB off the entrypoint.
3. **Split `codemirror` extensions** — currently bundled together;
   the language parsers are already async, but the core extensions
   (search, lint, autocomplete, view) are fused into one 445 KiB
   bundle. Could become two: `codemirror-core` + `codemirror-extras`.
4. **Bump `performance.maxEntrypointSize`** in `webpack.config.js` to
   stop emitting the `[big]` warning (or set realistic numbers).
5. **Audit `vendors.bundle.js`** — 463 KiB is heavy. Probably contains
   `react-markdown` + `react-syntax-highlighter` + `react-colorful`,
   none of which need to be in the entrypoint.

Each of these is its own change; do not bundle them.

---

## Pass 4 — 2026-05-08

Targets the two suggestions above that were still unaddressed after passes
1–3: vendors-bundle audit and lucide-react tree-shake verification.

### Bundle size — current state

| Chunk                  | Size (bytes) | Size (KiB) |
| ---------------------- | ------------ | ---------- |
| `vendors.bundle.js`    | 185 335      | 181.0      |
| `codemirror.bundle.js` | 423 182      | 413.3      |
| `main.bundle.js`       | 292 748      | 285.9      |
| `styles.css`           | 103 995      | 101.6      |
| **Entrypoint total**   | **1 005 260** | **981.7** (≈ 0.96 MiB) |

Webpack reports this as: `Entrypoint main 982 KiB`.

### Pass 4 deltas (vs end of pass 3)

| Metric                | Pass 3 end | Pass 4 end | Δ            |
| --------------------- | ---------- | ---------- | ------------ |
| `vendors.bundle.js`   | 250 KiB    | 181 KiB    | **-69 KiB (-27%)** |
| `codemirror.bundle.js` | 426 KiB   | 413 KiB    | -13 KiB     |
| `main.bundle.js`      | 285 KiB    | 286 KiB    | +0.6 KiB (effectively flat) |
| Entrypoint total      | 1.04 MiB   | 0.96 MiB   | **-83 KiB**       |

### Top vendors contributors before pass 4 (decisions taken)

Parsed sizes (unminified) from `webpack --json`. Decisions log:

| #  | Module                                  | Bytes  | Decision |
| -- | --------------------------------------- | -----: | -------- |
| 1  | `react-dom/cjs/react-dom.production.min.js` | 131 685 | Keep — eager runtime |
| 2  | `spotify-web-api-js/src/spotify-web-api.js` |  96 016 | **Lazy** — split to `spotify-api.chunk.js` |
| 3  | `@lezer/common/dist/index.js`           |  83 319 | **Move** to `codemirror.bundle.js` (CodeMirror runtime dep) |
| 4  | `@tauri-apps/api/window.js` (+2)        |  80 661 | Keep — eager (loricaBridge) |
| 5  | `@tauri-apps/api/window.cjs`            |  67 856 | **Remove** — duplicate of `window.js`, only loaded because `useSpotify` used `require()` |
| 6  | `lucide-react` (99 icons in vendors)    |  46 246 | Keep — already optimal (per-icon ESM, see lucide-react audit below) |
| 7  | `@lezer/highlight/dist/index.js`        |  29 915 | **Move** to `codemirror.bundle.js` |
| 8  | `@tauri-apps/plugin-shell` (CJS)        |  15 393 | **Remove** — duplicate, same fix as #5 |
| 9  | `@tauri-apps/api/core.js` (+1)          |  12 877 | Keep — eager |
| 10 | `@tauri-apps/api/core.cjs`              |  11 170 | **Remove** — duplicate, same fix as #5 |
| 11 | `@tauri-apps/api/dpi.cjs`               |  10 984 | **Remove** — duplicate, same fix as #5 |
| 12 | `@tauri-apps/plugin-http`               |   7 011 | Keep — used by many eager utils |
| 13 | `style-mod`                             |   6 935 | **Move** to `codemirror.bundle.js` |
| 14 | `react/cjs/react.production.min.js`     |   6 930 | Keep — eager runtime |
| 15 | `@tauri-apps/plugin-dialog`             |   6 807 | Keep — eager (loricaBridge) |

Two attack surfaces accounted for the bulk of the win:

1. **Tauri ESM/CJS duplication.** `src/hooks/useSpotify.js` was using
   `require('@tauri-apps/api/event')` etc. inside an `if (window.__TAURI__)`
   guard. Webpack treated the `require(...)` as CommonJS and resolved to
   `*.cjs`, but the rest of the codebase imports the same modules with the
   ESM `*.js` paths. Both copies ended up in `vendors.bundle.js`. Pass 4
   converts those to dynamic ESM `import()` calls so a) the same copy that
   loricaBridge already loads is shared, and b) the Tauri plugin-shell
   binding moves to a tiny `spotify-tauri.chunk.js` that only loads when
   the user clicks "Connect Spotify". Combined CJS bytes removed ≈ 105 KiB
   parsed, ≈ 35 KiB minified.

2. **`spotify-web-api-js` was eagerly imported.** The hook was constructed
   at module-eval time (`const spotifyApi = new SpotifyWebApi();`) so the
   library landed in the entrypoint even for users who never log into
   Spotify. Pass 4 lazy-loads the constructor inside an internal
   `loadSpotifyApi()` helper that the play/pause/next/prev/poll handlers
   await. The hook itself still mounts on first render so the MenuBar
   "Connect Spotify" pill renders without flicker; only the API wrapper
   defers. Saves 96 KiB parsed, ≈ 12 KiB minified once gzipped (the lib
   is now in `spotify-api.chunk.js`, 12 KiB minified, 11.8 KiB on disk).

### lucide-react tree-shake — verified, no change needed

Local `lucide-react` is `0.263.1`. `package.json` declares `"sideEffects":
false` and per-icon ESM modules at `dist/esm/icons/<name>.mjs`. Webpack
pulls only the named icons each file imports. Stats confirm: 99 icons in
`vendors.bundle.js` totalling 46 KiB parsed, average ≈ 470 bytes per
icon. The other ~1 100 icons in the package are listed as `chunks: []`
(orphan / tree-shaken). No code change required.

### Webpack splitChunks config changes

Two changes in `webpack.config.js`:

1. The `codemirror` cacheGroup now also matches `@lezer/*`, `style-mod`,
   `crelt`, `w3c-keyname`, and `@marijn/find-cluster-break` — every
   transitive runtime dep CodeMirror reaches synchronously. With
   `chunks: 'initial'` the rule still excludes async-only deps (e.g.
   `@lezer/markdown`, only loaded by the markdown viewer), so they keep
   their existing async chunks.
2. New `spotifyApi` cacheGroup splits `spotify-web-api-js` into a single
   `spotify-api.chunk.js` async chunk (instead of being co-bundled with
   whichever caller first reaches it).

### New chunks created in pass 4

| Chunk                    | Size (bytes) | Notes |
| ------------------------ | -----------: | ----- |
| `spotify-api.chunk.js`   | 12 038       | Loaded only after first Spotify API call |
| `spotify-tauri.chunk.js` |  2 306       | Tauri ESM bindings, loaded with the API or at connect time |

Both are 0 bytes for any signed-out user.

### Build status

`webpack 5.106.2 compiled successfully`. No new warnings. The pre-existing
`Entrypoint main [big]` warning shrank but didn't disappear (the 500 KiB
threshold in `performance.maxEntrypointSize` is still under-tuned versus
our 982 KiB reality). Bumping that threshold remains a follow-up; it has
no bundle-size impact.

### Suggested next perf passes (later)

Most of the original list is now done. What's left:

1. **Split `codemirror` extensions** — still 413 KiB at first paint. Core
   editor (state + view) is irreducible, but we could lazy-load `search`,
   `lint`, and `autocomplete` extensions until the user actually opens a
   panel that uses them.
2. **Bump `performance.maxEntrypointSize`** in `webpack.config.js` to
   1 MiB or so to stop the `[big]` warning.
3. **Drop `spotify-web-api-js`** entirely — the hook only uses 5 calls
   (`getMyCurrentPlayingTrack`, `play`, `pause`, `skipToNext`,
   `skipToPrevious`, `setAccessToken`). They're plain `fetch` calls; a
   ~30-line in-house wrapper would replace the 96 KiB lib. That's a
   v2.4-class change though — out of scope for this pass.

