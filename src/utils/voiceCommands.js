// src/utils/voiceCommands.js
//
// Wave 25 — Voice command parser. Builds on the Web Speech API
// dictation from Wave 11.1: instead of just transcribing into the
// agent input, we map the transcript to one of a small set of IDE
// commands ("ouvre les paramètres", "lance les tests", "sauvegarde",
// "ferme le fichier", …) and dispatch directly.
//
// Recognition strategy: keyword-based, not LLM-backed. The phrase
// matching is intentionally fuzzy — Web Speech transcripts are noisy
// and over-strict regex would throw away half of what users say. We
// score each candidate intent by token overlap and pick the highest
// scorer above a threshold; everything else falls through to "type
// the transcript into the agent input as a question".
//
// Bilingual: every intent ships with both an English and a French
// trigger list because Lorica's main user speaks French.

import { PROVIDERS } from './aiProviders';

// Each intent declares the action keywords + an optional set of object
// keywords. We compute `score = matched(action) + matched(object)`
// against the transcript's lowercased token set; intents that match at
// least one ACTION token win the matchup.
const INTENTS = [
  {
    id: 'open.settings',
    label: 'Open Settings',
    actions: ['open', 'show', 'ouvre', 'montre', 'affiche'],
    objects: ['settings', 'preferences', 'paramètres', 'parametres', 'reglages', 'réglages'],
    cmd: { type: 'panel', panel: 'showSettings' },
  },
  {
    id: 'open.terminal',
    label: 'Open Terminal',
    actions: ['open', 'show', 'ouvre', 'montre'],
    objects: ['terminal', 'shell', 'console'],
    cmd: { type: 'panel', panel: 'showTerminal' },
  },
  {
    id: 'open.search',
    label: 'Open Search',
    actions: ['open', 'show', 'find', 'ouvre', 'trouve', 'cherche', 'recherche'],
    objects: ['search', 'find', 'recherche'],
    cmd: { type: 'panel', panel: 'showSearch' },
  },
  {
    id: 'open.git',
    label: 'Open Git Panel',
    actions: ['open', 'show', 'ouvre', 'montre'],
    objects: ['git', 'source', 'control', 'controle'],
    cmd: { type: 'panel', panel: 'showGit' },
  },
  {
    id: 'open.copilot',
    label: 'Open AI Copilot',
    actions: ['open', 'ouvre', 'show', 'montre'],
    objects: ['copilot', 'agent', 'assistant', 'ai', 'ia'],
    cmd: { type: 'panel', panel: 'showAIPanel' },
  },
  {
    id: 'open.annotations',
    label: 'Open Annotations',
    actions: ['open', 'show', 'ouvre', 'montre', 'affiche'],
    objects: ['annotations', 'notes', 'sticky'],
    cmd: { type: 'panel', panel: 'showAnnotationsPanel' },
  },
  {
    id: 'open.collab',
    label: 'Open Live Share',
    actions: ['start', 'open', 'lance', 'démarre', 'demarre', 'ouvre'],
    objects: ['collab', 'collaboration', 'live', 'share', 'partage'],
    cmd: { type: 'panel', panel: 'showCollab' },
  },
  {
    id: 'open.worktrees',
    label: 'Open Worktrees',
    actions: ['open', 'show', 'ouvre', 'montre'],
    objects: ['worktrees', 'worktree', 'branches'],
    cmd: { type: 'panel', panel: 'showWorktrees' },
  },
  {
    id: 'save.file',
    label: 'Save active file',
    actions: ['save', 'sauvegarde', 'enregistre'],
    objects: ['file', 'fichier', 'this', 'ça', 'ca'],
    cmd: { type: 'action', action: 'saveActive' },
  },
  {
    id: 'toggle.zen',
    label: 'Toggle Zen mode',
    actions: ['toggle', 'enter', 'leave', 'enable', 'disable', 'active', 'desactive', 'désactive'],
    objects: ['zen', 'focus', 'distraction'],
    cmd: { type: 'action', action: 'toggleZen' },
  },
  {
    id: 'toggle.minimap',
    label: 'Toggle minimap',
    actions: ['toggle', 'show', 'hide', 'cache', 'montre'],
    objects: ['minimap', 'mini'],
    cmd: { type: 'action', action: 'toggleMinimap' },
  },
  {
    id: 'open.smartpaste',
    label: 'Smart Paste',
    actions: ['paste', 'translate', 'colle', 'traduit', 'traduis'],
    objects: ['smart', 'clipboard', 'presse-papier'],
    cmd: { type: 'panel', panel: 'showSmartPaste' },
  },
  {
    id: 'open.cheatsheet',
    label: 'Open Keyboard Cheatsheet',
    actions: ['open', 'show', 'ouvre', 'montre', 'affiche'],
    objects: ['shortcuts', 'cheatsheet', 'raccourcis', 'keymap'],
    cmd: { type: 'panel', panel: 'showKeyboardCheatsheet' },
  },
  // Wave 28 — extended catalog. Adds new intents for the panels +
  // editor actions the user reaches for most often, with bilingual
  // (and a sprinkling of Spanish + German) keywords.
  {
    id: 'open.fileTree',
    label: 'Toggle File Explorer',
    actions: ['open', 'show', 'toggle', 'ouvre', 'affiche', 'abrir', 'mostrar', 'zeige'],
    objects: ['files', 'explorer', 'tree', 'fichiers', 'archivos', 'dateien'],
    cmd: { type: 'panel', panel: 'showFileTree' },
  },
  {
    id: 'open.commandPalette',
    label: 'Open Command Palette',
    actions: ['open', 'show', 'ouvre', 'abrir'],
    objects: ['command', 'palette', 'commandes', 'comandos', 'befehl'],
    cmd: { type: 'panel', panel: 'showCommandPalette' },
  },
  {
    id: 'open.omnibar',
    label: 'Open Omnibar',
    actions: ['open', 'ouvre', 'abrir'],
    objects: ['omnibar', 'universel', 'universal'],
    cmd: { type: 'panel', panel: 'showOmnibar' },
  },
  {
    id: 'open.problems',
    label: 'Open Problems Panel',
    actions: ['open', 'show', 'ouvre', 'montre', 'mostrar'],
    objects: ['problems', 'errors', 'erreurs', 'problèmes', 'problemes', 'errores', 'fehler'],
    cmd: { type: 'panel', panel: 'showProblems' },
  },
  {
    id: 'open.outline',
    label: 'Open Outline',
    actions: ['open', 'show', 'ouvre', 'mostrar'],
    objects: ['outline', 'structure', 'symbols', 'gliederung', 'esquema'],
    cmd: { type: 'panel', panel: 'showOutline' },
  },
  {
    id: 'open.timeline',
    label: 'Open Timeline',
    actions: ['open', 'show', 'ouvre', 'mostrar'],
    objects: ['timeline', 'history', 'historique', 'verlauf', 'historia'],
    cmd: { type: 'panel', panel: 'showTimeline' },
  },
  {
    id: 'open.bookmarks',
    label: 'Open Bookmarks',
    actions: ['open', 'show', 'ouvre'],
    objects: ['bookmarks', 'favorites', 'favoris', 'marcadores', 'lesezeichen'],
    cmd: { type: 'panel', panel: 'showBookmarksPanel' },
  },
  {
    id: 'open.scratchpad',
    label: 'Open Scratchpad',
    actions: ['open', 'ouvre', 'abrir'],
    objects: ['scratchpad', 'notepad', 'brouillon', 'borrador', 'notizblock'],
    cmd: { type: 'panel', panel: 'showScratchpad' },
  },
  {
    id: 'open.todoBoard',
    label: 'Open TODO Board',
    actions: ['open', 'show', 'ouvre'],
    objects: ['todo', 'tasks', 'tâches', 'taches', 'tareas', 'aufgaben'],
    cmd: { type: 'panel', panel: 'showTodoBoard' },
  },
  {
    id: 'open.projectBrain',
    label: 'Open Project Brain',
    actions: ['open', 'show', 'ouvre', 'mostrar'],
    objects: ['brain', 'cerveau', 'cerebro', 'gehirn'],
    cmd: { type: 'panel', panel: 'showProjectBrain' },
  },
  {
    id: 'open.debug',
    label: 'Open Debug Panel',
    actions: ['open', 'start', 'launch', 'ouvre', 'lance', 'depurar'],
    objects: ['debug', 'debugger', 'debogueur', 'depurador'],
    cmd: { type: 'panel', panel: 'showDebug' },
  },
  {
    id: 'open.prReady',
    label: 'Open PR Ready Check',
    actions: ['check', 'open', 'vérifie', 'verifie', 'verifica', 'prüfe'],
    objects: ['pr', 'ready', 'pull', 'request'],
    cmd: { type: 'panel', panel: 'showPrReady' },
  },
  {
    id: 'open.focusTimer',
    label: 'Toggle Focus Timer',
    actions: ['start', 'open', 'lance', 'démarre', 'demarre', 'iniciar'],
    objects: ['focus', 'pomodoro', 'minuteur', 'temporizador'],
    cmd: { type: 'panel', panel: 'showFocusTimer' },
  },
  {
    id: 'toggle.split',
    label: 'Toggle Split Editor',
    actions: ['split', 'divise', 'partage', 'separa', 'teile'],
    objects: ['editor', 'split', 'editeur', 'éditeur'],
    cmd: { type: 'action', action: 'toggleSplit' },
  },
  {
    id: 'open.snippets',
    label: 'Open Snippet Palette',
    actions: ['open', 'insert', 'ouvre', 'insère', 'insere', 'insertar'],
    objects: ['snippet', 'snippets', 'fragment'],
    cmd: { type: 'panel', panel: 'showSnippets' },
  },
  {
    id: 'open.workspaceSwitcher',
    label: 'Switch workspace',
    actions: ['switch', 'change', 'open', 'ouvre', 'change', 'cambiar', 'wechsle'],
    objects: ['workspace', 'project', 'projet', 'proyecto', 'projekt'],
    cmd: { type: 'panel', panel: 'showWorkspaceSwitcher' },
  },
  {
    // Wave 50 — voice commit-message draft. Opens GitPanel AND
    // dispatches a signal the panel listens for to draft a message
    // from the staged diff via the active AI provider.
    id: 'commit.draftMessage',
    label: 'Draft commit message (AI)',
    actions: ['draft', 'redige', 'redigé', 'redigé', 'écris', 'ecris', 'write', 'commit', 'committe', 'genere', 'génère'],
    objects: ['commit', 'message', 'commitmessage'],
    cmd: { type: 'compound', steps: [
      { type: 'panel', panel: 'showGit' },
      { type: 'event', event: 'lorica:draftCommitMessage' },
    ] },
  },
  {
    id: 'open.recentFiles',
    label: 'Recent files (quick-switch)',
    actions: ['open', 'show', 'ouvre', 'montre', 'recent', 'récents', 'recents'],
    objects: ['files', 'fichiers', 'recent', 'récents', 'recents', 'history', 'historique'],
    cmd: { type: 'panel', panel: 'showRecentFiles' },
  },
  {
    id: 'open.refactor',
    label: 'AI refactor suggestions',
    actions: ['refactor', 'refactorer', 'refactor', 'rewrite', 'reecris', 'réécris'],
    objects: ['code', 'selection', 'sélection', 'snippet'],
    cmd: { type: 'panel', panel: 'showRefactor' },
  },
];

// Stop-words filtered out before substring scoring — without this
// "ouvre le terminal" would match toggle.zen because "le" is a
// substring of "toggle"/"leave"/"enable"/"disable" and racks up four
// false-positive action hits.
const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'to', 'of', 'in',
  'on', 'at', 'is', 'are', 'be',
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux',
  'ce', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son',
  'sa', 'ses', 'et', 'ou',
]);

// Minimum token length for substring scoring. Below this we require
// exact-equality so we don't get "le" → matching every keyword that
// has "le" as a substring.
const MIN_SUBSTRING_LEN = 3;

// Lower-case + strip accents + strip punctuation + split on whitespace
// + drop stop words. The accent strip matters for French — without it,
// "débogueur" tokenises as "débogueur" and won't substring-match the
// "debogueur" keyword. NFD-normalise then drop combining marks.
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

// Count how many of `keywords` appear in `tokens`. Tokens shorter
// than MIN_SUBSTRING_LEN must match exactly; longer ones can use
// bidirectional substring (so "réglages" still matches a 4+ char
// keyword like "regle").
function overlap(tokens, keywords) {
  let n = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const matched = tokens.some((t) => {
      if (t === k) return true;
      if (t.length < MIN_SUBSTRING_LEN || k.length < MIN_SUBSTRING_LEN) return false;
      return t.includes(k) || k.includes(t);
    });
    if (matched) n++;
  }
  return n;
}

/**
 * Parse a transcript and return the best-matching intent, or null.
 *
 * @param {string} transcript
 * @param {object} [opts]
 * @param {number} [opts.minScore=2]  Minimum total score (action + object)
 *                                    a candidate must reach. Below this we
 *                                    return null and the caller falls back
 *                                    to "send to agent as a question".
 * @returns {{intent, confidence}|null}
 */
export function parseVoiceCommand(transcript, { minScore = 2 } = {}) {
  const tokens = tokenize(transcript);
  if (tokens.length === 0) return null;
  let best = null;
  for (const intent of INTENTS) {
    const a = overlap(tokens, intent.actions);
    if (a === 0) continue; // every intent requires at least one action verb
    const o = overlap(tokens, intent.objects);
    const score = a + o;
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = { intent, score };
    }
  }
  if (!best) return null;
  // Confidence: 0..1 normalised over the largest possible score for
  // this intent (so a 1-action 1-object intent caps at 2/2 = 1.0).
  const max = (best.intent.actions.length > 0 ? 1 : 0) + (best.intent.objects.length > 0 ? 1 : 0);
  const confidence = Math.min(1, best.score / Math.max(2, max + 1));
  return { intent: best.intent, confidence };
}

/**
 * Execute a parsed intent against the host. The host provides:
 *   - `dispatch`: redux-style dispatch for SET_PANEL / TOGGLE_PANEL
 *   - `actions`: the actions ref from App.jsx (saveActive, toggleZen…)
 */
export function executeVoiceCommand(parsed, { dispatch, actions } = {}) {
  if (!parsed?.intent?.cmd) return false;
  const cmd = parsed.intent.cmd;
  if (cmd.type === 'panel') {
    dispatch?.({ type: 'SET_PANEL', panel: cmd.panel, value: true });
    return true;
  }
  if (cmd.type === 'action') {
    const fn = actions?.current?.[cmd.action];
    if (typeof fn === 'function') { fn(); return true; }
    return false;
  }
  // Wave 50 — `event` posts a window CustomEvent so a panel can react
  // without us having to import its imperative API (avoids circular
  // deps). The panel registers an addEventListener in its own scope.
  if (cmd.type === 'event') {
    window.dispatchEvent(new CustomEvent(cmd.event, { detail: cmd.detail || {} }));
    return true;
  }
  // `compound` runs each step in order, short-circuiting on the first
  // step that doesn't apply (e.g. an action that isn't wired).
  if (cmd.type === 'compound' && Array.isArray(cmd.steps)) {
    for (const step of cmd.steps) {
      const ok = executeVoiceCommand({ intent: { cmd: step } }, { dispatch, actions });
      if (!ok) return false;
    }
    return true;
  }
  return false;
}

// Surfaced for the Settings UI / a future "Voice cheatsheet" command.
export function listIntents() {
  return INTENTS.map((i) => ({
    id: i.id,
    label: i.label,
    triggers: [...i.actions, ...i.objects],
  }));
}

// Exported for the unit tests so we can assert behaviour without
// rebuilding the whole INTENTS catalog.
export const __testing__ = { tokenize, overlap };

// Marker so test files can assert "PROVIDERS hasn't drifted" — keeps
// the voice intents scoped to provider-agnostic IDE commands. (Empty
// reference — keeps the import non-tree-shaken if we later add
// voice-driven provider switching.)
void PROVIDERS;
