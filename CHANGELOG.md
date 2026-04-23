# Changelog

All notable changes to Lorica IDE. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
