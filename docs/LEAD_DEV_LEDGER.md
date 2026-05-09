# Lorica IDE — Lead Dev Ledger

_Running log of waves, daily bilans, and prioritization decisions._
_Append-only. Most recent at the top._

## Operating mode

- **Autonomous lead dev**: prioritization picks made from
  `docs/V2.3_ROADMAP.md` (high-value low-effort tier first) +
  `docs/V2.2_SHIP_PLAN.md` (Phase B/C items) without checking in.
- **Waves of 2-3 parallel agents max** to keep token budget healthy
  (lesson from rate-limit hits 2026-05-04/05). Sequential when
  possible.
- **Local fixes preferred over agents** for trivial work
  (one-line patches, build-script runs).
- **Daily bilan** appended below — what shipped, what's queued, current
  bundle / quality numbers.
- **Branching model**:
  - `main` is active dev. I commit per-wave there.
  - `wave-N` snapshot branch created at the commit where Wave N
    completed. User checkouts to test that wave's frozen state.
  - `waves-1-3-snapshot` is special: Waves 1-3 were entangled
    (no per-wave commits made), so a single snapshot covers all of them.
- User intervention requested only for: architectural decisions,
  breaking changes, anything that touches money (signing certs,
  hosted services), tagging / publishing.

## Constraints respected by every wave

- No new npm or cargo dependencies unless explicitly justified in the
  bilan.
- `src/components/Editor.jsx` internals never modified — only extended
  via props / extension array.
- `src/utils/completions/` and `src-tauri/src/lsp.rs` are touched by at
  most one agent per wave to avoid collisions.
- Build must stay green: `npm run build` after every code change.
- Theme-aware via `var(--color-*)` everywhere.

## Roadmap — upcoming waves

### Wave 5 — finishing v2.3 polish (firing now)
- **Agent A**: Nim autocomplete generator to 2k+ (current 883)
- **Agent B**: Crystal autocomplete generator to 2k+ (current 886)
- **Agent C**: Perf pass 4 — vendors bundle audit + lucide-react tree-shake (target: vendors 250 → 180 KiB)
- **Local (no agent)**: CHANGELOG.md v2.3.0 entry + new `docs/RELEASE_NOTES_v2.3.md`

### Wave 6 — V2.3 medium-tier features (queued, fire after W5 + LEDGER bilan)
- Floating / detachable editor windows (Tauri multi-window API)
- Agent worktree isolation (extends existing Swarm Dev)

### Wave 7 — Test coverage seed
- Vitest setup if not present
- Tests for the pure functions added in Waves 1-3:
  - `gitGraphLayout` (lane assignment edge cases)
  - `conflictMarkers.findConflicts` (diff3, nested, malformed)
  - `promptTemplates.expandPrompt` ({{...}} substitution)
  - `aiCoauthor.appendTrailer` (dedup, provider-aware)
  - `parseDiffNewLineRanges` (already has 5 inline tests — formalize)

### Wave 8 — V2.3 medium-tier extras
- Voice input (Web Speech API, Win+Mac, opt-in)
- Native devcontainer (read-only first pass: open shell in container)
- MCP marketplace inside Extensions panel

### Wave 9+ — Phase C2 v2.4 territory
- Extensions architecture v1 (dynamic-import + manifest + sandboxing)
- Spec drafted in v2.3, ship in v2.4
- Reference extension (Focus Timer is the easiest candidate)

## Bilan log

### 2026-05-09 (late night) — Waves 13-17 five-wave push

User asked for "5 waves". Picked from the deepseek.md "Wave 13
candidates" list, executed them sequentially, no agents.

| Wave | Result |
|---|---|
| **13. Ollama everywhere v2** | ✅ Refactored 12 lighter AI call sites through `aiProviders.js`. `aiSemanticRerank`, `predictNextEdit`, `brainAutoExtract`, `agentSwarm`, `swarmOrchestrator`, `useAI` rewritten. UI threading: AgentSwarmPanel, SwarmPanel, SnippetPalette, AutoFixModal, GlobalSearch, ProjectBrainPanel, SandboxPanel, TimeScrubBar — all now plumb `ollamaBaseUrl` + `model` and gate via `isKeyless()`. **Lorica is now end-to-end Ollama-capable** — agent loop, inline complete, commit messages, PR descriptions, smart paste, swarm review, swarm dev, snippet gen, auto-fix, semantic re-rank, brain extraction, time-scrub intent. |
| **14. 5 LSPs** | ✅ zls, nimlangserver, crystalline, haskell-language-server-wrapper, ocamllsp. Wired in both `lsp.rs::get_lsp_server`, `lsp.rs::lsp_install_hint`, `extensions.rs` registry, and `useLSP.js` LANGUAGE_BY_EXT. Total LSPs **17 → 22**. |
| **15. Annotation popovers** | ✅ New `AnnotationPopover.jsx` — inline read view with 4-note cap and "edit" link to the panel. Click vs shift-click split (peek vs jump). Annotations gutter extension now emits `lorica:peekAnnotation`. App listener routes to popover state. New "Show/Hide annotation gutter dots" command — wires the previously-dormant `showAnnotations` flag. |
| **16. Floating windows v2** | ✅ FloatingViewer now editable. Ctrl+S → disk write; main window's file watcher picks up the change. Lock toggle preserves v1 read-only mode. Diverging-doc safeguard refuses to silently overwrite unsaved edits when an `fs:change` arrives. Beforeunload guard. Used a Compartment to swap editable state without rebuilding the editor. |
| **17. Live Share v1 (text sync)** | ✅ `y-codemirror.next` lazy-loaded (~80 KiB chunk). `collab.js` exposes `getSharedText(key, initialContent)` with seed-once gate via a `_meta` Y.Map (prevents duplicate-content footgun). `useCollabSession` exposes `shareFile`/`unshareFile`/`getBindingFor`. CollabPanel grows a "Share active file" button. Editor.jsx accepts a `collabBinding` prop and rebuilds when it changes. |

**New deps (justified):**

- `y-codemirror.next ^0.3.5` — official Yjs binding for CodeMirror 6.
  Lazy-loaded.

**Bundle final (post Wave 17):**

| Chunk | Size | Δ vs Wave 12 |
|---|---|---|
| main.bundle.js | **317 KiB** | +5 KiB |
| vendors.bundle.js | 186 KiB | unchanged |
| codemirror.bundle.js | 413 KiB | unchanged |
| Entrypoint total | **~1.03 MiB** | +5 KiB |
| `yjs-binding` lazy | ~80 KiB | new (only fetched on first share) |

**Decisions made (autonomous):**

- **Floating windows v2 syncs via disk, not in-memory.** Two editors
  fighting over state was the failure mode I wanted to avoid; routing
  through Tauri's existing fs:change watcher is robust + simple.
- **Live Share shares ONE file at a time.** Multi-file sharing is a
  natural follow-up but adds complexity around per-file Y.Text
  lifecycle. v1 ships the simple model.
- **Seed-once via `_meta` Y.Map.** Without this gate, two peers
  joining at the same time both insert the file body. Cost: one extra
  Y.Map per session.
- **Editor rebuild on `collabBinding` change.** y-codemirror.next's
  binding takes over doc state, so we can't add it via
  reconfigure — the EditorState has to be reconstructed. Acceptable
  since binding changes are rare (start session / share file).

**Files touched (Waves 13-17, ~22 files):**

- New: `src/components/AnnotationPopover.jsx`,
  `src/extensions/yjsBinding.js`.
- Modified: `App.jsx`, `Editor.jsx`, `FloatingViewer.jsx`,
  `useLSP.js`, `useCollabSession.js`, `lsp.rs`, `extensions.rs`,
  `aiSemanticRerank.js`, `predictNextEdit.js`, `brainAutoExtract.js`,
  `agentSwarm.js`, `swarmOrchestrator.js`, `useAI.js`, `collab.js`,
  `annotationsGutter.js`, `CollabPanel.jsx`, `CommandPalette.jsx`,
  `AgentSwarmPanel.jsx`, `SwarmPanel.jsx`, `SnippetPalette.jsx`,
  `AutoFixModal.jsx`, `GlobalSearch.jsx`, `ProjectBrainPanel.jsx`,
  `SandboxPanel.jsx`, `TimeScrubBar.jsx`.

### 2026-05-09 (night) — Wave 12 polish round 2 complete

User pushed Wave 6-11 mega commit (`83d71a1`), then asked to keep
shipping. Picked four sub-waves from the deepseek.md "What's open"
section, did them locally, no agents.

| Sub-wave | Result |
|---|---|
| **12.1 Annotations gutter** | ✅ New `annotationsGutter.js` CodeMirror extension with coloured dots (5 colours) + multi-annotation stacking (max 3 + `+N`). Click dot → focus panel; right-click line → `AddAnnotationPrompt` modal (small toast-style with Ctrl+Enter save). Loosely coupled via `lorica:addAnnotation` / `lorica:focusAnnotation` window events so Editor.jsx stays clean. Editor + App threaded for `annotations` prop, normalised file paths via `normalizeFilePath`. |
| **12.2 Three new themes** | ✅ Tokyo Night, Dracula, Rosé Pine. Total 10 → **13**. Each declares 5-stop `logoBars`. createEditorTheme picks them up automatically from THEMES dict. Settings dropdown auto-includes them via `Object.entries(THEMES)`. |
| **12.3 Ollama everywhere (lighter call sites)** | ✅ Refactored `aiCommitMessage.js`, `aiInlineComplete.js`, `aiPrDescription.js` to route through `aiProviders.js`. Editor now accepts `aiOllamaUrl` + `aiOllamaModel` props; threaded through both eager + split-view Editor invocations and through FilePreview's `editorProps`. GitPanel + PrDescriptionModal pass them to the generators. `isKeyless(provider)` is the gate — Ollama skips the API-key check, anthropic/deepseek still require one. **Ollama now works for**: agent loop, inline complete, commit messages, PR descriptions, smart paste, smart paste translation. **Still queued (12 sites)**: SnippetPalette, AgentSwarmPanel, AutoFixModal, GlobalSearch (semantic re-rank), ProjectBrainPanel, SandboxPanel, TimeScrubBar, brainAutoExtract, agentSwarm, aiSemanticRerank, predictNextEdit, useAI. |
| **12.4 Perf pass 5** | ⏭️ Investigated and **deferred**. The 413 KiB codemirror chunk is mostly the unavoidable core (view, state, commands, language, autocomplete, search) + lezer + helpers. Real wins would mean lazy-loading `@codemirror/search` or restructuring eager imports — invasive, and the entrypoint is already ~1 MiB which is healthy. Documented in deepseek.md "What's open" for Wave 13. |

**Bundle final (post Wave 12):**

| Chunk | Size | Δ vs Wave 11 |
|---|---|---|
| main.bundle.js | **312 KiB** | +9 KiB (annotations gutter + Ollama thread + 3 themes) |
| vendors.bundle.js | 186 KiB | unchanged |
| codemirror.bundle.js | 413 KiB | unchanged |
| Entrypoint total | **~1.02 MiB** | +9 KiB |

**Decisions made (autonomous):**

- **Inline modal vs popover for AddAnnotationPrompt.** Popover anchored
  at the click position would be nicer UX but requires reaching into
  Editor for line geometry — too invasive for v1. The toast-style modal
  is good enough.
- **Annotation gutter is its own gutter, not co-located with bookmarks.**
  Mixing them would crowd the gutter and break the bookmark "star one
  spot" UX. Two thin gutters side by side is fine.
- **Ollama refactor scope: lighter call sites only.** The medium /
  small AI integrations (commit messages, inline completion, PR
  description) are done. The heavier ones (Swarm, Sandbox, Brain) all
  use bespoke prompt templates and tool flows; refactoring them is
  Wave 13 — same pattern, just more files.
- **Perf pass 5 deferred.** Don't optimise prematurely. The
  entrypoint is healthy.

**Files touched (Wave 12 alone, 9 changes):**

- New: `src/extensions/annotationsGutter.js`,
  `src/components/AddAnnotationPrompt.jsx`.
- Modified: `App.jsx`, `Editor.jsx`, `CommandPalette.jsx`,
  `Settings.jsx` (no — wait, themes only touch themes.js),
  `themes.js`, `aiCommitMessage.js`, `aiInlineComplete.js`,
  `aiPrDescription.js`, `GitPanel.jsx`, `PrDescriptionModal.jsx`.

### 2026-05-09 (evening) — Wave 11 "Futuristic IDE" complete

User explicitly lifted the "no new deps" rule and asked for the
features that turn Lorica into the **perfect futuristic IDE**. Took
the gloves off — added Yjs + y-webrtc for real collab, three big new
panels, and a centralised provider abstraction.

**Wave 11 ships 4 sub-waves (skipped 11.2 tree-sitter — outline panel already covers it via CodeMirror language exts):**

| Sub-wave | Result |
|---|---|
| **11.1 Ollama** | ✅ 3rd AI provider, fully local. New `aiProviders.js` central config (10-call-site refactor target). Settings UI auto-probes `/api/tags`. `useAgent.js` wired for tool-using agents on Ollama. CSP + capability allow-list updated. |
| **11.2 Tree-sitter** | ⏭️ Skipped — CodeMirror's language extensions already give us syntax-aware structure. Re-evaluate only if the OutlinePanel needs symbol-level info (LSP outlines work better there). |
| **11.3 Smart Paste** | ✅ 10-language heuristic detector + AI cross-language translation. `SmartPasteModal` side-by-side preview. Loosely-coupled insert via `lorica:insertAtCursor` event + `smartInsert` CodeMirror extension (Editor.jsx untouched). |
| **11.4 Annotations** | ✅ Sticky-note system anchored to `(file, line)`. Persists to `.lorica/annotations.json`. `useAnnotations` hook + `AnnotationsPanel` browser. 5 colours + pinning. Inline gutter dots = follow-up. |
| **11.5 Live Share** | ✅ alpha — Yjs + y-webrtc peer-to-peer collab. Awareness-only v0 (peer name + active file + cursor). `CollabPanel` UX with start/join/stop + live peer list. **Yjs is lazy-loaded** so the 194 KiB doesn't enter the entrypoint until session start. `cursorBeacon` extension throttles selection events at 80 ms, gated on a window flag. |

**New deps (justified):**

| Dep | Size impact | Justification |
|---|---|---|
| `yjs` | ~140 KiB lazy | CRDT engine — peer-to-peer collab needs a real CRDT. Industry standard. |
| `y-webrtc` | ~55 KiB lazy | WebRTC transport for Yjs. No server needed. |

**Tests grew 81 → 133** (3 new files: aiSmartPaste 17, annotations 12,
aiProviders 23). Found and fixed one bug along the way: SQL detector
was using `\bSELECT\b.+\bFROM\b` without dotall, missing multi-line
SQL.

**Bundle final (post Wave 11):**

| Chunk | Size | Δ vs Wave 10 |
|---|---|---|
| main.bundle.js | **303 KiB** | +16 KiB |
| vendors.bundle.js | 186 KiB | +5 KiB (small bump from new imports inside Settings) |
| codemirror.bundle.js | 413 KiB | unchanged |
| Entrypoint total | **~1.01 MiB** | +25 KiB |
| **Yjs** lazy chunk | 194 KiB | **NOT in entrypoint** — only fetched on Live Share start |
| smart-paste lazy | 12.6 KiB | new |
| annotations lazy | 5.9 KiB | new |
| collab lazy | 7 KiB | new |

**Decisions made (autonomous):**

- **Ollama for `useAgent.js` only in this pass.** The other 9 AI call
  sites (useAI.js, aiCommitMessage.js, aiInlineComplete.js, etc.)
  still hardcode anthropic + deepseek URLs. Refactoring them all is
  Wave 12 work — `aiProviders.js` is the migration target.
- **Live Share = awareness only in v0.** Full text sync via
  `y-codemirror.next` would silently lose user edits during diverging
  document states without a careful UX. v1 deserves its own session
  where we ship the divergence resolver alongside.
- **Yjs lazy import.** Initial build pulled 194 KiB into vendors
  because `useCollabSession` import-chained `utils/collab.js` →
  `yjs`. Refactored to dynamic-import `utils/collab.js` from inside
  `start()` — vendors back to 186 KiB.
- **Smart Paste insert via window event.** Editor.jsx internals are
  off-limits per LEDGER rule; using a custom DOM event keeps the
  modal and the editor decoupled. Same pattern as the Wave 9
  EXTENSION_API draft.
- **SQL detector regression fix.** Dotall flag was missing — caught
  by Wave 11.3's `aiSmartPaste.test.js`, the test seed paid for
  itself within hours of being written.

**Files touched (Wave 11 alone, 28 changes):**

- New: `src/utils/aiProviders.js`, `aiSmartPaste.js`, `annotations.js`,
  `collab.js`; `src/hooks/useAnnotations.js`, `useCollabSession.js`;
  `src/components/SmartPasteModal.jsx`, `AnnotationsPanel.jsx`,
  `CollabPanel.jsx`; `src/extensions/smartInsert.js`,
  `cursorBeacon.js`; `tests/aiProviders.test.js`,
  `aiSmartPaste.test.js`, `annotations.test.js`.
- Modified: `App.jsx`, `loricaBridge.js`, `index.html`, `Editor.jsx`,
  `LoricaDock.jsx`, `CommandPalette.jsx`, `Settings.jsx`,
  `appReducer.js`, `useAgent.js`, `useSession.js`,
  `tauri.conf.json`, `capabilities/main.json`, `package.json`,
  `package-lock.json`.

### 2026-05-09 — Waves 6-9 complete in one continuous session

User dropped back in after relocating the project to OneDrive
(`C:\Users\devli\Lorica-ide` → `C:\Users\devli\OneDrive\Lorica-ide`)
and asked for "verify the waves and do the rest." Memory was empty
post-move — re-read CHANGELOG, V2.3_ROADMAP, and the LEDGER to
reconstruct state, verified Waves 1-5 by inspecting the file tree and
running `npm run build` (green: entrypoint **982 KiB**, main 286 KiB).
Then worked Waves 6-9 sequentially, no agents — local edits + per-wave
build checks.

**Wave 6 — Floating windows + Worktrees panel (no agent)**

| Item | Result |
|---|---|
| Floating editor windows | ✅ New `cmd_window_open_floating` (Tauri 2 `WebviewWindowBuilder`) + URL-safe base64 hash routing. `index.jsx` lazy-loads `FloatingViewer.jsx` on `#floating=` URLs (kept App as the static entry to preserve the codemirror/vendors `chunks: 'initial'` split). Read-only viewer pulls the active theme from `lorica.session.v1` localStorage, watches `fs:change` events to auto-refresh. Re-popping the same path refocuses an existing window via SHA-256-derived deterministic label. TabBar context menu gets a "Pop out to floating window" entry. Capability scope expanded to `floating-*`. |
| Worktrees panel | ✅ New `cmd_git_worktree_status` returns rich rows (`branch`, `head`, `isMain`, `isDetached`, `isDirty`, `modifiedCount`, `ahead`, `behind`). `WorktreesPanel.jsx` (lazy chunk: `worktrees`) shows every row with Open / Merge / Remove. Add new worktree with one input → fires the existing `cmd_git_worktree_add`. New `showWorktrees` state flag + LoricaDock entry. The existing SwarmPanel worktree flow is untouched — this panel is for manual / "background task on a branch" use. |

**Wave 7 — Test coverage seed (no agent)**

Decision: vitest over node:test. Source files use ESM `import`/`export`
syntax but `package.json` has no `"type": "module"`, and adding it would
cascade into renaming three `.cjs` config files. Vitest handles ESM
transparently via Vite, dev-only dependency, doesn't bloat the user
bundle. Trade-off accepted (204 transitive packages, 2 audit warnings —
all transitive devDeps).

| Suite | Tests |
|---|---|
| `aiCoauthor` | 18 (provider mapping, trailer formatting, dedup, recency window) |
| `conflictMarkers` | 14 (simple, diff3, multi, malformed, nested, resolveBlock) |
| `promptTemplates` | 16 (parsePromptFile + expandPrompt + buildInstructionsPrefix) |
| `gitGraphLayout` | 11 (linear, merge, octopus, off-screen parent, geometry helpers) |
| `parseDiffNewLineRanges` | 9 (single hunk, multi-hunk, deletions, scoping) |

**Total: 68 tests, all green, 1.7 s wall clock.** New scripts: `npm test`
(one-shot) and `npm run test:watch` (TDD).

**Wave 8 — Voice / devcontainer / MCP (no agent)**

| Feature | Result |
|---|---|
| Voice dictation | ✅ `src/utils/voiceInput.js` wraps `SpeechRecognition`. AgentCopilot gains a mic button (only visible when both the toggle is on AND `isVoiceSupported()` returns true — Linux hides it). Settings → AI gains the toggle (also only visible on supported platforms — no dead UI on Linux). Errors map to friendly toasts; `aborted` is suppressed because we abort intentionally on stop. |
| Dev-container | ✅ New `src-tauri/src/devcontainer.rs` with a 60-line jsonc → json normalizer (state-machine over chars, string-aware so `//` inside URLs isn't stripped). `cmd_devcontainer_detect` returns name/image/workspaceFolder/composeFile/hasBuild. Frontend hook `useDevContainer.js` runs detect on project change; StatusBar renders a "Box" icon with the image name, click → spawns a fresh terminal session and writes `docker run -it --rm -v <project>:/workspace -w /workspace <image> bash`. Build-based / Compose-based configs degrade to a tooltip-only chip ("Lorica v2.3 doesn't run builds yet"). |
| MCP marketplace | ✅ Six curated entries in `extensions.rs` registry (filesystem, github, postgres, slack, puppeteer, fetch) under new `mcp` category. ExtensionManager gets a `MCP` filter chip with a cyan info banner explaining "install only — runtime wiring lands in v2.4". Reuses the existing install pipeline, no new infrastructure needed. |

**Wave 9 — Extension API spec + Focus Timer reference (no agent)**

- `docs/EXTENSION_API.md` — full v0 draft. Manifest schema, 9 permissions
  (`ui.statusBar` / `ui.dock` / `ui.settingsTab` / `ui.commandPalette` /
  `storage.local` / `storage.settings` / `events.editor` / `events.git` /
  `agent.tools` deferred), lifecycle table, sandboxing model (what v0
  enforces vs. deferred to v0.1), and the loader open-questions list for
  v2.4 (module loader strategy, CSS isolation, hot reload, signing).
- `extensions/focus-timer/` — reference extension. Manifest with the four
  duration settings, JS module using ONLY the documented surface (no
  React, no `window.lorica`, no direct localStorage), 24×24 SVG icon,
  README. Used as a sanity check that v0 is enough for at least one real
  feature today; v2.4 lifts it directly when the loader lands.

**Final numbers (post Wave 6-9):**

- Build: green (`npm run build`, ~52 s)
- Cargo check: green (1 pre-existing `unused_variables` warning unchanged
  + 1 `unused_mut` warning, both from Wave 4 era)
- Tests: 68 passing
- Main bundle: **287 KiB** (+1 KiB vs. Wave 5 — the FloatingViewer router
  in `index.jsx` is the only code added to main; everything else is in
  lazy chunks: `floating-viewer`, `worktrees`)
- Entrypoint total: **~982 KiB** (matches Wave 5 baseline)
- New chunks: `floating-viewer` 8.5 KiB, `worktrees` (~6 KiB)

**Decisions (autonomous):**

- Voice input gated behind both `isVoiceSupported()` AND the user toggle —
  refused to ship a dead mic button on Linux WebView2/WebKit2GTK where
  the API isn't exposed at all.
- Dev-container v1 covers `image` only. Compose and Build flows show
  the badge but degrade to "v2.3 doesn't run that" on click. The
  roadmap's read-only first pass language explicitly accepts this.
- MCP entries use `category: "mcp"` (not "tool") so the filter chip can
  render distinctly. Not added to `cmd_get_lsp_server` and not started
  at boot — purely catalog work for v2.3.
- Wave 9 is **spec only** as the roadmap directs. The extension loader
  is v2.4 work; the reference extension exists to validate the spec
  not to be loaded today.
- Vitest over node:test (ESM friction), accepted the dev-dep cost as
  worth it for the test seed value.

**Branches:**

- `main` advanced with one squash commit per wave (or one cumulative
  commit covering 6+7+8+9 — TBD with the user before pushing)

### 2026-05-08 — Wave 5 complete (3 agents, all ✅)

**Niche autocomplete completion (sequential agents to dodge rate limits):**

| Language | Before | After | Status |
|---|---|---|---|
| nim | 883 | **2,025** | ✅ (87% detail / 100% info) |
| crystal | 886 | **2,353** | ✅ (80.6% detail / 100% info) |

**All 5 niche languages now at parity** (haskell 2,448 / ocaml 2,131 / zig 4,744 / nim 2,025 / crystal 2,353). Total niche: **13,701 entries** vs 633 baseline = ×21.6.

**Perf pass 4 — first sub-1 MB entrypoint:**

| Chunk | Before | After | Δ |
|---|---|---|---|
| `vendors.bundle.js` | 250 KiB | **181 KiB** | **-27%** |
| `codemirror.bundle.js` | 426 KiB | 413 KiB | -13 KiB |
| `main.bundle.js` | 285 KiB | 286 KiB | +0.6 KiB |
| **Entrypoint total** | **1.04 MiB** | **0.96 MiB** | **-83 KiB** |

Wins:
- **Tauri ESM/CJS duplication fix** in `useSpotify.js` — was `require()`-ing CJS while the rest used ESM, doubling Tauri code in vendors.
- **`spotify-web-api-js` lazy-loaded** — 96 KiB out of entrypoint, only fetched if user signs into Spotify.
- **`lucide-react` already optimal** — sideEffects:false, per-icon ESM, ~470 bytes/icon. No change needed.
- **splitChunks tuning** — moved `@lezer/*` + helpers into the codemirror cacheGroup; new `spotifyApi` cacheGroup.

**Cumulative v2.1 → v2.3 perf:** main bundle **989 → 286 KiB (-71%)**, entrypoint **~1.6 → 0.96 MiB (-40%)**.

**Local docs work (no agent):**
- CHANGELOG.md: new v2.3.0 entry at top, v2.2.0 stays as historical.
- New `docs/RELEASE_NOTES_v2.3.md` for the GitHub Release.
- This LEDGER updated with Wave 4 + 5 + roadmap for Waves 6-9.

**Build**: green (npm + cargo). 1 pre-existing warning unchanged.

### 2026-05-05 (afternoon) — Wave 4 hotfix: LSP registry + queue + v2.3.0 bump

**User reported two regressions in Extensions panel:**
1. LSP downloads "impossible"
2. Install queue removed

**Root causes found via local debug (no agent):**
1. The 10 original LSPs (`lsp-python`, `lsp-typescript`, `lsp-rust`, `lsp-go`, `lsp-clangd`, `lsp-csharp`, `lsp-web`, `lsp-php`, `lsp-sql`, `lsp-java`) had been deleted from `extensions.rs` registry — only the 7 Wave-2 additions remained. Users couldn't see/install the LSPs they actually wanted.
2. ExtensionManager.jsx had been simplified by Wave 2 LSP+7 agent, removing `queueRef`/`installingNow`/"Queued #N" pills logic.

**Fixes (all local, no agent):**
- Re-added 10 LSP entries to `extensions.rs` matching Wave-2 pattern (per-OS install_cmd + XXX_MISSING toolchain pre-checks).
- C# auto-bootstraps .NET SDK via `dot.net/v1/dotnet-install` script.
- Python install on Windows fixed (no bracket re-quoting via cmd).
- Restored install queue: `queueRef` (sync source of truth) + `queue` (state mirror) + `installingNow` + sequential `runInstall` recursion via `setTimeout`. Cancel-X on each "Queued #N" pill.
- `find_binary()` extended: `~/.dotnet/tools`, `~/go/bin`, `~/.npm-global/bin`, Python user-install Scripts paths.

**Versioning bumped 2.2.0 → 2.3.0** in: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src/version.js`, `README.md` (download URLs).

**Branches**:
- `wave-4` snapshot at `75ddbac`
- `waves-1-3-snapshot` reset to `15ee93b` (pre-wave-4)
- `main` advanced to `75ddbac`

**Build**: green (npm + cargo). 1 pre-existing warning unchanged.

### 2026-05-05 — Wave 3 complete + niche recovery, ready to commit

**Wave 3 — themes + LSP harmo + @branch-diff (3 agents, all ✅):**

| Agent | Result |
|---|---|
| Themes +4 | ✅ Solarized Dark, Solarized Light, Catppuccin Mocha, Gruvbox Dark. Theme switcher pickup auto via `Object.entries(THEMES)`. **10 themes total** (was 6). 5-stop `logoBars` per theme for theme-aware logo. |
| LSP harmonization + `@branch-diff` | ✅ 7 new arms in `get_lsp_server()` (ruby/bash/lua/elixir/dart/kotlin/swift) + `lsp_install_hint()` extended → **17 LSPs fully wired** client-side and registry-side. New `cmd_git_branch_diff` (reuses `detect_base_branch`). `@diff` / `@branch-diff` mentions with 30 KB cap. Dual-payload pattern: `modelPayload` sees full diff, `displayPayload` shows clean placeholder in chat history. |

**Niche autocomplete recovery (4 agents, 2/4 hit rate limit but all data salvaged):**

| Language | Entries | Status |
|---|---|---|
| haskell | 2,448 | ✅ (from Wave 2 timed-out agent's infrastructure) |
| ocaml | 2,131 | ✅ (agent finished writing data before rate limit hit final-report) |
| zig | 4,744 | ✅ (way over target; agent also fixed return-shape bug in `buildZig`) |
| nim | 883 | ⚠️ Rate-limited mid-write. Returns array now (one-liner local fix from `return s;` to `return s.toArray();`). Sub-target but salvageable as a v2.2.x patch. |
| crystal | 886 | ⚠️ Rate-limited mid-write. Return shape correct. Sub-target. |

**Niche total: 11,092 entries** vs 633 baseline (17.5×).

**Numbers (post Wave 3, pre-commit):**
- Main bundle: **285 KiB** (-71% vs v2.1)
- Entrypoint total: **1.04 MiB** (-522 KiB vs pre-pass-3)
- Autocomplete: **~63k entries across 30 languages** (5 niches × ~11k + 25 mainstream × ~52k baseline)
- LSP servers: **17** (10 → 17, fully harmonized client + registry)
- Themes: **10** (was 6)
- Build: green; Cargo check: green (1 pre-existing warning)

**Decisions made (autonomous):**
- Niche failures handled locally without firing more agents:
  - Detected `entries.map is not a function` from build-script run.
  - Located the bug (one missing `.toArray()` call in nim.mjs).
  - Fixed inline (1-char edit). Build script ran clean.
- Rate-limit policy from now on: **max 2-3 parallel agents**, sequential when possible, prefer local fixes for trivial issues.
- Nim/Crystal sub-target accepted as v2.2.x backlog rather than burning more tokens immediately.

**Ready to commit on main + advance `waves-1-3-snapshot` to that commit.**

### 2026-05-04 / 05-05 — Wave 2 complete, niche recovery in flight

**Wave 2 — final results (5 agents, 4/5 success):**

| Agent | Result |
|---|---|
| A — Fix `useAgent.js` regression + perf pass 3 | ✅ **Massive win.** Entrypoint 1.56 MiB → **1.04 MiB (-522 KiB / -33%)**. xterm pulled out of entrypoint via lazy Terminal. Main bundle 325 → 284 KiB. New chunks: `terminal` 7 KB, `agent-copilot` 41 KB, `lock-screen` 4 KB, `xterm` 290 KB async-only. 4 hooks idle-deferred (useUpdate, useProjectBrain, useCustomAgents, useProjectPrompts). Boot times instrumentation in PerformanceHUD. |
| B — Niche autocomplete to 2k+ | ❌ **Timed out** after 2h25 with 25 tool uses. Built infrastructure (`scripts/completions-gen/` with `EntrySet` helpers + build pipeline) and completed haskell.mjs (116 KB) → haskell.js (240 KB), but 4 stub generators left empty for ocaml/zig/nim/crystal. → Recovery: split into 4 separate small agents. |
| C — Autocomplete UX polish | ✅ Recency ranking (LRU 200/lang in localStorage), fuzzy match on `detail` (label-match wins), snippet template insertion via `@codemirror/autocomplete`'s `snippet()`, capitalization-insensitive prefix preserved. New `useRecentCompletions` hook. ~3 KB delta. |
| D — Staged gutter + AI co-author trailer | ✅ Two features. Gutter: extension `gitDiffGutter.js` + hook `useGitDiffGutter.js`, parallel `git.diff` + `git.diffStaged`, debounce 250ms + single-flight + stale-token guard, theme-aware (warning/success/gradient). Pure-string `parseDiffNewLineRanges` with 5 inline tests. Trailer: `aiCoauthor.js` with `markAiEdit/shouldAppendTrailer/appendTrailer/providerCoauthor`, hooks fire on Editor Ctrl+K, useAgent write_file, AgentCopilot Apply. Settings toggle. Provider-aware (Claude vs DeepSeek). |
| E — +7 LSP servers | ✅ `lsp-ruby/bash/lua/elixir/dart/kotlin/swift`. Total 17 LSPs. Mapping `LANGUAGE_BY_EXT` extended. Toolchain pre-checks (RUBY/NODE/ELIXIR/JAVA missing markers). Discovery: 10 originals live in `src-tauri/src/lsp.rs::get_lsp_server()`, 7 new ones in `extensions.rs` — registry split between two files. **Flagged for harmonization** in next wave. |

**Niche recovery (relaunched 2026-05-05 after rate limit reset):**
- 4 separate agents — one per language file in `scripts/completions-gen/<lang>.mjs`
- Each scoped tight (~2200 entries target)
- Run `node scripts/completions-gen/build.mjs` after all 4 complete

**Wave 3 (kicked off in parallel with niche recovery):**
- 4 more themes (Solarized Dark/Light, Catppuccin Mocha, Gruvbox Dark)
- LSP registry harmonization (move 7 new ones into `get_lsp_server()`) + `@branch-diff` agent context mention

**Numbers (post Wave 2 partial):**
- Main bundle: **284 KiB** (-71% vs v2.1 baseline)
- Entrypoint total: **1.04 MiB** (-522 KiB vs pre-pass-3)
- Autocomplete: ~50k entries across 26 mainstream + 4 niche-still-stub languages (haskell at 2k+; ocaml/zig/nim/crystal pending)
- LSP servers: 17
- Themes: 6 → going to 10 in Wave 3
- Build: green
- Cargo check: green (1 pre-existing warning)

**Decisions made (autonomous):**
- Niche recovery split 1→4 agents to avoid the 2h+ timeout pattern.
- LSP registry mismatch is real-but-harmless (the user-facing Extensions panel still shows the right set); harmonization moved to Wave 3 priority.
- Daily bilan cadence: append section per calendar day (regardless of how many waves run that day).

### 2026-05-03 — Lead dev mode start, Wave 2 in flight

**Wave 1 (v2.3 features merged into v2.2 mega-bundle):** ✅ shipped
- Git status decorations in FileTree (+12 KiB main)
- AI conflict resolution UX (+8-10 KiB main)
- Multi-line search & replace (+5 KiB main)
- Prompt files & slash menu (+5 KiB main)
- Git graph visualization (+0.1 KiB main, +6.9 KiB lazy)

**Wave 2 (in flight):**
- Fix `useAgent.js` perf regression + perf pass 3 (cold-start marks,
  more idle-defer, lazy panels)
- Niche autocomplete to 2k+: haskell, ocaml, zig, nim, crystal
- Autocomplete UX polish (recency ranking, fuzzy on `detail`, snippet
  templates)
- Staged-changes gutter + AI co-author commit trailer
- 7 more LSP servers (ruby, bash, lua, elixir, dart, kotlin, swift)

**Numbers (post Wave 1):**
- Main bundle ~325-334 KiB (fluctuating with concurrent edits)
- Autocomplete entries ~52,000 across 30 languages
- LSP servers in registry: 10
- Themes: 6
- Build: green
- Cargo check: green (1 pre-existing unused-variable warning)

**Outstanding (queued for next waves):**
- C2 extensions architecture spec draft (`EXTENSION_API.md`) — v2.4 ship
- Voice input (Web Speech API, Win+Mac)
- Devcontainer read-only support
- Floating editor windows (Tauri multi-window)
- Agent worktree isolation
- MCP marketplace
- More themes (currently 6, could double)
- Test coverage (codebase has minimal automated tests)
- Per-feature user docs

**Decisions made:**
- All v2.3-roadmap features merged into v2.2 mega-bundle per user
  preference ("no v2.3 yet, just improvements"). v2.3 documents will be
  recycled as v2.4-roadmap when v2.2 ships.
- Extensions architecture (C2) stays at v2.4 — too big for the current
  bundle.
- Code signing left to user (Certum €30/yr or SignPath after traction).
