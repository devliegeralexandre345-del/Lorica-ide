# Agent Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'AICopilot (chat simple) par un agent agentique style Cline avec tool use Anthropic, streaming Markdown, approbation des actions et ouverture d'onglets diff dans l'éditeur.

**Architecture:** Boucle agentique dans `useAgent.js` qui stream l'API Anthropic avec tool use, pause à chaque appel d'outil destructif pour approbation utilisateur, puis exécute via `window.lorica`. L'UI dans `AgentCopilot.jsx` affiche les messages en Markdown streamé et les tool calls dans des blocs expandables. Quand un `write_file` est approuvé, le fichier s'ouvre dans un nouvel onglet éditeur.

**Tech Stack:** React 18, Anthropic API (SSE streaming + tool use), `react-markdown`, `react-syntax-highlighter`, Tauri 2 (`window.lorica`), Tailwind CSS (tokens Lorica existants)

---

## Fichiers créés / modifiés

| Fichier | Action | Rôle |
|---------|--------|------|
| `src-tauri/src/terminal.rs` | Modifier | Ajouter `cmd_run_command` |
| `src-tauri/src/lib.rs` | Modifier | Enregistrer `cmd_run_command` |
| `src/loricaBridge.js` | Modifier | Exposer `terminal.runCommand` |
| `src/store/appReducer.js` | Modifier | Ajouter état agent + actions |
| `src/utils/agentTools.js` | Créer | Définitions des outils Anthropic |
| `src/components/MarkdownMessage.jsx` | Créer | Rendu Markdown streamé |
| `src/components/AgentToolBlock.jsx` | Créer | Bloc d'action avec approbation et diff inline |
| `src/components/AgentConfigModal.jsx` | Créer | Modal de config au démarrage du chat |
| `src/hooks/useAgent.js` | Créer | Boucle agentique + streaming |
| `src/components/AgentCopilot.jsx` | Créer | Panel principal (remplace AICopilot) |
| `src/App.jsx` | Modifier | Utiliser AgentCopilot + useAgent |

---

## Task 1: Ajouter `cmd_run_command` dans Rust

**Files:**
- Modify: `src-tauri/src/terminal.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Ajouter la struct `CommandOutput` et la commande dans `terminal.rs`**

À la fin de `src-tauri/src/terminal.rs`, après la dernière fonction, ajouter :

```rust
#[derive(serde::Serialize, serde::Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

#[tauri::command]
pub fn cmd_run_command(command: String, cwd: Option<String>) -> CmdResult<CommandOutput> {
    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };
    let shell_flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let mut cmd = std::process::Command::new(shell);
    cmd.arg(shell_flag).arg(&command);

    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            CmdResult::ok(CommandOutput {
                stdout,
                stderr,
                exit_code,
                success: output.status.success(),
            })
        }
        Err(e) => CmdResult::err(format!("Failed to run command: {}", e)),
    }
}
```

- [ ] **Step 2: Enregistrer la commande dans `lib.rs`**

Dans `src-tauri/src/lib.rs`, trouver le bloc `// Terminal` dans `invoke_handler` et ajouter `terminal::cmd_run_command` :

```rust
// Terminal
terminal::cmd_terminal_create,
terminal::cmd_terminal_write,
terminal::cmd_terminal_resize,
terminal::cmd_terminal_kill,
terminal::cmd_run_command,
```

- [ ] **Step 3: Exposer dans `loricaBridge.js`**

Dans `src/loricaBridge.js`, trouver le bloc `const terminal = {` et ajouter avant la `}` fermante :

```js
runCommand: (command, cwd) => safeInvoke('cmd_run_command', { command, cwd }),
```

- [ ] **Step 4: Compiler pour vérifier**

```bash
cd src-tauri && cargo check
```

Résultat attendu : `Finished` sans erreurs.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/terminal.rs src-tauri/src/lib.rs src/loricaBridge.js
git commit -m "feat: add cmd_run_command Tauri command for agent tool use"
```

---

## Task 2: Installer les dépendances npm

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Installer `react-markdown` et `react-syntax-highlighter`**

```bash
npm install react-markdown react-syntax-highlighter
```

Résultat attendu : les deux packages apparaissent dans `package.json` dependencies.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-markdown and react-syntax-highlighter"
```

---

## Task 3: Ajouter l'état agent dans `appReducer.js`

**Files:**
- Modify: `src/store/appReducer.js`

- [ ] **Step 1: Ajouter l'état initial agent**

Dans `src/store/appReducer.js`, trouver le bloc `// AI` dans `initialState` et le remplacer par :

```js
// AI (legacy copilot — conservé pour compatibilité)
aiMessages: [],
aiLoading: false,
aiApiKey: '',
aiProvider: 'anthropic',
aiDeepseekKey: '',

// Agent Copilot
agentMessages: [],        // [{ id, role, content, toolCalls }]
agentLoading: false,
agentConfig: null,        // { context, permissions, autoApprove }
agentSessionActive: false,
```

- [ ] **Step 2: Ajouter les cases reducer pour l'agent**

Dans `appReducer`, après le `case 'SET_AI_LOADING':` existant, ajouter :

```js
case 'AGENT_SET_CONFIG':
  return {
    ...state,
    agentConfig: action.config,
    agentSessionActive: true,
    agentMessages: [],
  };
case 'AGENT_ADD_MESSAGE': {
  const msg = { ...action.message, id: Date.now() + Math.random(), toolCalls: action.message.toolCalls || [] };
  return { ...state, agentMessages: [...state.agentMessages, msg] };
}
case 'AGENT_APPEND_STREAM': {
  const msgs = [...state.agentMessages];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    msgs[msgs.length - 1] = { ...last, content: last.content + action.text };
  }
  return { ...state, agentMessages: msgs };
}
case 'AGENT_ADD_TOOL_CALL': {
  const msgs = [...state.agentMessages];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    msgs[msgs.length - 1] = {
      ...last,
      toolCalls: [...(last.toolCalls || []), action.toolCall],
    };
  }
  return { ...state, agentMessages: msgs };
}
case 'AGENT_UPDATE_TOOL_CALL': {
  const msgs = state.agentMessages.map((msg) => {
    if (!msg.toolCalls) return msg;
    const updated = msg.toolCalls.map((tc) =>
      tc.id === action.id ? { ...tc, ...action.updates } : tc
    );
    return { ...msg, toolCalls: updated };
  });
  return { ...state, agentMessages: msgs };
}
case 'AGENT_SET_LOADING':
  return { ...state, agentLoading: action.value };
case 'AGENT_CLEAR':
  return { ...state, agentMessages: [], agentLoading: false, agentSessionActive: false, agentConfig: null };
```

- [ ] **Step 3: Vérifier que le build ne casse pas**

```bash
npm run build 2>&1 | tail -20
```

Résultat attendu : `compiled successfully` ou warnings sans erreurs fatales.

- [ ] **Step 4: Commit**

```bash
git add src/store/appReducer.js
git commit -m "feat: add agent state and reducer actions to appReducer"
```

---

## Task 4: Créer `src/utils/agentTools.js`

**Files:**
- Create: `src/utils/agentTools.js`

- [ ] **Step 1: Créer le fichier**

```js
// src/utils/agentTools.js
// Définitions des outils Anthropic pour l'agent Lorica

export const TOOL_PERMISSIONS = {
  read_file:    'canRead',
  list_dir:     'canRead',
  search_files: 'canSearch',
  fetch_url:    'canWeb',
  write_file:   'canWrite',
  create_file:  'canCreate',
  delete_file:  'canDelete',
  run_command:  'canTerminal',
};

// Outils non-destructifs (auto-exécutés sans demande d'approbation)
export const NON_DESTRUCTIVE_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'fetch_url']);

const ALL_TOOL_DEFS = [
  {
    name: 'read_file',
    description: 'Read the content of a file at the given absolute path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with new content. Shows a diff to the user before applying.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Full new content of the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the files and subdirectories in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_file',
    description: 'Create a new empty file at the given path. Fails if the file already exists.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path for the new file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory at the given path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command in the project directory and return stdout/stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern across all files in the project.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        case_sensitive: { type: 'boolean', description: 'Whether to search case-sensitively' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch the text content of a URL (documentation, API, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
  },
];

/**
 * Returns the subset of tool definitions matching the enabled permissions.
 * @param {object} permissions - { canRead, canWrite, canCreate, canDelete, canTerminal, canSearch, canWeb }
 */
export function buildToolsForPermissions(permissions) {
  return ALL_TOOL_DEFS.filter((tool) => {
    const permKey = TOOL_PERMISSIONS[tool.name];
    return permKey ? permissions[permKey] : true;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/agentTools.js
git commit -m "feat: add agent tool definitions for Anthropic tool use"
```

---

## Task 5: Créer `src/components/MarkdownMessage.jsx`

**Files:**
- Create: `src/components/MarkdownMessage.jsx`

- [ ] **Step 1: Créer le composant**

```jsx
// src/components/MarkdownMessage.jsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function MarkdownMessage({ content, isStreaming }) {
  return (
    <div className="text-xs text-lorica-text leading-relaxed markdown-agent">
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: '0.5rem 0',
                    borderRadius: '0.375rem',
                    fontSize: '11px',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                  }}
                  {...props}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              );
            }
            return (
              <code
                className="px-1 py-0.5 rounded text-[11px] bg-lorica-bg border border-lorica-border text-lorica-accent font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-lorica-text">{children}</li>;
          },
          h1({ children }) {
            return <h1 className="text-sm font-bold text-lorica-text mb-1 mt-2">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-xs font-semibold text-lorica-text mb-1 mt-2">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-xs font-semibold text-lorica-textDim mb-1 mt-1">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-lorica-accent/40 pl-2 text-lorica-textDim italic my-1">
                {children}
              </blockquote>
            );
          },
          strong({ children }) {
            return <strong className="font-semibold text-lorica-text">{children}</strong>;
          },
          a({ href, children }) {
            return (
              <span className="text-lorica-accent underline cursor-pointer" title={href}>
                {children}
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3 bg-lorica-accent animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MarkdownMessage.jsx
git commit -m "feat: add MarkdownMessage component with streaming cursor"
```

---

## Task 6: Créer `src/components/AgentToolBlock.jsx`

**Files:**
- Create: `src/components/AgentToolBlock.jsx`

- [ ] **Step 1: Créer le composant**

```jsx
// src/components/AgentToolBlock.jsx
import React, { useState } from 'react';
import {
  FileText, Pencil, FolderOpen, Plus, Trash2, Terminal,
  Search, Globe, Check, X, Loader2, ChevronDown, ChevronRight
} from 'lucide-react';

const TOOL_ICONS = {
  read_file: FileText,
  write_file: Pencil,
  list_dir: FolderOpen,
  create_file: Plus,
  delete_file: Trash2,
  run_command: Terminal,
  search_files: Search,
  fetch_url: Globe,
};

const TOOL_LABELS = {
  read_file: 'Lire',
  write_file: 'Écrire',
  list_dir: 'Lister',
  create_file: 'Créer',
  delete_file: 'Supprimer',
  run_command: 'Exécuter',
  search_files: 'Rechercher',
  fetch_url: 'Fetch',
};

function InlineDiff({ oldContent, newContent }) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lines = [];
  for (let i = 0; i < maxLen; i++) {
    const a = oldLines[i] ?? null;
    const b = newLines[i] ?? null;
    if (a === b) {
      lines.push({ type: 'same', content: b });
    } else {
      if (a !== null) lines.push({ type: 'removed', content: a });
      if (b !== null) lines.push({ type: 'added', content: b });
    }
  }
  return (
    <div className="mt-2 rounded border border-lorica-border overflow-auto max-h-48 text-[10px] font-mono">
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            line.type === 'added'
              ? 'bg-green-900/20 text-green-400 px-2'
              : line.type === 'removed'
              ? 'bg-red-900/20 text-red-400 px-2 line-through'
              : 'px-2 text-lorica-textDim'
          }
        >
          {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
          {line.content}
        </div>
      ))}
    </div>
  );
}

export default function AgentToolBlock({ toolCall, onApprove, onReject }) {
  const [showDiff, setShowDiff] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[toolCall.name] || FileText;
  const label = TOOL_LABELS[toolCall.name] || toolCall.name;

  const isPending = toolCall.status === 'pending';
  const isRunning = toolCall.status === 'running';
  const isDone = toolCall.status === 'done';
  const isRejected = toolCall.status === 'rejected';
  const isError = toolCall.status === 'error';

  // Summary of what the tool does
  const summary = (() => {
    const i = toolCall.input || {};
    if (toolCall.name === 'read_file') return i.path || '';
    if (toolCall.name === 'write_file') return i.path || '';
    if (toolCall.name === 'list_dir') return i.path || '';
    if (toolCall.name === 'create_file') return i.path || '';
    if (toolCall.name === 'delete_file') return i.path || '';
    if (toolCall.name === 'run_command') return i.command || '';
    if (toolCall.name === 'search_files') return `"${i.query || ''}"`;
    if (toolCall.name === 'fetch_url') return i.url || '';
    return '';
  })();

  return (
    <div className={`rounded-lg border text-[11px] overflow-hidden my-1 ${
      isPending ? 'border-lorica-accent/50 bg-lorica-accent/5'
      : isDone ? 'border-lorica-border bg-lorica-panel/50'
      : isRejected ? 'border-red-500/30 bg-red-900/5'
      : isError ? 'border-red-500/50 bg-red-900/10'
      : 'border-lorica-border bg-lorica-panel/50'
    }`}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon size={12} className={isPending ? 'text-lorica-accent' : 'text-lorica-textDim'} />
        <span className={`font-mono font-semibold ${isPending ? 'text-lorica-accent' : 'text-lorica-textDim'}`}>
          {label}
        </span>
        <span className="flex-1 truncate text-lorica-textDim opacity-70 font-mono">{summary}</span>

        {/* Status indicator */}
        {isRunning && <Loader2 size={11} className="animate-spin text-lorica-accent shrink-0" />}
        {isDone && <Check size={11} className="text-green-400 shrink-0" />}
        {isRejected && <X size={11} className="text-red-400 shrink-0" />}
        {isError && <X size={11} className="text-red-400 shrink-0" />}

        {expanded ? (
          <ChevronDown size={10} className="text-lorica-textDim shrink-0" />
        ) : (
          <ChevronRight size={10} className="text-lorica-textDim shrink-0" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-lorica-border/50">
          {/* Show full input */}
          <div className="mt-1.5 font-mono text-[10px] text-lorica-textDim whitespace-pre-wrap bg-lorica-bg rounded p-1.5 border border-lorica-border max-h-32 overflow-auto">
            {JSON.stringify(toolCall.input || {}, null, 2)}
          </div>

          {/* Diff for write_file */}
          {toolCall.name === 'write_file' && toolCall.input?.content && (
            <button
              onClick={() => setShowDiff((v) => !v)}
              className="mt-1.5 text-[10px] text-lorica-accent hover:underline"
            >
              {showDiff ? 'Masquer le diff' : 'Voir le diff'}
            </button>
          )}
          {showDiff && toolCall.name === 'write_file' && (
            <InlineDiff
              oldContent={toolCall.oldContent || ''}
              newContent={toolCall.input?.content || ''}
            />
          )}

          {/* Result */}
          {(isDone || isError) && toolCall.result && (
            <div className={`mt-1.5 font-mono text-[10px] whitespace-pre-wrap rounded p-1.5 border max-h-32 overflow-auto ${
              isError ? 'text-red-400 bg-red-900/10 border-red-500/30' : 'text-lorica-textDim bg-lorica-bg border-lorica-border'
            }`}>
              {toolCall.result}
            </div>
          )}

          {/* Approve / Reject buttons */}
          {isPending && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => onApprove(toolCall.id)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-green-900/20 border border-green-500/40 text-green-400 hover:bg-green-900/40 transition-colors"
              >
                <Check size={10} /> Approuver
              </button>
              <button
                onClick={() => onReject(toolCall.id)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-900/20 border border-red-500/40 text-red-400 hover:bg-red-900/40 transition-colors"
              >
                <X size={10} /> Rejeter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AgentToolBlock.jsx
git commit -m "feat: add AgentToolBlock component with approval, diff, and status"
```

---

## Task 7: Créer `src/components/AgentConfigModal.jsx`

**Files:**
- Create: `src/components/AgentConfigModal.jsx`

- [ ] **Step 1: Créer le composant**

```jsx
// src/components/AgentConfigModal.jsx
import React, { useState } from 'react';
import { Bot, AlertTriangle, X } from 'lucide-react';

const DEFAULT_PERMISSIONS = {
  canRead: true,
  canWrite: true,
  canCreate: true,
  canDelete: true,
  canTerminal: true,
  canSearch: true,
  canWeb: true,
};

const PERM_LABELS = {
  canRead: 'Lire les fichiers',
  canWrite: 'Modifier les fichiers',
  canCreate: 'Créer des fichiers',
  canDelete: 'Supprimer des fichiers',
  canTerminal: 'Exécuter des commandes terminal',
  canSearch: 'Recherche dans le projet',
  canWeb: 'Accès web (fetch URL)',
};

const CONTEXT_OPTIONS = [
  { value: 'none', label: 'Aucun (défaut)', warning: null },
  { value: 'active', label: 'Fichier actif', warning: null },
  { value: 'tree', label: 'Arbre de fichiers', warning: '⚠ Consomme plus de tokens' },
  { value: 'tree_keys', label: 'Arbre + fichiers clés (package.json, README…)', warning: '⚠⚠ Consomme beaucoup plus de tokens' },
];

export default function AgentConfigModal({ onStart, onCancel }) {
  const [context, setContext] = useState('none');
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [autoApprove, setAutoApprove] = useState(false);

  const togglePerm = (key) => setPermissions((p) => ({ ...p, [key]: !p[key] }));

  const handleStart = () => {
    onStart({ context, permissions, autoApprove });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-lorica-panel border border-lorica-border rounded-xl shadow-2xl w-80 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lorica-border">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-lorica-accent" />
            <span className="text-xs font-semibold text-lorica-text">Nouveau chat agent</span>
          </div>
          <button onClick={onCancel} className="text-lorica-textDim hover:text-lorica-text transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          {/* Contexte initial */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-2">
              Contexte initial
            </div>
            <div className="space-y-1">
              {CONTEXT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="context"
                    value={opt.value}
                    checked={context === opt.value}
                    onChange={() => setContext(opt.value)}
                    className="mt-0.5 accent-lorica-accent"
                  />
                  <div>
                    <span className="text-xs text-lorica-text group-hover:text-lorica-accent transition-colors">
                      {opt.label}
                    </span>
                    {opt.warning && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <AlertTriangle size={9} className="text-yellow-400 shrink-0" />
                        <span className="text-[10px] text-yellow-400">{opt.warning}</span>
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Permissions */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-2">
              Permissions
            </div>
            <div className="space-y-1">
              {Object.entries(PERM_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={permissions[key]}
                    onChange={() => togglePerm(key)}
                    className="accent-lorica-accent"
                  />
                  <span className="text-xs text-lorica-text group-hover:text-lorica-accent transition-colors">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Mode approbation */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-2">
              Mode approbation
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="approve"
                  checked={!autoApprove}
                  onChange={() => setAutoApprove(false)}
                  className="accent-lorica-accent"
                />
                <span className="text-xs text-lorica-text">Approuver chaque action</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="approve"
                  checked={autoApprove}
                  onChange={() => setAutoApprove(true)}
                  className="accent-lorica-accent"
                />
                <span className="text-xs text-lorica-text">
                  YOLO — auto-approuver tout
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-lorica-border">
          <button
            onClick={handleStart}
            className="w-full py-1.5 rounded-lg bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent text-xs font-semibold hover:bg-lorica-accent/30 transition-colors"
          >
            Démarrer
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AgentConfigModal.jsx
git commit -m "feat: add AgentConfigModal with permissions and context options"
```

---

## Task 8: Créer `src/hooks/useAgent.js`

**Files:**
- Create: `src/hooks/useAgent.js`

- [ ] **Step 1: Créer le hook**

```js
// src/hooks/useAgent.js
import { useCallback, useRef } from 'react';
import { buildToolsForPermissions, NON_DESTRUCTIVE_TOOLS } from '../utils/agentTools';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export function useAgent(state, dispatch) {
  const abortRef = useRef(null);
  // Map of toolCallId -> { resolve } — used to wait for user approval
  const approvalRef = useRef({});

  // Called by AgentCopilot when user clicks "Approuver"
  const approveToolCall = useCallback((id) => {
    approvalRef.current[id]?.resolve(true);
    delete approvalRef.current[id];
  }, []);

  // Called by AgentCopilot when user clicks "Rejeter"
  const rejectToolCall = useCallback((id) => {
    approvalRef.current[id]?.resolve(false);
    delete approvalRef.current[id];
  }, []);

  // Stop the running agent
  const stop = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'AGENT_SET_LOADING', value: false });
  }, [dispatch]);

  // Wait for user to approve or reject a tool call
  function waitForApproval(id) {
    return new Promise((resolve) => {
      approvalRef.current[id] = { resolve };
    });
  }

  // Execute a single tool call
  async function executeTool(toolCall, config, projectPath) {
    const isDestructive = !NON_DESTRUCTIVE_TOOLS.has(toolCall.name);

    if (isDestructive && !config.autoApprove) {
      // For write_file: try to read old content before asking approval
      if (toolCall.name === 'write_file' && toolCall.input?.path) {
        try {
          const r = await window.lorica.fs.readFile(toolCall.input.path);
          if (r.success) {
            dispatch({
              type: 'AGENT_UPDATE_TOOL_CALL',
              id: toolCall.id,
              updates: { oldContent: r.data.content },
            });
          }
        } catch (_) {}
      }

      const approved = await waitForApproval(toolCall.id);
      if (!approved) {
        dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'rejected' } });
        return 'Action rejected by user.';
      }
    }

    dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'running' } });

    try {
      let result = '';

      switch (toolCall.name) {
        case 'read_file': {
          const r = await window.lorica.fs.readFile(toolCall.input.path);
          result = r.success ? r.data.content : `Error: ${r.error}`;
          break;
        }
        case 'write_file': {
          const r = await window.lorica.fs.writeFile(toolCall.input.path, toolCall.input.content);
          if (r.success) {
            result = 'File written successfully.';
            // Open file in editor tab
            const name = toolCall.input.path.split(/[\\/]/).pop();
            const ext = name.includes('.') ? name.split('.').pop() : '';
            dispatch({
              type: 'OPEN_FILE',
              file: { path: toolCall.input.path, name, content: toolCall.input.content, extension: ext, dirty: false },
            });
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'list_dir': {
          const r = await window.lorica.fs.readDir(toolCall.input.path);
          if (r.success) {
            result = r.data.map((e) => `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'create_file': {
          const r = await window.lorica.fs.createFile(toolCall.input.path);
          result = r.success ? 'File created.' : `Error: ${r.error}`;
          break;
        }
        case 'delete_file': {
          const r = await window.lorica.fs.deletePath(toolCall.input.path);
          result = r.success ? 'Deleted.' : `Error: ${r.error}`;
          break;
        }
        case 'run_command': {
          const cwd = toolCall.input.cwd || projectPath;
          const r = await window.lorica.terminal.runCommand(toolCall.input.command, cwd);
          if (r.success) {
            const d = r.data;
            result = `exit ${d.exit_code}\n${d.stdout}${d.stderr ? '\nSTDERR:\n' + d.stderr : ''}`.trim();
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'search_files': {
          const r = await window.lorica.search.searchInFiles(
            projectPath,
            toolCall.input.query,
            toolCall.input.case_sensitive ?? false,
            50
          );
          if (r.success) {
            const matches = r.data.matches.slice(0, 20);
            result = matches.length === 0
              ? 'No matches found.'
              : matches.map((m) => `${m.preview}:${m.line} — ${m.text}`).join('\n');
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'fetch_url': {
          try {
            const resp = await fetch(toolCall.input.url);
            const text = await resp.text();
            // Truncate to 8000 chars to avoid flooding context
            result = text.length > 8000 ? text.slice(0, 8000) + '\n[truncated]' : text;
          } catch (e) {
            result = `Fetch error: ${e.message}`;
          }
          break;
        }
        default:
          result = `Unknown tool: ${toolCall.name}`;
      }

      dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'done', result } });
      return result;
    } catch (e) {
      const errMsg = `Error: ${e.message}`;
      dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'error', result: errMsg } });
      return errMsg;
    }
  }

  // Build the initial context injection based on config
  async function buildInitialContext(config, activeFile, projectPath) {
    if (config.context === 'none' || !projectPath) return null;

    if (config.context === 'active' && activeFile) {
      return `Current open file: ${activeFile.name}\n\`\`\`${activeFile.extension}\n${activeFile.content}\n\`\`\``;
    }

    if (config.context === 'tree' || config.context === 'tree_keys') {
      const r = await window.lorica.fs.readDir(projectPath);
      if (!r.success) return null;
      const flatten = (entries, indent = '') =>
        entries.map((e) =>
          `${indent}${e.isDirectory ? '📁' : '📄'} ${e.name}${e.children ? '\n' + flatten(e.children, indent + '  ') : ''}`
        ).join('\n');
      let ctx = `Project structure (${projectPath}):\n${flatten(r.data)}`;

      if (config.context === 'tree_keys') {
        for (const keyFile of ['package.json', 'README.md', 'Cargo.toml']) {
          const candidate = `${projectPath}/${keyFile}`;
          const fr = await window.lorica.fs.readFile(candidate);
          if (fr.success) {
            ctx += `\n\n--- ${keyFile} ---\n${fr.data.content.slice(0, 3000)}`;
          }
        }
      }
      return ctx;
    }
    return null;
  }

  // Parse SSE stream and return { textContent, toolUses, stopReason }
  async function parseStream(response, dispatch) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let textContent = '';
    const toolUses = []; // { id, name, inputAccum, input }
    let stopReason = null;
    let activeToolIdx = -1;

    dispatch({ type: 'AGENT_ADD_MESSAGE', message: { role: 'assistant', content: '', toolCalls: [] } });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { continue; }

        if (ev.type === 'content_block_start') {
          if (ev.content_block.type === 'tool_use') {
            const toolCall = {
              id: ev.content_block.id,
              name: ev.content_block.name,
              inputAccum: '',
              input: null,
              status: 'pending',
            };
            toolUses.push(toolCall);
            activeToolIdx = toolUses.length - 1;
            dispatch({
              type: 'AGENT_ADD_TOOL_CALL',
              toolCall: { id: toolCall.id, name: toolCall.name, input: {}, status: 'pending' },
            });
          } else if (ev.content_block.type === 'text') {
            activeToolIdx = -1;
          }
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'text_delta') {
            textContent += ev.delta.text;
            dispatch({ type: 'AGENT_APPEND_STREAM', text: ev.delta.text });
          } else if (ev.delta.type === 'input_json_delta' && activeToolIdx >= 0) {
            toolUses[activeToolIdx].inputAccum += ev.delta.partial_json;
          }
        } else if (ev.type === 'content_block_stop') {
          if (activeToolIdx >= 0 && toolUses[activeToolIdx].input === null) {
            try {
              toolUses[activeToolIdx].input = JSON.parse(toolUses[activeToolIdx].inputAccum);
              dispatch({
                type: 'AGENT_UPDATE_TOOL_CALL',
                id: toolUses[activeToolIdx].id,
                updates: { input: toolUses[activeToolIdx].input },
              });
            } catch (_) {
              toolUses[activeToolIdx].input = {};
            }
          }
        } else if (ev.type === 'message_delta') {
          stopReason = ev.delta?.stop_reason || stopReason;
        }
      }
    }

    return { textContent, toolUses, stopReason };
  }

  const sendMessage = useCallback(async (userMessage, activeFile) => {
    if (!state.aiApiKey) {
      dispatch({
        type: 'AGENT_ADD_MESSAGE',
        message: { role: 'assistant', content: '⚠️ Configure ta clé API Anthropic dans les Paramètres.' },
      });
      return;
    }

    const config = state.agentConfig;
    const projectPath = state.projectPath;
    const tools = buildToolsForPermissions(config.permissions);

    // Build message history for API
    const apiMessages = [];

    // Initial context injection (system-like user message)
    const ctxText = await buildInitialContext(config, activeFile, projectPath);
    if (ctxText) {
      apiMessages.push({ role: 'user', content: ctxText });
      apiMessages.push({ role: 'assistant', content: 'Contexte reçu. Comment puis-je t\'aider ?' });
    }

    // Add conversation history (skip last 2 if they were the context injection)
    for (const msg of state.agentMessages) {
      if (msg.role === 'user') {
        apiMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        // Rebuild Anthropic content blocks
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls || []) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input || {} });
        }
        if (content.length > 0) apiMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool_results') {
        apiMessages.push({ role: 'user', content: msg.results });
      }
    }

    // Add current user message
    dispatch({ type: 'AGENT_ADD_MESSAGE', message: { role: 'user', content: userMessage } });
    apiMessages.push({ role: 'user', content: userMessage });

    dispatch({ type: 'AGENT_SET_LOADING', value: true });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Agentic loop
      while (true) {
        const response = await fetch(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': state.aiApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8096,
            stream: true,
            tools: tools.length > 0 ? tools : undefined,
            system: `You are Lorica Agent, an expert AI embedded in the Lorica IDE. You have direct access to the user's codebase via tools. Be concise, precise, and always use tools to read files before modifying them. Project path: ${projectPath || 'unknown'}.`,
            messages: apiMessages,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          dispatch({
            type: 'AGENT_ADD_MESSAGE',
            message: { role: 'assistant', content: `❌ API Error: ${err.error?.message || response.statusText}` },
          });
          break;
        }

        const { textContent, toolUses, stopReason } = await parseStream(response, dispatch);

        // Build assistant content for API history
        const assistantContent = [];
        if (textContent) assistantContent.push({ type: 'text', text: textContent });
        for (const tu of toolUses) {
          assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input || {} });
        }
        if (assistantContent.length > 0) {
          apiMessages.push({ role: 'assistant', content: assistantContent });
        }

        if (stopReason !== 'tool_use' || toolUses.length === 0) break;

        // Execute tools and collect results
        const toolResults = [];
        for (const tu of toolUses) {
          const result = await executeTool(tu, config, projectPath);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
        }

        // Store tool results in agent messages for UI (role: 'tool_results')
        dispatch({
          type: 'AGENT_ADD_MESSAGE',
          message: { role: 'tool_results', results: toolResults, content: '' },
        });

        apiMessages.push({ role: 'user', content: toolResults });
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        dispatch({
          type: 'AGENT_ADD_MESSAGE',
          message: { role: 'assistant', content: `❌ Erreur: ${e.message}` },
        });
      }
    } finally {
      dispatch({ type: 'AGENT_SET_LOADING', value: false });
    }
  }, [state.aiApiKey, state.agentConfig, state.agentMessages, state.projectPath, dispatch]);

  return { sendMessage, approveToolCall, rejectToolCall, stop };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAgent.js
git commit -m "feat: add useAgent hook with streaming, tool use, and approval flow"
```

---

## Task 9: Créer `src/components/AgentCopilot.jsx`

**Files:**
- Create: `src/components/AgentCopilot.jsx`

- [ ] **Step 1: Créer le composant**

```jsx
// src/components/AgentCopilot.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Square, Plus, Trash2, Loader2 } from 'lucide-react';
import AgentConfigModal from './AgentConfigModal';
import AgentToolBlock from './AgentToolBlock';
import MarkdownMessage from './MarkdownMessage';

export default function AgentCopilot({ state, dispatch, agent, activeFile }) {
  const [input, setInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.agentMessages]);

  const handleStart = (config) => {
    dispatch({ type: 'AGENT_SET_CONFIG', config });
    setShowConfig(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSend = () => {
    if (!input.trim() || state.agentLoading) return;
    agent.sendMessage(input.trim(), activeFile);
    setInput('');
  };

  const handleNewChat = () => {
    dispatch({ type: 'AGENT_CLEAR' });
    setShowConfig(true);
  };

  const isActive = state.agentSessionActive;

  return (
    <div className="flex flex-col h-full">
      {/* Config Modal */}
      {showConfig && (
        <AgentConfigModal
          onStart={handleStart}
          onCancel={() => setShowConfig(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border shrink-0">
        <Bot size={14} className="text-lorica-accent" />
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Agent</span>

        <span
          className={`text-[9px] px-1.5 py-0.5 rounded-full border border-current opacity-70 ${
            state.aiProvider === 'anthropic' ? 'text-purple-400' : 'text-blue-400'
          }`}
        >
          {state.aiProvider === 'anthropic' ? 'Claude' : 'DeepSeek'}
        </span>

        <div className="flex items-center gap-1 ml-auto">
          {state.agentLoading && (
            <button
              onClick={agent.stop}
              className="p-1 rounded text-red-400 hover:bg-red-900/20 transition-colors"
              title="Arrêter"
            >
              <Square size={12} />
            </button>
          )}
          {!state.agentLoading && state.agentMessages.length > 0 && (
            <button
              onClick={() => dispatch({ type: 'AGENT_CLEAR' })}
              className="p-1 rounded text-lorica-textDim hover:text-lorica-text transition-colors"
              title="Vider le chat"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={handleNewChat}
            className="p-1 rounded text-lorica-textDim hover:text-lorica-accent transition-colors"
            title="Nouveau chat"
          >
            <Plus size={12} />
          </button>
          {state.agentLoading && (
            <Loader2 size={12} className="animate-spin text-lorica-accent" />
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {/* Welcome state */}
        {!isActive && state.agentMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Bot size={32} className="text-lorica-accent/20 mb-3" />
            <div className="text-xs text-lorica-textDim mb-1">Agent Lorica</div>
            <div className="text-[10px] text-lorica-textDim/60 mb-4">
              Peut lire, modifier et créer des fichiers,<br />exécuter des commandes et explorer le projet.
            </div>
            <button
              onClick={() => setShowConfig(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lorica-accent/10 border border-lorica-accent/30 text-lorica-accent text-xs hover:bg-lorica-accent/20 transition-colors"
            >
              <Plus size={12} /> Nouveau chat
            </button>
          </div>
        )}

        {/* Message list */}
        {state.agentMessages.map((msg, i) => {
          if (msg.role === 'tool_results') return null; // internal, not displayed

          const isLast = i === state.agentMessages.length - 1;
          const isStreaming = state.agentLoading && isLast && msg.role === 'assistant';

          return (
            <div key={msg.id || i} className={msg.role === 'user' ? 'ml-4' : 'mr-1'}>
              {msg.role === 'user' ? (
                <div className="rounded-lg px-3 py-2 bg-lorica-accent/10 border border-lorica-accent/20">
                  <p className="text-xs text-lorica-text">{msg.content}</p>
                </div>
              ) : (
                <div className="rounded-lg px-3 py-2 bg-lorica-panel border border-lorica-border">
                  {msg.content && (
                    <MarkdownMessage content={msg.content} isStreaming={isStreaming && (msg.toolCalls?.length === 0)} />
                  )}
                  {/* Tool calls */}
                  {(msg.toolCalls || []).map((tc) => (
                    <AgentToolBlock
                      key={tc.id}
                      toolCall={tc}
                      onApprove={agent.approveToolCall}
                      onReject={agent.rejectToolCall}
                    />
                  ))}
                  {/* Streaming indicator when tool is running */}
                  {isStreaming && msg.toolCalls?.some((tc) => tc.status === 'running') && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-lorica-textDim">
                      <Loader2 size={10} className="animate-spin text-lorica-accent" />
                      Exécution en cours…
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {isActive && (
        <div className="p-2 border-t border-lorica-border shrink-0">
          <div className="flex items-center gap-2 bg-lorica-bg rounded-lg border border-lorica-border px-3 py-1.5 focus-within:border-lorica-accent/50 transition-colors">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              placeholder="Message à l'agent…"
              className="flex-1 bg-transparent text-xs text-lorica-text outline-none placeholder:text-lorica-textDim/50"
              disabled={state.agentLoading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || state.agentLoading}
              className="p-1 text-lorica-accent hover:bg-lorica-accent/10 rounded transition-colors disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AgentCopilot.jsx
git commit -m "feat: add AgentCopilot panel with streaming messages and tool call UI"
```

---

## Task 10: Câbler dans `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Remplacer l'import AICopilot et ajouter useAgent**

Dans `src/App.jsx`, trouver :
```js
import AICopilot from './components/AICopilot';
```
Remplacer par :
```js
import AgentCopilot from './components/AgentCopilot';
```

Trouver :
```js
const ai = useAI(state, dispatch);
```
Ajouter juste après :
```js
import { useAgent } from './hooks/useAgent';
// (ajouter l'import en haut du fichier avec les autres imports)
```

En haut du fichier, ajouter parmi les imports :
```js
import { useAgent } from './hooks/useAgent';
```

Dans la fonction `App()`, après `const ai = useAI(state, dispatch);`, ajouter :
```js
const agent = useAgent(state, dispatch);
```

- [ ] **Step 2: Remplacer le rendu AICopilot par AgentCopilot**

Chercher dans `App.jsx` l'utilisation de `<AICopilot` et la remplacer par :
```jsx
<AgentCopilot
  state={state}
  dispatch={dispatch}
  agent={agent}
  activeFile={state.openFiles[state.activeFileIndex] || null}
/>
```

- [ ] **Step 3: Build de vérification**

```bash
npm run build 2>&1 | tail -30
```

Résultat attendu : `compiled successfully` sans erreurs fatales.

- [ ] **Step 4: Commit final**

```bash
git add src/App.jsx
git commit -m "feat: wire AgentCopilot and useAgent into App — agent panel complete"
```

---

## Vérification finale

- [ ] Lancer l'app : `npm run tauri:dev`
- [ ] Ouvrir le panel Agent (bouton dans la dock)
- [ ] Cliquer "Nouveau chat" → modal s'affiche avec permissions et contexte
- [ ] Cliquer "Démarrer" → champ de saisie apparaît
- [ ] Envoyer "Liste les fichiers du projet" → `list_dir` s'exécute, résultat affiché
- [ ] Envoyer "Modifie le fichier X" → bloc `write_file` apparaît avec boutons Approuver/Rejeter
- [ ] Cliquer "Voir le diff" → diff inline affiché dans le bloc
- [ ] Cliquer "Approuver" → fichier s'ouvre dans un nouvel onglet éditeur
- [ ] Bouton Stop (carré rouge) interrompt le stream
