# SignPath Foundation Application — Pre-filled Form

> **Status: REJECTED on 2026-04-20.** Reason given by SignPath: insufficient
> external reputation signals (GitHub stars, community adoption, external
> articles). Not a judgment on code quality — the Foundation program is
> reserved for projects with established public trust. Reapply once Lorica
> has community traction:
>
> - 100+ GitHub stars
> - External contributors (non-trivial PRs from outside the maintainer)
> - Blog posts / Reddit / HN mentions
> - Sustained download counts on Releases
>
> Keep this doc for the next attempt — the form answers are still good,
> only the Reputation field will need rewriting with real numbers.

**Where to submit:** https://signpath.org/apply
**Terms (read first):** https://signpath.org/terms.html

Copy-paste each field below. Fields marked 🔴 you **must** fill yourself
(personal info I can't supply). Fields marked ⚠ may need adjustment — read
the note.

---

## Pre-submission checklist

Before clicking Submit, verify:

- [x] `LICENSE` (MIT) at repo root ✅
- [x] `README.md` mentions SignPath Foundation for code signing ✅
- [x] GitHub Actions release workflow in place ✅
- [x] Release notes template mentions SignPath ✅
- [ ] **At least one public unsigned release pushed** (v2.2.0)
      → run `git tag v2.2.0 && git push origin v2.2.0`
      → wait for the workflow to publish the release
      → this must exist BEFORE you submit
- [ ] Homepage URL works (see below — use the repo URL if GitHub Pages
      isn't enabled)

---

## Form fields

### Project Name*
```
Lorica IDE
```

### Repository URL*
```
https://github.com/devliegeralexandre345-del/Lorica-ide
```

### Homepage URL*

⚠ **Two options — pick based on whether GitHub Pages is enabled:**

**If you have GitHub Pages enabled** at `username.github.io/Lorica-ide`:
```
https://devliegeralexandre345-del.github.io/Lorica-ide/
```

**If GitHub Pages is NOT enabled** (probably the case right now):
```
https://github.com/devliegeralexandre345-del/Lorica-ide
```

SignPath explicitly allows the repo page as a homepage. Using a dead
GitHub Pages URL will fail their validation, so use the repo URL if in
doubt.

### Download URL
```
https://github.com/devliegeralexandre345-del/Lorica-ide/releases
```

The releases page satisfies the requirement that "this page must mention
that the project uses the SignPath Foundation for code signing" because
the release notes template in `.github/workflows/release.yml` now
includes a prominent SignPath Foundation section. The same info is also
in `README.md` → section "🔏 Code signing".

### Privacy Policy URL

Leave empty. Lorica doesn't collect user data — the field is "required if
the software collects user data", which isn't our case. All API keys are
user-provided and stored locally in the encrypted vault; no telemetry is
sent anywhere.

### Wikipedia URL (optional)

Leave empty. No Wikipedia article.

### Tagline*
```
A privacy-first, AI-native code editor built with Tauri 2 and Rust — everything runs locally.
```

### Description* (500 char limit)
```
Lorica IDE is a native, privacy-first code editor. It combines AI-assisted coding, an encrypted credential vault, on-device semantic code search, Git, LSP/DAP support, and an integrated terminal. Everything runs locally with no telemetry and no mandatory cloud backend. Users supply their own AI API keys, stored encrypted on disk.
```
(334 chars — SignPath asked for "no version-specific features or
dependencies" so Tauri 2 / React / CodeMirror / Argon2id are dropped; the
description focuses on what Lorica does for users, not how it's built.)

### Reputation*

⚠ **This is the hardest field for a new project.** Be honest, but frame
what exists well. Draft below:

```
Lorica IDE is an early-stage open-source project in active development by a solo maintainer. The repository at https://github.com/devliegeralexandre345-del/Lorica-ide contains the full source (Rust backend, React/CodeMirror frontend), an MIT LICENSE, a comprehensive README documenting every feature, and a reproducible GitHub Actions release pipeline that produces Windows, macOS, and Linux installers from tagged commits. Our v2.2.0 release is published with downloadable artifacts. As a pre-1.0 project the primary reason for seeking SignPath Foundation code signing is to remove SmartScreen and Smart App Control friction for the first wave of early adopters — we are not yet in a position to cite external media coverage or large install counts, which is precisely why OS-level code signing would be materially enabling for the project's growth.
```

**Don't try to inflate reputation.** SignPath has seen every fake-reputation
submission imaginable. Honesty with a clear statement of *why you need
signing now* is what gets approved.

### Maintainer Type
```
Individual developer
```

### Build System
```
GitHub Actions (workflow at .github/workflows/release.yml)
```

### First Name* 🔴
(Your real first name — must match the ID you'll use for identity verification.)

### Last Name* 🔴
(Your real last name.)

### Email* 🔴
(An email address you actively monitor — this is where their approval
decision and any follow-up questions arrive.)

### Company Name
Leave empty if you're applying as an individual.

### Primary Discovery Channel*
Pick the most accurate option from their dropdown. If they have a free-text
"Other" option, use:
```
AI assistant (Claude) during research for free code-signing options for a Tauri-based OSS project
```

Or if the dropdown only has fixed options, pick **"Search engine"** or
**"Recommendation"**, whichever is offered.

### Please specify the exact source (optional)
```
Conversation with Claude (Anthropic AI assistant) about SAC/SmartScreen mitigation strategies for unsigned Windows installers.
```

### Consent checkboxes

- ☑ **"I have read and agree to the SignPath Foundation Code of Conduct…"**
  → Required. Read https://signpath.org/terms.html first, it's short.

- ☐ **"I agree to receive other communications from SignPath."**
  → Optional. Your call.

- ☑ **"I agree to allow SignPath to store and process my personal data."**
  → Required to process the application at all.

---

## After submission

1. Expect a confirmation email within ~48 hours.
2. First review pass: usually 1-2 weeks.
3. They'll likely ask clarifying questions about the project or the build
   pipeline — reply within 24h to keep momentum.
4. Identity verification happens during the review (they'll ask for a
   government ID scan at some point, encrypted upload).
5. Once approved: they give you a `SIGNPATH_API_TOKEN` and an `ORG_ID`.
   Add them as GitHub Secrets, then swap the signing step in
   `.github/workflows/release.yml` (TODO comment already in place).

## If rejected

Most common rejection reasons and fixes:

- **"Not enough evidence of being open source"** → make sure LICENSE is
  prominent at repo root (✅ done) and README clearly states the license.
- **"No public release to evaluate"** → publish a release first.
- **"Dual-licensed / commercial components"** → not our case, pure MIT.
- **"Unable to verify identity"** → they need a clean government ID scan.

You can reapply after addressing the issue.
