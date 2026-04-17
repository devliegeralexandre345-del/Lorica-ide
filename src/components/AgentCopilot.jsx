// src/components/AgentCopilot.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Square, Plus, Trash2, Loader2, RefreshCw, Activity } from 'lucide-react';
import AgentConfigModal from './AgentConfigModal';
import AgentToolBlock from './AgentToolBlock';
import MarkdownMessage from './MarkdownMessage';

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
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

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

  const handleStart = (config) => {
    dispatch({ type: 'AGENT_SET_CONFIG', config });
    setShowConfig(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSend = () => {
    if (!input.trim() || state.agentLoading) return;
    agent.sendMessage(input.trim(), activeFile);
    setInput('');
    setSlashOpen(false);
  };

  const handleKeyDown = (e) => {
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

          <div className="flex items-center gap-2 bg-lorica-bg rounded-lg border border-lorica-border px-3 py-1.5 focus-within:border-lorica-accent/50 transition-colors">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message à l'agent… ( / pour commandes )"
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

          {/* Usage footer */}
          {state.agentUsage && (
            <div className="flex items-center gap-2 mt-1.5 px-1 text-[9px] text-lorica-textDim/70">
              <Activity size={9} />
              {(() => {
                const u = state.agentUsage;
                const input = u.input_tokens ?? u.prompt_tokens ?? 0;
                const output = u.output_tokens ?? u.completion_tokens ?? 0;
                const total = u.total_tokens ?? (input + output);
                return (
                  <span>
                    {input.toLocaleString()} in · {output.toLocaleString()} out · {total.toLocaleString()} total
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
