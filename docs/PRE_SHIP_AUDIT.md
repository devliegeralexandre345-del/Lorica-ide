# Pre-ship audit — v2.2.0

_Run 2026-04-25. Re-run before tagging if any code changes._

Auditor: read-only pass. No code changes applied. Fixes are described
inline so a follow-up agent can land them.

## 1. Version pinning

All four version anchors agree on `2.2.0`. No drift detected.

- [x] `package.json` → `2.2.0` (line 3)
- [x] `src-tauri/tauri.conf.json` → `2.2.0` (line 4)
- [x] `src-tauri/Cargo.toml` (root crate) → `2.2.0` (line 3)
- [x] `src/version.js` → `APP_VERSION = '2.2.0'` (line 3)
- [x] StatusBar / Settings / WelcomeTab / ReleaseNotes / useReleaseNotes all import from `src/version.js` — no hardcoded `2.x.x` strings remain in shippable code.
- [x] `tauri.conf.json` `productName: "Lorica"` and `identifier: "com.lorica.app"` match expectations.

Result: **PASS**.

## 2. Build

### `npm run build` — PASS
- Exit: success (`webpack 5.106.2 compiled successfully in 100594 ms`).
- Total wall time: ~100 s.
- Warnings: `Entrypoint main [big] 1.56 MiB` — webpack performance hint, not a real warning. Main JS chunks fall within expected envelope.
- Top 10 emitted assets by size (from `dist/`):

| File | Size |
|---|---|
| `mammoth.chunk.js` | 481 KiB |
| `vendors.bundle.js` | 452 KiB |
| `codemirror.bundle.js` | 445 KiB |
| `main.bundle.js` | **284 KiB** (304 KiB pre-gzip per webpack stats) |
| `xterm.bundle.js` | 283 KiB |
| `cmpl-python.chunk.js` | 235 KiB |
| `cmpl-jsts.chunk.js` | 235 KiB |
| `cmpl-go.chunk.js` | 168 KiB |
| `cmpl-rust.chunk.js` | 165 KiB |
| `cmpl-csharp.chunk.js` | 161 KiB |

Note: `main.bundle.js` on disk is 290,789 bytes ≈ 284 KiB. Webpack stats line reports `304 KiB` (pre-min/gzip accounting). Marketing claim "~304 KiB main bundle" matches the webpack-reported figure used in CHANGELOG / RELEASE_NOTES.

### `cargo check` — PASS with 1 warning
- Exit code 0. Wall time `11m 29s` (cold cache).
- Warnings: **1**
  - `src/extensions.rs:640:9` — `unused variable: filename` (suggests prefixing with `_filename`).
  - Non-blocking. Either rename to `_filename` or use the variable. Trivial follow-up; not a ship blocker.

Result: **PASS**.

## 3. Doc consistency

Cross-check of marketing claims across `README.md`, `CHANGELOG.md`,
`docs/RELEASE_NOTES_v2.2.md`, `docs/LAUNCH_POSTS.md`.

| Claim | README | CHANGELOG | RELEASE_NOTES_v2.2 | LAUNCH_POSTS |
|---|---|---|---|---|
| Autocomplete entries | **~52,000 / ~52k** | **~52,000 / ~52k** | **~52,000** | **~49k** ⚠ |
| Languages | 30 | 30 | 30 | 30 |
| Main bundle size | **~304 KiB** | **~304 KiB / under 310 KiB** | **~304 KiB / under 310 KiB** | **~320 KiB / 315 KiB (title)** ⚠ |
| LSP servers | 10 | 10 | 10 | 10 |
| Themes | Six (6) | (implied via list) | 6 | Six (listed as 6) |
| Idle RAM | not stated | not stated | not stated | ~180 MB |

### Drift findings

**BLOCKER 1 — `docs/LAUNCH_POSTS.md` numbers are stale (v2.1-era values).**
This is the file you'll paste into Show HN / r/rust. Numbers MUST match the README the readers will click through to, or commenters will dunk on you.

- Line 32 (HN title): `315 KiB main bundle` → should be `304 KiB`.
- Line 54 (HN body): `~320 KiB` → `~304 KiB`.
- Line 60 (HN body): `~49k autocomplete entries` → `~52k`.
- Line 139 (r/rust body): `~320 KiB` → `~304 KiB`.

Fix: pure text edit, no code.

**BLOCKER 2 — `docs/RELEASE_NOTES_v2.2.md` line 136 anchor is stale.**
- The link `CHANGELOG.md#220--2026-04-20` points at date `2026-04-20`.
- Actual CHANGELOG header (line 6) is `## [2.2.0] — 2026-04-25`. GitHub generates the anchor from the date, so this anchor is broken.
- Fix: change to `#220--2026-04-25`.

**Minor — `docs/V2.3_ROADMAP.md` line 76** mentions a 320 KiB threshold ("`size-limit`...past 320 KiB"). That's an aspirational ceiling for v2.3, not a current-bundle claim, so it's defensible — flag only because the number 320 also appears (incorrectly) in LAUNCH_POSTS.

**OK — `RELEASE_NOTES_v2.2.md` line 12 says "main bundle stays under 310 KiB".** True (304 < 310). Consistent with README.

## 4. Repo cleanliness

### Glob sweep
- `**/*.bak`: none
- `**/*.old`: none
- `**/*.legacy.js`: none
- `**/*.tmp`: none
- `**/.DS_Store`: none
- `**/Thumbs.db`: none

### `.gitignore` coverage
- [x] `node_modules/`
- [x] `dist/`
- [x] `src-tauri/target/`
- [x] OS junk: `.DS_Store`, `Thumbs.db`, `*.swp`, `*.swo`
- [x] `.vscode/`, `.idea/`
- [x] `*.bak`, `*.backup`, `*.log`
- [ ] **MISSING — `.lorica/`**. The brain panel and project-local data write here. Not currently present in this repo, but if it ever gets created during dev (running the IDE on its own source), it'd land in git. Recommend adding `.lorica/` to `.gitignore` defensively.

### `git status`
**Working tree is dirty** with the v2.2 cleanup-in-progress changes. Listed for transparency:

```
M  CHANGELOG.md            (intentional — v2.2 entry)
 M README.md
 M docs/LAUNCH_POSTS.md     (NEEDS the number fixes above before commit)
 M docs/RELEASE_NOTES_v2.2.md (NEEDS anchor fix above before commit)
 M package-lock.json
 M package.json
 M src-tauri/src/extensions.rs
 M src-tauri/src/git.rs
M  src/App.jsx              (perf: lazy-load fixes)
 M src/components/{ClipboardHistory,CommandPalette,Editor,
                   ExtensionManager,FilePalette,FilePreview,
                   GlobalSearch,Omnibar,PerformanceHUD}.jsx
M  src/components/StatusBar.jsx
 M src/components/WelcomeTab.jsx
 M src/hooks/{useAgent,useAgentSessionPersistence,useClipboardHistory,
              useGlobalErrorHandler,useReleaseNotes}.js
 M src/styles/globals.css
 M src/utils/completions/{crystal,haskell,nim,ocaml,zig}.js
?? src/utils/aiLatency.js   (new file from perf split, intentional)
```

All of these match the recent perf / lazy-load commits in flight. Ship-blocker: nothing here looks like accidental WIP, but **commit them before tagging v2.2.0** so the tag reflects shipped state.

### Stray debug strings in shippable files
Scanned: `src/App.jsx`, `src/index.jsx`, `src/components/Editor.jsx`,
`src/components/StatusBar.jsx`, `src-tauri/src/lib.rs`,
`src-tauri/src/main.rs`. Pattern: `console.log`, `dbg!`, `TODO`, `FIXME`, `XXX`, `println!(`.

Result: **clean** — no stray debug logs or unfinished-work markers in any of the audited files. Existing commented-out code uses `//` block comments, not debug print statements.

## 5. Link validation

GitHub user/repo path is consistently `devliegeralexandre345-del/Lorica-ide` across all four marketing/doc files (12 occurrences total in README + RELEASE_NOTES + LAUNCH_POSTS). No alternate user names like `devliegeralexandre/...` slipped in.

Anchor links inspected:
- `README.md` → `[`docs/V2.2_SHIP_PLAN.md`](./docs/V2.2_SHIP_PLAN.md)` — relative path, file exists per `Glob` earlier.
- `README.md` → `(./LICENSE)`, `(./PRIVACY.md)`, `(./SECURITY.md)` — all present at repo root.
- `RELEASE_NOTES_v2.2.md` → `CHANGELOG.md#220--2026-04-20` — **BROKEN** (see §3 BLOCKER 2). Date in CHANGELOG is `2026-04-25`; the anchor must match.

All other `https://github.com/...` URLs follow the canonical form `https://github.com/devliegeralexandre345-del/Lorica-ide/{releases,blob/main}/...` — no typos.

## 6. License + legal

- [x] `LICENSE` at repo root, **MIT License**, copyright `(c) 2025-2026 Lorica IDE contributors` — matches README §License.
- [x] README badge says `License: MIT`.
- [ ] **MINOR — `package.json` is missing the `license` field.** Convention is `"license": "MIT"`. npm doesn't require it for `private: true` packages, but tooling (Snyk, license-scanners, registries that scrape package.json) and downstream IDE integrations expect it. Recommend adding `"license": "MIT"` after the `description` line.
- [x] `src-tauri/Cargo.toml` describes `lorica` crate. **MINOR — Cargo.toml is missing a `license = "MIT"` field too.** Same recommendation: add for consistency. Not a ship blocker because the crate isn't published to crates.io (`private`-style — no `publish = false` either, so a manual `cargo publish` would currently succeed without a license declared, which would be sloppy). Add `license = "MIT"` under `description` in `[package]`.

### Icons spot-check
`src-tauri/icons/` contains:
- `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.png`, `logo.svg`

All standard Tauri-bundle sizes plus the project's own logo SVG. CHANGELOG §Branding describes the logo as a custom 5-bar zigzag built for v2.2 — consistent with the file present. No unexpected third-party assets in the icons folder.

## 7. .git hygiene

### Last 10 commits

```
bc0f04a bump v2.2 fix
faa230c Setup SignPath Foundation application prep
aaaf49e perf(bundle): drop 1.3 MB from first paint via PrismLight and smarter chunking
6876acc perf(bundle): lazy-load modals and side-panels for a lighter first paint
fc5669d feat(git): AI-powered PR descriptions from branch context
36d823d feat(agent): give the agent a semantic_search tool over the embedding index
b7b0f2c feat(semantic): LLM re-rank layer on top of cosine search
2dc26d8 feat(semantic): auto-reindex on file changes via debounced watcher
cbabe60 fix(updater): correct GitHub repo URL and harden the update flow
645af31 chore(polish): go-to-line for search hits + semantic gitignore + cleanup
```

- No `wip`, `tmp`, `XXX`, or `[skip ci]` messages. Conventional-commit prefixes consistent.
- `bc0f04a "bump v2.2 fix"` is a bit terse — not embarrassing on its own, but consider whether a final `chore(release): v2.2.0` commit message makes the tag history read more cleanly. Optional.
- Last commit author: `Alexandre Devlieger <devliegeralexandre345@gmail.com>` — matches the GitHub username path used in URLs (`devliegeralexandre345-del`). Identity is consistent.

Result: **PASS** with cosmetic note above.

## Doc consistency table summary (claims that ship to users)

| Number | Authoritative source | Spread elsewhere | Action |
|---|---|---|---|
| ~52,000 / ~52k autocomplete entries | README, CHANGELOG, RELEASE_NOTES | `LAUNCH_POSTS.md` says ~49k | Fix LAUNCH_POSTS |
| 30 languages | All four | All four | OK |
| ~304 KiB main bundle | README, CHANGELOG, RELEASE_NOTES, webpack stats | `LAUNCH_POSTS.md` says ~320 KiB / 315 KiB | Fix LAUNCH_POSTS |
| 10 LSP servers | All four | All four | OK |
| 6 themes | All four | All four | OK |
| Idle RAM ~180 MB | LAUNCH_POSTS only | (not in README) | OK if accurate; consider removing or moving to README so it's defensible against challenge |

## Sign-off

- [ ] All checks pass — ship clear.
- [x] **3 issues blocking ship** (numbers + 1 cosmetic):
  1. `docs/LAUNCH_POSTS.md` — stale numbers (`~49k` → `~52k`, `~320 KiB / 315 KiB` → `~304 KiB`) on lines 32, 54, 60, 139.
  2. `docs/RELEASE_NOTES_v2.2.md:136` — broken changelog anchor `#220--2026-04-20` should be `#220--2026-04-25`.
  3. **Working tree must be committed** before tagging v2.2.0 — currently 31 modified files + 1 untracked.
- [ ] **3 minor follow-ups (recommended, not blocking):**
  1. `src-tauri/src/extensions.rs:640` unused-variable warning — prefix with `_filename`.
  2. Add `"license": "MIT"` to `package.json`.
  3. Add `license = "MIT"` to `src-tauri/Cargo.toml [package]`.
  4. Add `.lorica/` to `.gitignore` defensively.

Once items 1-3 from the blocker list land, this audit can be re-run and signed off.
