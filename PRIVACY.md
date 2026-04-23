# Privacy Policy

Last updated: 2026-04-20

Lorica IDE (the "Software") is developed and distributed by Alexandre
Devlieger ("the Maintainer"). This document describes what data Lorica
collects, processes, or transmits — and just as importantly, what it does
not. It is written to be compliant with the EU General Data Protection
Regulation (GDPR, Regulation 2016/679) and analogous laws in other
jurisdictions.

This policy applies to the Software itself. The website at
`github.com/devliegeralexandre345-del/Lorica-ide` is governed by
GitHub's own privacy policy.

---

## 1. TL;DR

Lorica is a **local-first desktop application**. It does not phone home,
does not collect analytics, does not ship a tracking SDK, and does not
require an account. Every file you edit and every setting you change
stays on your machine.

The **only** time Lorica transmits data to a third party is when **you
explicitly opt in** to an AI-powered feature (Copilot, Agent, Inline Edit,
Semantic Search with cloud backend, etc.) or a music integration
(Spotify). In those cases, the destinations are the official APIs of
the providers whose keys you supplied — never a Lorica-operated server
(none exists).

## 2. Data the Software stores on your device

All of the following stay **exclusively on your computer**, under your
user profile:

| Data | Location | Encryption |
|---|---|---|
| API keys (Anthropic, DeepSeek, etc.) | Local vault file | **Yes** — Argon2id-derived key + ChaCha20-Poly1305 AEAD, master password never leaves the machine |
| Your source files, open tabs, session state | Wherever you open projects | No (these are your own files) |
| Editor settings / keybindings | App data directory | No |
| Semantic search index | `<project>/.lorica/semantic.bin` | No (contains only embeddings of your code, stored locally) |
| Git credentials | Delegated to Git's credential manager | Per your Git config |
| Project Brain notes | `<project>/.lorica/brain/*.md` | No (your own notes) |
| Agent session history | `<project>/.lorica/agent-sessions/*.json` | No |
| Time-scrub snapshots | `<project>/.lorica/snapshots/*` | No |
| Chrome-style clipboard history | In-memory only (never persisted) | N/A |

You can inspect or delete all of this at any time with standard file
system tools. Removing the `.lorica/` folder inside a project wipes all
Lorica-specific state for that project. Removing the OS-level app-data
directory wipes global settings.

## 3. Data transmitted to third parties (opt-in)

Lorica never transmits your data **without you explicitly enabling** a
feature that requires it. The third parties that may receive data are
listed below. Each connection is initiated directly from your machine
to the provider — there is no intermediate Lorica-operated server.

### 3.1 AI Providers (Anthropic, DeepSeek, and compatible LLM APIs)

**When triggered** — any Copilot completion, chat with Agent, Inline AI
Edit (Ctrl+K), Auto-Fix loop, swarm review, PR Ready, Apply Code modal,
custom agent invocation, and any feature that says "AI" or "Agent" in
its name.

**What is sent** — the prompt you typed, relevant code from the file
you're editing, optionally code from other files you've opened or that
the agent pulls in as context, and conversation history from the current
session. Also sent: system prompts defining the agent's role, and tool-use
definitions.

**Where it goes** — the official Anthropic API (`api.anthropic.com`)
or DeepSeek API (`api.deepseek.com`) or the compatible endpoint you
configured. These providers are independent data controllers; their
handling of your data is governed by their own privacy policies.

**How to stop** — remove the API key from Settings → AI. Without a key,
no AI feature can transmit anything. You can also disable specific
features in Settings → Features.

**Data Processing Agreement** — if you are subject to GDPR and your
prompts may contain personal data, you are the data controller and the
AI provider is your data processor. You are responsible for having a
valid DPA in place with that provider. Lorica does not enter into a DPA
on your behalf.

### 3.2 Spotify (optional music integration)

**When triggered** — only if you connect a Spotify account via
Settings → Integrations.

**What is sent** — standard OAuth 2.0 flow (PKCE + state), then read-only
playback information requests to `api.spotify.com`.

**Where it goes** — Spotify AB, governed by Spotify's privacy policy.

**How to stop** — click "Disconnect Spotify" in Settings, or revoke the
token from your Spotify account dashboard.

### 3.3 Update checks

When an update check runs (on start and periodically thereafter), Lorica
queries `api.github.com/repos/devliegeralexandre345-del/Lorica-ide/releases/latest`
to see if a newer version is available. GitHub receives your IP address
and user agent as part of any normal HTTPS request. Lorica does not send
any additional identifying information to GitHub beyond a `User-Agent:
Lorica-Updater` header.

You can disable update checks in Settings → Updates.

## 4. Telemetry, analytics, crash reports

**There is none.** Lorica ships with zero telemetry SDK. No events are
collected. No errors are uploaded. Crash dumps stay on the user's machine.
Logs are written locally.

If, in a future version, telemetry is ever considered, it will be:

- Strictly **opt-in**, off by default
- Explicitly described in this document before shipping
- Accompanied by a clear in-app disclosure and consent dialog

## 5. Cookies, browser storage

Lorica is a desktop application, not a website. It does not set cookies.
The embedded WebView stores settings in `localStorage` / `sessionStorage`
scoped to the app — these values never leave the machine.

## 6. Children

Lorica is a developer tool not directed at children under 16. No special
provisions are needed because no personal data is collected on the
Maintainer's infrastructure to begin with.

## 7. Your rights under GDPR

Since the Maintainer does not operate any server that holds your personal
data, the following rights are satisfied by the architecture of the
Software itself:

- **Right to access (Art. 15)** — all your data is on your own machine,
  in plain files you can read.
- **Right to erasure (Art. 17)** — delete `.lorica/` folders and the app
  data directory. Nothing is retained.
- **Right to rectification (Art. 16)** — edit the files directly.
- **Right to portability (Art. 20)** — everything is already in open
  formats (JSON, Markdown, bincode for the index, standard SQLite for
  some caches).
- **Right to object (Art. 21)** — don't enable AI / Spotify / update
  checks. The Software works fully offline without any of them.

For data transmitted to Anthropic, DeepSeek, Spotify, or GitHub, those
rights are fulfilled by those respective providers under their own
privacy policies.

## 8. Security

The Maintainer takes reasonable technical measures to protect data stored
on your device:

- API keys are encrypted with Argon2id + XChaCha20-Poly1305
- Vault unlock requires a master password that is not stored anywhere
- File writes use atomic tmp-then-rename to avoid half-written state
- No `unwrap()` on user input, no shell interpolation on user-provided
  paths or branch names, Content-Security-Policy on the embedded WebView

To report a security vulnerability, see `SECURITY.md` at the root of the
repository.

## 9. Changes to this policy

When this policy changes, the `Last updated` date at the top is bumped.
Because Lorica is distributed as an app, you see the new policy the next
time you install or update. Material changes (e.g. adding a third-party
processor, introducing any form of telemetry) will be announced in the
release notes.

## 10. Contact

For privacy questions, data requests, or GDPR-related inquiries:

**Alexandre Devlieger**
Email: `devliegeralexandre345@gmail.com`
Issue tracker: https://github.com/devliegeralexandre345-del/Lorica-ide/issues

This document, being maintained in Git alongside the Software's source
code, has its full revision history publicly auditable.
