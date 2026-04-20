// src/components/AgentCopilot.jsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Bot, Send, Square, Plus, Trash2, Loader2, RefreshCw, Activity,
  AtSign, FileText, Folder, Star,
} from 'lucide-react';
import AgentConfigModal from './AgentConfigModal';
import AgentToolBlock from './AgentToolBlock';
import MarkdownMessage from './MarkdownMessage';
import ApplyCodeModal from './ApplyCodeModal';
import {
  parseMentions,
  expandMentions,
  flattenFileTree,
  fuzzyMatch,
  escapePath,
} from '../utils/mentions';
import { estimateCost, formatCost } from '../utils/agentCost';

// Memoized message row. Non-last messages are stable once the agent has
// moved on — React.memo with a cheap equality check prevents thousands of
// reconciliations while text streams into the LAST message. Stream updates
// only re-render the tail row, which is where the work belongs.
const AgentMessageRow = React.memo(function AgentMessageRow({
  msg, isStreaming, onApply, projectPath, onApprove, onReject,
  onSaveToBrain, onEditUser, isLastUser,
}) {
  if (msg.role === 'user') {
    return (
      <div className="ml-4 group">
        <div className="rounded-lg px-3 py-2 bg-lorica-accent/10 border border-lorica-accent/20 relative">
          <p className="text-xs text-lorica-text whitespace-pre-wrap">{msg.content}</p>
          {isLastUser && (
            <button
              onClick={() => onEditUser?.(msg)}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-[9px] text-lorica-textDim hover:text-lorica-accent px-1 py-0.5 rounded transition-opacity"
              title="Edit & re-send"
            >
              edit
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="mr-1 group">
      <div className="rounded-lg px-3 py-2 bg-lorica-panel border border-lorica-border relative">
        {msg.content && (
          <MarkdownMessage
            content={msg.content}
            isStreaming={isStreaming && (msg.toolCalls?.length === 0)}
            onApply={onApply}
            projectPath={projectPath}
          />
        )}
        {(msg.toolCalls || []).map((tc) => (
          <AgentToolBlock
            key={tc.id}
            toolCall={tc}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
        {isStreaming && msg.toolCalls?.some((tc) => tc.status === 'running') && (
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-lorica-textDim">
            <Loader2 size={10} className="animate-spin text-lorica-accent" />
            Exécution en cours…
          </div>
        )}
        {msg.content && !isStreaming && (
          <button
            onClick={() => onSaveToBrain?.(msg)}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-[9px] text-lorica-textDim hover:text-amber-400 px-1 py-0.5 rounded transition-opacity"
            title="Save this answer to Project Brain"
          >
            ☆ to Brain
          </button>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // Custom equality: identity compare msg, isStreaming, and the tool-call
  // list reference. The parent always re-creates the tool-call list when
  // it mutates (via dispatch returning a new array), so shallow ref-equal
  // is the right check. Callback refs are assumed stable via useCallback.
  return (
    prev.msg === next.msg &&
    prev.isStreaming === next.isStreaming &&
    prev.onApply === next.onApply &&
    prev.onApprove === next.onApprove &&
    prev.onReject === next.onReject &&
    prev.onSaveToBrain === next.onSaveToBrain &&
    prev.onEditUser === next.onEditUser &&
    prev.isLastUser === next.isLastUser &&
    prev.projectPath === next.projectPath
  );
});

// Slash commands for quick context injection
const SLASH_COMMANDS = [
  { cmd: '/explain', desc: 'Expliquer le fichier actif', expand: () => 'Explique ce que fait le fichier actif en détail.' },
  { cmd: '/fix', desc: 'Corriger les bugs du fichier actif', expand: () => 'Regarde le fichier actif et corrige les bugs éventuels. Lis le fichier avant de modifier.' },
  { cmd: '/refactor', desc: 'Refactorer le fichier actif', expand: () => 'Refactore le fichier actif pour le rendre plus clair, modulaire et idiomatique. Lis-le d\'abord.' },
  { cmd: '/test', desc: 'Écrire des tests pour le fichier actif', expand: () => 'Écris des tests pour le fichier actif. Crée un nouveau fichier de tests adapté au framework du projet.' },
  { cmd: '/docs', desc: 'Ajouter la documentation', expand: () => 'Ajoute des commentaires JSDoc/docstrings au fichier actif sans modifier la logique.' },
  { cmd: '/review', desc: 'Revue de code', expand: () => 'Fais une revue de code détaillée du fichier actif: bugs, sécurité, perf, maintenabilité.' },
  { cmd: '/tree', desc: 'Afficher l\'arbre du projet', expand: () => 'Utilise list_dir pour explorer la structure du projet et résume son architecture.' },
];

export default function AgentCopilot({ state, dispatch, agent, activeFile }) {
  const [input, setInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  // @mention picker state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1); // caret position of the '@'
  // Apply-code modal state — set when the user clicks "Apply" on a code block
  const [applyModal, setApplyModal] = useState(null); // { code, hint } | null
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Flatten the project file tree once per update — used by the mention picker
  // for fuzzy path search. Folders and files both land in the same list so a
  // single query can match either.
  const flatFiles = useMemo(
    () => flattenFileTree(state.fileTree || [], state.projectPath || ''),
    [state.fileTree, state.projectPath],
  );

  // Compose the candidate list the mention picker shows. The "active file"
  // shortcut is always first (so `@<Enter>` attaches the current buffer), then
  // fuzzy-matched files and folders from the project.
  const mentionItems = useMemo(() => {
    if (!mentionOpen) return [];
    const items = [];
    if (activeFile) {
      items.push({
        kind: 'active',
        name: 'Active file',
        detail: activeFile.path || activeFile.name || '(no path)',
      });
    }
    const matched = fuzzyMatch(flatFiles, mentionQuery, 25);
    for (const m of matched) {
      items.push({
        kind: m.isDirectory ? 'folder' : 'file',
        name: m.name,
        detail: m.relPath,
        path: m.path,
      });
    }
    return items;
  }, [mentionOpen, mentionQuery, flatFiles, activeFile]);

  // When another component (Editor quick-actions, command palette, etc.)
  // pushes text into state.agentInputPrefill, pull it into the input box and
  // clear the slot. We intentionally don't auto-send — the user gets a chance
  // to tweak the wording first.
  useEffect(() => {
    if (state.agentInputPrefill) {
      setInput(state.agentInputPrefill);
      dispatch({ type: 'AGENT_CLEAR_PREFILL' });
      // If the agent session isn't active yet, prompt the config modal so the
      // prefilled question doesn't sit in a dead input.
      if (!state.agentSessionActive) setShowConfig(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [state.agentInputPrefill, state.agentSessionActive, dispatch]);

  // Auto-scroll to bottom, but only when the user is already near the bottom
  // (so manual scroll-up isn't fought) and WITHOUT smooth behaviour (which
  // triggers continuous layout + animation frames — blocks clicks during
  // streaming). We also throttle by only running on message *count* changes
  // or when the last message's content length changes appreciably.
  const lastScrollSigRef = useRef('');
  useEffect(() => {
    const container = messagesContainerRef.current;
    const end = messagesEndRef.current;
    if (!container || !end) return;
    const msgs = state.agentMessages;
    const last = msgs[msgs.length - 1];
    // Build a coarse signature: message count + bucketed last-content length
    const sig = `${msgs.length}:${last ? Math.floor((last.content || '').length / 200) : 0}`;
    if (sig === lastScrollSigRef.current) return;
    lastScrollSigRef.current = sig;

    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (nearBottom) {
      // Instant scroll — no smooth animation (animation keeps main thread busy
      // across frames which stalls click handling).
      end.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [state.agentMessages]);

  // Slash-command filter
  const slashFilter = input.startsWith('/') ? input.slice(1).toLowerCase() : null;
  const slashMatches = slashFilter !== null
    ? SLASH_COMMANDS.filter((c) => c.cmd.slice(1).toLowerCase().startsWith(slashFilter))
    : [];

  useEffect(() => {
    if (slashFilter !== null && slashMatches.length > 0) {
      setSlashOpen(true);
      setSlashIdx(0);
    } else {
      setSlashOpen(false);
    }
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySlash = (cmd) => {
    setInput(cmd.expand());
    setSlashOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // --- @mention detection ---
  // Re-evaluate on every input change. We look at the substring from the
  // caret back to the previous whitespace; if it starts with '@' and contains
  // no nested '@' or colon boundary problems, we consider the user to be
  // typing a mention query and surface the picker.
  const detectMention = () => {
    const el = inputRef.current;
    if (!el) return;
    // Don't clash with the slash-command picker
    if (slashOpen) { setMentionOpen(false); return; }
    const caret = el.selectionStart ?? input.length;
    const before = input.slice(0, caret);
    // Match the last @token up to caret. We stop at whitespace so a fresh
    // "@" at the start of a new word reopens cleanly.
    const m = /(?:^|\s)@([a-zA-Z0-9_./\\:-]*)$/.exec(before);
    if (m) {
      const atPos = caret - m[1].length - 1; // position of the '@' char
      setMentionStart(atPos);
      setMentionQuery(m[1]);
      setMentionOpen(true);
      setMentionIdx(0);
    } else {
      setMentionOpen(false);
      setMentionStart(-1);
    }
  };

  useEffect(() => {
    detectMention();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, slashOpen]);

  const applyMention = (item) => {
    if (!item || mentionStart < 0) return;
    // Replace the '@query' token with the rendered token.
    const caret = inputRef.current?.selectionStart ?? input.length;
    const head = input.slice(0, mentionStart);
    const tail = input.slice(caret);
    let token = '';
    if (item.kind === 'active') token = '@active';
    else if (item.kind === 'file') token = `@file:${escapePath(item.path)}`;
    else if (item.kind === 'folder') token = `@folder:${escapePath(item.path)}`;
    const next = `${head}${token} ${tail}`;
    setInput(next);
    setMentionOpen(false);
    setMentionStart(-1);
    // Put the caret right after the inserted token (and trailing space)
    setTimeout(() => {
      const pos = head.length + token.length + 1;
      const el = inputRef.current;
      if (el) {
        el.focus();
        try { el.setSelectionRange(pos, pos); } catch (_) {}
      }
    }, 0);
  };

  // --- Apply-code handlers ---
  // Opens the ApplyCodeModal. `hint` is the auto-detected target path (may be
  // null — in that case the user picks manually in the modal). onApply is
  // stable so MarkdownMessage stays correctly memoized.
  const handleApplyCode = useCallback((code, hint) => {
    setApplyModal({ code, hint: hint || (activeFile?.path ?? null) });
  }, [activeFile]);

  const handleConfirmApply = useCallback(async ({ path, newContent }) => {
    try {
      const r = await window.lorica.fs.writeFile(path, newContent);
      if (r && r.success) {
        // Open (or refresh) the file in the editor so the user immediately
        // sees the applied change.
        const name = path.split(/[\\/]/).pop();
        const ext = name.includes('.') ? name.split('.').pop() : '';
        dispatch({
          type: 'OPEN_FILE',
          file: { path, name, content: newContent, extension: ext, dirty: false },
        });
        setApplyModal(null);
      } else {
        // eslint-disable-next-line no-alert
        alert(`Apply failed: ${r?.error || 'unknown error'}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`Apply error: ${e.message}`);
    }
  }, [dispatch]);

  const handleStart = (config) => {
    dispatch({ type: 'AGENT_SET_CONFIG', config });
    setShowConfig(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // One-click start from a saved custom agent. We lift its fields into the
  // normal agentConfig shape (same fields the modal produces) so useAgent
  // doesn't need to special-case "custom" agents.
  const handleStartCustom = (a) => {
    dispatch({
      type: 'AGENT_SET_CONFIG',
      config: {
        model: a.model,
        permissions: a.permissions,
        autoApprove: !!a.autoApprove,
        context: a.context || 'none',
        systemPromptOverride: a.systemPrompt,
        customAgentName: a.name,
        customAgentIcon: a.icon,
      },
    });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSend = async () => {
    if (!input.trim() || state.agentLoading) return;
    const raw = input.trim();
    // Parse @mentions and expand them into a preamble. The raw message is
    // kept so the model sees the tokens inline (useful for "compare @file:a
    // and @file:b" style prompts) and the preamble provides the content.
    let payload = raw;
    try {
      const tokens = parseMentions(raw);
      if (tokens.length > 0) {
        const preamble = await expandMentions(tokens, {
          activeFile,
          projectPath: state.projectPath,
        });
        if (preamble) payload = preamble + raw;
      }
    } catch (e) {
      // Expansion failure shouldn't block the send — log and carry on.
      // eslint-disable-next-line no-console
      console.warn('[agent] mention expansion failed:', e);
    }
    agent.sendMessage(payload, activeFile);
    setInput('');
    setSlashOpen(false);
    setMentionOpen(false);
  };

  const handleKeyDown = (e) => {
    // @mention picker navigation takes priority (it's the most recently
    // triggered dropdown — and by construction it cannot be open while the
    // slash picker is also open).
    if (mentionOpen && mentionItems.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionItems.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionItems.length) % mentionItems.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applyMention(mentionItems[mentionIdx]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); return; }
    }
    if (slashOpen && slashMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applySlash(slashMatches[slashIdx]);
        return;
      }
      if (e.key === 'Escape') { setSlashOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleNewChat = () => {
    dispatch({ type: 'AGENT_CLEAR' });
    setShowConfig(true);
  };

  // Save a single assistant message as a note in the Project Brain. User
  // always reviews + retitles — we drop them into the Brain panel in edit
  // mode with a draft, never write silently.
  const handleSaveToBrain = useCallback(async (msg) => {
    if (!state.projectPath) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Open a project to save to Brain', duration: 2500 } });
      return;
    }
    try {
      const { saveBrainEntry } = await import('../utils/projectBrain');
      const lastUser = [...state.agentMessages].reverse().find((m) => m.role === 'user');
      const title = (lastUser?.content || msg.content).replace(/\s+/g, ' ').slice(0, 70);
      await saveBrainEntry(state.projectPath, {
        title: title || 'Agent answer',
        type: 'note',
        tags: ['agent', 'chat'],
        body: `${lastUser ? `## Question\n${lastUser.content}\n\n` : ''}## Answer\n${msg.content}\n`,
      });
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Saved to Brain — open the Brain panel to review', duration: 2500 } });
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Save failed: ${e.message}`, duration: 3000 } });
    }
  }, [state.projectPath, state.agentMessages, dispatch]);

  // Edit the user's most recent message: pull it into the input, trim
  // history back to before it, let the user re-send with corrections.
  const handleEditUser = useCallback((msg) => {
    // Find the index of the last user message and cut everything from
    // there on so the next send replaces it.
    const msgs = [...state.agentMessages];
    const idx = msgs.map((m) => m.role).lastIndexOf('user');
    if (idx < 0) return;
    dispatch({ type: 'AGENT_SET_MESSAGES', messages: msgs.slice(0, idx) });
    setInput(msg.content);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [state.agentMessages, dispatch]);

  const isActive = state.agentSessionActive;

  return (
    <div className="flex flex-col h-full">
      {/* Config Modal */}
      {showConfig && (
        <AgentConfigModal
          onStart={handleStart}
          onCancel={() => setShowConfig(false)}
          provider={state.aiProvider || 'anthropic'}
        />
      )}

      {/* Apply-code modal */}
      {applyModal && (
        <ApplyCodeModal
          code={applyModal.code}
          initialPath={applyModal.hint || ''}
          projectPath={state.projectPath}
          onConfirm={handleConfirmApply}
          onCancel={() => setApplyModal(null)}
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

        {/* Model badge */}
        {state.agentConfig?.model && (
          <span className="text-[9px] text-lorica-textDim/80 truncate max-w-[120px]" title={state.agentConfig.model}>
            {state.agentConfig.model.replace(/^claude-|^deepseek-/, '')}
          </span>
        )}

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
            <>
              <button
                onClick={agent.retryLastMessage}
                className="p-1 rounded text-lorica-textDim hover:text-lorica-accent transition-colors"
                title="Ré-envoyer le dernier message"
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={() => dispatch({ type: 'AGENT_CLEAR' })}
                className="p-1 rounded text-lorica-textDim hover:text-lorica-text transition-colors"
                title="Vider le chat"
              >
                <Trash2 size={12} />
              </button>
            </>
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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {/* Welcome state */}
        {!isActive && state.agentMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-6 px-4">
            <Bot size={30} className="text-lorica-accent/30 mb-3" />
            <div className="text-xs text-lorica-textDim mb-1">Agent Lorica</div>
            <div className="text-[10px] text-lorica-textDim/60 mb-4">
              Peut lire, modifier et créer des fichiers,<br />exécuter des commandes et explorer le projet.
            </div>
            <button
              onClick={() => setShowConfig(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lorica-accent/10 border border-lorica-accent/30 text-lorica-accent text-xs hover:bg-lorica-accent/20 transition-colors mb-4"
            >
              <Plus size={12} /> Nouveau chat
            </button>

            {/* Custom agents saved in .lorica/agents/*.json. Click = start a
                session with that agent's system prompt + perms in one step. */}
            {(state.customAgents || []).length > 0 && (
              <div className="w-full">
                <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1.5">
                  Custom agents
                </div>
                <div className="space-y-1">
                  {state.customAgents.map((a) => (
                    <button
                      key={a._path || a.slug}
                      onClick={() => handleStartCustom(a)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-lorica-panel/60 border border-lorica-border hover:border-lorica-accent/40 hover:bg-lorica-accent/5 transition-colors text-left group"
                    >
                      <span className="text-base shrink-0">{a.icon || '🤖'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-lorica-text truncate">{a.name}</div>
                        {a.description && (
                          <div className="text-[9px] text-lorica-textDim truncate">{a.description}</div>
                        )}
                      </div>
                      <span className="text-lorica-textDim group-hover:text-lorica-accent transition-colors">›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => dispatch({ type: 'SET_PANEL', panel: 'showAgentBuilder', value: true })}
              className="mt-3 text-[10px] text-lorica-textDim hover:text-lorica-accent underline-offset-2 hover:underline transition-colors"
            >
              + Create custom agent…
            </button>
          </div>
        )}

        {/* Message list.
            Perf: each row is memoized (AgentMessageRow) so stream updates
            only re-render the last message, not the whole history. */}
        {(() => {
          // Find the index of the last user message — only show the "edit"
          // affordance on that one. Recomputed cheaply per render; state
          // changes rarely.
          const lastUserIdx = (() => {
            for (let i = state.agentMessages.length - 1; i >= 0; i--) {
              if (state.agentMessages[i].role === 'user') return i;
            }
            return -1;
          })();
          return state.agentMessages.map((msg, i) => {
            if (msg.role === 'tool_results') return null;
            const isLast = i === state.agentMessages.length - 1;
            const isStreaming = state.agentLoading && isLast && msg.role === 'assistant';
            return (
              <AgentMessageRow
                key={msg.id || i}
                msg={msg}
                isStreaming={isStreaming}
                onApply={handleApplyCode}
                onApprove={agent.approveToolCall}
                onReject={agent.rejectToolCall}
                onSaveToBrain={handleSaveToBrain}
                onEditUser={handleEditUser}
                isLastUser={i === lastUserIdx}
                projectPath={state.projectPath}
              />
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {isActive && (
        <div className="p-2 border-t border-lorica-border shrink-0 relative">
          {/* Slash-command suggestions */}
          {slashOpen && slashMatches.length > 0 && (
            <div className="absolute left-2 right-2 bottom-full mb-1 bg-lorica-panel border border-lorica-border rounded-lg shadow-lg overflow-hidden z-10">
              {slashMatches.map((c, i) => (
                <button
                  key={c.cmd}
                  onMouseEnter={() => setSlashIdx(i)}
                  onClick={() => applySlash(c)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    i === slashIdx ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-text hover:bg-lorica-border/30'
                  }`}
                >
                  <span className="font-mono font-semibold">{c.cmd}</span>
                  <span className="text-[10px] text-lorica-textDim truncate">{c.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* @mention picker — file / folder / active */}
          {mentionOpen && mentionItems.length > 0 && (
            <div className="absolute left-2 right-2 bottom-full mb-1 bg-lorica-panel border border-lorica-border rounded-lg shadow-lg overflow-hidden z-10 max-h-64 overflow-y-auto">
              <div className="px-2.5 py-1 text-[9px] uppercase tracking-widest text-lorica-textDim/70 border-b border-lorica-border bg-lorica-bg/40 sticky top-0">
                <span className="flex items-center gap-1"><AtSign size={9} /> Mention — ↑↓ pour choisir, Tab/↵ pour insérer</span>
              </div>
              {mentionItems.map((item, i) => {
                const Icon =
                  item.kind === 'active' ? Star :
                  item.kind === 'folder' ? Folder : FileText;
                return (
                  <button
                    key={`${item.kind}:${item.detail}:${i}`}
                    onMouseEnter={() => setMentionIdx(i)}
                    onMouseDown={(e) => { e.preventDefault(); applyMention(item); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      i === mentionIdx ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-text hover:bg-lorica-border/30'
                    }`}
                  >
                    <Icon size={11} className={item.kind === 'active' ? 'text-yellow-400' : item.kind === 'folder' ? 'text-lorica-accent/80' : 'text-lorica-textDim'} />
                    <span className="font-semibold truncate">{item.name}</span>
                    <span className="text-[10px] text-lorica-textDim truncate ml-auto">{item.detail}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 bg-lorica-bg rounded-lg border border-lorica-border px-3 py-1.5 focus-within:border-lorica-accent/50 transition-colors">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onKeyUp={detectMention}
              onClick={detectMention}
              placeholder="Message à l'agent… ( / commandes, @ mentions )"
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

          {/* Usage + cost footer — ballpark $ so the user can see the
              burn rate of the current session and rein it in if needed. */}
          {state.agentUsage && (
            <div className="flex items-center gap-2 mt-1.5 px-1 text-[9px] text-lorica-textDim/70">
              <Activity size={9} />
              {(() => {
                const u = state.agentUsage;
                const input = u.input_tokens ?? u.prompt_tokens ?? 0;
                const output = u.output_tokens ?? u.completion_tokens ?? 0;
                const total = u.total_tokens ?? (input + output);
                const model = state.agentConfig?.model || (state.aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'deepseek-chat');
                const { cost } = estimateCost(model, u);
                return (
                  <span title={`Model: ${model}\nInput: ${input.toLocaleString()} tokens\nOutput: ${output.toLocaleString()} tokens`}>
                    {input.toLocaleString()} in · {output.toLocaleString()} out · {total.toLocaleString()} total · <b className={cost > 0.5 ? 'text-amber-400' : 'text-emerald-400'}>{formatCost(cost)}</b>
                  </span>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
