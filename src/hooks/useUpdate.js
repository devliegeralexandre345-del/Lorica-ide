import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for managing automatic updates
 * @returns {{
 *   currentVersion: string,
 *   latestVersion: string | null,
 *   updateAvailable: boolean,
 *   releaseNotes: string | null,
 *   isChecking: boolean,
 *   isInstalling: boolean,
 *   checkNow: () => Promise<void>,
 *   installUpdate: () => Promise<void>
 * }}
 */
export function useUpdate(dispatch) {
  const currentVersion = '2.0.0'; // From tauri.conf.json
  const [latestVersion, setLatestVersion] = useState(null);
  const [releaseNotes, setReleaseNotes] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const downloadUrlRef = useRef(null);

  const updateAvailable = latestVersion !== null;

  /**
   * Invoke Tauri command to check for updates
   */
  const checkForUpdate = useCallback(async () => {
    setIsChecking(true);
    if (dispatch) {
      dispatch({ type: 'SET_UPDATE_INFO', isChecking: true });
    }
    try {
      // Use Tauri 2 invoke API
      const result = await window.__TAURI__.core.invoke('check_for_update');
      if (result) {
        setLatestVersion(result.version);
        setReleaseNotes(result.body);
        setDownloadUrl(result.downloadUrl);
        downloadUrlRef.current = result.downloadUrl;

        // Update store
        if (dispatch) {
          dispatch({
            type: 'SET_UPDATE_INFO',
            available: true,
            latestVersion: result.version,
            downloadUrl: result.downloadUrl,
            releaseNotes: result.body,
            isChecking: false,
          });

          // Show toast notification
          dispatch({
            type: 'ADD_TOAST',
            toast: {
              type: 'info',
              message: `Update v${result.version} available!`,
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
      }
    } catch (error) {
      console.warn('Update check failed:', error);
      // Silent fail, don't show to user
    } finally {
      setIsChecking(false);
      if (dispatch) {
        dispatch({ type: 'SET_UPDATE_INFO', isChecking: false });
      }
    }
  }, [dispatch]);

  /**
   * Install the update by downloading and launching installer
   */
  const installUpdate = useCallback(async () => {
    const url = downloadUrlRef.current;
    if (!url) {
      console.error('No download URL available');
      if (dispatch) {
        dispatch({
          type: 'ADD_TOAST',
          toast: {
            type: 'error',
            message: 'No download URL available. Please check for updates first.',
          },
        });
      }
      return;
    }

    setIsInstalling(true);
    if (dispatch) {
      dispatch({ type: 'SET_UPDATE_INSTALLING', isInstalling: true });
    }
    try {
      await window.__TAURI__.core.invoke('download_and_install_update', {
        downloadUrl: url,
      });
      // Installer launched, app may close soon
      if (dispatch) {
        dispatch({
          type: 'ADD_TOAST',
          toast: {
            type: 'success',
            message: 'Installer launched, please follow the installation wizard.',
          },
        });
      }
    } catch (error) {
      console.error('Installation failed:', error);
      if (dispatch) {
        dispatch({
          type: 'ADD_TOAST',
          toast: {
            type: 'error',
            message: `Installation failed: ${error.message || error}`,
          },
        });
      }
    } finally {
      setIsInstalling(false);
      if (dispatch) {
        dispatch({ type: 'SET_UPDATE_INSTALLING', isInstalling: false });
      }
    }
  }, [dispatch]);

  // Check on mount
  useEffect(() => {
    checkForUpdate();
  }, []);

  // Periodic check every 30 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      checkForUpdate();
    }, 30 * 60 * 1000); // 30 minutes

    return () => clearInterval(interval);
  }, [checkForUpdate]);

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseNotes,
    isChecking,
    isInstalling,
    checkNow: checkForUpdate,
    installUpdate,
  };
}