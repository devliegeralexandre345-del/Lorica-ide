import { useState, useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * Hook managing the in-app auto-update flow.
 *
 * - Reads `currentVersion` from the Tauri backend (no more hardcoded strings).
 * - `checkNow()` queries GitHub Releases; errors bubble up so the UI can log
 *   them. Periodic background checks stay silent to avoid toast spam.
 * - `installUpdate()` streams the installer and listens for `update:progress`
 *   events to drive the progress bar.
 *
 * @returns {{
 *   currentVersion: string,
 *   latestVersion: string | null,
 *   updateAvailable: boolean,
 *   releaseNotes: string | null,
 *   isChecking: boolean,
 *   isInstalling: boolean,
 *   progress: { downloaded: number, total: number, percent: number } | null,
 *   lastError: string | null,
 *   checkNow: () => Promise<void>,
 *   installUpdate: () => Promise<void>
 * }}
 */
export function useUpdate(dispatch) {
  const [currentVersion, setCurrentVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState(null);
  const [releaseNotes, setReleaseNotes] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastError, setLastError] = useState(null);
  const downloadUrlRef = useRef(null);
  const isInteractiveRef = useRef(false);

  const updateAvailable = latestVersion !== null;

  const invoke = useCallback(async (cmd, args) => {
    const core = window.__TAURI__?.core;
    if (!core?.invoke) throw new Error('Tauri runtime unavailable');
    return core.invoke(cmd, args);
  }, []);

  // Load current version once on mount.
  useEffect(() => {
    let alive = true;
    invoke('get_current_version')
      .then((v) => alive && setCurrentVersion(String(v || '')))
      .catch(() => alive && setCurrentVersion(''));
    return () => {
      alive = false;
    };
  }, [invoke]);

  /**
   * Query the backend for a newer release.
   * @param {{ interactive?: boolean }} [opts] — interactive checks toast
   *   errors; background checks stay silent.
   */
  const checkForUpdate = useCallback(
    async (opts = {}) => {
      const interactive = !!opts.interactive;
      isInteractiveRef.current = interactive;
      setIsChecking(true);
      setLastError(null);
      if (dispatch) dispatch({ type: 'SET_UPDATE_INFO', isChecking: true });

      try {
        const result = await invoke('check_for_update');
        if (result) {
          setLatestVersion(result.version);
          setReleaseNotes(result.body);
          setDownloadUrl(result.downloadUrl);
          downloadUrlRef.current = result.downloadUrl;

          if (dispatch) {
            dispatch({
              type: 'SET_UPDATE_INFO',
              available: true,
              latestVersion: result.version,
              downloadUrl: result.downloadUrl,
              releaseNotes: result.body,
              isChecking: false,
            });
            dispatch({
              type: 'ADD_TOAST',
              toast: {
                type: 'info',
                message: `Mise à jour v${result.version} disponible`,
              },
            });
          }
        } else {
          setLatestVersion(null);
          setReleaseNotes(null);
          setDownloadUrl(null);
          downloadUrlRef.current = null;
          if (dispatch) {
            dispatch({
              type: 'SET_UPDATE_INFO',
              available: false,
              latestVersion: null,
              downloadUrl: null,
              releaseNotes: null,
              isChecking: false,
            });
          }
          if (interactive && dispatch) {
            dispatch({
              type: 'ADD_TOAST',
              toast: { type: 'success', message: 'Lorica est à jour' },
            });
          }
        }
      } catch (error) {
        const msg = typeof error === 'string' ? error : error?.message || String(error);
        console.warn('Update check failed:', msg);
        setLastError(msg);
        if (interactive && dispatch) {
          dispatch({
            type: 'ADD_TOAST',
            toast: {
              type: 'error',
              message: `Vérification échouée: ${msg}`,
            },
          });
        }
      } finally {
        setIsChecking(false);
        if (dispatch) dispatch({ type: 'SET_UPDATE_INFO', isChecking: false });
      }
    },
    [dispatch, invoke]
  );

  /**
   * Download + launch the installer with live progress.
   */
  const installUpdate = useCallback(async () => {
    const url = downloadUrlRef.current;
    if (!url) {
      if (dispatch) {
        dispatch({
          type: 'ADD_TOAST',
          toast: {
            type: 'error',
            message: 'URL de téléchargement manquante. Vérifiez les mises à jour.',
          },
        });
      }
      return;
    }

    setIsInstalling(true);
    setProgress({ downloaded: 0, total: 0, percent: 0 });
    if (dispatch) dispatch({ type: 'SET_UPDATE_INSTALLING', isInstalling: true });

    // Subscribe to progress events for this install session.
    let unlisten = null;
    try {
      try {
        unlisten = await listen('update:progress', (e) => {
          const p = e?.payload;
          if (p && typeof p === 'object') {
            setProgress({
              downloaded: Number(p.downloaded || 0),
              total: Number(p.total || 0),
              percent: Number(p.percent || 0),
            });
          }
        });
      } catch (_) {
        // Non-fatal: we still download, just without progress updates.
        unlisten = null;
      }

      await invoke('download_and_install_update', { downloadUrl: url });
      if (dispatch) {
        dispatch({
          type: 'ADD_TOAST',
          toast: {
            type: 'success',
            message: 'Installateur lancé. Suivez l\'assistant pour terminer.',
          },
        });
      }
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || String(error);
      console.error('Installation failed:', msg);
      setLastError(msg);
      if (dispatch) {
        dispatch({
          type: 'ADD_TOAST',
          toast: {
            type: 'error',
            message: `Installation échouée: ${msg}`,
          },
        });
      }
    } finally {
      if (typeof unlisten === 'function') {
        try { unlisten(); } catch (_) { /* ignore */ }
      }
      setIsInstalling(false);
      setProgress(null);
      if (dispatch) dispatch({ type: 'SET_UPDATE_INSTALLING', isInstalling: false });
    }
  }, [dispatch, invoke]);

  // Check on mount (background, silent on errors)
  useEffect(() => {
    checkForUpdate({ interactive: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic check every 30 minutes (background)
  useEffect(() => {
    const interval = setInterval(() => {
      checkForUpdate({ interactive: false });
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdate]);

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseNotes,
    isChecking,
    isInstalling,
    progress,
    lastError,
    // Manual check from UI — toasts errors.
    checkNow: () => checkForUpdate({ interactive: true }),
    installUpdate,
  };
}
