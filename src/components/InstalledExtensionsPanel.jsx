// src/components/InstalledExtensionsPanel.jsx
//
// Wave 24 — Settings tab listing every scanned extension manifest
// with an enable/disable toggle. Drives the runtime loader (Wave 23)
// by maintaining the `lorica.extensions.enabled` set in localStorage.
//
// Distinct from the existing `ExtensionManager` (which is the LSP /
// MCP marketplace) — this panel is for USER-AUTHORED extensions
// loaded via the v0 runtime. We keep them separated because they
// answer different questions: ExtensionManager = "what can I install
// from the marketplace", InstalledExtensionsPanel = "what's actually
// running in my IDE right now".

import React, { useEffect, useState, useCallback } from 'react';
import { Plug, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { activateExtension, deactivateExtension } from '../utils/extensionRuntime';

const ENABLED_KEY = 'lorica.extensions.enabled';

function readEnabled() {
  try { return new Set(JSON.parse(localStorage.getItem(ENABLED_KEY) || '[]')); }
  catch { return new Set(); }
}
function writeEnabled(set) {
  try { localStorage.setItem(ENABLED_KEY, JSON.stringify([...set])); } catch {}
}

export default function InstalledExtensionsPanel({ projectPath, builtinDir, dispatch }) {
  const [manifests, setManifests] = useState([]);
  const [errors, setErrors] = useState([]);
  const [enabled, setEnabled] = useState(readEnabled);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.lorica.extensionLoader.scan(projectPath || null, builtinDir || null);
      if (r?.success) {
        setManifests(r.data?.manifests || []);
        setErrors(r.data?.errors || []);
      } else {
        setErrors([r?.error || 'scan failed']);
      }
    } finally {
      setLoading(false);
    }
  }, [projectPath, builtinDir]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (manifest) => {
    setBusyId(manifest.id);
    try {
      const wasEnabled = enabled.has(manifest.id);
      const next = new Set(enabled);
      if (wasEnabled) {
        await deactivateExtension(manifest.id);
        next.delete(manifest.id);
        dispatch?.({
          type: 'ADD_TOAST',
          toast: { type: 'info', message: `${manifest.name} disabled`, duration: 2000 },
        });
      } else {
        const rec = await activateExtension(manifest);
        if (rec.error) {
          dispatch?.({
            type: 'ADD_TOAST',
            toast: { type: 'error', message: `${manifest.name}: ${rec.error}`, duration: 5000 },
          });
          return;
        }
        next.add(manifest.id);
        dispatch?.({
          type: 'ADD_TOAST',
          toast: { type: 'success', message: `${manifest.name} loaded`, duration: 2000 },
        });
      }
      setEnabled(next);
      writeEnabled(next);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
        <Plug size={14} className="text-cyan-400" />
        Installed Extensions ({manifests.length})
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40 flex items-center gap-1"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </label>

      {errors.length > 0 && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30 text-[10px] text-amber-200">
          <div className="flex items-center gap-1.5 font-semibold mb-1">
            <AlertTriangle size={11} />
            {errors.length} manifest error{errors.length === 1 ? '' : 's'}
          </div>
          {errors.slice(0, 3).map((e, i) => (
            <div key={i} className="font-mono text-[9px] text-amber-300/80 truncate">{e}</div>
          ))}
          {errors.length > 3 && (
            <div className="text-[9px] text-amber-300/60 mt-0.5">…and {errors.length - 3} more</div>
          )}
        </div>
      )}

      {manifests.length === 0 ? (
        <div className="text-center py-6 text-[11px] text-lorica-textDim">
          No extensions found.
          <div className="mt-1 text-[10px]">
            Drop a folder with <code>manifest.json</code> + <code>extension.js</code> into{' '}
            <code>~/.local/share/Lorica/extensions/</code> or{' '}
            <code>{'<project>'}/.lorica/extensions/</code>.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {manifests.map((m) => {
            const isOn = enabled.has(m.id);
            const busy = busyId === m.id;
            return (
              <div key={m.id} className="rounded-lg border border-lorica-border bg-lorica-bg/40 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12px] font-semibold text-lorica-text">{m.name}</span>
                  <span className="text-[9px] text-lorica-textDim font-mono">v{m.version}</span>
                  <span className="text-[9px] uppercase tracking-widest text-lorica-textDim/70 px-1.5 py-0.5 rounded bg-lorica-border/30">
                    {m.source}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => toggle(m)}
                    disabled={busy}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                      isOn ? 'bg-lorica-accent' : 'bg-lorica-border'
                    }`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      isOn ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
                {m.description && (
                  <div className="text-[10px] text-lorica-textDim mb-1.5">{m.description}</div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {(m.permissions || []).map((p) => (
                    <span
                      key={p}
                      title={`Permission: ${p}`}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 font-mono"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <div className="text-[9px] text-lorica-textDim mt-1.5 font-mono truncate" title={m.rootPath}>
                  {m.rootPath}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
