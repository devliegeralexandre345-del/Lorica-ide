// src/components/AgentSwarmPanel.jsx
//
// Full-screen overlay that runs the Multi-Agent Swarm against the active
// file and displays findings grouped by severity. The four role columns
// fill in progressively as each agent finishes — latency is dominated by
// the slowest call, which is also visible to the user via the per-role
// spinner.
//
// Design:
//   • Single panel, three sections: top stats bar, left role status column,
//     right findings list (filterable by severity + role).
//   • Each finding is a card: severity pill, title, body markdown, "Jump
//     to line" button, optional "Apply fix" suggestion.
//   • The actual "Apply" operation is intentionally NOT automatic — this
//     panel surfaces analysis; edits go through the agent/edit flow
//     so the user sees the diff before committing.
//
// The panel is a modal (z-50 overlay). We reuse the existing app-level
// `showAgentSwarm` state flag to gate visibility — no prop drilling for
// open/close.

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  X, Zap, Bug, Shield as ShieldIcon, Activity, Network, Loader2, AlertTriangle,
  ChevronRight, Check, Download, Users,
} from 'lucide-react';
import { runSwarm, SWARM_ROLES, SEVERITY_RANK, loadCustomSwarmRoles, mergeSwarmRoles } from '../utils/agentSwarm';

const SEVERITY_META = {
  critical: { color: 'text-red-300',    bg: 'bg-red-500/20 border-red-500/50',    label: 'CRIT' },
  high:     { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/40',    label: 'HIGH' },
  medium:   { color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/40',label: 'MED'  },
  low:      { color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/40',    label: 'LOW'  },
  info:     { color: 'text-lorica-textDim',  bg: 'bg-lorica-border/30 border-lorica-border', label: 'INFO' },
};

const ROLE_ICONS = {
  bugs: Bug, security: ShieldIcon, perf: Activity, arch: Network,
};

export default function AgentSwarmPanel({ state, dispatch, activeFile }) {
  const [roles, setRoles] = useState(SWARM_ROLES);
  // Per-role live state: 'pending' | 'running' | 'done' | 'error'
  const [roleStates, setRoleStates] = useState(() =>
    Object.fromEntries(SWARM_ROLES.map((r) => [r.id, { status: 'pending', findings: [] }]))
  );
  const [severityFilter, setSeverityFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [startedAt, setStartedAt] = useState(null);
  const [finishedAt, setFinishedAt] = useState(null);
  const abortRef = useRef(null);

  // Load + merge custom roles from `.lorica/swarm-roles.json` on open.
  useEffect(() => {
    (async () => {
      const custom = await loadCustomSwarmRoles(state.projectPath);
      const merged = mergeSwarmRoles(SWARM_ROLES, custom);
      setRoles(merged);
      setRoleStates(Object.fromEntries(merged.map((r) => [r.id, { status: 'pending', findings: [] }])));
    })();
  }, [state.projectPath]);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showAgentSwarm', value: false });
  };

  const run = async () => {
    if (!activeFile) return;
    if (!apiKey) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Configure an API key first (Settings)', duration: 4000 } });
      return;
    }
    setStartedAt(Date.now());
    setFinishedAt(null);
    setRoleStates(Object.fromEntries(roles.map((r) => [r.id, { status: 'running', findings: [] }])));
    abortRef.current = new AbortController();
    try {
      await runSwarm({
        file: activeFile,
        provider,
        apiKey,
        roles, // pass merged built-in + custom list
        signal: abortRef.current.signal,
        onRoleUpdate: (role, rs) => {
          setRoleStates((prev) => ({ ...prev, [role.id]: rs }));
        },
      });
      setFinishedAt(Date.now());
    } catch (_) {
      setFinishedAt(Date.now());
    }
  };

  // Auto-run on open if an active file exists. The user can hit "Re-run"
  // after edits to refresh findings.
  useEffect(() => {
    if (state.showAgentSwarm && activeFile && !startedAt) run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.showAgentSwarm]);

  // Aggregate + sort findings.
  const findings = useMemo(() => {
    const all = [];
    for (const role of roles) {
      const rs = roleStates[role.id];
      if (!rs) continue;
      rs.findings.forEach((f) =>
        all.push({ ...f, roleId: role.id, roleLabel: role.label })
      );
    }
    const filtered = all.filter((f) =>
      (severityFilter === 'all' || f.severity === severityFilter) &&
      (roleFilter === 'all' || f.roleId === roleFilter)
    );
    filtered.sort(
      (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    );
    return filtered;
  }, [roleStates, severityFilter, roleFilter]);

  const jumpToLine = (line) => {
    if (!line || !activeFile) return;
    dispatch({ type: 'OPEN_FILE', file: { ...activeFile, pendingGoto: { line } } });
    close();
  };

  // Dump all current findings into a single Brain entry so they stay
  // reviewable after the modal closes. We DON'T group by role — the user
  // can always filter in the Brain panel; the important thing is to keep
  // everything in one place per review.
  const exportFindingsToBrain = async () => {
    if (!state.projectPath || findings.length === 0) return;
    try {
      const { saveBrainEntry } = await import('../utils/projectBrain');
      const bySeverity = findings.reduce((m, f) => {
        (m[f.severity] = m[f.severity] || []).push(f);
        return m;
      }, {});
      const body = [
        `Reviewed ${activeFile?.name || 'file'} with ${roles.length} agents on ${new Date().toISOString().slice(0, 10)}.`,
        `Total findings: ${findings.length}`,
        '',
        ...['critical', 'high', 'medium', 'low', 'info']
          .filter((s) => bySeverity[s]?.length)
          .flatMap((s) => [
            `## ${s.toUpperCase()} (${bySeverity[s].length})`,
            '',
            ...bySeverity[s].map((f) =>
              `- **${f.roleLabel}** — ${f.title}${f.line ? ` · L${f.line}` : ''}\n  ${f.body}${f.suggest ? `\n  _Fix_: ${f.suggest}` : ''}`
            ),
            '',
          ]),
      ].join('\n');
      await saveBrainEntry(state.projectPath, {
        title: `Review · ${activeFile?.name || 'file'} · ${findings.length} findings`,
        type: 'note',
        tags: ['swarm-review', ...(activeFile?.extension ? [activeFile.extension] : [])],
        body,
      });
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Exported ${findings.length} findings to Brain`, duration: 2500 } });
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Export failed: ${e.message}`, duration: 3500 } });
    }
  };

  const jumpToAgentWithSuggestion = (finding) => {
    const text = `Apply this suggestion to the file \`${activeFile?.name}\` at line ${finding.line ?? '?'}:\n\n**Issue**: ${finding.title}\n\n**Fix**: ${finding.suggest || finding.body}\n\nRead the current file first, then apply the minimal change.`;
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    dispatch({ type: 'AGENT_PREFILL_INPUT', text });
    close();
  };

  if (!state.showAgentSwarm) return null;

  const running = Object.values(roleStates).some((r) => r.status === 'running');
  const elapsed = finishedAt && startedAt ? ((finishedAt - startedAt) / 1000).toFixed(1) : null;
  const totalFindings = findings.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-6xl h-full max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_80px_rgba(0,212,255,0.25)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Zap size={18} className="text-lorica-accent" />
          <div className="flex flex-col">
            <div className="text-sm font-semibold text-lorica-text">Multi-Agent Deep Review</div>
            <div className="text-[10px] text-lorica-textDim">
              {activeFile ? activeFile.path || activeFile.name : 'No active file'}
              {elapsed && ` · finished in ${elapsed}s`}
              {running && ` · analyzing in parallel…`}
            </div>
          </div>
          <div className="flex-1" />
          <button
            onClick={exportFindingsToBrain}
            disabled={running || findings.length === 0 || !state.projectPath}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-amber-400 border border-amber-400/40 hover:bg-amber-400/10 transition-colors disabled:opacity-40"
            title="Save all findings as a note in Project Brain"
          >
            <Download size={11} /> Export to Brain
          </button>
          <button
            onClick={run}
            disabled={running || !activeFile}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-lorica-accent/15 border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/25 transition-colors disabled:opacity-40"
          >
            {running ? 'Running…' : 'Re-run'}
          </button>
          <button onClick={close} className="p-1.5 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-text transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left column: role status */}
          <div className="w-[260px] shrink-0 border-r border-lorica-border overflow-y-auto p-3 space-y-2">
            <div className="text-[9px] uppercase tracking-widest text-lorica-textDim mb-1">Roles</div>
            {roles.map((role) => {
              const rs = roleStates[role.id] || { status: 'pending', findings: [] };
              const Icon = ROLE_ICONS[role.id] || Zap;
              const count = rs.findings.length;
              return (
                <button
                  key={role.id}
                  onClick={() => setRoleFilter(roleFilter === role.id ? 'all' : role.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors text-left ${
                    roleFilter === role.id
                      ? `${role.bg} ${role.color}`
                      : `${role.bg.replace('/10', '/5').replace('/30', '/20')} ${role.color} opacity-80 hover:opacity-100`
                  }`}
                >
                  <Icon size={13} className="shrink-0" />
                  <span className="flex-1 font-medium">{role.label}</span>
                  {rs.status === 'running' && <Loader2 size={11} className="animate-spin" />}
                  {rs.status === 'done'    && <span className="text-[10px] opacity-80">{count}</span>}
                  {rs.status === 'error'   && <AlertTriangle size={11} />}
                </button>
              );
            })}

            <div className="pt-3 text-[9px] uppercase tracking-widest text-lorica-textDim">Severity</div>
            {['all', 'critical', 'high', 'medium', 'low', 'info'].map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                  severityFilter === sev
                    ? 'bg-lorica-accent/15 text-lorica-accent'
                    : 'text-lorica-textDim hover:bg-lorica-border/30 hover:text-lorica-text'
                }`}
              >
                <span className="capitalize">{sev}</span>
              </button>
            ))}
          </div>

          {/* Right column: findings */}
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {running && findings.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-lorica-textDim text-xs">
                <div className="relative mb-4">
                  <Zap size={38} className="text-lorica-accent animate-pulse-glow" />
                </div>
                {roles.length} agents working in parallel…
              </div>
            )}
            {!running && findings.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-lorica-textDim text-xs text-center">
                <Check size={36} className="text-emerald-400/70 mb-2" />
                <div className="font-semibold text-lorica-text mb-1">No findings for this file</div>
                <div>
                  All {roles.length} reviewers came back clean{severityFilter !== 'all' || roleFilter !== 'all' ? ' (for current filters)' : ''}.
                </div>
              </div>
            )}
            {findings.map((f, i) => {
              const sev = SEVERITY_META[f.severity] || SEVERITY_META.info;
              return (
                <div
                  key={i}
                  className={`rounded-xl border ${sev.bg} p-3 space-y-2 backdrop-blur-sm`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${sev.bg} ${sev.color} shrink-0`}>
                      {sev.label}
                    </span>
                    <span className={`text-[10px] shrink-0 opacity-70 ${sev.color}`}>
                      {f.roleLabel}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-lorica-text">
                      {f.title}
                    </span>
                    {f.line != null && (
                      <button
                        onClick={() => jumpToLine(f.line)}
                        className="text-[10px] text-lorica-textDim hover:text-lorica-accent flex items-center gap-1 shrink-0"
                      >
                        L{f.line} <ChevronRight size={10} />
                      </button>
                    )}
                  </div>
                  {f.body && (
                    <div className="text-[11px] text-lorica-text/90 leading-relaxed pl-16 -mt-1">
                      {f.body}
                    </div>
                  )}
                  {f.suggest && (
                    <div className="flex items-start gap-2 pl-16">
                      <div className="flex-1 text-[11px] text-lorica-textDim italic">
                        <span className="text-emerald-400 not-italic font-medium">Fix:</span> {f.suggest}
                      </div>
                      <button
                        onClick={() => jumpToAgentWithSuggestion(f)}
                        className="text-[10px] px-2 py-0.5 rounded border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/10 transition-colors shrink-0"
                      >
                        Apply via Agent
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer stats */}
        <div className="px-5 py-2 border-t border-lorica-border text-[10px] text-lorica-textDim flex items-center gap-4">
          <span>Total: <b className="text-lorica-text">{totalFindings}</b> findings</span>
          <span>·</span>
          {Object.entries(SEVERITY_META).map(([s, meta]) => {
            const n = findings.filter((f) => f.severity === s).length;
            if (n === 0) return null;
            return (
              <span key={s} className={meta.color}>
                {n} {meta.label}
              </span>
            );
          })}
          <div className="flex-1" />
          <span className="opacity-50">Powered by {provider === 'anthropic' ? 'Claude' : 'DeepSeek'}</span>
        </div>
      </div>
    </div>
  );
}
