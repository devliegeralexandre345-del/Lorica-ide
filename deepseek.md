# Handoff document — Lorica IDE

_Living doc. Whoever is coding on Lorica updates this at the end of_
_every meaningful step. The point: if Claude runs out of context, the_
_next assistant (DeepSeek, another Claude session, anyone) can pick up_
_cold and stay productive without re-reading the whole repo._

**Last updated**: 2026-05-09 by Claude (Opus 4.7) — **Waves 43-47 complete**.
**Workspace Switcher** (recent projects modal w/ keyboard nav),
**AI Test Generator** (selection → drafted test file, save to disk),
**AI Doc Generator** (active file → markdown reference page),
**AI query expansion** wired into GlobalSearch as an opt-in toggle,
+19 tests across 2 new files. **263 JS tests + 12 Rust tests green**.
Bundle: main **314 KiB**. User has lifted the no-new-deps rule — keep
adding what makes Lorica the perfect futuristic IDE.

---

## Who you are talking to

- **User**: Alexandre Devlieger. Speaks French, prefers terse replies.
  Don't write paragraphs when one sentence works.
- **GitHub identity**: `devliegeralexandre345-del`. Don't use any other
  username in URLs.
- **Communication style**: short updates as you go ("found X", "fixing
  Y"), one or two sentences at end-of-turn. No emojis unless he asks.
- **Language**: reply in French unless he writes English first.

## What Lorica is

A privacy-first, AI-powered desktop IDE built on Tauri 2 (Rust backend
+ React/CodeMirror frontend). Single binary, no telemetry, supports
Anthropic Claude AND DeepSeek as AI providers (which is why DeepSeek
might be reading this — it's been wired into the Settings panel since
v2.0).

Currently at version **2.3.0** — the user is working on the v2.3.x
follow-ups (Waves 6-10) which haven't been tagged yet.

## Hard constraints (DO NOT violate)

These come from the LEDGER and from the user's repeated feedback. Every
assistant before you respected them — you must too.

1. **Adding deps is fine when it serves the IDE.** The user explicitly
   lifted the old "no new deps" rule on 2026-05-09. Wave 11 added
   `yjs`, `y-webrtc` (collab) and `vitest` (devDep, tests). Justify
   in the bilan, prefer lazy-import for heavy ones, and watch the
   entrypoint budget.
2. **`src/components/Editor.jsx` internals are off-limits.** Extend it
   via the `extensions` array prop only — never modify the CodeMirror
   setup inside.
3. **`src/utils/completions/` and `src-tauri/src/lsp.rs`** can be
   touched by at most one task at a time (collision-prone).
4. **Build must stay green** after every code change. Run `npm run
   build` and `cargo check` before declaring a task done.
5. **Theme everything via `var(--color-*)`**. Never hardcode hex
   values in components. The 10 themes rely on this discipline.
6. **No skipping git hooks** (no `--no-verify`) and no force-pushing
   to main.
7. **Don't commit unless the user asks.** If unclear, ask first.
8. **Don't `git add` everything blindly.** Stage explicit files; never
   commit `.env`, secrets, or `dist/`.
9. **Avoid emojis in code or docs** unless he asks. Same for the
   chat replies.
10. **No new docstrings or "what this does" comments.** Comments
    explain *why* — invariants, hidden constraints, surprising
    behaviour. Never narrate the code line-by-line.

## Build / test / verify

```bash
# JS bundle (production)
npm run build           # ~50-90s, exits 0 on success

# Rust check (no full build, fastest signal)
cd src-tauri && cargo check

# Rust tests (compiles the test binary, slower)
cd src-tauri && cargo test --lib

# JS unit tests (Vitest)
npm test                # one-shot
npm run test:watch      # TDD loop

# Full Tauri dev (rare — only when testing the actual desktop binary)
npm run tauri:dev
```

**Bundle budget**: main.bundle ≈ **312 KiB**, entrypoint total
≈ **1.02 MiB** (Wave 12 added +9 KiB for the annotations gutter +
Ollama threading + 3 themes). Yjs stays lazy. If a change pushes main
past 340 KiB, stop and investigate — Wave 5 fought hard to get these
numbers down. Codemirror chunk is still 413 KiB; perf pass 5 deferred
(no quick wins found, would need surgery into the eager imports).

**Working directory**: `C:\Users\devli\OneDrive\Lorica-ide` (Windows,
bash shell available via WSL or Git Bash). The user moved the project
INTO OneDrive recently — if you see stale paths in cargo target
errors, run `rm -rf src-tauri/target/debug/build/` then retry.

## Repo layout you actually need to know

```
src/
  App.jsx                    # main shell (786+ lines, lazy-loads everything)
  index.jsx                  # entry — routes to FloatingViewer or App
  FloatingViewer.jsx         # Wave 6 — read-only viewer for floating windows
  loricaBridge.js            # window.lorica.* surface (calls cmd_* in Rust)
  components/                # 60+ React components
  hooks/                     # 26+ React hooks (useFileSystem, useGit, useAgent…)
  utils/                     # pure-ish modules; tests live in /tests
  store/appReducer.js        # one big reducer, ~700 fields of UI state
src-tauri/
  src/lib.rs                 # invoke handlers (~150 commands registered)
  src/{git,filesystem,terminal,...}.rs  # one file per concern
  capabilities/main.json     # Tauri permissions; floating-* is allow-listed
extensions/
  focus-timer/               # Wave 9 — reference extension for v2.4 loader
docs/
  V2.3_ROADMAP.md            # source of truth for what's planned
  LEAD_DEV_LEDGER.md         # bilan log — most recent at the top
  WAVE_TEST_GUIDE.md         # manual test scenarios per wave
  EXTENSION_API.md           # Wave 9 spec for the v2.4 extension loader
tests/
  *.test.js                  # Vitest, 81 tests as of Wave 10
```

## What's done already (so you don't redo it)

### Shipped pre-handoff

- **v2.3.0** — 13 v2.3 features merged in Waves 1-3 + Wave 4 LSP fix +
  Wave 5 niche autocomplete to parity. See CHANGELOG `[2.3.0]`.

### Shipped this session (Waves 6-10, NOT yet committed)

- **Wave 6** — floating editor windows (`cmd_window_open_floating`
  + FloatingViewer.jsx + TabBar entry) AND Worktrees panel
  (`cmd_git_worktree_status` + WorktreesPanel.jsx + dock entry).
- **Wave 7** — Vitest test seed. 5 files, then 7 files, **81 tests
  green** as of Wave 10.
- **Wave 8** — voice dictation (Web Speech API, opt-in via Settings),
  devcontainer detection (`cmd_devcontainer_detect` + StatusBar
  badge + `docker run` shell), MCP marketplace (6 entries in
  Extensions panel under new `mcp` category).
- **Wave 9** — `docs/EXTENSION_API.md` v0 spec + `extensions/focus-timer/`
  reference. Spec only — loader ships in v2.4.
- **Wave 10** — polish. Audit follow-ups (license fields in
  package.json + Cargo.toml, `.lorica/` + `.lorica-worktrees/` in
  .gitignore, fixed both pre-existing cargo warnings), tests for
  voiceInput + buildDockerRunCommand + devcontainer Rust parser
  (+13 tests). WAVE_TEST_GUIDE.md updated with scenarios for
  Waves 6-9. CHANGELOG + LEDGER updated.

- **Waves 43-47 — seventh 5-wave push** (2026-05-09 absolute final night).
  - **43. Workspace Switcher**: `WorkspaceSwitcher.jsx` modal — recent
    projects from `lorica.recentProjects` localStorage, filterable list,
    keyboard nav (↑/↓/Enter/Esc), one-click "Open folder…" fallback.
    Wired into command palette + voice intents (`open.workspaceSwitcher`,
    accepts EN/FR/ES/DE). New `showWorkspaceSwitcher` flag in reducer.
    Lazy chunk: `workspace-switcher`.
  - **44. AI Test Generator**: `aiTestGenerator.js` + `AITestGeneratorModal`.
    Auto-runs on open against the active selection (or full active
    file). Strict-JSON contract `{path, framework, content}` from the
    model; the parser rejects anything that doesn't fit. Modal shows
    editable suggested path + framework badge + preview, "Save test
    file" writes via `window.lorica.fs.writeFile` (creates parent dir
    first). Lazy chunk: `test-gen`.
  - **45. AI Doc Generator**: `aiDocGenerator.js` + `AIDocGeneratorModal`.
    Generates a markdown reference (overview / Public API table /
    Examples / Notes) for the active file. Caps source at 16k chars.
    Output cleaner strips whole-reply code-fence wraps but preserves
    legitimate inner example fences. Save / copy / download. Lazy
    chunk: `doc-gen`.
  - **46. AI query expansion wired**: GlobalSearch grows an "AI expand
    ON/OFF" toggle next to the existing "AI re-rank" toggle. When ON
    (and rerank canon: provider has a key), the query is fanned out via
    `expandQuery()` into 2-4 semantic-search-friendly phrases, cosine
    search runs over the union of results, merge keyed by `path:start_line`.
    Falls back to original query on parse failure (utility was shipped
    in Wave 41 but unwired).
  - **47. Tests + integration**: `tests/aiTestGenerator.test.js`
    (11 cases on `parseTestJson`) + `tests/aiDocGenerator.test.js`
    (10 cases on `cleanOutput`). Command palette entries for Wave 44
    + Wave 45. All flags wired into the reducer + App lazy imports.
    Total: **263 / 20 files**.

- **Waves 38-42 — sixth 5-wave push** (2026-05-09 absolute deepest night).
  - **38. AI Code Explain**: `aiCodeExplain.js` + `AICodeExplainModal`.
    Modal asks the AI to explain the active selection (or first 200
    lines). Renders the markdown via the existing `MarkdownMessage`.
    Auto-runs on open. Command palette: "Explain selection (AI)".
    Lazy chunk: `code-explain` (9.8 KiB).
  - **39. Annotation Markdown export**: pure
    `exportAnnotationsToMarkdown` helper grouped by file → sorted by
    line, with author/pinned/remote tags + threaded replies. Panel
    grows a "Export .md" button that downloads via Blob URL.
  - **40. Recent collab sessions persisted**: useCollabSession keeps
    the last 8 room ids in `lorica.collab.recentRooms` (id +
    displayName + lastSeen). CollabPanel shows a "Recent rooms"
    list with one-click rejoin + per-row forget. Skips persistence
    for explicit-signaling sessions (treated as throwaway).
  - **41. AI query expansion**: `aiQueryExpand.js` takes a natural-
    language question → 2-4 short semantic-search-friendly phrases.
    Falls back to the original query on parse failure. Wired into
    GlobalSearch's semantic flow as a future toggle (utility shipped,
    integration is a small Wave 43+ wire-up).
  - **42. Tests**: `tests/annotationsExport.test.js` (10 cases) +
    `tests/aiQueryExpand.test.js` (8 cases). Total: **242 / 18**.

- **Waves 33-37 — fifth 5-wave push** (2026-05-09 deepest night).
  - **33. AI theme generator**: `aiThemeGenerator.js` + `ThemeGeneratorModal.jsx`.
    Free-text → JSON theme via the active AI provider. Strict hex
    validation rejects malformed model output. Generated themes save
    to `lorica.themes.custom` and merge into `THEMES` at boot via
    `loadAndMergeCustomThemes()`.
  - **34. Voice preview chip**: live "Voice intent: <label>" hint
    above the agent input while dictating, refreshed on every
    interim transcript. Clears on stop / error / no-match.
  - **35. Code-review v3 (replies)**: each review note gets a Y.Map-
    backed reply array. New `appendReviewReply` + `postReviewReply`
    surface. CollabPanel renders a per-note reply composer (cancel /
    Enter / Esc) with collapsed-by-default thread display.
  - **36. Left-side status-bar host slot**: a new
    `lorica-ext-statusbar-host-left` div in the left cluster.
    Extensions pass `{ side: 'left' }` to `ctx.statusBar.register`
    to mount there instead of the right.
  - **37. Theme generator tests**: `tests/aiThemeGenerator.test.js`
    with 15 cases pinning hex validation, parse defensiveness, slug
    collision handling. Total: **229 / 16 files**.

- **Waves 28-32 — fourth 5-wave push** (2026-05-09 latest deep night).
  - **28. Voice intents v2**: catalog 13 → 28 intents. Added
    file tree / command palette / omnibar / problems / outline /
    timeline / bookmarks / scratchpad / TODO board / project brain /
    debug / PR ready / focus timer / split editor / snippets. Spanish
    + German keywords on top of EN+FR. Tokeniser now strips accents
    (NFD-normalise + drop combining marks) so "débogueur" matches
    the "debogueur" keyword.
  - **29. Code-review v2**: peer review notes posted via
    `collab.appendReviewNote(file, line, text)` are merged into the
    annotations stream that `Editor.jsx` receives, so they pin as
    in-editor gutter dots on the receiving peer's screen. Author +
    color preserved; tagged `_remote: true` so future polish can
    style them differently.
  - **30. Inline rewrite presets**: `QUICK_PROMPTS` in
    `InlineAIEditPrompt.jsx` doubled (6 → 12). Added "Make it more
    concise", "Add type annotations", "Convert to async/await",
    "Make it immutable", "Add unit tests", "Extract pure helpers",
    "Inline this".
  - **31. Perf pass 5**: lazy-load `AddAnnotationPrompt` +
    `AnnotationPopover`. Both render only after a gutter click /
    right-click — no need to ship them in the initial paint. New
    chunks: `annotation-prompt` (3.2 KiB), `annotation-popover`
    (5.6 KiB). main.bundle.js: 326 → **319 KiB** (−7 KiB).
  - **32. Test coverage**: new `voiceCommandsV2.test.js` with 30+
    cases pinning the Wave 28 catalog. Total: **214 / 15 files**.

- **Waves 23-27 — third 5-wave push** (2026-05-09 deep night).
  - **23. Extension runtime (phase 2)**: `extensionRuntime.js` loads
    a manifest's entry JS via `cmd_extension_read_entry` + Blob URL +
    dynamic import, then hands the extension a sandboxed `ctx` object
    scoped to its declared permissions. `extensionHost.js` provides
    the host-side surface: status-bar chip slot in StatusBar, command
    registry, `lorica.ext.<id>.<key>` localStorage namespace,
    `lorica.ext.<id>.settings.<key>` for `contributes.settings`.
    `bootEnabledExtensions()` runs on App mount per project.
  - **24. Settings → Extensions tab**: new
    `InstalledExtensionsPanel.jsx` listing every scanned manifest
    with enable/disable toggle, version, source badge (project /
    user / builtin), permission chips, and root path. Persists the
    enabled set to `lorica.extensions.enabled` localStorage.
  - **25. Voice command parser**: `voiceCommands.js` maps transcripts
    (English + French) to one of 13 IDE intents (open settings,
    terminal, search, git, copilot, annotations, collab, worktrees;
    save file, toggle zen, toggle minimap, smart paste, cheatsheet).
    Stop-word filter + min-3-char substring match avoid the
    "le → toggle/leave" false positives. AgentCopilot's dictation
    handler routes the final transcript through this and clears the
    input on a hit.
  - **26. Inline Markdown for replies**: tiny home-grown renderer
    (`inlineMarkdown.js`) supporting `**bold**`, `*italic*`,
    `~~strike~~`, `` `code` ``, `[label](url)`, `\n`. URL allow-list
    blocks `javascript:` / `data:` / any other scheme that's not
    http(s) / mailto. Used by AnnotationPopover + AnnotationsPanel.
  - **27. Code-review mode**: `collab.js` exposes `appendReviewNote`
    + `onReviewNotesChange` over a session-shared `Y.Array`.
    `useCollabSession` adds `enableReviewMode` / `disableReviewMode`
    + `postReviewNote`. CollabPanel grows a review toggle and a live
    feed of peer-posted notes (author, timestamp, file:line, text)
    with a "Post review note on active file" quick action.

- **Waves 18-22 — second 5-wave push** (2026-05-09 latest).
  - **18. Live Share v2 multi-file**: `useCollabSession` switched from
    a single `sharedFile` to a `Set<string>` of paths. Multiple files
    can sync in parallel; the binding lookup is per-file. Remote cursors
    in peers' editors come for free via `yCollab(awareness)`.
  - **19. OpenRouter (4th provider)**: BYOK aggregator giving access
    to 100+ models (Claude, GPT-4o, Llama, Qwen, Gemini, …). Settings
    UI auto-fetches the catalog with a search filter and shows context
    length + per-million-token pricing. New `aiOpenRouterKey` +
    `aiOpenRouterModel` reducer fields. All Wave 13 call sites updated
    to recognise openrouter alongside the other 3 providers.
  - **20. Annotation comment threads**: `replies: Array<Reply>` field
    on every annotation. Hook gains `addReply` / `updateReply` /
    `removeReply`. Panel gets a per-annotation thread view + new-reply
    composer (author + text inputs). Popover preview shows the latest
    2 replies. Legacy entries auto-migrate via `ensureReplies()`.
  - **21. Tests for new utilities**: +20 cases (12 OpenRouter
    provider, 8 annotation replies). Total: **153 / 12 files**.
  - **22. Extension loader v0 phase 1**: new Rust module
    `extension_loader.rs` with `cmd_extension_scan` (project,
    user-data, builtin dir scan with first-found-wins) +
    `cmd_extension_read_entry` (path-traversal-blocked file read).
    Validates `lorica_api_version === "0"` and rejects unknown
    permission strings. 4/4 Rust tests passing. **Phase 2** (the
    actual JS sandbox + dynamic-import) is queued for Wave 23+.

- **Waves 13-17 — five-wave push** (2026-05-09 late night).
  - **13. Ollama everywhere v2**: refactored the remaining 12 lighter
    call sites to route through `aiProviders.js`. `aiSemanticRerank.js`,
    `predictNextEdit.js`, `brainAutoExtract.js`, `agentSwarm.js`,
    `swarmOrchestrator.js`, `useAI.js` all done. UI components
    plumbed: AgentSwarmPanel, SwarmPanel, SnippetPalette, AutoFixModal,
    GlobalSearch, ProjectBrainPanel, SandboxPanel, TimeScrubBar all
    pass `ollamaBaseUrl` + `model` and use `isKeyless()` to gate the
    API-key check. Ollama now works for **every** AI surface in
    Lorica — agent loop, inline complete, commit messages, PR
    descriptions, smart paste, swarm review, swarm dev, snippet gen,
    auto-fix, semantic re-rank, brain extraction, time-scrub intent.
  - **14. 5 new LSPs**: zls (Zig), nimlangserver, crystalline,
    haskell-language-server, ocamllsp. Wired into both `lsp.rs::get_lsp_server`
    and the Extensions panel registry. `LANGUAGE_BY_EXT` in `useLSP.js`
    extended for `.zig/.nim/.cr/.hs/.lhs/.ml/.mli`. Total LSPs **17 → 22**.
  - **15. Annotation popovers**: clicking a gutter dot now opens an
    inline `AnnotationPopover` showing up to 4 notes per line, with
    age, author, color, and an "edit" link to the full panel. Shift-
    click jumps straight to the panel. Toggle-visibility command:
    "Show/Hide annotation gutter dots".
  - **16. Floating windows v2 (read-write)**: `FloatingViewer` is now
    editable. Ctrl+S writes to disk, the main window's file watcher
    picks up the change. Lock toggle keeps the v1 read-only mode
    available. Beforeunload guard on dirty buffers. Diverging-doc
    safeguard: refuses to silently overwrite unsaved edits when an
    `fs:change` arrives.
  - **17. Live Share v1 (full text sync)**: `y-codemirror.next` (~80 KiB
    lazy chunk) binds Y.Text to CodeMirror. CollabPanel grows a
    "Share active file" button — picks ONE file, syncs every keystroke
    via Yjs CRDT. Other open files stay private. Initial-content seed
    is gated by a `_meta` Y.Map so two peers joining simultaneously
    don't both seed (avoids the duplicate-content footgun). Editor.jsx
    rebuilds when `collabBinding` prop changes.

- **Wave 12 — polish round 2** (2026-05-09 night). Four sub-waves:
  - **12.1 Annotations gutter**: completes Wave 11.4 — coloured dots in
    a dedicated CodeMirror gutter for every line that has a sticky
    note, click to focus the panel, right-click any line to add via
    a small inline modal (`AddAnnotationPrompt`). Loosely coupled
    via window events (`lorica:addAnnotation`, `lorica:focusAnnotation`)
    so Editor stays clean. Pinned annotations get a thin ring.
  - **12.2 Three new themes**: Tokyo Night (purple/cyan, very popular),
    Dracula (the classic), Rosé Pine (warm pastel). All declare their
    own logoBars so the in-app logo recolours; total themes 10 → **13**.
  - **12.3 Ollama everywhere**: refactored `aiCommitMessage.js`,
    `aiInlineComplete.js`, `aiPrDescription.js` to route through
    `aiProviders.js`. The Editor now threads `aiOllamaUrl` +
    `aiOllamaModel` props so inline ghost-text completion works
    locally. GitPanel + PrDescriptionModal pass the same. Ollama is
    now usable for: agent loop ✅, inline complete ✅, commit messages ✅,
    PR descriptions ✅, smart paste ✅, smart paste translation ✅.
    Still hardcoded (out of scope this pass): SnippetPalette,
    AgentSwarmPanel, AutoFixModal, GlobalSearch, ProjectBrainPanel,
    SandboxPanel, TimeScrubBar, brainAutoExtract, agentSwarm,
    aiSemanticRerank, predictNextEdit, useAI. These are the
    less-frequently-hit call sites — Wave 13 candidate.
  - **12.4 Perf pass 5**: investigated, deferred. The 413 KiB
    codemirror chunk is mostly the unavoidable core (view, state,
    commands, language, autocomplete, search) + lezer parsers +
    helpers. Real wins would require lazy-loading `@codemirror/search`
    or restructuring the eager imports — invasive, and the entrypoint
    is already healthy (~1 MiB).

- **Wave 11 — "Futuristic IDE"** (2026-05-09 evening). Five sub-waves:
  - **11.1 Ollama local LLM**: 3rd AI provider option (alongside
    Anthropic + DeepSeek). Centralised provider config in
    `src/utils/aiProviders.js` (PROVIDERS, getEndpoint, getHeaders,
    buildChatBody, extractText, isKeyless, supportsTools, listOllamaModels).
    Settings UI auto-probes `/api/tags` to list installed models.
    `useAgent.js` wired to support tool calling against Ollama. CSP +
    capability allow-list updated for `http://localhost:*`.
  - **11.2 Tree-sitter outline**: deliberately skipped — CodeMirror
    language extensions already cover the use case for the existing
    OutlinePanel. Re-evaluate if real symbol-level info is needed.
  - **11.3 AI Smart Paste**: heuristic language detector (10 langs)
    + AI-powered cross-language translation. Modal at
    `SmartPasteModal.jsx`; uses the cursor-beacon-style window event
    to insert without touching Editor.jsx internals (`smartInsert`
    extension). Command palette entry + dock entry.
  - **11.4 Spatial annotations**: sticky-note system anchored to
    `(file, line)` pairs. `useAnnotations` hook persists to
    `.lorica/annotations.json` (debounced 400 ms). `AnnotationsPanel`
    browses + edits + jumps. 5 colour variants. Inline gutter dots
    are deferred to a follow-up.
  - **11.5 Live Share (alpha)**: real-time collab via Yjs + y-webrtc
    (peer-to-peer, no Lorica server). v0 = awareness-only (peer name,
    active file, cursor row/col); full edit sync (Y.Text via
    y-codemirror.next) deferred to v1. The collab utility is lazy-
    loaded — Yjs's 194 KiB never enters the entry graph until the
    user clicks Start. Cursor beacon extension (`cursorBeacon.js`)
    emits throttled `lorica:cursorMoved` window events when a session
    is active.

### Files modified / created this session (not yet committed)

```
modified:
  CHANGELOG.md
  docs/LEAD_DEV_LEDGER.md
  docs/WAVE_TEST_GUIDE.md
  package.json
  package-lock.json
  src-tauri/Cargo.toml
  src-tauri/capabilities/main.json
  src-tauri/src/extensions.rs
  src-tauri/src/git.rs
  src-tauri/src/lib.rs
  src/App.jsx
  src/components/AgentCopilot.jsx
  src/components/ExtensionManager.jsx
  src/components/LoricaDock.jsx
  src/components/Settings.jsx
  src/components/StatusBar.jsx
  src/components/TabBar.jsx
  src/index.jsx
  src/loricaBridge.js
  src/store/appReducer.js
  src/hooks/useDevContainer.js
  .gitignore

new:
  deepseek.md                                  # this file
  docs/EXTENSION_API.md
  extensions/focus-timer/{manifest.json,extension.js,icon.svg,README.md}
  src-tauri/src/devcontainer.rs
  src/FloatingViewer.jsx
  src/components/WorktreesPanel.jsx
  src/utils/voiceInput.js
  tests/{setup.js,aiCoauthor.test.js,conflictMarkers.test.js,
         devContainer.test.js,gitGraphLayout.test.js,
         parseDiffNewLineRanges.test.js,promptTemplates.test.js,
         voiceInput.test.js}
  vitest.config.js
```

## Status of the verification matrix (right now)

- `npm run build` ✅ green (~67 s, main **314 KiB** (−7 KiB vs Wave 42),
  vendors 182 KiB, entry ~1.02 MiB)
- `cargo check` ✅ green, **0 warnings**
- `npm test` ✅ **263/263** Vitest cases across 20 files (+21 across the
  Wave 47 tests for test-gen + doc-gen parsers)
- `cargo test --lib extension_loader` ✅ **4/4**
- `cargo test --lib devcontainer` ✅ **8/8**
- Lazy chunks: `yjs-binding` (~80 KiB, only on share),
  `annotation-popover` (5.6 KiB, only on dot-click),
  `annotation-prompt` (3.2 KiB, only on right-click-gutter),
  `workspace-switcher` (Wave 43), `test-gen` (Wave 44), `doc-gen` (Wave 45)

## What's open for the next assistant

In priority order — pick whichever fits the user's next ask:

1. **Wait for the user's instructions on commits**. 27+ files are
   uncommitted. He may want one cumulative commit, or 5 squashes
   (one per wave: 6, 7, 8, 9, 10). Don't `git commit` without him
   asking.
2. **Wave 48 candidates** (Waves 43-47 fully shipped — these are next):
   - **AI Refactor Suggestion modal**: hover a function, "Suggest
     refactors" → AI returns 3 diffs with rationale; user picks one to
     apply via the existing inline-edit pipeline.
   - **Bookmark sync over Live Share**: bookmarks already exist locally;
     share them in the same Yjs doc as annotations so peers see them.
   - **Recent files quick-switch (Ctrl+E)**: like VS Code's Ctrl+P but
     scoped to currently-open + recently-closed buffers only.
   - **AI commit-message in voice intent catalog**: when a `commit
     message` voice phrase is detected, open GitPanel and pre-populate
     a draft from the staged diff.
   - **Codemirror chunk lazy-split**: 413 KiB chunk; splitting
     `@codemirror/search` saves ~30 KiB on initial paint. Invasive.
   - **Extension settings panel inside the extension's status-bar chip**:
     today extensions add settings to the global Settings → Extensions
     tab. A per-extension chip-popover would scale better.

3. **Wave 33 candidates** (historic; some shipped, some still open):
   - **Extension runtime v0.1 (sandbox hardening)**: shadow DOM for
     status-bar chips so extension CSS can't leak; Web Worker
     execution for CPU-intensive extensions; `network.outbound`
     permission with allow-list.
   - **Voice command palette overlay**: while dictating, show the
     parsed intent in a floating chip above the input so the user
     sees what's about to fire before it does.
   - **Codemirror chunk lazy-split**: 413 KiB is the long pole now.
     Splitting `@codemirror/search` into its own chunk fetched on
     `Ctrl+F` would shave ~30 KiB off the initial paint. Invasive
     because the keymap binding has to survive a lazy load.
   - **Status-bar host slot for the LEFT side too**: today extensions
     can only register on the right cluster.
   - **Code-review v3 — replies on review notes**: a peer can reply
     to another peer's review note inline. Y.Map per note, simple
     append-only.
   - **Theme generator (AI-powered)**: "make me a theme based on
     this image" using Claude's vision API.
3. **Open audit minor items still on the books**:
   - `src-tauri/Cargo.toml` could declare `publish = false` to make
     the missing-license warning permanently impossible.
4. **Documentation drift watch**:
   - `docs/PRE_SHIP_AUDIT.md` was written for v2.2.0 — re-running
     it against current state would catch new drift but isn't urgent.

## Conventions for replying / committing

- Replies in French, short.
- Code comments: explain *why*, never *what*. No comments at all is
  better than a "what does this do" comment.
- Commit messages: conventional-commit style (`feat(scope):`,
  `perf(bundle):`, `wave-N: ...`). One-line subject; body only when
  there's a non-obvious why.
- Test names: descriptive sentences ("appends a Co-authored-by trailer
  with a blank-line separator"), not snake_case.
- File-path references in chat: use markdown links, e.g.
  `[App.jsx:142](src/App.jsx:142)`.

## Update protocol (the whole point of this file)

Every time you finish something meaningful — fix a bug, ship a wave,
land a commit, change a constraint — **edit this file** before you
end the turn. Specifically:

- Bump the **Last updated** line at the top with date + your model
  name + a one-line summary.
- Update the **Status of the verification matrix** if you ran builds.
- Move items between **What's done already** and **What's open** as
  state changes.
- Append new constraints to **Hard constraints** if the user gave you
  new feedback during the session.

Don't let this file go stale. If you see it referencing waves that no
longer match the LEDGER, fix the drift right then — the LEDGER is the
source of truth.

---

## How to ask the user for a clean handoff

If you do hit your context limit, leave the session with:

1. This file freshly updated (latest "Last updated" line).
2. The LEDGER updated with a sub-bilan describing the partial state.
3. A **clear sentence** to the user: "I'm at my limit — pick up from
   `deepseek.md`'s 'What's open' section. The build is currently
   {green | red because X}."

That way DeepSeek (or whoever) walks in oriented in 30 seconds.
