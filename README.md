# Lorica IDE

**Secure • AI-Powered • Native**

IDE nouvelle génération construit avec **Tauri 2 + Rust** (backend) et **React + CodeMirror** (frontend).

---

## ⬇️ Téléchargement

**[→ Voir toutes les releases](https://github.com/devliegeralexandre345-del/Lorica-ide/releases)**

| Plateforme | Format | Lien |
|------------|--------|------|
| 🪟 Windows | Installateur `.msi` | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.0.0_x64_en-US.msi) |
| 🪟 Windows | Executable `.exe` | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/Lorica_2.0.0_x64-setup.exe) |
| 🐧 Linux | Package `.deb` (Debian/Ubuntu) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/lorica_2.0.0_amd64.deb) |
| 🐧 Linux | Package `.rpm` (Fedora/RHEL) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/lorica-2.0.0-1.x86_64.rpm) |
| 🐧 Linux | `.AppImage` (universel) | [Télécharger](https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/lorica_2.0.0_amd64.AppImage) |

> Les liens ci-dessus pointent vers la **dernière release**. Pour une version spécifique, rendez-vous sur la [page des releases](https://github.com/devliegeralexandre345-del/Lorica-ide/releases).

### Installation rapide

**Windows**
```powershell
# MSI (recommandé)
winget install --source winget Lorica

# Ou télécharge le .msi / .exe ci-dessus et lance-le
```

**Debian / Ubuntu**
```bash
wget https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/lorica_2.0.0_amd64.deb
sudo dpkg -i lorica_2.0.0_amd64.deb
```

**Fedora / RHEL**
```bash
sudo rpm -i https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/lorica-2.0.0-1.x86_64.rpm
```

**AppImage (toutes distros Linux)**
```bash
wget https://github.com/devliegeralexandre345-del/Lorica-ide/releases/latest/download/lorica_2.0.0_amd64.AppImage
chmod +x lorica_2.0.0_amd64.AppImage
./lorica_2.0.0_amd64.AppImage
```

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
