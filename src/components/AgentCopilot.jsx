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
