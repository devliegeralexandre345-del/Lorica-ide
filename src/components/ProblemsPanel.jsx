import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, XCircle, Info, ChevronDown, ChevronRight,
  FileCode, X, RefreshCw, Trash2, Filter
} from 'lucide-react';

const SEVERITY_CONFIG = {
  error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10', label: 'Error' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10', label: 'Warning' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Info' },
};

export default function ProblemsPanel({ state, dispatch, onFileOpen }) {
  const [problems, setProblems] = useState([]);
  const [filter, setFilter] = useState('all'); // all | error | warning | info
  const [expandedFiles, setExpandedFiles] = useState({});

  // Collect problems from security alerts + last debug output
  useEffect(() => {
    const collected = [];

    // Security alerts → problems
    if (state.securityAlerts?.length > 0) {
      state.securityAlerts.forEach((alert, i) => {
        collected.push({
          id: `sec-${i}`,
          severity: alert.severity === 'critical' ? 'error' : 'warning',
          message: `${alert.pattern} detected`,
          file: alert.file || 'Unknown',
          line: alert.line || 0,
          source: 'Security Scanner',
        });
      });
    }

    // Open files → scan for common issues
    state.openFiles?.forEach((file) => {
      if (!file.content) return;
      const lines = file.content.split('\n');
      lines.forEach((line, idx) => {
        // TODO in production
        const trimmed = line.trim();
        if (trimmed.includes('console.log') && !trimmed.startsWith('//')) {
          collected.push({
            id: `lint-${file.path}-${idx}`,
            severity: 'info',
            message: 'console.log statement found',
            file: file.path,
            fileName: file.name,
            line: idx + 1,
            source: 'LoricaLint',
          });
        }
        if (trimmed.includes('TODO') || trimmed.includes('FIXME') || trimmed.includes('HACK')) {
          const tag = trimmed.includes('FIXME') ? 'FIXME' : trimmed.includes('HACK') ? 'HACK' : 'TODO';
          collected.push({
            id: `todo-${file.path}-${idx}`,
            severity: tag === 'FIXME' ? 'warning' : 'info',
            message: `${tag}: ${trimmed.substring(trimmed.indexOf(tag)).slice(0, 80)}`,
            file: file.path,
            fileName: file.name,
            line: idx + 1,
            source: 'LoricaLint',
          });
        }
      });
    });

    setProblems(collected);
  }, [state.openFiles, state.securityAlerts]);

  const filtered = filter === 'all' ? problems : problems.filter(p => p.severity === filter);

  // Group by file
  const grouped = {};
  for (const p of filtered) {
    const key = p.file || 'unknown';
    if (!grouped[key]) grouped[key] = { name: p.fileName || key.split(/[/\\]/).pop(), problems: [] };
    grouped[key].problems.push(p);
  }

  const counts = {
    error: problems.filter(p => p.severity === 'error').length,
    warning: problems.filter(p => p.severity === 'warning').length,
    info: problems.filter(p => p.severity === 'info').length,
  };

  const toggleFile = (path) => setExpandedFiles(prev => ({ ...prev, [path]: !prev[path] }));
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showProblems', value: false });

  return (
    <div className="h-full flex flex-col bg-lorica-surface border-t border-lorica-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-lorica-border">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Problems</span>
          {/* Severity counts */}
          <div className="flex items-center gap-2">
            {Object.entries(counts).map(([sev, count]) => {
              const cfg = SEVERITY_CONFIG[sev];
              return count > 0 ? (
                <button
                  key={sev}
                  onClick={() => setFilter(filter === sev ? 'all' : sev)}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    filter === sev ? cfg.bg + ' ' + cfg.color : 'text-lorica-textDim hover:text-lorica-text'
                  }`}
                >
                  <cfg.icon size={10} /> {count}
                </button>
              ) : null;
            })}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setProblems([])} className="p-1 text-lorica-textDim hover:text-lorica-text" title="Clear"><Trash2 size={12} /></button>
          <button onClick={close} className="p-1 text-lorica-textDim hover:text-lorica-text"><X size={12} /></button>
        </div>
      </div>

      {/* Problem list */}
      <div className="flex-1 overflow-y-auto text-xs">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-lorica-textDim text-[11px] opacity-50">
            No problems detected ✓
          </div>
        ) : (
          Object.entries(grouped).map(([filePath, group]) => (
            <div key={filePath}>
              <button
                onClick={() => toggleFile(filePath)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-lorica-text hover:bg-lorica-panel/40 transition-colors"
              >
                {expandedFiles[filePath] !== false ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <FileCode size={10} className="text-lorica-accent" />
                <span className="flex-1 text-left truncate">{group.name}</span>
                <span className="text-[9px] text-lorica-textDim bg-lorica-bg px-1.5 rounded">{group.problems.length}</span>
              </button>
              {expandedFiles[filePath] !== false && group.problems.map((p) => {
                const cfg = SEVERITY_CONFIG[p.severity];
                return (
                  <button
                    key={p.id}
                    onClick={() => onFileOpen && onFileOpen(p.file, p.line > 0 ? { line: p.line } : undefined)}
                    className="w-full flex items-start gap-2 px-3 pl-7 py-0.5 text-[11px] hover:bg-lorica-panel/30 transition-colors"
                  >
                    <cfg.icon size={11} className={`${cfg.color} flex-shrink-0 mt-0.5`} />
                    <span className="flex-1 text-left text-lorica-textDim truncate">{p.message}</span>
                    <span className="text-[9px] text-lorica-accent/50 flex-shrink-0">{p.source}</span>
                    {p.line > 0 && <span className="text-[9px] text-lorica-textDim/50 flex-shrink-0">:{p.line}</span>}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
