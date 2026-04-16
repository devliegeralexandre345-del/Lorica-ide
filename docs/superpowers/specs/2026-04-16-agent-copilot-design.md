# Agent Copilot — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Objectif

Remplacer l'actuel `AICopilot` (chat simple, contexte fichier unique, pas de streaming) par un vrai agent agentique style Cline : l'IA peut lire/écrire des fichiers, exécuter des commandes, explorer le projet, avec streaming Markdown, approbation des actions et diff dans l'éditeur.

---

## Architecture générale

La stack agentique fonctionne en boucle :

1. L'utilisateur configure les permissions dans le modal de démarrage
2. L'utilisateur envoie un message
3. `useAgent.js` envoie à l'API Anthropic avec les outils activés
4. L'API stream les tokens → affichés en temps réel dans le panel
5. Si l'IA appelle un outil → stream pausé → bloc d'action affiché dans le panel
6. L'utilisateur approuve ou rejette (ou auto-approve en YOLO mode)
7. Le résultat de l'outil est envoyé à l'API → stream reprend
8. La boucle continue jusqu'à ce que l'IA n'appelle plus d'outil

Le panel reste à droite de l'IDE. Quand un `write_file` est approuvé, un onglet diff s'ouvre dans l'éditeur principal.

---

## Modal de configuration (nouveau chat)

Affiché à chaque fois que l'utilisateur démarre un nouveau chat.

### Contexte initial
| Option | Description | Avertissement |
|--------|-------------|---------------|
| Aucun (défaut) | L'IA explore elle-même via ses outils | — |
| Fichier actif | Contenu du fichier ouvert injecté au démarrage | — |
| Arbre de fichiers | Structure du projet envoyée au démarrage | ⚠ Consomme plus de tokens |
| Arbre + fichiers clés | Arbre + package.json, README, etc. | ⚠⚠ Consomme beaucoup plus de tokens |

### Permissions (checkboxes, toutes activées par défaut)
- Lire les fichiers
- Modifier les fichiers
- Créer / Supprimer des fichiers
- Exécuter des commandes terminal
- Recherche dans le projet
- Accès web

### Mode d'approbation
- **Approuver chaque action** (défaut) — un bloc apparaît pour chaque action destructive
- **YOLO mode** — toutes les actions sont auto-approuvées, un log est affiché

---

## Outils de l'IA

Chaque outil est déclaré dans `src/utils/agentTools.js` et mappé sur une commande Tauri ou une API JS native.

| Outil | Description | Implémentation |
|-------|-------------|----------------|
| `read_file` | Lire le contenu d'un fichier | Commande Tauri `read_file` |
| `write_file` | Écrire/modifier un fichier | Commande Tauri `write_file` |
| `list_dir` | Lister les fichiers d'un dossier | Commande Tauri `read_directory` |
| `create_file` | Créer un nouveau fichier | Commande Tauri `create_file` |
| `delete_file` | Supprimer un fichier | Commande Tauri `delete_file` |
| `run_command` | Exécuter une commande dans le terminal | Nouvelle commande Tauri `run_in_terminal` |
| `search_files` | Chercher du texte dans le projet | Commande Tauri `search_in_files` |
| `fetch_url` | Récupérer une URL | `fetch` JS natif |

Seuls les outils correspondant aux permissions activées sont envoyés à l'API.

---

## Streaming & rendu Markdown

- Utilise `fetch` avec `ReadableStream` sur l'API Anthropic (Server-Sent Events)
- Tokens affichés en temps réel dans `MarkdownMessage.jsx` via `react-markdown` + `react-syntax-highlighter`
- Curseur clignotant pendant le stream
- Bouton **Stop** pour interrompre le stream et annuler la boucle agentique

---

## Blocs d'action (tool use)

Composant `AgentToolBlock.jsx`. Trois états possibles :

### Outil non-destructif (read_file, list_dir, search_files, fetch_url)
Auto-exécuté si la permission est activée. Affiché comme bloc collapsé avec statut ✓.
```
┌─ read_file ──────────────────────── ✓ exécuté ─┐
│  📄 src/components/Editor.jsx                   │
└─────────────────────────────────────────────────┘
```

### Outil destructif — mode approbation
```
┌─ write_file ──────────────────── en attente... ─┐
│  📝 src/utils/completions.js                    │
│  [Voir le diff]  [✓ Approuver]  [✗ Rejeter]    │
└─────────────────────────────────────────────────┘
```

### Commande terminal
```
┌─ run_command ─────────────────── en attente... ─┐
│  $ npm run build                                │
│  [✓ Approuver]  [✗ Rejeter]                    │
└─────────────────────────────────────────────────┘
```

Cliquer "Voir le diff" ou "Approuver" sur un `write_file` ouvre un onglet diff dans l'éditeur (`DiffViewer.jsx` existant). Après application, l'onglet se ferme automatiquement.

---

## Nouveaux fichiers

| Fichier | Rôle |
|---------|------|
| `src/hooks/useAgent.js` | Boucle agentique, streaming SSE, exécution des outils |
| `src/components/AgentCopilot.jsx` | Panel principal (remplace `AICopilot.jsx`) |
| `src/components/AgentConfigModal.jsx` | Modal de configuration au démarrage d'un chat |
| `src/components/AgentToolBlock.jsx` | Bloc d'action (approbation, statut, diff) |
| `src/components/MarkdownMessage.jsx` | Rendu Markdown streamé |
| `src/utils/agentTools.js` | Définitions des outils pour l'API Anthropic |

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `src/App.jsx` | Importer `AgentCopilot` au lieu de `AICopilot` |
| `src/store/appReducer.js` | Nouveaux états : `agentSession`, `agentConfig`, `agentMessages`, `agentLoading` |
| `src-tauri/src/terminal.rs` | Ajouter la commande `run_in_terminal` si absente |

---

## Dépendances à ajouter

```
react-markdown
react-syntax-highlighter
```

---

## Style

Tous les composants utilisent exclusivement les tokens CSS Lorica existants :
- `bg-lorica-bg`, `bg-lorica-panel`, `bg-lorica-surface`
- `border-lorica-border`
- `text-lorica-text`, `text-lorica-textDim`, `text-lorica-accent`
- Classes utilitaires Tailwind déjà utilisées dans le projet

Aucun style custom, aucune dépendance CSS supplémentaire.
