# Changelog

All notable changes to Lorica IDE. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Waves 6-12

Wave 12 (2026-05-09 night) is the polish round that closes the
Wave 11 loose ends — annotations get their inline gutter UX, the
themes catalog grows from 10 to 13, and Ollama wires through the
inline-completion / commit-message / PR-description paths so the
"local mode" promise from Wave 11.1 is actually true everywhere a
user expects it.

### Added — Wave 12.1 (Annotations gutter)

- **Inline coloured gutter dots** for every line that has a sticky
  note. Multi-annotation lines stack up to 3 dots + a `+N` chip.
- **Right-click any gutter line → add annotation** via
  `AddAnnotationPrompt` (small inline modal with Ctrl/Cmd+Enter to
  save). Pinned annotations get a thin ring so they stand out.
- **Click a dot → focus the AnnotationsPanel** so the user can edit
  the note's text + colour.
- New extension: `src/extensions/annotationsGutter.js`. Loosely
  coupled to the hook via window events
  (`lorica:addAnnotation`, `lorica:focusAnnotation`).
- New command: `Add annotation here` in the Command Palette.

### Added — Wave 12.2 (3 new themes)

Total themes 10 → **13**. Each declares a 5-stop `logoBars` palette
so the in-app logo recolours.

- **Tokyo Night** (`tokyoNight`) — purple/cyan tones, currently the
  most-asked-for theme on community channels.
- **Dracula** (`dracula`) — the classic. Pink/cyan/green logo bars.
- **Rosé Pine** (`rosePine`) — warm pastel, most popular among
  designer-leaning developers.

### Added — Wave 12.3 (Ollama everywhere)

Refactored the lighter AI call sites to route through
`src/utils/aiProviders.js` so the local-LLM path works in more places:

- **`aiCommitMessage.js`** — Ollama support for AI-generated commit
  messages from staged diffs.
- **`aiInlineComplete.js`** — Ollama support for inline ghost-text
  completion. Editor.jsx now threads `aiOllamaUrl` + `aiOllamaModel`
  props through; split-view editors get the same.
- **`aiPrDescription.js`** — Ollama support for AI-generated PR
  descriptions.

GitPanel + PrDescriptionModal now pass `ollamaBaseUrl` + `model`
through to the generators. `isKeyless(provider)` is the new gate that
skips the API-key check for Ollama everywhere it's used.

Still queued for Wave 13 (lower-priority sites): SnippetPalette,
AgentSwarmPanel, AutoFixModal, GlobalSearch (semantic re-rank),
ProjectBrainPanel, SandboxPanel, TimeScrubBar, plus a handful of
utility modules (~12 sites total).

### Bundle impact (Wave 12)

- `main.bundle.js`: 303 → **312 KiB** (+9 KiB for annotations gutter
  + Ollama threading + 3 new themes).
- `vendors.bundle.js`: 186 KiB (unchanged).
- `codemirror.bundle.js`: 413 KiB (unchanged).
- Total entrypoint: ~1.02 MiB.

## [Unreleased] — Waves 6-11

Wave 11 ("Futuristic IDE", 2026-05-09) lands the medium-tier features
that take Lorica from "AI-augmented editor" to a privacy-first IDE
with offline AI, cross-language paste, sticky-note collab, and
peer-to-peer Live Share. ~+18 KiB main bundle for all of it (Yjs is
lazy — never enters the entrypoint).

### Added — Wave 11.1 (Ollama / local LLM)

- **3rd AI provider option**: `Ollama (local)` joins Anthropic and
  DeepSeek in Settings. Zero network egress — all requests stay on
  the user's machine via the OpenAI-compatible Ollama endpoint
  (default `http://localhost:11434`).
- **Auto model probing**: Settings queries `/api/tags` to list
  installed models with sizes; the user picks via a dropdown instead
  of typing model names by hand.
- **Centralised provider config** (`src/utils/aiProviders.js`):
  `PROVIDERS`, `getEndpoint`, `getHeaders`, `buildChatBody`,
  `extractText`, `isKeyless`, `supportsTools`, `listOllamaModels`,
  `resolveModel`, `resolveOllamaBase`. Replaces the URL constants
  scattered across ~10 files.
- **Agent-loop wiring** for Ollama (tool calls + streaming via the
  existing OpenAI-compatible code path, dual fallback on stream
  failure). CSP + Tauri capability allow-lists updated for
  `http://localhost:*` and `http://127.0.0.1:*`.

### Added — Wave 11.3 (AI Smart Paste)

- **Cross-language clipboard translation**: copy a Python helper from
  Stack Overflow, paste it into a Rust file, get idiomatic Rust.
  Heuristic detector (10 languages: Python, JS, TS, Rust, Go, Java,
  C#, C++, SQL, Bash) decides the source; the active file's extension
  decides the target.
- **Side-by-side preview modal** (`SmartPasteModal`) — clipboard on
  the left, AI translation on the right, "Insert at cursor" button
  drops the result via a `lorica:insertAtCursor` window event +
  `smartInsert` CodeMirror extension. No Editor.jsx internals
  touched.
- Available from the command palette (`Smart Paste (translate
  clipboard with AI)`) and the dock.

### Added — Wave 11.4 (Spatial annotations)

- **Sticky-note system** anchored to `(file, line)` pairs, persisted
  to `.lorica/annotations.json` so they travel with the repo if the
  user wants to commit them.
- **5 colour variants** (amber, blue, rose, emerald, violet) +
  per-note `pinned` flag + author attribution.
- **`AnnotationsPanel`** modal browses every annotation in the
  project with search / colour filter / inline edit; click any row to
  open the file. Hook (`useAnnotations`) handles load on project
  change + debounced 400 ms save on edits.

### Added — Wave 11.5 (Live Share alpha)

- **Peer-to-peer collaboration** via Yjs + y-webrtc. No Lorica server
  involved — signaling routes through public Yjs servers, the
  editor traffic is direct WebRTC between peers. Room id is the
  shared secret; users start a session and copy the id to invite.
- **v0 scope: awareness only** — peers see each other's display
  name, active file, cursor row/col. Full text sync via
  `y-codemirror.next` is queued for v1 (would otherwise risk losing
  user edits when the document diverges).
- **`CollabPanel`** UI for start/join/stop, peer list with coloured
  presence dots and live cursor positions.
- **Cursor beacon extension** (`cursorBeacon`) emits throttled
  selection-change events (~80 ms) gated on
  `window.__loricaCollabActive` — zero overhead when no session is
  live.

### Added — tests

- `aiSmartPaste.test.js` — 17 cases covering language detection,
  alias normalisation, fence stripping.
- `annotations.test.js` — 12 cases covering id generation, defaults,
  path normalisation, file grouping.
- `aiProviders.test.js` — 23 cases pinning every provider's URL,
  headers, body shape, response extraction, predicate behaviour.
- **+52 cases total** vs. Wave 10 (was 81; now **133 across 10
  files**, 1.7 s wall clock).

### New dependencies

- `yjs ^13.6.30` — CRDT engine for Live Share. Lazy-loaded; never
  in the entrypoint.
- `y-webrtc ^10.3.0` — WebRTC transport for Yjs. Lazy-loaded.
- (devDep) `vitest` was already added in Wave 7.

### Bundle impact

- `main.bundle.js`: 287 → **303 KiB** (+18 KiB for Wave 11 wiring:
  new Settings UI, hooks, dispatchers, extensions, dock + palette
  entries).
- `vendors.bundle.js`: unchanged at 186 KiB (Yjs lazy-loaded into
  its own ~194 KiB chunk that fires only when a Live Share session
  starts).
- New lazy chunks: `smart-paste` 12.6 KiB, `annotations` 5.9 KiB,
  `collab` 7 KiB, `collab-engine` 1.7 KiB.

## [Unreleased] — Waves 6-10

This batch is the v2.3 medium-tier follow-up: floating editor windows, a
standalone git-worktree manager, the v0 Extension API spec, a real test
seed, and three power-user features (voice dictation, dev-container
shell, MCP marketplace) that were queued in `docs/V2.3_ROADMAP.md`'s
medium tier. No version bump — these land on top of v2.3.0.

### Added — Wave 6 (medium-tier features)

- **Floating editor windows** — right-click any tab → "Pop out to
  floating window" spawns an independent Tauri WebviewWindow with a
  read-only CodeMirror viewer. The window watches the same `fs:change`
  events as the main project and auto-refreshes on disk edits. Re-popping
  the same file refocuses the existing window. New Rust command
  `cmd_window_open_floating`; new entry-point split in `index.jsx`
  (FloatingViewer is a `floating-viewer` chunk, not in the main bundle).
- **Standalone Git Worktrees panel** — open from the dock (or via the
  `showWorktrees` panel state). Lists every worktree git knows about
  with branch / dirty count / ahead-behind, and exposes per-row
  Open / Merge / Remove actions. Add new worktree with one input.
  New backend command `cmd_git_worktree_status` (rich variant of the
  existing `_list`).

### Added — Wave 7 (test coverage seed)

- **Vitest** as the test runner (`npm test` / `npm run test:watch`),
  configured for `tests/**/*.test.{js,mjs}` against the source modules.
- **68 tests across 5 files** covering the pure-function code paths
  introduced in Waves 1-3:
  - `aiCoauthor` — provider mapping, trailer formatting, dedup, the
    localStorage-backed `shouldAppendTrailer` recency window.
  - `conflictMarkers` — single conflicts, diff3 ancestor blocks, nested
    blocks, malformed inputs, all three resolve actions.
  - `promptTemplates` — frontmatter parsing (LF/CRLF, quoted values,
    casefolding), `{{selection}}` / `{{file}}` / `{{open_files}}` substitution,
    `buildInstructionsPrefix` shape.
  - `gitGraphLayout` — empty input, linear history, simple merges, octopus
    merges, off-screen parents.
  - `parseDiffNewLineRanges` — single hunk, multi-hunk, deletions,
    file-scoped targeting, `/dev/null` deletion sentinel.

### Added — Wave 8 (medium-tier extras)

- **Voice dictation in the agent input** (Web Speech API) — opt-in
  toggle in Settings → AI. When enabled and the browser exposes
  `SpeechRecognition` (macOS / Edge / Chrome), a mic button appears in
  the AgentCopilot input. Audio is handled by the platform speech
  engine (on-device on macOS, Edge speech on Windows). Hidden entirely
  on Linux WebView2/WebKit2GTK where the API isn't exposed. Permission
  errors are surfaced as toasts.
- **Dev-container shell (read-only first pass)** — Lorica detects
  `.devcontainer/devcontainer.json` (or `.devcontainer.json`) on
  project change and surfaces a "Open in container" badge in the
  status bar. Click it to spawn `docker run -it --rm -v $project:/workspaces/repo …`
  in a fresh terminal session. Build-based and Compose-based configs
  show a tooltip explaining v2.3 limits. New Rust module
  `src-tauri/src/devcontainer.rs` with a small jsonc parser
  (handles `// line` and `/* block */` comments).
- **MCP server marketplace (preview)** — six curated entries in the
  Extensions panel under a new `MCP` category: filesystem, github,
  postgres, slack, puppeteer, fetch. Install runs the upstream `npm`
  / `pip` command; runtime wiring into the agent toolbox is queued for
  v2.4 with a banner that says so.

### Added — Wave 9 (Phase C2 spec)

- **`docs/EXTENSION_API.md`** — v0 (alpha) extension API spec.
  Manifest schema, permission model (`ui.statusBar`, `ui.dock`,
  `ui.commandPalette`, `storage.local`, `storage.settings`,
  `events.editor`, `events.git`), lifecycle (install → enable →
  activate → deactivate → remove), sandboxing model with v0
  enforcement vs. deferred v0.1 enforcement, and the loader
  open-questions list for the v2.4 implementation.
- **`extensions/focus-timer/`** — reference extension translating
  `src/components/FocusTimer.jsx` to the v0 API. Manifest, JS module
  using only the documented surface, icon SVG, and a README explaining
  why Focus Timer was the cleanest extraction candidate. Folder
  ships in-tree so v2.4 can lift it directly when the loader lands.

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
