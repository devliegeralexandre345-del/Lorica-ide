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

## Bilan log

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
