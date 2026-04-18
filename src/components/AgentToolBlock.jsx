// src/components/AgentToolBlock.jsx
import React, { useState } from 'react';
import {
  FileText, Pencil, FolderOpen, Plus, Trash2, Terminal,
  Search, Globe, Check, X, Loader2, ChevronDown, ChevronRight, Sparkles
} from 'lucide-react';

const TOOL_ICONS = {
  read_file: FileText,
  write_file: Pencil,
  list_dir: FolderOpen,
  create_file: Plus,
  delete_file: Trash2,
  run_command: Terminal,
  search_files: Search,
  semantic_search: Sparkles,
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
  semantic_search: 'Recherche IA',
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
    if (toolCall.name === 'semantic_search') return `"${i.query || ''}"`;
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
