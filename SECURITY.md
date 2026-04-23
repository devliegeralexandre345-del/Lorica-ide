# Security Policy

Thank you for taking the time to look at Lorica's security. Because Lorica
is a developer tool that touches source code, terminals, credentials, and
a local encrypted vault, we take reports seriously and respond to them in
a predictable way.

## Supported versions

Security fixes are applied to the latest released minor version. Older
versions receive fixes only on a case-by-case basis (e.g. critical
vulnerabilities with active exploitation).

| Version | Supported |
|---|---|
| 2.2.x (latest) | ✅ |
| 2.1.x | ⚠ critical fixes only |
| < 2.1 | ❌ |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for a security vulnerability.**

Send a report to **devliegeralexandre345@gmail.com** with the subject
line starting with `[SECURITY]`. If you would rather use an encrypted
channel, request a PGP key in an initial plaintext message with no
sensitive details and I'll reply with one.

A good report contains:

1. **A concise description** of the issue ("unsandboxed iframe allows
   local file read", "stored XSS in markdown preview", etc.)
2. **Impact** — what an attacker can do
3. **Reproduction steps** — ideally a minimal PoC (repo, shell commands,
   sample project, crafted file)
4. **Affected version(s)** — check with `About → Version` in the app
5. **Your preferred contact** for follow-up questions
6. Optional: a suggested fix if you have one in mind

You don't need to prepare a full write-up before the first contact — a
short heads-up is enough to start the conversation.

## What to expect after reporting

- **Acknowledgment** within **72 hours** of your first email (usually
  same day, but this is the worst-case guarantee).
- **Triage** within **7 days**: is this a real security issue, what's the
  severity, what's the fix scope.
- **Fix & release** depends on severity:
  - Critical (remote code execution, vault bypass, key exfiltration): aim
    for a patched release within **14 days**
  - High (local privilege escalation, memory corruption in backend):
    within **30 days**
  - Medium / Low: in the next scheduled release
- **Disclosure coordination** — we follow responsible disclosure. By
  default, public disclosure happens once a patched release is out. If
  you prefer an embargo or a specific disclosure date, tell us in your
  report and we'll discuss.
- **Credit** — if you want to be credited in the release notes and in a
  `SECURITY-ACKNOWLEDGMENTS.md` file, include the name / handle / URL
  you'd like us to use. Anonymous reporting is fine too.

## Out of scope

Reports on the following won't be treated as security issues:

- SmartScreen / Smart App Control warnings on unsigned installers — known
  limitation, addressed by code signing in a future release (see the
  code signing section of the README).
- Missing HSTS / CSP / cookie flags on the GitHub Pages website — that's
  a GitHub infrastructure concern.
- Any issue that requires physical access to an unlocked machine or a
  user explicitly running a malicious extension they installed.
- Theoretical issues without a reproducible PoC.
- Findings from automated scanners without analysis (please validate
  manually before reporting).

## Security design cheat-sheet

Things worth knowing when auditing:

- **Vault**: Argon2id (default parameters: `m=19456 t=2 p=1`) →
  XChaCha20-Poly1305 AEAD. Master password never touches disk. An AEAD
  canary prevents offline password bruteforce against a weaker side
  channel. Source: `src-tauri/src/security.rs`.
- **Atomic writes**: every write that matters uses `tmp + fsync +
  rename`. Source: `src-tauri/src/filesystem.rs::atomic_write`.
- **IPC boundary**: every Tauri command validates input; shell-invoked
  subprocesses never interpolate user input into strings (args via
  `Command::args`, `--` separator on Git paths/branches).
- **LSP / DAP**: Content-Length framed readers that parse exact byte
  counts; a malformed header produces a parse error, not an OOM.
- **Web preview sandbox**: `<iframe sandbox>` without `allow-same-origin`,
  so HTML previews run in a null origin and cannot reach the Lorica app's
  DOM / storage / vault.
- **Regex features**: all user-provided regex goes through
  `compileSafe()` + `boundedExec()` with match count and wall-clock caps
  to prevent ReDoS.
- **JS sandbox**: user-executable snippets run in a Web Worker with a
  hard timeout — the worker is terminated on expiry.
- **Updater**: signed release assets must match allowed GitHub hosts;
  non-HTTPS and off-repo URLs are rejected before download.

If you find that one of the above claims is wrong in practice, that's
almost certainly worth a report.

## Thanks

Security reports from outside contributors are how projects like this
stay honest. We appreciate you.

— Alexandre Devlieger, maintainer
