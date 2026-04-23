# Launch posts — Show HN + Reddit templates

Templates below are calibrated for each platform's culture. Paste, adjust
the specifics, post. **Pick ONE to start** — don't carpet-bomb every site
at once, the community notices and penalizes it.

## Ordering recommendation

1. **r/rust** first — the friendliest audience for a Rust/Tauri project.
   If the post lands well, you get some stars, issues, and early
   feedback to reference in later posts.
2. **Show HN** 24-48h later — needs a bit of activity on the repo to not
   look like a ghost town. HN will surface it or bury it on its own
   rhythm, don't stress the timing.
3. **r/programming** or **r/commandline** only if the first two went well
   and you have follow-up material (a new feature, a blog post, a
   screencast).

Never post the same day on multiple big subs — Reddit's anti-spam flags
cross-posting by the same account in <24h.

---

## Show HN (news.ycombinator.com/submit)

HN rules: title starts with `Show HN:`, is a statement (no clickbait),
under 80 chars. First comment from you is the context.

### Title
```
Show HN: Lorica – a local-first AI IDE built with Tauri and Rust
```

### URL
```
https://github.com/devliegeralexandre345-del/Lorica-ide
```

### First comment (post immediately after submission)
```
Hi HN,

I've been building Lorica for the past few months: a native code editor that treats AI as a first-class citizen but keeps everything local-first.

A few design choices that might be interesting:

- Tauri 2 + Rust backend, React + CodeMirror 6 frontend. Startup around 800ms cold on my machine, RAM footprint under 200MB for a typical project.
- Zero telemetry. No Lorica-operated server exists. When you use AI features, your prompts go directly from your machine to Anthropic / DeepSeek using your own API key — nothing transits through me.
- Encrypted credential vault (Argon2id + XChaCha20-Poly1305) for API keys and secrets.
- Semantic code search that runs fully on-device via an ONNX embedding model — the index never leaves your repo.
- LSP + DAP clients with Content-Length-framed readers, a proper piece-table buffer for large files, atomic writes, regex ReDoS protection.

What's NOT here yet: remote collab, mobile build, fancy extension marketplace. If you want those, VSCode is better than me.

Happy to answer questions about the architecture, the Tauri experience, the choices around AI gating / consent, or anything else. Code signing is the next priority but we haven't hit the reputation bar for free cert programs yet — hence the SmartScreen warning on the Windows installer (README explains how to click through).

The repo:
https://github.com/devliegeralexandre345-del/Lorica-ide
```

### Things that help HN rank
- Reply fast to every comment in the first hour
- Don't argue — steelman the critique then explain your thinking
- If someone finds a real bug, fix it and push within the thread
- Don't ask for upvotes, it's counterproductive and against HN guidelines

---

## r/rust (reddit.com/r/rust/submit)

r/rust is the right target. They love Tauri, they love privacy-first,
they're polite, and the mods curate aggressively against spam.

### Post type: `link` (points to the GitHub repo)

### Title
```
Lorica — a local-first AI code editor in Rust + Tauri 2 (MIT)
```

### URL
```
https://github.com/devliegeralexandre345-del/Lorica-ide
```

### Optional first comment
```
Hey r/rust,

Sharing a project I've been working on: Lorica, a native code editor built entirely on Tauri 2 / Rust on the backend, React + CodeMirror on the frontend, MIT licensed.

Some Rust-specific bits:

- Piece-table buffer for large-file editing, backed by mmap2 for the original file + an append-only String for edits. Line index uses a Vec<usize> built at load time and rebuilt on each edit (there's a TODO to make this incremental).
- Argon2id + ChaCha20-Poly1305 vault via the `ring` crate. An AEAD-gated canary prevents GPU bruteforce against a side channel.
- LSP / DAP implemented as Content-Length-framed readers because a lot of clients get this wrong (including some older versions of very popular IDEs).
- notify for filesystem watching with a segment-based filter to drop events inside node_modules / .git / target — one cargo build was drowning the frontend otherwise.
- All user-input paths that go into shell invocations (git) use the `--` separator and validated branch names. No shell interpolation anywhere.
- Atomic writes everywhere it matters (tmp → fsync → rename).

There's an integrated Agent loop talking to Anthropic / DeepSeek, all gated behind an RGPD consent modal on first use. No telemetry, no phone-home. Key is stored encrypted locally.

Feedback welcome, especially on the Rust side. I'm a solo maintainer and I'm sure there are things to improve — the issue tracker is open.

Repo: https://github.com/devliegeralexandre345-del/Lorica-ide
```

### Things that help r/rust rank
- Mention Rust-specific design decisions — "what did you pick and why"
- Don't oversell. Don't say "revolutionary" or "best IDE ever"
- Include crates used (notify, ring, tokio, mmap2) — people scan for these
- Respond to every comment, even nitpicks. Particularly nitpicks.

---

## r/programming (more risky — only after traction)

r/programming is bigger but more toxic to "self-promotion posts". Only
post here if:

- You have 100+ GitHub stars already
- You have a genuine technical writeup (blog post about something you
  solved in Lorica's codebase — piece-table implementation, LSP framing
  quirks, Tauri gotchas, etc.)

### Title (technical writeup style, NOT a self-promo)
```
Implementing a piece-table buffer in Rust for mmap-backed large-file editing
```

The post URL is your blog post, NOT the repo. Link to the repo inside
the post, at the bottom, after you've earned the reader's attention.

### Things that help r/programming rank
- Technical substance, not marketing
- Code examples inline
- Benchmarks or numbers
- Honest about limitations ("this is O(n) on each edit, here's why and
  what I'd do differently")

---

## r/commandline and r/coolgithubprojects

Both are smaller but friendly. Use r/rust's post as a template, just
adjust the tagline and hook. r/coolgithubprojects explicitly welcomes
self-promotion as long as the repo is real.

---

## After a post goes live

- **Update the README** with a "As seen on HN / r/rust" badge if it
  lands on the front page
- **Add a CHANGELOG entry** if you shipped a fix in response to feedback
- **Do NOT edit your post for the first 24h** — Reddit de-ranks edited
  posts
- **Screenshot the traction** (upvotes, comments, star count jump) for
  the next SignPath reapplication — that's exactly what they asked for
  in their rejection email
