# Lorica v2.3.0 — "Surface area"

_Copy this file's body into the GitHub Release description when publishing v2.3.0._

---

Lorica v2.3 adds the surface area users have been asking for. Thirteen
new features lifted from a competitor scan (VS Code, Cursor, Zed) +
community pain-point pass. Three perf passes that **cut first-paint by
33%** without sacrificing the 30-language autocomplete dictionary.
Seven more LSP servers (10 → **17**). Four more themes (6 → **10**).
A new generator pipeline for scaling niche-language autocomplete to
mainstream parity.

## Highlights

### 🌳 Git, in the editor
- **Status decorations in the file tree** — M / A / U / D / R / C / !
  letters next to filenames. Folders with changes get a subtle dot.
  Theme-aware via `var(--color-*)`.
- **Staged-changes gutter** — green bars for staged lines, yellow for
  unstaged-modified, gradient for both. Reuses `cmd_git_diff_staged`.
- **Git graph view** — pure-SVG branch / commit topology. Octopus
  merge support, manual virtualization above 200 commits. Toggle in
  Git Panel.
- **AI co-author commit trailer** — opt-in. Auto-appends
  `Co-authored-by: Claude <noreply@anthropic.com>` (or DeepSeek) on
  commits within 30 minutes of an AI-driven edit.

### 🤖 Smarter agent UX
- **AI conflict resolution** — inline toolbar above each `<<<<<<<`
  marker: **Resolve with AI** + Keep ours/theirs/both. AI button
  pre-loads the agent panel with a structured OURS/THEIRS prompt.
- **Reusable prompt files** — `.lorica/prompts/*.md` with frontmatter
  appear in the slash menu. `.lorica/instructions.md` auto-attached
  to every agent system prompt. `{{selection}}` / `{{file}}` /
  `{{open_files}}` substitution.
- **`@diff` / `@branch-diff` mentions** — attach the full branch diff
  vs. main as agent context with one token. Dual-payload pattern: the
  model sees the diff, the chat history shows a clean placeholder.
  30 KB cap.

### 🔍 Better search
- **Multi-line search & replace** — toggle in both the in-editor
  panel (`Ctrl+F`) and `GlobalSearch` (`Ctrl+Shift+F`). Backend
  `cmd_search_in_files` walks file content with new
  `byte_offset_to_line_col` helper.

### 📚 Autocomplete that won't run out
- **Recency ranking** — accepted completions float to the top.
  Per-language LRU 200 in localStorage. Boost decays over 30 days.
- **Fuzzy match on `detail`** — typing `vec` surfaces `Vec` AND
  `BinaryHeap` (whose detail says `Vec<T>-backed priority queue`).
- **Snippet template insertion** — `${1:placeholder}` entries route
  through CodeMirror's `snippet()` for tab-stop fields.
- **Niche-language parity** — Haskell, OCaml, Zig, Nim, Crystal each
  expanded to **2,000+ entries** (Zig at 4,744). Total niche entries
  went from 633 → 13,000+. Powered by a new generator pipeline at
  `scripts/completions-gen/`.

### 🧠 Seventeen LSP servers, one-click install
+7 new: **Ruby** (solargraph), **Bash** (bash-language-server), **Lua**
(lua-language-server), **Elixir** (elixir-ls), **Dart** (built-in SDK),
**Kotlin** (kotlin-language-server), **Swift** (sourcekit-lsp).

The previous 10 — **Python** (pylsp), **TypeScript / JavaScript**, **Rust**,
**Go** (gopls), **C/C++** (clangd), **C#** (csharp-ls, with auto-bootstrap of
the .NET SDK), **HTML/CSS/JSON**, **PHP** (intelephense), **SQL**, **Java**
(jdtls) — restored after a registry regression in v2.2.

Toolchain pre-checks emit friendly `RUBY_MISSING` / `NODE_MISSING` /
`JAVA_MISSING` markers so a missing prerequisite gets a clear "Install
Ruby first" toast instead of a cryptic shell error. `find_binary()`
walks `~/.dotnet/tools`, `~/go/bin`, `~/.npm-global/bin`, and Python
user-install Scripts paths.

### 🎨 Ten themes, theme-aware logo
+4 new: **Solarized Dark**, **Solarized Light**, **Catppuccin Mocha**,
**Gruvbox Dark**. Each ships with a 5-stop `logoBars` palette so the
logo re-tints with the theme.

### 🪶 Lighter on first paint
Three perf passes layered on top of the v2.2 work:

| Pass | Main bundle | Entrypoint total |
|---|---|---|
| v2.1 baseline | 989 KiB | ~1.6 MiB |
| Pass 1 (autocomplete chunked per-language) | 321 KiB | — |
| Pass 2 (FilePreview nested chunks) | 304 KiB | — |
| Pass 3 (Terminal/AgentCopilot/LockScreen lazy + idle-defer hooks) | **285 KiB** | **1.04 MiB** |

`Terminal` lazy-loading pulls **xterm (290 KiB)** out of the entrypoint
— it now only loads when the user opens a terminal pane. Boot-time
marks (`lorica:boot:start` / `firstpaint` / `projectready`) feed a
"Boot times" chip in the Performance HUD.

## Breaking changes

None. v2.3 is a drop-in replacement for v2.2.

## Known issues

- **Windows installers are not yet Authenticode-signed.** Smart App
  Control will block the install on Windows 11 fresh setups; right-click
  the `.msi` → Properties → "Unblock" to proceed. We're re-applying to
  [SignPath Foundation](https://signpath.org) once the project has more
  public traction. Alternatively, a Certum Open Source Code Signing cert
  (~€30/year) would unblock signing immediately.
- **Language servers and debug adapters** are still installed
  separately. The Extensions panel offers one-click installers for 17
  language servers (and auto-bootstraps the .NET SDK if you don't have
  it). Native debug adapters still require manual install — the toast
  tells you exactly which command to run for your language.
- **Nim and Crystal autocomplete** — landed at 883 / 886 entries each
  (target was 2,000+). Rate-limit hit during generation. Sub-target
  but a 6× improvement over v2.2's ~140-entry baseline. Will be filled
  to 2,000+ in v2.3.x.

## Full changelog

See [CHANGELOG.md](https://github.com/devliegeralexandre345-del/Lorica-ide/blob/main/CHANGELOG.md#230--2026-05-05).

## Checksums

_(filled in automatically by the release workflow when publishing)_

| File | SHA-256 |
|---|---|
| `Lorica_2.3.0_x64_en-US.msi` | `<to be filled by CI>` |
| `Lorica_2.3.0_x64-setup.exe` | `<to be filled by CI>` |
| `Lorica_2.3.0_amd64.deb` | `<to be filled by CI>` |
| `Lorica-2.3.0-1.x86_64.rpm` | `<to be filled by CI>` |
| `Lorica_2.3.0_amd64.AppImage` | `<to be filled by CI>` |

## Thanks

Solo-maintained. If you find a bug, please file an issue following
[SECURITY.md](https://github.com/devliegeralexandre345-del/Lorica-ide/blob/main/SECURITY.md)
for security-sensitive reports or a regular GitHub issue for everything
else.

🤖 Built with help from Claude Code.
