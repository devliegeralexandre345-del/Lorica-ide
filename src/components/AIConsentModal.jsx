import React from 'react';
import { Shield, ExternalLink } from 'lucide-react';

/**
 * RGPD consent gate for the first use of any AI feature.
 *
 * Mounted at the App level and shown whenever `state.aiConsentModalOpen`
 * is true. Once the user clicks "Accepter", `SET_AI_CONSENT` with
 * value=true is dispatched, which persists the flag to localStorage and
 * closes the modal. Every subsequent AI call just sees `aiConsentGiven`
 * and proceeds without a prompt.
 */
export default function AIConsentModal({ state, dispatch }) {
  if (!state.aiConsentModalOpen) return null;

  const accept = () => dispatch({ type: 'SET_AI_CONSENT', value: true });
  const decline = () => dispatch({ type: 'CLOSE_AI_CONSENT_MODAL' });

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
      onClick={decline}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-w-xl rounded-2xl p-6"
        style={{
          background: 'var(--color-panel)',
          border: '1px solid rgba(0, 212, 255, 0.3)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="p-2 rounded-lg"
            style={{ background: 'rgba(0, 212, 255, 0.1)' }}
          >
            <Shield size={20} style={{ color: '#00d4ff' }} />
          </div>
          <h2
            id="ai-consent-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--color-text)' }}
          >
            Consentement pour les fonctionnalités IA
          </h2>
        </div>

        <div
          className="space-y-3 text-sm leading-relaxed mb-5"
          style={{ color: 'var(--color-text)' }}
        >
          <p>
            En utilisant une fonctionnalité IA de Lorica (Copilot, Agent,
            Inline Edit, Auto-Fix, Swarm Review, etc.), tu acceptes que les
            données suivantes soient envoyées au fournisseur IA dont tu as
            configuré la clé API :
          </p>

          <ul className="ml-4 space-y-1" style={{ color: 'var(--color-textDim)' }}>
            <li>• Ton prompt (ce que tu tapes dans l'IA)</li>
            <li>• Le contenu du fichier en cours et son contexte</li>
            <li>• L'historique récent de la conversation</li>
            <li>• Parfois du contexte de fichiers liés que l'agent tire tout seul</li>
          </ul>

          <p>
            <strong>Destinations possibles</strong> (selon ta config) :{' '}
            <code style={{ color: '#00d4ff' }}>api.anthropic.com</code>,{' '}
            <code style={{ color: '#00d4ff' }}>api.deepseek.com</code>, ou
            l'endpoint compatible OpenAI que tu as configuré. Lorica n'opère
            aucun serveur intermédiaire — tes données vont directement chez
            le fournisseur.
          </p>

          <p>
            Ces fournisseurs sont des <strong>data processors indépendants</strong>.
            Leur traitement est régi par leur propre politique de
            confidentialité. Si tes prompts peuvent contenir des données
            personnelles (au sens RGPD), c'est à toi d'avoir un DPA valide
            avec eux.
          </p>

          <div
            className="p-3 rounded-lg text-xs"
            style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)' }}
          >
            Tu peux révoquer ce consentement à tout moment dans{' '}
            <strong>Settings → Privacy</strong>, ou retirer ta clé API pour
            bloquer physiquement tout envoi de données.
          </div>

          <p style={{ color: 'var(--color-textDim)' }}>
            Politique de confidentialité complète :{' '}
            <a
              href="https://github.com/devliegeralexandre345-del/Lorica-ide/blob/main/PRIVACY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: '#00d4ff' }}
            >
              PRIVACY.md <ExternalLink size={12} />
            </a>
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={decline}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: 'var(--color-textDim)',
            }}
          >
            Refuser
          </button>
          <button
            onClick={accept}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'linear-gradient(135deg, #00d4ff, #0099cc)',
              color: '#0a0a0f',
            }}
          >
            J'accepte
          </button>
        </div>
      </div>
    </div>
  );
}
