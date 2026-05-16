import React, { useState, useRef, useEffect } from 'react';
import { Lock, Unlock, ShieldCheck, Eye, EyeOff, AlertTriangle } from 'lucide-react';

export default function LockScreen({ onUnlock, onInit, onReset, vaultInitialized }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isInit, setIsInit] = useState(!vaultInitialized);
  // Two-step confirm for the forgot-password reset. First click shows
  // an inline warning + "Confirmer" button; only the second click
  // actually wipes the vault. Prevents a slip from destroying all the
  // user's stored secrets.
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isInit) {
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      const result = await onInit(password);
      if (!result.success) {
        setError(result.error || 'Failed to initialize vault');
      }
    } else {
      const result = await onUnlock(password);
      if (!result.success) {
        setError('Invalid password');
        setPassword('');
      }
    }
  };

  return (
    <div className="lock-backdrop fixed inset-0 z-50 flex items-center justify-center">
      <div className="w-[380px] bg-lorica-panel border border-lorica-border rounded-2xl shadow-2xl p-8 animate-fadeIn">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-lorica-accent/10 border border-lorica-accent/20 mb-4">
            <Lock size={28} className="text-lorica-accent" />
          </div>
          <h1 className="text-xl font-bold text-lorica-text">Lorica</h1>
          <p className="text-xs text-lorica-textDim mt-1">
            {isInit ? 'Create a master password to secure your vault' : 'Enter your master password to unlock'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password */}
          <div className="relative">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Master Password"
              className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-4 py-2.5 text-sm text-lorica-text outline-none focus:border-lorica-accent transition-colors pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-lorica-textDim hover:text-lorica-text"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {/* Confirm password (init only) */}
          {isInit && (
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm Password"
              className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-4 py-2.5 text-sm text-lorica-text outline-none focus:border-lorica-accent transition-colors"
            />
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-lorica-danger bg-lorica-danger/10 border border-lorica-danger/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-lorica-accent text-lorica-bg font-semibold py-2.5 rounded-lg hover:bg-lorica-accent/90 transition-colors text-sm"
          >
            {isInit ? <ShieldCheck size={16} /> : <Unlock size={16} />}
            {isInit ? 'Create Vault & Enter' : 'Unlock'}
          </button>
        </form>

        {/* Toggle init/unlock */}
        {vaultInitialized && isInit && (
          <button
            onClick={() => setIsInit(false)}
            className="w-full text-center text-xs text-lorica-textDim hover:text-lorica-accent mt-4 transition-colors"
          >
            Already have a vault? Sign in
          </button>
        )}
        {!vaultInitialized && !isInit && (
          <button
            onClick={() => setIsInit(true)}
            className="w-full text-center text-xs text-lorica-textDim hover:text-lorica-accent mt-4 transition-colors"
          >
            Create a new vault
          </button>
        )}

        {/* Forgot-password reset. Only offered when the vault already
            exists AND the user is on the unlock screen — there's no
            point showing it during initial creation. */}
        {vaultInitialized && !isInit && onReset && (
          <div className="mt-3 pt-3 border-t border-lorica-border/40">
            {!resetArmed ? (
              <button
                onClick={() => { setResetArmed(true); setError(''); }}
                className="w-full text-center text-[11px] text-lorica-textDim hover:text-amber-400 transition-colors"
              >
                Mot de passe oublié ? Réinitialiser le vault
              </button>
            ) : (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-start gap-2 text-[11px] text-amber-200">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    La réinitialisation supprime définitivement tous les
                    secrets stockés (clés API, etc.). Cette action est
                    irréversible.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setResetting(true);
                      const result = await onReset();
                      setResetting(false);
                      if (result?.success) {
                        // Drop back into the "create a new vault" flow.
                        setResetArmed(false);
                        setIsInit(true);
                        setPassword('');
                        setConfirmPassword('');
                        setError('');
                      } else {
                        setError(result?.error || 'Reset failed');
                      }
                    }}
                    disabled={resetting}
                    className="flex-1 py-1.5 rounded-md bg-amber-500/30 border border-amber-500/60 text-amber-100 text-[11px] font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
                  >
                    {resetting ? 'Réinitialisation…' : 'Confirmer la suppression'}
                  </button>
                  <button
                    onClick={() => setResetArmed(false)}
                    disabled={resetting}
                    className="flex-1 py-1.5 rounded-md border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-text transition-colors disabled:opacity-50"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

