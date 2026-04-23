# Lorica IDE

**Secure • AI-Powered • Native**

IDE nouvelle génération construit avec **Tauri 2 + Rust** (backend) et **React + CodeMirror** (frontend).

---

## 🆕 Nouveautés v2.2.0

Cette release transforme Lorica d'un **IDE avec des features IA** en un **IDE construit autour de l'IA**. Tout est natif, local-first, commit-friendly.

### Paradigme

- **🎯 Omnibar** (`Ctrl+P`) — Un seul surface pour fichiers / commandes / symboles / semantic search / agent. Préfixes `>`, `@`, `#`, `?`, `:`. Recent queries + saved searches.
- **⚡ Inline AI Edit** (`Ctrl+K`) — Sélectionne, décris le changement, l'IA rewrite en place. Streaming, quick-prompts, history de feedback pour Predict Next Edit.
- **🧠 Project Brain** — Mémoire projet persistante en `.lorica/brain/*.md` (decisions / facts / glossary / milestones). Liens `[[wiki]]`, vues List/Timeline/Graph, auto-extract depuis conversations agent.
- **🪄 Auto-Fix Loop** (`Ctrl+Alt+X`) — Error terminal → fix auto avec escalation Haiku→Sonnet→Opus, rerun, history, learn-from-success vers Brain.
- **🐝 Swarm Development** (`Ctrl+Alt+W`) — Décompose une feature en sous-tâches DAG, chacune dans son git worktree parallèle. Phase merge à la fin avec détection de conflits.
- **🔍 Multi-Agent Swarm Review** (`Ctrl+Shift+A`) — 4 agents spécialisés en parallèle (Bug / Security / Perf / Architect) + custom roles depuis `.lorica/swarm-roles.json`. Export findings vers Brain.
- **👤 Agent Identity** — Profil persistant (nom, tone, proactivity, personal memory) injecté à chaque session.
- **🏗️ Custom Agent Builder** — Wizard pour créer tes propres agents avec system prompt / permissions / triggers (on-save globs, shortcuts). Stockés `.lorica/agents/*.json`.

### Intelligence de code

- **📊 Semantic Types** (`Ctrl+Alt+Y`) — Brand types AI-inferred (UserId vs GroupId), mismatch underlines, auto-infer on save, export TypeScript.
- **🔥 Code Heatmap** (`Ctrl+Alt+G`) — Churn + author attribution + bus-factor warnings (⚠ solo-owned) sur le file tree.
- **🕸️ Code Canvas** (`Ctrl+Shift+N`) — Graphe dépendances interactif (SVG), filter-by-extension, fuzzy search, minimap.
- **✅ PR Ready?** (`Ctrl+Alt+P`) — 7 checks IA + Impact forecast + Architectural diff. Custom checks `.lorica/pr-checks.json`. "Fix with agent" par failure.
- **👀 Live Blame** (`Ctrl+Alt+B`) — Gutter auteur/commit/date, accent sur lignes uncommitted.

### Dev experience

- **🧪 Sandbox** (`Ctrl+Alt+S`) — Web Worker isolé, 3 modes: Run (AI-generated inputs) / Replay (behavior diff) / Probes (`// @probe`).
- **⏮️ Time Scrub** (`Ctrl+Alt+T`) — Scrub temporel par fichier, snapshot every 30s, diff side-by-side, intent-based rewind ("avant le refactor").
- **⭐ Bookmarks** (`Ctrl+M` toggle, `Ctrl+;` next) — Avec notes + groupes, panel cross-project.
- **📝 Scratchpad** — Multi-notebook en `.lorica/scratchpad/*.md`, markdown preview.
- **📋 TODO Board** — Kanban drag-and-drop, priority P0/P1/P2, due dates, tags, archive. Stocké `.lorica/todos.json`.
- **🌐 API Tester** (`Ctrl+Alt+H`) — Postman-lite: envs (`{{var}}`), collections per-project, response assertions.
- **🔤 Regex Builder** (`Ctrl+Alt+R`) — 20 patterns + saved custom + live tester.
- **📎 Clipboard History** (`Ctrl+Shift+V`) — 30 items rolling + pinning + search.
- **⏱️ Focus Timer** (`Ctrl+Alt+F`) — Pomodoro 25/5 + stats today/week/month/total.
- **🔎 Instant Preview** — Auto-route JSON/YAML/TOML/CSV/XML/URL/regex/SQL/HTML iframe/Markdown TOC.

### Polish

- **⌨️ Keyboard cheatsheet** (`?`) — searchable, catégorisée.
- **🛡️ Error boundaries** — crash localisé, jamais l'app entière.
- **🎛️ Settings feature grid** — toggle global pour toutes les features opt-in.
- **💡 Ambient HUD** — pill discret qui surface agent streaming / next-edit / swarm / auto-fix / heatmap.
- **⚙️ Performance HUD** (`Alt+Shift+P`) — FPS / heap / % live.
- **💾 Session restore** — projet, tabs, layout, thème restaurés au boot.

**[→ Release notes complètes v2.2.0](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/tag/v2.2.0)**

---

## ⬇️ Téléchargement

**[→ Voir toutes les releases](https://github.com/devliegeralexandre345-del/Lorica-ide/releases)**

| Plateforme | Format | Lien |
|------------|--------|------|
| 🪟 Windows | Installateur `.msi` | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.2.0_x64_en-US.msi) |
| 🪟 Windows | Executable `.exe` | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.2.0_x64-setup.exe) |
| 🐧 Linux | Package `.deb` (Debian/Ubuntu) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.2.0_amd64.deb) |
| 🐧 Linux | Package `.rpm` (Fedora/RHEL) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica-2.2.0-1.x86_64.rpm) |
| 🐧 Linux | `.AppImage` (universel) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.2.0_amd64.AppImage) |

> Les liens ci-dessus pointent vers la **dernière release**. Pour une version spécifique, rendez-vous sur la [page des releases](https://github.com/devliegeralexandre345-del/Lorica-ide/releases).

### 🔏 Code signing

Windows binaries of Lorica are currently **unsigned**. We're an early-stage
solo-maintainer project and we haven't yet qualified for the free
code-signing programs (they require established community reputation) nor
committed to a paid certificate. The binary you download is built
reproducibly from the tagged commit on GitHub — you can verify the SHA-256
against the release notes.

Once Lorica has enough community traction to qualify for free signing
(SignPath Foundation or equivalent), Windows releases will be signed
automatically via the existing GitHub Actions pipeline — no action needed
on your side.

### Installation rapide

**Windows**
```powershell
# MSI (recommandé)
winget install --source winget Lorica

# Ou télécharge le .msi / .exe ci-dessus et lance-le
```

> **⚠ Avertissement SmartScreen sur Windows**
>
> Les installeurs Lorica ne sont pas encore signés avec un certificat
> Authenticode — on est un projet OSS solo early-stage. Windows va afficher
> un avertissement :
>
> **SmartScreen (écran bleu "Windows a protégé votre PC")**
> → Clique **"Informations complémentaires"** → **"Exécuter quand même"**.
>
> **Smart App Control (blocage complet)** — sur Windows 11 récents
> → Clique droit sur le `.msi` → **Propriétés** → coche **"Débloquer"** → **OK**, puis relance.
> Si SAC refuse toujours, c'est que ton OS est configuré pour ne jamais
> accepter de binaires non signés — tu dois alors installer Lorica depuis
> les sources (voir [Lancement depuis les sources](#lancement-depuis-les-sources))
> ou attendre qu'on ait un certificat.
>
> **Pourquoi ce message apparaît** — SmartScreen et SAC bloquent par
> défaut les binaires sans signature Microsoft-partner. Lorica n'a pas
> encore cette signature (coût + reputation requise). Vérifier l'intégrité
> du fichier téléchargé reste possible via le SHA-256 :
> `Get-FileHash Lorica_2.2.0_x64_en-US.msi`
> à comparer avec le hash publié dans les
> [release notes](https://github.com/devliegeralexandre345-del/Lorica-ide/releases).

**Debian / Ubuntu**
```bash
wget https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.2.0_amd64.deb
sudo dpkg -i Lorica_2.2.0_amd64.deb
```

**Fedora / RHEL**
```bash
sudo rpm -i https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica-2.2.0-1.x86_64.rpm
```

**AppImage (toutes distros Linux)**
```bash
wget https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.2.0_amd64.AppImage
chmod +x Lorica_2.2.0_amd64.AppImage
./Lorica_2.2.0_amd64.AppImage
```

---

## 🔒 Privacy

Lorica est **local-first** et respecte le RGPD par conception :

- **Zéro télémétrie.** Aucun analytics, aucun endpoint Lorica, aucun tracker embarqué.
- **Toutes tes données restent sur ta machine** — code, fichiers, settings, historique, index semantic.
- **Les clés API (Anthropic, DeepSeek…) sont chiffrées** localement avec Argon2id + ChaCha20-Poly1305.
- **Les features IA sont opt-in.** Tant que tu n'entres pas de clé API, aucune donnée ne quitte ton ordinateur. Quand tu utilises l'IA, tes prompts vont **directement** au provider (Anthropic / DeepSeek) — il n'y a pas de serveur Lorica intermédiaire.

📄 **Politique de confidentialité complète : [PRIVACY.md](./PRIVACY.md)**
— détaille chaque transfert de données, tes droits RGPD, comment tout supprimer.

---

## Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Rust (Tauri 2) |
| Frontend | React 18 + Tailwind CSS |
| Éditeur | CodeMirror 6 |
| Crypto | ring (XChaCha20-Poly1305) + Argon2id |
| Terminal | portable-pty |
| File watch | notify |
| Large files | mmap + piece table |

---

## Lancement depuis les sources

### Prérequis

- **Rust** : [rustup.rs](https://rustup.rs)
- **Node.js 18+** : [nodejs.org](https://nodejs.org)
- **Linux** : `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev`
- **Windows** : Visual Studio Build Tools + WebView2
- **macOS** : Xcode Command Line Tools

### Installation

```bash
# Linux/macOS
chmod +x setup.sh && ./setup.sh

# Windows
setup.bat

# Ou manuellement :
npm install
cd src-tauri && cargo build && cd ..
```

### Développement

```bash
npm run tauri:dev
```

### Build production

```bash
npm run tauri:build
# → Binaires dans src-tauri/target/release/
# → Installateurs dans src-tauri/target/release/bundle/
```

---

## Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+P` | Command Palette |
| `Ctrl+S` | Sauvegarder |
| `Ctrl+Shift+S` | Tout sauvegarder |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+\`` | Toggle Terminal |
| `Ctrl+Shift+A` | Toggle AI Copilot |
| `Ctrl+Shift+G` | Git Panel |
| `Ctrl+Shift+F` | Recherche globale |
| `Ctrl+K → Z` | Zen Mode |
| `Ctrl+\` | Split Editor |
| `Ctrl+L` | Verrouiller l'IDE |
| `Escape` | Fermer / Quitter Zen |

---

## Sécurité

- Vault chiffré XChaCha20-Poly1305 avec KDF Argon2id
- Clés verrouillées en RAM (`mlock`) — jamais swappées sur disque
- Zéroisation automatique de la mémoire au déverrouillage (`zeroize`)
- Audit log avec hash chaîné SHA-256 (anti-tamper)
- Scan de secrets dans le code (API keys, tokens, passwords)

---

## Structure

```
lorica/
├── src/                      # Frontend React
│   ├── index.jsx             # Entry point
│   ├── loricaBridge.js       # Tauri ↔ React bridge
│   ├── App.jsx               # App principal
│   ├── components/           # Composants React
│   ├── hooks/                # Hooks custom
│   ├── store/                # Reducer + state
│   ├── utils/                # Languages, themes
│   └── styles/               # CSS global
├── src-tauri/                # Backend Rust
│   ├── src/
│   │   ├── lib.rs            # Entry + command registration
│   │   ├── filesystem.rs     # File I/O natif
│   │   ├── security.rs       # Vault chiffré
│   │   ├── terminal.rs       # PTY natif
│   │   ├── extensions.rs     # Debuggers & outils
│   │   ├── dap.rs            # Debug Adapter Protocol
│   │   ├── buffer.rs         # mmap + piece table
│   │   └── watcher.rs        # File watcher
│   ├── Cargo.toml
│   └── tauri.conf.json
├── webpack.config.js
├── tailwind.config.js
└── package.json
```
