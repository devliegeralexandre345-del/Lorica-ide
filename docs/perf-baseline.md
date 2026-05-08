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
