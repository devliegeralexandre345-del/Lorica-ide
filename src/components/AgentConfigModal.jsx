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

const MODELS = {
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (recommandé)' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (plus intelligent)' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5 (plus rapide)' },
  ],
  deepseek: [
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (rapide, recommandé)' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (plus intelligent — promo)' },
    { value: 'deepseek-chat', label: 'DeepSeek Chat (legacy — alias V4 Flash)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (legacy — alias V4 Flash thinking)' },
  ],
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

export default function AgentConfigModal({ onStart, onCancel, provider = 'anthropic' }) {
  const [context, setContext] = useState('none');
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [autoApprove, setAutoApprove] = useState(false);
  const modelsForProvider = MODELS[provider] || MODELS.anthropic;
  const [model, setModel] = useState(modelsForProvider[0].value);

  const togglePerm = (key) => setPermissions((p) => ({ ...p, [key]: !p[key] }));

  const handleStart = () => {
    onStart({ context, permissions, autoApprove, model });
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
          {/* Modèle */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mb-2">
              Modèle ({provider})
            </div>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-lorica-bg border border-lorica-border rounded-md px-2 py-1.5 text-xs text-lorica-text focus:outline-none focus:border-lorica-accent"
            >
              {modelsForProvider.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

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
