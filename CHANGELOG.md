# Changelog

All notable changes to Lorica IDE. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] — 2026-05-05

Lorica v2.3 ships ~13 new features (drawn from a competitor scan + a
community pain-point pass), three perf passes that cut first-paint cost
by **33% (1.56 → 1.04 MiB)** while keeping the entire 30-language
autocomplete dictionary intact, +7 LSP servers (10 → 17), +4 themes
(6 → 10), and a new generator pipeline for scaling niche-language
completions to mainstream parity.

### Added

#### Editor & v2.3 features
- **Git status decorations in file tree** — M / A / U / D / R / C / !
  letters next to filenames, theme-aware via `var(--color-*)`. Folders
  containing changes get a subtle dot.
- **AI conflict resolution** — inline toolbar above each `<<<<<<<`
  marker with **Resolve with AI** / Keep ours / Keep theirs / Keep
  both. Clicking AI opens the agent panel pre-loaded with a structured
  OURS/THEIRS prompt + 5 lines of context.
- **Multi-line search & replace** — toggle in both the in-editor
  panel (`Ctrl+F`) and GlobalSearch (`Ctrl+Shift+F`). Backend
  `cmd_search_in_files` extended with `multiline: Option<bool>`.
- **Reusable prompt files & instructions** — `.lorica/instructions.md`
  auto-prepended to the agent system prompt; `.lorica/prompts/*.md`
  with frontmatter appear in the slash menu with a "project" badge.
  Templates support `{{selection}}`, `{{file}}`, `{{open_files}}`.
- **Git graph visualization** — pure-SVG branch / commit topology.
  Lazy-loaded chunk, manual virtualization > 200 commits, octopus
  merge support. Toggle Log / Graph in Git Panel persists in
  localStorage.
- **Staged-changes gutter** — green bars for staged lines, yellow for
  unstaged-modified, gradient for both. Reuses `cmd_git_diff_staged`
  (extended with optional `file_path`).
- **AI co-author commit trailer** — opt-in toggle in Settings → Git.
  Auto-appends `Co-authored-by: Claude <noreply@anthropic.com>` (or
  DeepSeek) when an edit was AI-driven within the last 30 minutes.
  Pure-function `appendTrailer` with case-insensitive dedup.
- **`@diff` / `@branch-diff` agent context mention** — type `@diff` in
  the agent panel to attach the full branch diff vs. main as context.
  Dual payload: model sees the diff, chat history shows a clean
  placeholder. 30 KB cap with friendly warning.

#### Autocomplete UX polish
- **Recency ranking** — per-language LRU 200 in localStorage; recently
  accepted entries float to the top with a bounded boost (max +20,
  decays over 30 days).
- **Fuzzy match on `detail`** — typing `vec` now also surfaces entries
  whose `detail` contains `Vec<T>` (lower-priority than label
  matches).
- **Snippet template insertion** — entries with `${1:placeholder}`
  markers route through `@codemirror/autocomplete`'s `snippet()` for
  tab-stop fields.

#### Niche language autocomplete (new generator pipeline)
- New `scripts/completions-gen/` infrastructure: `EntrySet` helpers
  with dedup + sort + serialize, run via `node
  scripts/completions-gen/build.mjs`.
- haskell, ocaml, zig, nim, crystal expanded from baselines of
  100-150 entries each to **2,000+ each** (zig at 4,744). Total niche
  entries went from 633 → 13,000+.

#### Language Server Protocol
- **+7 new LSP server one-click installers**: Ruby (`solargraph`),
  Bash (`bash-language-server`), Lua (`lua-language-server`), Elixir
  (`elixir-ls`), Dart (built-in to SDK), Kotlin
  (`kotlin-language-server`), Swift (`sourcekit-lsp`). Total: **17
  LSPs**. Toolchain pre-checks emit friendly `XXX_MISSING:` markers.
- **`get_lsp_server()` harmonized** with the registry — all 17 servers
  wired both client-side and registry-side.

#### Themes & branding
- **+4 themes**: Solarized Dark, Solarized Light, Catppuccin Mocha,
  Gruvbox Dark. Total 10 themes. 5-stop `logoBars` per theme for
  the theme-aware logo.

#### Performance push (three passes)
- **Pass 1**: lazy-load completion chunks. Main bundle 989 KiB → 321 KiB.
- **Pass 2**: lazy-load `FilePreview` nested previews
  (Html/Pdf/Docx/Xml/Sql). 321 → 304 KiB.
- **Pass 3**: lazy-load Terminal (xterm out of entrypoint) +
  AgentCopilot + LockScreen. Idle-defer 4 hooks. Boot times
  instrumentation in PerformanceHUD. **304 → 285 KiB**, entrypoint
  total **1.56 → 1.04 MiB (-33%)**.

### Fixed

- **LSP install regression**: 10 original LSP entries (`lsp-python`,
  `lsp-typescript`, `lsp-rust`, `lsp-go`, `lsp-clangd`, `lsp-csharp`,
  `lsp-web`, `lsp-php`, `lsp-sql`, `lsp-java`) had been dropped from
  the Extensions registry. Restored.
- **Install queue regression**: "Queued #N" pills + cancel-X had been
  removed from `ExtensionManager.jsx`. Restored with `queueRef` source
  of truth + sequential `runInstall` recursion.
- **Python LSP install on Windows**: cmd.exe doesn't need quoting for
  `[all]` brackets; previous code re-quoted via Rust's `Command::args`
  producing literal `""..."` that pip rejected.
- **C# auto-bootstrap .NET SDK**: `csharp-ls` install now invokes
  Microsoft's `dotnet-install` script when `dotnet` is missing — no
  admin required, installs to `$HOME/.dotnet`.
- **`find_binary()`** extended to walk `~/.dotnet/tools`, `~/go/bin`,
  `~/.npm-global/bin`, Python user-install Scripts/Library paths.

### Changed
- All version pins (`package.json`, `Cargo.toml`, `tauri.conf.json`,
  `src/version.js`) and download URLs in `README.md` bumped to 2.3.0.

## [2.2.0] — 2026-04-20

Privacy, correctness, and the C++ debugger finally works. This release
closes ~30 real bugs uncovered during a deep audit, adds GDPR-compliant
consent for AI features, and wires up a proper signed-release pipeline
for future code-signing adoption.

### Added

#### Privacy & Security
- **GDPR consent modal** before any AI feature's first call — details
  exactly what data is sent, where, and why. Persisted in `localStorage`
  so accepted users never see it again.
- **PRIVACY.md** at the repo root documenting every data flow
  (local-only storage, AI provider calls, Spotify OAuth, update checks).
- **SECURITY.md** with vulnerability report procedure, SLAs, and a
  cheat-sheet of Lorica's security design.
- **Vault canary verification**: added an Argon2-gated AEAD canary so
  offline brute-force attempts can't bypass KDF via a weaker side channel.
- **Atomic writes** everywhere it matters (vault, semantic index,
  generic file writes) via a shared `atomic_write()` helper. No more
  half-written files if the process dies mid-save.

#### Debugger / Run
- **C++ Run fix**: `-std=c++17` is no longer applied to `.c` files (gcc
  rejected it), source paths are now absolute (previously broke when the
  project root didn't match the source directory), output binary goes to
  a temp directory, and `-pthread` is added on Unix.
- **TypeScript Run**: detects `tsx` or `ts-node` on PATH instead of
  failing with a cryptic SyntaxError from `node foo.ts`. Shows an
  actionable install message when neither is installed.
- **DAP adapter detection**: cross-platform `which`/`where` lookup,
  proper `lldb-dap` / `codelldb` preference for C/C++/Rust, real DAP
  endpoints for Python (`debugpy.adapter`), Go (`dlv dap`), and honest
  "not yet bundled" messages for Java and PHP (the old configs were
  JDWP / Xdebug, not DAP).
- **Actionable error messages** when a DAP adapter or LSP server is
  missing — each includes the exact install command for that language.

#### Git
- **Git author setup flow**: when `user.name` / `user.email` are
  missing, the backend surfaces a `GIT_AUTHOR_MISSING:` prefix and the
  Git panel shows an inline form. Saves globally by default so every
  future repo inherits the identity, then retries the blocked commit.
- `cmd_git_get_author` and `cmd_git_set_author` backend commands.

#### Editor / Autocomplete
- **C/C++ include header completion**: typing `#include <` now suggests
  ~60 C++ stdlib headers and ~40 POSIX C headers, with fallback to the
  keyword list outside of `#include` contexts.
- **Massive stdlib autocomplete expansion** for Python, JavaScript /
  TypeScript, Rust, and Go — roughly 5× more entries than v2.1:
  - Python: full `os.path.*`, `collections.*`, `itertools.*`,
    `functools.*`, `re.*`, `pathlib.Path.*`, `subprocess.*`,
    `threading.*`, `asyncio.*`, `logging.*`, `argparse.*`, `hashlib.*`,
    `datetime.*`, `typing`, and many more stdlib modules.
  - JS/TS: complete `Array.prototype.*`, `String.prototype.*`,
    `RegExp`, `Set`/`Map`, `Intl.*`, `Date.*`, `URL` / `URLSearchParams`,
    `Element.*` / `HTMLFormElement` / `HTMLInputElement`, `FormData`,
    `Blob`, `File`, `FileReader`, `crypto.subtle.*`, `performance.*`,
    `CanvasRenderingContext2D.*`.
  - Rust: `std::mem`, `std::ptr`, `std::io`, `std::fs`, `std::path`,
    `std::process`, `std::thread`, `std::sync` (Arc / Mutex / atomic),
    `std::time`, `std::env`, `std::net`, `std::collections` (BTreeMap /
    VecDeque / …), `std::rc`, `std::cell`, `std::ops`, `std::fmt`.
  - Go: `context`, `encoding/json`, `net/http`, `path/filepath`,
    `regexp`, `sort`, `sync`, `os/exec`, `bytes`, `reflect`,
    `runtime`, `math/rand`, `testing`, `flag`, `log`.

#### Extensions (soft extension system, preview of v2.3)
- **Feature catalog** (`utils/features.js`) — 28 togglable features
  organised in 5 categories (Productivity, AI & Agents, Visualization,
  Diagnostics, Developer tools).
- **Settings → Features grid** — per-feature toggle switches with reset
  to defaults. Disabled features disappear from the Omnibar catalogue.
- **Conservative defaults** — fresh install ships with 11 of 28 features
  on (Focus Timer, Scratchpad, TODO Board, Bookmarks, Clipboard,
  Brain, Instant Preview, Git Blame, Problems, Snippets). Power users
  opt in to the other 17 (Swarm Review, Swarm Dev, PR Ready, Code
  Canvas, Semantic Types, Time Scrub, Heatmap, Performance HUD,
  Agent Builder, Sandbox, Regex Builder, API Tester, Diff Viewer, …).
- v2.3 will convert this into a real dynamic-import extension system
  without breaking the feature ID contract.

#### File watcher
- New `useFileWatcher` hook auto-refreshes the file tree when files
  are created / modified / deleted outside Lorica (git checkout, npm
  install, another editor). Debounced 200 ms to coalesce bursts.
- Backend watcher now filters events inside `node_modules`, `.git`,
  `target`, `dist`, etc. — a single `npm install` used to drown the
  frontend.

#### Updater
- `validate_download_url` pins installer downloads to GitHub + the
  GitHub release CDN, rejecting arbitrary URLs. Prevents a rogue
  frontend from redirecting the updater to a malicious binary.

#### Infrastructure
- `.github/workflows/release.yml` — multi-platform release pipeline
  (Windows MSI, macOS dmg, Linux deb/AppImage) with optional
  Authenticode signing when `WINDOWS_CERT_PFX_BASE64` is configured.
- `docs/V2.2_TEST_CHECKLIST.md` — 90-min manual test walkthrough.
- `docs/V2.2_SHIP_PLAN.md` — phased roadmap (ship / stabilize / v2.3).
- `docs/LAUNCH_POSTS.md` — pre-calibrated Show HN / Reddit templates.

### Changed

- **Tauri async commands** that borrow their inputs (DAP / LSP) now
  return `Result<T, String>` as required by Tauri 2. The inner manager
  methods keep using `CmdResult<T>` for IPC consistency via a
  `.into_result()` bridge.
- **Session persistence** now saves `autoSave`, `autoSaveDelay`,
  `autoLockMinutes`, `heatmapEnabled`, `heatmapRange`, and
  `semanticAutoEnabled` — previously these "reset to default" on
  relaunch.
- **API key storage** in Settings → AI now writes to the encrypted
  vault (`cmd_add_secret`). Keys auto-hydrate into state when the vault
  unlocks, so users no longer need to paste them after every restart.
- **Omnibar** (`Ctrl+P`) width reduced from 640px → 560px, max height
  from 70vh → 55vh, tighter row padding — fits comfortably on 1080p
  laptops.
- **Omnibar no longer requires scrolling by default**. Empty view
  capped at 3 recent files + 3 core commands (was up to 28 rows);
  search mixed-mode capped at 6 files + 2 commands (was up to 24
  rows). Prefix modes (`>` / `@` / `#` / `?`) give generous caps for
  when the user explicitly asks for a bigger list.
- **Semantic search is now triggered by `#` prefix only** — previously
  fired on every keystroke over 3 chars, paying network + embedding
  latency even when the user was just opening a file.
- **Extension card layout** (Extensions manager) refactored so long
  install errors no longer crush the description text into a vertical
  column.
- **Spotify OAuth** now forwards the `state` parameter for CSRF
  defense-in-depth on top of existing PKCE.
- **`open_url` Tauri command** validates scheme (http/https only) and
  normalizes the URL through `Url::parse` before shelling out — blocks
  `file://` and custom-scheme attacks reachable from the frontend.

### Fixed

#### Backend correctness
- **LSP / DAP Content-Length framing**: readers were line-based,
  shredding multi-line JSON bodies. Replaced with header-aware readers
  that parse `Content-Length: N\r\n\r\n` then read exactly `N` bytes.
- **LSP / DAP manager lifetime**: `LspManager::new()` / `DapManager::new()`
  inside each command dropped sessions on every call. Managers now live
  in `AppState`, so sessions survive between commands.
- **DAP writer envelope**: DAP outbound messages now wrap bodies in
  `Content-Length: N\r\n\r\n<body>` instead of the old `<body>\n` that
  debugpy and codelldb ignored.
- **Piece-table bounds** (`buffer.rs`): insert/delete no longer panic
  on out-of-range offsets; `total_len -= length` underflow prevented.
- **`rebuild_line_index`** off-by-one on files ending with `\n`.
- **Watcher Unix-path assumption**: segment filter handles Windows `\`
  paths too.
- **Git commands** using `--` separator on user-provided paths and
  branches (stage, unstage, checkout, blame, worktree add) — prevents
  filenames starting with `-` from being parsed as git flags.
- **`jdtls` LSP config path**: `~/.config/jdtls/config` was passed as a
  literal `~` string to the `Command` spawner, creating a directory
  named `~` in the project. Now resolved via `dirs::config_dir()`.
- **Semantic index dim mismatch**: when a stored index's vector
  dimension differs from the query embedding (model change, corruption),
  `cosine` used to silently truncate and return garbage scores. Now
  errors out asking the user to rebuild.

#### Frontend correctness
- **TimeScrubBar "Rendered more hooks" crash**: `useMemo` was called
  after an early `return null` for files with no active buffer. Moved
  the hook above the early returns so hook count is stable across
  renders.
- **Window Blob URL leak** (sandbox worker, HTML preview) — revoked
  after consumption.
- **File tree auto-refresh**: previously only fired when semantic
  auto-reindex was enabled.
- **Settings persistence**: autoSave, autoLockMinutes, heatmapEnabled,
  etc. now survive relaunch.

#### Security hardening
- **21 `.lock().unwrap()` → `lock_or_recover()`**: a poisoned mutex no
  longer crashes the IDE.
- Removed 2 unwraps on `vault.derived_key` that were safe-in-theory but
  fragile to refactor.

### Removed
- Raw `lldb` fallback in the DAP adapter for C/C++/Rust — it was never
  a DAP server, just an interactive debugger the IDE couldn't
  communicate with. Users get an actionable install hint for `lldb-dap`
  or `codelldb` instead.
- Hardcoded `SIGNPATH` "pending validation" claims from the README —
  SignPath Foundation rejected our v1 application (project too young).
  We'll re-apply after traction. Binaries stay unsigned in the meantime
  with clear SmartScreen workaround instructions.

### Security
- No known vulnerabilities in this release. Issues found during the
  internal audit (key exfiltration via weak password verify, CSRF via
  missing OAuth state, binary-drop via unvalidated update URLs) are all
  fixed above.

---

## [2.1.0] — Previous releases

See git history prior to v2.2 for earlier changes. This file was
introduced in v2.2.
