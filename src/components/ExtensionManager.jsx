import React, { useState, useEffect, useRef } from 'react';
import {
  Package, Download, Trash2, Check, Bug, Wrench, Palette, RefreshCw,
  ChevronDown, ChevronRight, X, ExternalLink, Search, Info, ExternalLink as ExternalLinkIcon, AlertCircle
} from 'lucide-react';

const CATEGORY_ICONS = { debugger: Bug, tool: Wrench, language: Package, theme: Palette };
const CATEGORY_COLORS = { debugger: 'text-red-400', tool: 'text-blue-400', language: 'text-green-400', theme: 'text-purple-400' };

export default function ExtensionManager({ dispatch }) {
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('all');
  const [progress, setProgress] = useState({}); // { [id]: 0-100 }
  const [showInstallGuide, setShowInstallGuide] = useState(null); // ext id or null
  const [installError, setInstallError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await window.lorica.extensions.list();
      setExtensions(res?.data || res || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const simulateProgress = (extId, duration = 15000) => {
    let start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const percent = Math.min(100, Math.floor((elapsed / duration) * 100));
      setProgress(prev => ({ ...prev, [extId]: percent }));
      if (percent >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setProgress(prev => ({ ...prev, [extId]: 0 }));
        }, 500);
      }
    }, 200);
    return () => clearInterval(interval);
  };

  const handleInstall = async (ext) => {
    // Si pas de install_cmd mais il y a install_note, afficher le guide
    if (!ext.install_cmd && ext.install_note) {
      setShowInstallGuide(ext);
      return;
    }

    setInstalling(ext.id);
    setInstallError(null);
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: `Installing ${ext.name}...`, duration: 5000 } });
    
    // Démarrer la simulation de progression
    const cleanup = simulateProgress(ext.id, ext.category === 'debugger' ? 15000 : 8000);
    
    try {
      const res = await window.lorica.extensions.install(ext.id);
      if (res?.success !== false) {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: res?.data || `${ext.name} installed!` } });
      } else {
        const errorMsg = res?.error || 'Install failed';
        setInstallError({ id: ext.id, message: errorMsg });
        dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: errorMsg } });
      }
    } catch (e) {
      const errMsg = String(e);
      setInstallError({ id: ext.id, message: errMsg });
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: errMsg } });
    } finally {
      cleanup();
      setInstalling(null);
      setTimeout(() => refresh(), 1000);
    }
  };

  const handleUninstall = async (ext) => {
    await window.lorica.extensions.uninstall(ext.id);
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: `${ext.name} removed` } });
    refresh();
  };

  const filtered = extensions.filter(e => {
    const matchFilter = !filter || e.name.toLowerCase().includes(filter.toLowerCase()) || e.languages.some(l => l.includes(filter.toLowerCase()));
    const matchCat = category === 'all' || e.category === category;
    return matchFilter && matchCat;
  });

  const categories = ['all', ...new Set(extensions.map(e => e.category))];

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showExtensions', value: false });

  return (
    <div className="fixed inset-0 z-50 lorica-modal-overlay flex items-center justify-center" onClick={close}>
      <div className="w-[600px] max-h-[80vh] bg-lorica-panel border border-lorica-border rounded-2xl shadow-2xl flex flex-col animate-fadeIn overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-lorica-border">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-lorica-accent" />
            <span className="text-sm font-semibold text-lorica-text">Extensions</span>
            <span className="text-[10px] text-lorica-textDim bg-lorica-bg px-2 py-0.5 rounded-full">
              {extensions.filter(e => e.installed).length} installed
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={`p-1 text-lorica-textDim hover:text-lorica-accent ${loading ? 'animate-spin' : ''}`}>
              <RefreshCw size={14} />
            </button>
            <button onClick={close} className="text-lorica-textDim hover:text-lorica-text"><X size={16} /></button>
          </div>
        </div>

        {/* Search + Category Filter */}
        <div className="px-4 py-2 border-b border-lorica-border/50 space-y-2">
          <div className="flex items-center bg-lorica-bg border border-lorica-border rounded-lg px-2 py-1.5">
            <Search size={12} className="text-lorica-textDim mr-2" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search extensions..."
              className="flex-1 bg-transparent text-xs text-lorica-text outline-none placeholder:text-lorica-textDim/50"
            />
          </div>
          <div className="flex gap-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 rounded-full text-[10px] transition-colors capitalize ${
                  category === cat
                    ? 'bg-lorica-accent/20 text-lorica-accent'
                    : 'text-lorica-textDim hover:text-lorica-text bg-lorica-bg'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Extension List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-lorica-textDim animate-pulse">Loading extensions...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-lorica-textDim">No extensions found</div>
          ) : (
            filtered.map(ext => {
              const Icon = CATEGORY_ICONS[ext.category] || Package;
              const color = CATEGORY_COLORS[ext.category] || 'text-lorica-textDim';
              const isInstalling = installing === ext.id;

              // Friendlier message for the apt-get lock race. The raw
              // dpkg error is overwhelming and not actionable for a
              // non-sysadmin user.
              const friendlyError = (raw) => {
                if (!raw) return raw;
                if (raw.includes('dpkg/lock') || raw.includes('Could not get lock')) {
                  return "Another package manager is running (apt / dpkg). Wait for it to finish or close it, then try again.";
                }
                return raw;
              };

              return (
                <div key={ext.id} className="border-b border-lorica-border/30 hover:bg-lorica-panel/50 transition-colors group">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className={`mt-0.5 p-1.5 rounded-lg flex-shrink-0 ${ext.installed ? 'bg-green-400/10' : 'bg-lorica-bg'}`}>
                      <Icon size={16} className={ext.installed ? 'text-green-400' : color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-lorica-text">{ext.name}</span>
                        <span className="text-[9px] text-lorica-textDim">v{ext.version}</span>
                      </div>
                      <div className="text-[10px] text-lorica-textDim mt-0.5 break-words">{ext.description}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ext.languages.map(l => (
                          <span key={l} className="px-1.5 py-0.5 text-[9px] bg-lorica-bg rounded text-lorica-textDim capitalize">{l}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex-shrink-0 max-w-[140px]">
                      {ext.installed ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-green-400 flex items-center gap-1"><Check size={10} /> Installed</span>
                          <button
                            onClick={() => handleUninstall(ext)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-lorica-textDim hover:text-red-400 transition-all"
                            title="Uninstall"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          {isInstalling && progress[ext.id] > 0 ? (
                            <div className="w-20 h-1.5 bg-lorica-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-lorica-accent transition-all duration-200"
                                style={{ width: `${progress[ext.id]}%` }}
                              />
                            </div>
                          ) : null}
                          <button
                            onClick={() => handleInstall(ext)}
                            disabled={isInstalling}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] transition-colors ${
                              isInstalling
                                ? 'bg-lorica-border text-lorica-textDim'
                                : !ext.install_cmd && ext.install_note
                                ? 'bg-amber-400/20 text-amber-400 hover:bg-amber-400/30'
                                : 'bg-lorica-accent/20 text-lorica-accent hover:bg-lorica-accent/30'
                            }`}
                          >
                            {!ext.install_cmd && ext.install_note ? (
                              <>
                                <Info size={10} />
                                Guide d'install
                              </>
                            ) : (
                              <>
                                <Download size={10} />
                                {isInstalling ? 'Installing...' : 'Install'}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Install error goes on its own full-width row under the
                      card. Putting it in the right-hand column (old code)
                      made the flex column expand for long errors, which
                      crushed the middle column and wrapped the description
                      one word per line. */}
                  {installError?.id === ext.id && (
                    <div className="px-4 pb-2 -mt-1">
                      <div className="flex items-start gap-1.5 text-[10px] text-red-400 bg-red-500/5 border border-red-500/20 rounded px-2 py-1.5 break-words">
                        <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
                        <span className="break-words min-w-0">{friendlyError(installError.message)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

