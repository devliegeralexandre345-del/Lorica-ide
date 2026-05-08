# Lorica — Wave Test Guide

_Per-wave test scenarios. Each scenario describes setup, steps, expected_
_outcome, and fail signs._

## Branching model

- **`main`** — active dev. The lead-dev fires waves here, commit per wave.
- **`wave-N`** — snapshot branch created at the commit where Wave N completed.
  Checkout to freeze in time and test that wave's state.
- **`waves-1-3-snapshot`** — special: Waves 1, 2, 3 were entangled (never
  committed wave-by-wave), so a single snapshot covers all of them.

## How to use this guide

```bash
# Test the entangled Waves 1+2+3 mass:
git checkout waves-1-3-snapshot
npm install   # first time only
npm run tauri:dev

# Test Wave 4+ individually (once they ship):
git checkout wave-4
npm run tauri:dev
# → freeze the app at end-of-wave-4 state

# Back to active dev:
git checkout main
```

Each test below is self-contained. Total time for all waves: ~60-75 min.
P0 only: ~25 min.

---

## Wave 1 — v2.3 features merged into v2.2

### 1.1 Git status decorations in file tree (P0, 3 min)

**Setup**
- Open any git repo in Lorica.
- Confirm the file tree shows file names cleanly.

**Steps**
1. Modify a tracked file (e.g. add a line to `README.md`, save).
2. Look at the file tree.

**Expect**
- The modified file shows a **yellow `M`** to the right of its name.
- The folder containing the file shows a small **dot** indicating it has changes.

**More cases**
- Stage with `git add <file>` in a terminal → letter turns **green**.
- Create a brand new file → letter is `U` (untracked) in **blue**.
- Delete a file externally → letter is `D` in **red**.
- File in `.gitignore` → no letter.

**Fail signs**: tree never updates; wrong color per status; folder dot missing.

---

### 1.2 AI conflict resolution (P1, 5 min)

**Setup**
- Open any file that doesn't have conflict markers.

**Steps**
1. In the editor, paste this block at the top of any file:
   ```
   <<<<<<< HEAD
   const x = 1;
   =======
   const x = 2;
   >>>>>>> branch-name
   ```
2. Save the file.

**Expect**
- The conflict region gets a light tinted background.
- Above the `<<<<<<<` line, an inline toolbar appears with buttons:
  **Resolve with AI** · **Keep ours** · **Keep theirs** · **Keep both**

**Test each button**
- Click **Keep ours** → block replaced with `const x = 1;`. Re-paste before next test.
- Click **Keep theirs** → `const x = 2;`. Re-paste.
- Click **Keep both** → both lines kept, in order.
- Click **Resolve with AI** → AI panel opens with a structured prompt pre-loaded (OURS / THEIRS / context).

**Fail signs**: no toolbar, click does nothing, AI prompt is empty.

---

### 1.3 Multi-line search & replace (P1, 4 min)

**Setup**
- Open any file with multiple lines of code.

**Steps for in-editor search**
1. Press `Ctrl+F`.
2. Toggle the **multi-line** button (icon: `WrapText` — looks like wrapping arrows).
3. Paste a multi-line query, e.g.:
   ```
   function foo() {
     return null;
   }
   ```

**Expect**
- The search matches across lines.
- Replace works with multi-line replacement.

**Steps for project-wide search**
1. Open **GlobalSearch** (`Ctrl+Shift+F`).
2. Toggle **Multi-line**.
3. Paste a multi-line query, search.

**Expect**
- Backend uses `--multiline` flag, returns matches across lines.
- Replace-all rewrites the file with newlines preserved.

**Fail signs**: multi-line button missing; query treated as single-line; replacement contains literal `\n`.

---

### 1.4 Prompt files & slash menu (P1, 5 min)

**Setup**
- In the project root, create:
  - `.lorica/instructions.md` with `Always respond in concise bullet points.`
  - `.lorica/prompts/explain.md` with:
    ```markdown
    ---
    name: Explain selection
    description: Walk through the highlighted code line by line
    ---
    Explain this code:

    ```
    {{selection}}
    ```
    ```

**Steps**
1. Open the AI / Copilot panel.
2. Type `/`. Wait for dropdown.

**Expect**
- Dropdown shows built-ins (`/clear`, `/reset`) **and** the new `explain` entry with a "project" badge.
- Selecting `/explain` replaces the slash with the prompt body. `{{selection}}` resolves to whatever's selected in the editor.

**Steps for instructions auto-attach**
1. Send any message.

**Expect**
- The agent's response is concise bullet points (because `instructions.md` was prepended to the system prompt). The chat history shows YOUR raw message, not the prepended instructions.

**Fail signs**: `/` dropdown doesn't appear; project prompts missing; instructions ignored.

---

### 1.5 Git graph visualization (P2, 3 min)

**Setup**
- Open any project with > 5 commits and ideally > 1 branch.

**Steps**
1. Open Git Panel.
2. In the History area, click the **Graph** tab (toggle next to Log).

**Expect**
- A pure-SVG graph shows commits as colored dots, branches as lanes.
- Refs (HEAD, branches, tags) shown as chips next to commits.
- Octopus merges render correctly (3+ incoming edges).
- Click a commit → highlights both in graph and in Log view.

**Fail signs**: empty graph; lanes overlap chaotically; clicking does nothing; > 200 commits cause lag (it's manually virtualized; should stay smooth).

---

## Wave 2 — Improvements

### 2.1 Perf pass 3 — boot times + lazy panels (P0, 2 min)

**Steps**
1. Cold start the app (kill, relaunch).
2. Open Performance HUD (`Alt+Shift+P`).
3. Look for the **Boot times** chip.

**Expect**
- Chip shows two numbers: `firstpaint·projectready ms` (e.g. `420·1180ms`).
- Both well under 2.5s.
- xterm only loads when you open the Terminal (`` Ctrl+` ``) — first open has a brief Suspense, subsequent are instant.

**Memory check**
- After 5 min idle: Task Manager / Activity Monitor → process should sit < 250 MB on a typical project.

**Fail signs**: chip missing; firstpaint > 1500ms on a modern laptop; xterm forced into entrypoint (delays first paint).

---

### 2.2 Autocomplete polish — recency, fuzzy, snippets (P1, 4 min)

**Recency**
1. In a JS file, type `imp` and accept `import`.
2. Restart Lorica.
3. Type `imp` again — `import` should be at the top (boost from recency).

**Fuzzy on detail**
1. In a Rust file, type `vec`.
2. The dropdown should include both `Vec` (label match) AND any entry whose `detail` contains `Vec<T>` (e.g. `BinaryHeap`).

**Snippets**
1. Type `match` in a Rust file.
2. Accept the snippet entry.
3. Cursor jumps to the first `${1:placeholder}` field. Tab moves to the next.

**Capitalization**
- Type `iter` → matches both `Iterator` (capitalized) and `iter` (lowercase).

**Fail signs**: recency doesn't persist; `BinaryHeap` doesn't show on `vec`; snippets insert literal `${1:...}` text.

---

### 2.3 Staged-changes gutter (P1, 3 min)

**Setup**
- Open a tracked file, modify a few lines.

**Steps**
1. See **yellow** vertical bars in the gutter for unstaged changes.
2. Stage some of those lines: `git add -p <file>` in terminal.
3. The staged lines turn **green**.
4. Modify a line that was already staged → bar becomes a **gradient** (green→yellow).

**Fail signs**: no bars; staging in terminal doesn't refresh the gutter; gradient doesn't render.

---

### 2.4 AI co-author commit trailer (P2, 4 min)

**Setup**
- Settings → Git → enable **"Auto-append AI co-author trailer to commits"**.

**Steps**
1. Use Inline AI Edit (`Ctrl+K`) on any selection. Accept.
2. Stage the file.
3. In the Git panel, type a commit message, click Commit.

**Expect**
- The actual commit (`git log`) includes:
  ```
  Co-authored-by: Claude <noreply@anthropic.com>
  ```
  (or `DeepSeek <noreply@deepseek.com>` if you're on DeepSeek).
- A **CoauthorHint** chip appears above the commit input when the trailer will be appended.

**Fail signs**: trailer appears even when toggle is OFF; trailer appended for a commit > 30 min after last AI edit; provider name wrong; trailer duplicated when user manually typed one.

---

### 2.5 +7 LSP servers in Extensions panel (P1, 5 min)

**Steps**
1. Open Extensions panel.
2. Filter by category: **Language**.

**Expect**
- 17 LSP entries total (was 10).
- New: `lsp-ruby`, `lsp-bash`, `lsp-lua`, `lsp-elixir`, `lsp-dart`, `lsp-kotlin`, `lsp-swift`.

**Install one (test)**
1. Click Install on `lsp-bash` (npm-based, fastest).
2. If Node.js is missing, you should see a clear toast: "Missing toolchain — Install Node.js from https://nodejs.org/".
3. If Node is present, the install runs and shows a progress bar (~45s).

**Verify the LSP attaches**
1. Open any `.sh` or `.bash` file.
2. Type a partial command like `if [ -`.
3. Bash LSP completions should appear (alongside the static dictionary).

**Fail signs**: new LSPs missing; install errors are cryptic; LSP doesn't attach to .sh files.

---

## Wave 3 — Polish

### 3.1 4 new themes (P2, 2 min)

**Steps**
1. Settings → Appearance → Theme dropdown.

**Expect**
- 10 entries total (was 6).
- New: **Solarized Dark**, **Solarized Light**, **Catppuccin Mocha**, **Gruvbox Dark**.

**Switch through each** — instant repaint, no flash. Logo bars re-tint to match each theme's `logoBars` palette.

**Fail signs**: missing themes; switching crashes; logo stays in old palette.

---

### 3.2 Niche autocomplete to 2k+ (P1, 3 min)

**Status**: in flight from agents at write time. After completion, run from repo:
```
node scripts/completions-gen/build.mjs
```

**Steps**
1. Open a `.ml`, `.zig`, `.nim`, or `.cr` file (create one if needed: `test.ml` with `let x = 1`).
2. Type a known identifier prefix:
   - OCaml: `List.` → ≥40 entries (map, filter, fold_left, etc.).
   - Zig: `std.mem.` → ≥30 entries (Allocator, copy, eql, etc.).
   - Nim: `strutils.` → ≥30 entries (split, parseInt, replace, etc.).
   - Crystal: `String.` → ≥40 entries.

**Expect**
- Dropdowns show 2,000+ entries per language total. Each entry has `detail` + `info` for ≥70% / 50%.

**Fail signs**: dropdown shows < 200 entries; entries lack `detail`; literal `;` left in labels.

---

### 3.3 LSP harmonization + `@branch-diff` mention (P2, 3 min)

**Status**: in flight from agent.

**LSP harmo test**
1. Open a `.rb` file. Status bar should show "Ruby LSP attached" (if solargraph installed) or graceful no-op.
2. Same for `.kt`, `.dart`, `.swift`, `.lua`, `.ex`, `.bash`.

**`@branch-diff` test**
1. In the agent panel, type `@diff` or `@branch-diff` followed by a question (e.g. "what changed?").
2. Send.

**Expect**
- The `@diff` mention in the chat is replaced with a placeholder (`[branch diff omitted from chat — full text attached as context]`).
- The AI's response actually references files in the diff (proves the diff was attached as context).
- If diff > 30 KB: warning toast "diff too large to attach automatically".

**Fail signs**: `@diff` not recognized; AI doesn't see the diff; warning never fires for large diffs.

---

## Smoke tests (cross-wave, P0, 5 min)

After any wave's tests pass, run these for sanity:

1. **Build clean**: `npm run build` exits 0.
2. **No console errors**: Open dev tools, no red errors during normal usage.
3. **Theme switch**: Switch through all 10 themes. Editor renders correctly in each.
4. **Open + edit + save**: Open a file, edit, `Ctrl+S`. File saved on disk.
5. **Terminal**: `` Ctrl+` ``, type a command, see output.
6. **Git commit via panel**: works without the AI co-author trailer toggle on (default).

---

## Reverting a wave's changes

**Waves 1-3** (entangled in `waves-1-3-snapshot`): reverting just one wave
is not clean — they share App.jsx, Editor.jsx, useAgent.js. If you find a
regression in this snapshot, identify the specific file/line via
`git diff main -- <file>` and revert that hunk via `git restore -p`.

**Wave 4 onwards** (each on its own branch): clean reverts possible.
- See what's in `wave-N`: `git log --oneline main..wave-N`
- Revert: `git revert <commit-sha>` or just don't merge that branch.
