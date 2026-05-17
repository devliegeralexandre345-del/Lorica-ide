# Lorica IDE

**Secure • AI-Powered • Native**

IDE nouvelle génération construit avec **Tauri 2 + Rust** (backend) et **React + CodeMirror** (frontend).

> Pourquoi Lorica plutôt qu'un fork de VS Code ? Parce que **l'IA est
> au cœur**, pas un plugin. Parce que **rien ne quitte ta machine**
> sans que tu choisisses. Parce que c'est **du Rust natif**, pas
> Electron — boot rapide, RAM modeste, GPU pas réquisitionné. Et
> parce que tout est **opt-in** : si tu veux juste un éditeur, c'est
> un éditeur. Si tu veux un agent qui modifie ton repo, il est là.

---

## 🆕 Nouveautés v2.3.0

> **Dernière version : v2.3.01** — hotfix pour la compatibilité
> DeepSeek thinking-mode (round-trip de `reasoning_content` sur
> les tours multi-turn). Les liens de téléchargement ci-dessous
> pointent automatiquement sur la dernière release.

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

### Polish & qualité de vie

- **⌨️ Keyboard cheatsheet** (`?`) — searchable, catégorisée.
- **🛡️ Error boundaries** — crash localisé, jamais l'app entière.
- **🎛️ Settings feature grid** — toggle global pour toutes les features opt-in.
- **💡 Ambient HUD** — pill discret qui surface agent streaming / next-edit / swarm / auto-fix / heatmap.
- **⚙️ Performance HUD** (`Alt+Shift+P`) — FPS / heap / latence IA. Toggle direct dans Settings, persisté entre relaunches.
- **💾 Session restore** — projet, tabs, layout, thème, et préférences d'auto-lock restaurés au boot.

### AI providers

- **🤖 Anthropic** — Claude Sonnet 4 (défaut), Opus 4, Haiku 3.5.
- **🚀 DeepSeek V4** — Flash (rapide, défaut) et Pro (raisonnement profond, promo lancement).
- **🦙 Ollama** — modèles locaux (llama3.1, etc.) sans clé API.
- **🌐 OpenRouter** — accès unifié à des dizaines de modèles via une seule clé.

### Sécurité & UX agent

- **🔓 "Toujours approuver"** — clique une fois pour ce type d'outil, l'agent enchaîne sans re-demander. Plus besoin de YOLO mode pour avoir un workflow fluide.
- **🔑 Reset vault** — bouton "Mot de passe oublié" sur l'écran de lock. Plus besoin de redémarrer l'IDE quand tu ne te souviens plus du master password.
- **🔕 Auto-lock désactivé par défaut** — opt-in via Settings (2/5/10/30 min). Plus de surprise au retour de pause.
- **🤫 Silent install Windows** — l'updater NSIS s'exécute sans fenêtre wizard, ferme/réinstalle/relance Lorica tout seul.
- **🚫 Zéro console.exe qui flash** — toutes les commandes système (git, npm, LSP, DAP, terminal agent) tournent en background sans flash noir.

**[→ Release notes complètes v2.3.0](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/tag/v2.3.0)**

---

## 🛣️ Roadmap

| Prochaine release | Focus |
|---|---|
| **v2.3.5** | Optimisations frontend — boot < 600 ms, bundle gzip < 800 KiB |
| **v2.4** | Updates incrémentaux à la VS Code — pas de réinstall complet pour un changement de JS |
| **v2.5** | Optimisations backend Rust — streaming file tree, search parallèle |
| **v3.0** | Marketplace d'extensions avec SDK TypeScript public |
| **v4.0** | Dev à distance — SSH / WSL / devcontainer |
| **v5.0** | App mobile compagnon pour approuver les actions agent à distance |
| **v6.0** | Project Brain v2 — mémoire long-terme avec graphe de connaissances |
| **v7.0** | Moteur de refactor cross-file (rename, extract, move) avec preview |

Le plan détaillé jusqu'à v10 est dans `docs/roadmap/` (en local).
Les patches mineurs sortent en `vX.Y.0Z` (ex: `v2.3.01`), les optims
en `vX.Y.5`. Voir `docs/roadmap/00-versioning-rules.md` pour la
convention complète.

---

## ⬇️ Téléchargement

**[→ Voir toutes les releases](https://github.com/devliegeralexandre345-del/Lorica-ide/releases)**

| Plateforme | Format | Lien |
|------------|--------|------|
| 🪟 Windows | Installateur `.msi` | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.3.01_x64_en-US.msi) |
| 🪟 Windows | Executable `.exe` | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.3.01_x64-setup.exe) |
| 🐧 Linux | Package `.deb` (Debian/Ubuntu) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.3.01_amd64.deb) |
| 🐧 Linux | Package `.rpm` (Fedora/RHEL) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica-2.3.01-1.x86_64.rpm) |
| 🐧 Linux | `.AppImage` (universel) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.3.01_amd64.AppImage) |

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
> `Get-FileHash Lorica_2.3.01_x64_en-US.msi`
> à comparer avec le hash publié dans les
> [release notes](https://github.com/devliegeralexandre345-del/Lorica-ide/releases).

**Debian / Ubuntu**
```bash
wget https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.3.01_amd64.deb
sudo dpkg -i Lorica_2.3.01_amd64.deb
```

**Fedora / RHEL**
```bash
sudo rpm -i https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica-2.3.01-1.x86_64.rpm
```

**AppImage (toutes distros Linux)**
```bash
wget https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.3.01_amd64.AppImage
chmod +x Lorica_2.3.01_amd64.AppImage
./Lorica_2.3.01_amd64.AppImage
```

---

## 🔒 Privacy

Lorica est **local-first** et respecte le RGPD par conception :

- **Zéro télémétrie.** Aucun analytics, aucun endpoint Lorica, aucun tracker embarqué.
- **Toutes tes données restent sur ta machine** — code, fichiers, settings, historique, index semantic.
- **Les clés API (Anthropic, DeepSeek, OpenRouter…) sont chiffrées** localement avec Argon2id + ChaCha20-Poly1305.
- **Les features IA sont opt-in.** Tant que tu n'entres pas de clé API, aucune donnée ne quitte ton ordinateur. Quand tu utilises l'IA, tes prompts vont **directement** au provider (Anthropic / DeepSeek / OpenRouter / Ollama local) — il n'y a pas de serveur Lorica intermédiaire.
- **Ollama local** disponible si tu ne veux strictement rien envoyer en dehors de ta machine.

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
| Semantic search | fastembed (ONNX) + bincode index |
| Collab | Yjs + y-codemirror + y-webrtc |
| AI providers | Anthropic, DeepSeek V4, Ollama, OpenRouter |

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

Les essentiels — appuie sur `?` dans l'IDE pour la cheatsheet
complète, searchable et catégorisée.

### Navigation

| Raccourci | Action |
|-----------|--------|
| `Ctrl+P` | Omnibar (fichiers / commandes / symboles / semantic / agent) |
| `Ctrl+Shift+F` | Recherche globale dans le projet |
| `Ctrl+E` | Recent files switcher |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+\`` | Toggle terminal |
| `Ctrl+Shift+G` | Git panel |

### Édition & fichiers

| Raccourci | Action |
|-----------|--------|
| `Ctrl+S` | Sauvegarder |
| `Ctrl+Shift+S` | Tout sauvegarder |
| `Ctrl+\` | Split editor |
| `Ctrl+M` / `Ctrl+;` | Toggle bookmark / suivant |
| `Ctrl+Shift+V` | Clipboard history |

### IA

| Raccourci | Action |
|-----------|--------|
| `Ctrl+K` | Inline AI edit (sélection → décrire le changement) |
| `Ctrl+Shift+A` | Agent Copilot (et multi-agent swarm review) |
| `Ctrl+Alt+X` | Auto-fix loop (erreur terminal → fix avec escalation) |
| `Ctrl+Alt+W` | Swarm dev (décomposer feature → worktrees parallèles) |
| `Ctrl+Alt+P` | PR Ready ? (7 checks IA avant push) |

### Diagnostics & visualisation

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Alt+B` | Toggle git blame gutter |
| `Ctrl+Alt+G` | Code heatmap (churn + bus factor) |
| `Ctrl+Alt+Y` | Semantic types |
| `Ctrl+Shift+N` | Code canvas (graphe dépendances) |
| `Ctrl+Alt+T` | Time scrub (rewind temporel) |
| `Alt+Shift+P` | Performance HUD (FPS / heap / latence IA) |

### Outils dev

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Alt+S` | Sandbox (Web Worker isolé) |
| `Ctrl+Alt+H` | API tester |
| `Ctrl+Alt+R` | Regex builder |
| `Ctrl+Alt+F` | Focus timer Pomodoro |

### App

| Raccourci | Action |
|-----------|--------|
| `Ctrl+K → Z` | Zen mode |
| `Ctrl+L` | Verrouiller l'IDE (si auto-lock activé) |
| `?` | Cheatsheet complète |
| `Escape` | Fermer modal / quitter Zen |

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

---

## 🐛 Issues & retours

Tu trouves un bug ? Tu as une idée ? Tu veux discuter d'une feature ?

- **Bugs / problèmes** : [Issues GitHub](https://github.com/devliegeralexandre345-del/Lorica-ide/issues/new) — décris le problème, ta version, ton OS. Les patches mineurs (`vX.Y.0Z`) sortent vite quand le bug est clair.
- **Idées de features** : ouvre une issue avec le tag `enhancement`. Si ça matche un major prévu (voir roadmap plus haut), ça sera priorisé.
- **Question** : [Discussions GitHub](https://github.com/devliegeralexandre345-del/Lorica-ide/discussions) plutôt qu'une issue.

Lorica est maintenu solo en early stage — les retours détaillés
sont précieux. Capture d'écran, étapes de repro, ligne de log =
fix beaucoup plus rapide.

---

## 📄 Licence

[MIT](./LICENSE) — fais-en ce que tu veux. Si Lorica t'aide,
un ⭐ sur GitHub fait toujours plaisir.
