# Lorica v2.2.0 — "Credibility"

_Copy this file's body into the GitHub Release description when publishing v2.2.0._

---

Lorica v2.2 is a **correctness release**. It closes ~30 real bugs
uncovered during a deep audit, adds GDPR-compliant consent for every
AI feature, and wires up a proper release pipeline for future signing.
If you tried the C++ debugger in v2.1 and gave up — try again.

## Highlights

### 🔒 Privacy-first by default
- **GDPR consent modal** before any data leaves your machine, with
  clear breakdown of what goes where. No telemetry, no tracking, no
  Lorica-operated server.
- Full [PRIVACY.md](https://github.com/devliegeralexandre345-del/Lorica-ide/blob/main/PRIVACY.md)
  documenting every transfer.
- API keys now actually persist in the encrypted vault (previously
  they were in-memory only and lost on relaunch).

### 🐛 The debugger works again
- C++ compile no longer fails with `-std=c++17` on `.c` files.
- DAP adapter detection is now cross-platform (Windows no longer
  silently fails on `which`).
- Missing-adapter errors include **exact install commands** for every
  language.
- Proper `lldb-dap` / `codelldb` / `debugpy.adapter` / `dlv dap` endpoints
  replace the previous broken configs.

### 📂 File watcher actually watches
- Files created / deleted outside Lorica (git checkout, npm install,
  another editor) now refresh the tree automatically — 200ms debounce.
- Noisy directories (`node_modules`, `.git`, `target`, …) are filtered
  at the source so `npm install` doesn't drown the frontend.

### 🔐 Settings persistence
- `autoSave`, `autoLockMinutes`, `heatmapEnabled`,
  `semanticAutoEnabled`, and a few more now survive relaunch.
  Previously they "reset to default" every boot.

### 🧭 Git author setup
- First commit on a fresh machine used to fail with a wall of text.
  Now Lorica detects missing `user.name` / `user.email`, shows an
  inline form, saves globally, and retries the commit.

### ⌨️ Autocomplete that actually knows your stdlib
- C/C++: typing `#include <` suggests ~100 stdlib headers.
- Python, JS/TS, Rust, Go: ~5× more stdlib entries than v2.1 —
  `os.path.*`, `Array.prototype.*`, `std::sync::*`, `net/http.*`, and
  hundreds more. Works without any LSP running.

### 🧩 Configurable feature set (preview of v2.3 extensions)
- **Settings → Features** lets you toggle 28 features on/off. Disabled
  features disappear from the Omnibar completely. Defaults ship only
  the popular 11 so fresh installs aren't overwhelming.
- **Omnibar no longer requires scrolling** — 6 rows max in the empty
  view, 8 rows max when mixing files + commands. `>` / `@` / `#` / `?`
  prefixes give bigger lists when you explicitly want more.

### 🛡 Vault hardening
- Argon2id-gated AEAD canary replaces the brute-forceable SHA-256
  password verification.
- Atomic writes (tmp + fsync + rename) for the vault, semantic index,
  and generic file saves. No more corrupt files if the process dies
  mid-write.

### 🧰 Infrastructure
- Multi-platform GitHub Actions release pipeline (Windows MSI, macOS
  dmg, Linux deb / AppImage) with opt-in Authenticode signing — ready
  for when we obtain a code-signing certificate.
- Integration-free (no external services required) by default.

## Breaking changes

None. v2.2 is a drop-in replacement for v2.1.

## Known issues

- **Windows installers are not yet Authenticode-signed.** Smart App
  Control will block the install on Windows 11 fresh setups; right-click
  the `.msi` → Properties → "Unblock" to proceed. We're re-applying to
  [SignPath Foundation](https://signpath.org) once the project has more
  public traction.
- **Language servers and debug adapters must be installed separately**
  (Lorica doesn't bundle them). The app shows the exact install command
  for your language when one is missing — follow the toast and you're
  set.

## Full changelog

See [CHANGELOG.md](https://github.com/devliegeralexandre345-del/Lorica-ide/blob/main/CHANGELOG.md#220--2026-04-20).

## Checksums

_(filled in automatically by the release workflow when publishing)_

| File | SHA-256 |
|---|---|
| `Lorica_2.2.0_x64_en-US.msi` | `<to be filled by CI>` |
| `Lorica_2.2.0_x64-setup.exe` | `<to be filled by CI>` |
| `Lorica_2.2.0_amd64.deb` | `<to be filled by CI>` |
| `Lorica-2.2.0-1.x86_64.rpm` | `<to be filled by CI>` |
| `Lorica_2.2.0_amd64.AppImage` | `<to be filled by CI>` |

## Thanks

Solo-maintained. If you find a bug, please file an issue following
[SECURITY.md](https://github.com/devliegeralexandre345-del/Lorica-ide/blob/main/SECURITY.md)
for security-sensitive reports or a regular GitHub issue for everything
else.

🤖 Built with help from Claude Code.
