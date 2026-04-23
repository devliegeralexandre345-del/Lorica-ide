import { useCallback, useEffect, useRef } from 'react';

export function useSecurity(state, dispatch) {
  const lastActivityRef = useRef(Date.now());
  const lockTimerRef = useRef(null);

  // Auto-lock logic
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);

    lockTimerRef.current = setInterval(() => {
      if (state.autoLockMinutes > 0 && !state.isLocked) {
        const elapsed = (Date.now() - lastActivityRef.current) / 1000 / 60;
        if (elapsed >= state.autoLockMinutes) {
          dispatch({ type: 'SET_LOCKED', value: true });
          window.lorica.security.lockVault();
          window.lorica.security.addAuditEntry('AUTO_LOCK', `Locked after ${state.autoLockMinutes} min inactivity`);
        }
      }
    }, 30000);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      clearInterval(lockTimerRef.current);
    };
  }, [state.autoLockMinutes, state.isLocked, dispatch]);

  // Pull any previously-saved API keys out of the vault into in-memory
  // state. Called every time the vault transitions to unlocked (boot
  // with an unlocked session, or after an explicit unlock). Errors are
  // non-fatal — we silently keep the in-memory state if a secret doesn't
  // exist yet (first run after vault creation).
  const hydrateKeysFromVault = useCallback(async () => {
    const tryLoad = async (vaultKey, actionType) => {
      try {
        const res = await window.lorica.security.getSecret(vaultKey);
        if (res?.success !== false && typeof res?.data === 'string' && res.data.length > 0) {
          dispatch({ type: actionType, key: res.data });
        }
      } catch { /* absent secret — fine */ }
    };
    await Promise.all([
      tryLoad('anthropic_api_key', 'SET_AI_KEY'),
      tryLoad('deepseek_api_key',  'SET_DEEPSEEK_KEY'),
    ]);
  }, [dispatch]);

  // Check vault state on mount. If the vault is already unlocked at
  // boot (not our default, but possible after a relaunch if lock wasn't
  // called), also hydrate keys immediately.
  useEffect(() => {
    (async () => {
      const init = await window.lorica.security.isVaultInitialized();
      const unlocked = await window.lorica.security.isVaultUnlocked();
      dispatch({
        type: 'SET_VAULT_STATE',
        initialized: init.data,
        unlocked: unlocked.data,
      });
      if (unlocked.data) await hydrateKeysFromVault();
    })();
  }, [dispatch, hydrateKeysFromVault]);

  const unlock = useCallback(async (password) => {
    const result = await window.lorica.security.unlockVault(password);
    if (result.success) {
      dispatch({ type: 'SET_LOCKED', value: false });
      dispatch({ type: 'SET_VAULT_STATE', initialized: true, unlocked: true });
      lastActivityRef.current = Date.now();
      // Secrets were sealed before — now they're accessible, pull them
      // into React state so AI features work without a manual re-paste.
      await hydrateKeysFromVault();
    }
    return result;
  }, [dispatch, hydrateKeysFromVault]);

  const lock = useCallback(async () => {
    dispatch({ type: 'SET_LOCKED', value: true });
    await window.lorica.security.lockVault();
    dispatch({ type: 'SET_VAULT_STATE', initialized: true, unlocked: false });
  }, [dispatch]);

  const initVault = useCallback(async (password) => {
    const result = await window.lorica.security.initVault(password);
    if (result.success) {
      dispatch({ type: 'SET_VAULT_STATE', initialized: true, unlocked: true });
    }
    return result;
  }, [dispatch]);

  return { unlock, lock, initVault };
}

