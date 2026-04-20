import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import SpotifyWebApi from 'spotify-web-api-js';

// Tauri imports
let listen, openInBrowser, getCurrentWindow;
if (typeof window !== 'undefined' && window.__TAURI__) {
  ({ listen } = require('@tauri-apps/api/event'));
  ({ open: openInBrowser } = require('@tauri-apps/plugin-shell'));
  ({ getCurrentWindow } = require('@tauri-apps/api/window'));
}

const spotifyApi = new SpotifyWebApi();

const CLIENT_ID = '57b0685cc3574d10a21bc43c6ed546f4';
const SCOPES = ['user-read-currently-playing', 'user-modify-playback-state', 'user-read-playback-state'];

export const CODING_PLAYLISTS = [
  { name: 'Lofi Beats', uri: 'spotify:playlist:0vvXsWCC9xrXsKd4FyS8kM', embedId: '0vvXsWCC9xrXsKd4FyS8kM' },
  { name: 'Deep Focus', uri: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ', embedId: '37i9dQZF1DWZeKCadgRdKQ' },
  { name: 'Chill Coding', uri: 'spotify:playlist:37i9dQZF1DX5trt9i14X7j', embedId: '37i9dQZF1DX5trt9i14X7j' },
  { name: 'Brain Food', uri: 'spotify:playlist:37i9dQZF1DWXLeA8Omikj7', embedId: '37i9dQZF1DWXLeA8Omikj7' },
  { name: 'Synthwave', uri: 'spotify:playlist:37i9dQZF1DXdLEN7aqioXM', embedId: '37i9dQZF1DXdLEN7aqioXM' },
  { name: 'Electronic Focus', uri: 'spotify:playlist:37i9dQZF1DX0wMD4IoQ5aJ', embedId: '37i9dQZF1DX0wMD4IoQ5aJ' },
];

// FIX: Génération de clé 100% conforme aux normes de Spotify (RFC 7636)
const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
};

const sha256 = async (plain) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
};

const base64encode = (input) => {
  const bytes = new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

export function useSpotify() {
  const [token, setToken] = useState(() => {
    // FIX: Préchargement synchrone du token depuis localStorage
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('spotify_token') || null;
    }
    return null;
  });
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentPlaylist, setCurrentPlaylist] = useState(CODING_PLAYLISTS[0]);
  const [callbackServerPort, setCallbackServerPort] = useState(3000);
  
  // FIX: Utilisation de useRef pour éviter les stale closures
  const callbackServerPortRef = useRef(callbackServerPort);
  const isFetchingTokenRef = useRef(false);
  const abortControllerRef = useRef(null);
  const focusWindowTimeoutRef = useRef(null);
  
  // Mise à jour de la ref quand le port change
  useEffect(() => {
    callbackServerPortRef.current = callbackServerPort;
  }, [callbackServerPort]);
  
  // FIX: Déterminer REDIRECT_URI en utilisant la ref pour éviter stale closure
  const getRedirectUri = useCallback(() => {
    if (typeof window !== 'undefined' && window.__TAURI__) {
      return `http://127.0.0.1:${callbackServerPortRef.current}/callback`;
    }
    return 'http://127.0.0.1:3000/callback';
  }, []);
  
  // FIX: fetchToken hissé au niveau du hook pour être accessible partout
  const fetchToken = useCallback(async (authCode) => {
    if (isFetchingTokenRef.current) return;
    isFetchingTokenRef.current = true;
    
    // Annuler toute requête précédente
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    // On nettoie l'URL pour ne pas réutiliser le même code
    window.history.replaceState({}, document.title, "/");
    const codeVerifier = window.localStorage.getItem('code_verifier');
    
    try {
      const tokenUrl = atob('aHR0cHM6Ly9hY2NvdW50cy5zcG90aWZ5LmNvbS9hcGkvdG9rZW4=');
      
      // FIX: Timeout de 5 secondes pour la requête fetch
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 5000)
      );
      
      const response = await Promise.race([
        fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: getRedirectUri(),
            code_verifier: codeVerifier,
          }),
          signal: abortController.signal,
        }),
        timeoutPromise
      ]);
      
      const data = await response.json();
      
      if (!response.ok) {
        console.error("❌ REFUS DE SPOTIFY :", data.error, "-", data.error_description);
        window.localStorage.removeItem('code_verifier');
        return;
      }
      
      if (data.access_token) {
        window.localStorage.setItem('spotify_token', data.access_token);
        // FIX: Stocker aussi le refresh_token si disponible
        if (data.refresh_token) {
          window.localStorage.setItem('spotify_refresh_token', data.refresh_token);
        }
        setToken(data.access_token);
        
        // Refocaliser la fenêtre Tauri après réception du token
        if (typeof window !== 'undefined' && window.__TAURI__ && getCurrentWindow) {
          focusWindowTimeoutRef.current = setTimeout(async () => {
            try {
              const win = getCurrentWindow();
              await win.show();
              await win.unminimize();
              await win.setFocus();
            } catch (e) {
              console.warn("Could not focus window:", e);
            }
          }, 300);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error("❌ ERREUR RÉSEAU :", e);
      }
    } finally {
      isFetchingTokenRef.current = false;
      abortControllerRef.current = null;
    }
  }, [getRedirectUri]);
  
  // FIX: Fonction pour rafraîchir le token avec refresh_token
  const refreshAccessToken = useCallback(async () => {
    const refreshToken = window.localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) return null;
    
    try {
      const tokenUrl = atob('aHR0cHM6Ly9hY2NvdW50cy5zcG90aWZ5LmNvbS9hcGkvdG9rZW4=');
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      
      const data = await response.json();
      if (data.access_token) {
        window.localStorage.setItem('spotify_token', data.access_token);
        setToken(data.access_token);
        return data.access_token;
      }
    } catch (e) {
      console.error("❌ ERREUR REFRESH TOKEN :", e);
    }
    return null;
  }, []);
  
  // Démarrer le serveur Tauri pour OAuth callback
  useEffect(() => {
    if (!window.__TAURI__) return;
    
    let mounted = true;
    
    const startServer = async () => {
      try {
        const port = await window.__TAURI__?.core?.invoke('start_spotify_auth_server');
        if (port && mounted) {
          setCallbackServerPort(port);
        }
      } catch (e) {
        console.error('Failed to start Spotify auth server:', e);
      }
    };
    
    startServer();
    
    return () => {
      mounted = false;
    };
  }, []);
  
  // Écouter l'événement Tauri pour récupérer le code OAuth
  useEffect(() => {
    if (!window.__TAURI__ || !listen) return;
    
    let unlistenFn;
    let mounted = true;
    
    const setupListener = async () => {
      try {
        const unlisten = await listen('spotify-oauth-callback', async (event) => {
          if (!mounted) return;
          // Backward-compat: older backend emits a bare string, newer emits
          // {code, state}. We accept both so upgrades don't break in flight.
          const payload = event.payload;
          const code = typeof payload === 'string' ? payload : payload?.code;
          const returnedState = typeof payload === 'string' ? null : payload?.state;
          // Verify state matches what we generated before the redirect.
          try {
            const expected = sessionStorage.getItem('spotify_oauth_state');
            if (expected && returnedState && expected !== returnedState) {
              console.warn('Spotify OAuth state mismatch — rejecting callback.');
              return;
            }
          } catch {
            // sessionStorage can throw in locked-down browsers — fall through,
            // the token fetch will fail if the code is stale anyway.
          }
          if (!code) return;
          await fetchToken(code);
        });
        
        if (mounted) {
          unlistenFn = unlisten;
        }
      } catch (e) {
        console.error('Failed to listen to spotify-oauth-callback:', e);
      }
    };
    
    setupListener();
    
    return () => {
      mounted = false;
      if (unlistenFn) {
        unlistenFn();
      }
      if (focusWindowTimeoutRef.current) {
        clearTimeout(focusWindowTimeoutRef.current);
      }
    };
  }, [fetchToken]); // FIX: Dépendance sur fetchToken pour éviter stale closure
  
  // Gestion du token et polling du track actuel
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    // Traiter le code dans l'URL (mode web dev)
    if (!token && code) {
      fetchToken(code);
    }
    
    if (token) {
      spotifyApi.setAccessToken(token);
      
      const fetchCurrentTrack = async () => {
        try {
          const data = await spotifyApi.getMyCurrentPlayingTrack();
          if (data && data.item) {
            setCurrentTrack({
              name: data.item.name,
              artist: data.item.artists[0].name,
              albumArt: data.item.album.images[0]?.url,
              isPlaying: data.is_playing,
            });
          } else {
            setCurrentTrack(null);
          }
        } catch (e) {
          if (e.status === 401) {
            // Token expiré, essayer de le rafraîchir
            const newToken = await refreshAccessToken();
            if (!newToken) {
              window.localStorage.removeItem('spotify_token');
              setToken(null);
            }
          }
        }
      };
      
      fetchCurrentTrack();
      // FIX: Intervalle augmenté à 5 secondes pour économiser les appels API
      const interval = setInterval(fetchCurrentTrack, 5000);
      
      return () => clearInterval(interval);
    }
  }, [token, fetchToken, refreshAccessToken]);
  
  const login = useCallback(async () => {
    // FIX: On nettoie l'ancien cache avant de générer une nouvelle clé
    window.localStorage.removeItem('spotify_token');
    window.localStorage.removeItem('code_verifier');
    window.localStorage.removeItem('spotify_refresh_token');
    
    const codeVerifier = generateRandomString(64);
    window.localStorage.setItem('code_verifier', codeVerifier);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    // CSRF defense-in-depth alongside PKCE: we store a random state and
    // verify it on the callback. Uses sessionStorage so it's scoped to the
    // current window and cleared when the app closes.
    const oauthState = generateRandomString(32);
    try { sessionStorage.setItem('spotify_oauth_state', oauthState); } catch {}

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: getRedirectUri(),
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state: oauthState,
    });
    
    const authUrl = atob('aHR0cHM6Ly9hY2NvdW50cy5zcG90aWZ5LmNvbS9hdXRob3JpemU=');
    const fullAuthUrl = `${authUrl}?${params.toString()}`;
    
    // Ouvrir dans le navigateur système via Tauri, ou rediriger la webview en dev
    if (typeof window !== 'undefined' && window.__TAURI__ && openInBrowser) {
      await openInBrowser(fullAuthUrl);
    } else {
      window.location.href = fullAuthUrl;
    }
  }, [getRedirectUri]);
  
  const play = useCallback(() => {
    spotifyApi.play();
    setCurrentTrack(prev => prev ? { ...prev, isPlaying: true } : null);
  }, []);
  
  const pause = useCallback(() => {
    spotifyApi.pause();
    setCurrentTrack(prev => prev ? { ...prev, isPlaying: false } : null);
  }, []);
  
  const next = useCallback(() => spotifyApi.skipToNext(), []);
  const previous = useCallback(() => spotifyApi.skipToPrevious(), []);
  
  const selectPlaylist = useCallback((playlist) => setCurrentPlaylist(playlist), []);
  
  const setCustomPlaylist = useCallback((spotifyUrl) => {
    const match = spotifyUrl.match(/spotify\.com\/(playlist|track|album)\/([a-zA-Z0-9]+)/);
    if (match) {
      setCurrentPlaylist({ name: 'Custom', type: match[1], embedId: match[2] });
      return true;
    }
    return false;
  }, []);
  
  const getEmbedUrl = useCallback(() => {
    if (!currentPlaylist) return null;
    const type = currentPlaylist.type || 'playlist';
    const embedUrl = atob('aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL2VtYmVk');
    return `${embedUrl}/${type}/${currentPlaylist.embedId}?utm_source=generator&theme=0`;
  }, [currentPlaylist]);
  
  const logout = useCallback(() => {
    window.localStorage.removeItem('spotify_token');
    window.localStorage.removeItem('code_verifier');
    window.localStorage.removeItem('spotify_refresh_token');
    setToken(null);
    setCurrentTrack(null);
  }, []);
  
  // FIX: Mémoisation des valeurs de retour pour éviter re-renders inutiles
  const returnValues = useMemo(() => ({ 
    token, 
    currentTrack, 
    login, 
    play, 
    pause, 
    next, 
    previous, 
    logout,
    currentPlaylist, 
    playlists: CODING_PLAYLISTS, 
    selectPlaylist, 
    setCustomPlaylist, 
    getEmbedUrl,
    refreshAccessToken,
  }), [
    token, currentTrack, login, play, pause, next, previous, logout,
    currentPlaylist, selectPlaylist, setCustomPlaylist, getEmbedUrl,
    refreshAccessToken,
  ]);
  
  return returnValues;
}