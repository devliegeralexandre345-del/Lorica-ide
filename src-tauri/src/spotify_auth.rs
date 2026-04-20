use std::net::{TcpListener, TcpStream};
use std::io::{Read, Write};
use std::thread;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, atomic::AtomicBool};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

static SERVER_PORT: AtomicU16 = AtomicU16::new(0);

// FIX: Structure pour gérer l'état du serveur avec timeout et arrêt propre
struct ServerState {
    should_stop: Arc<AtomicBool>,
    started_at: Instant,
}

impl ServerState {
    fn new() -> Self {
        Self {
            should_stop: Arc::new(AtomicBool::new(false)),
            started_at: Instant::now(),
        }
    }

    fn should_stop(&self) -> bool {
        self.should_stop.load(Ordering::Relaxed) || 
        self.started_at.elapsed() > Duration::from_secs(300) // 5 minutes timeout
    }

    fn stop(&self) {
        self.should_stop.store(true, Ordering::Relaxed);
    }
}

/// Minimal HTTP server to catch Spotify OAuth callback
/// FIX: Prend le listener déjà bound pour éviter la race condition
fn start_auth_server(listener: TcpListener, app: AppHandle, server_state: Arc<ServerState>) -> std::io::Result<()> {
    let port = listener.local_addr()?.port();
    log::info!("Spotify OAuth callback server listening on port {}", port);
    
    // FIX: Configurer le listener en mode non-bloquant pour permettre les checks d'arrêt
    if let Err(e) = listener.set_nonblocking(true) {
        log::warn!("Could not set nonblocking on listener: {}", e);
    }
    
    for stream in listener.incoming() {
        if server_state.should_stop() {
            log::info!("Server stopping on port {} (timeout or manual stop)", port);
            break;
        }
        
        match stream {
            Ok(mut stream) => {
                let app_clone = app.clone();
                let server_state_clone = server_state.clone();
                
                thread::spawn(move || {
                    handle_connection(&mut stream, app_clone, server_state_clone);
                });
            }
            Err(e) => {
                // FIX: Ignorer les erreurs "would block" en mode non-bloquant
                if e.kind() != std::io::ErrorKind::WouldBlock {
                    log::error!("Failed to accept connection on port {}: {}", port, e);
                }
                // Petite pause pour éviter la boucle CPU intensive
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    
    Ok(())
}

fn handle_connection(stream: &mut TcpStream, app: AppHandle, server_state: Arc<ServerState>) {
    let mut buffer = [0; 4096];
    if let Ok(size) = stream.read(&mut buffer) {
        let request = String::from_utf8_lossy(&buffer[..size]);
        
        if request.starts_with("GET /callback") {
            let url_str = format!("http://127.0.0.1{}", request.split_whitespace().nth(1).unwrap_or("/callback"));
            
            if let Ok(url) = Url::parse(&url_str) {
                // FIX: Gérer à la fois le code (succès) et l'erreur (user refuse)
                let mut code = None;
                let mut error = None;
                let mut state: Option<String> = None;

                for (key, value) in url.query_pairs() {
                    if key == "code" {
                        code = Some(value.to_string());
                    } else if key == "error" {
                        error = Some(value.to_string());
                    } else if key == "state" {
                        state = Some(value.to_string());
                    }
                }

                if let Some(code) = code {
                    log::info!("Spotify OAuth code received: {}...", &code[..10.min(code.len())]);

                    // FIX: Émettre l'event au frontend avec {code, state} pour
                    // que le frontend puisse vérifier le state CSRF-style.
                    #[derive(serde::Serialize, Clone)]
                    struct CallbackPayload {
                        code: String,
                        state: Option<String>,
                    }
                    let payload = CallbackPayload { code: code.clone(), state };
                    let emit_result = app.emit("spotify-oauth-callback", &payload);
                    
                    if let Err(e) = emit_result {
                        log::error!("Failed to emit spotify-oauth-callback event: {}", e);
                    }
                    
                    // Refocaliser la fenêtre principale après réception du code
                    if let Some(main_window) = app.get_webview_window("main") {
                        // Petit délai pour laisser la page de succès s'afficher dans le navigateur
                        thread::sleep(Duration::from_millis(200));

                        let _ = main_window.show();
                        let _ = main_window.unminimize();
                        let _ = main_window.set_focus();
                    }
                    
                    // FIX: Arrêter le serveur après réception d'un code valide
                    server_state.stop();
                    
                    // Envoyer la page HTML de succès (affichée dans le navigateur système)
                    let body = r#"<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Lorica - Spotify Connected</title>
                    <style>
                    body{background:#0a0a0f;color:#00d4ff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
                    .card{text-align:center;padding:40px;border:1px solid rgba(0,212,255,0.3);border-radius:16px;background:rgba(0,212,255,0.05);max-width:500px;}
                    .checkmark{font-size:48px;margin-bottom:16px;color:#1db954;}
                    .message{font-size:18px;margin-bottom:8px;font-weight:bold;}
                    .submessage{font-size:14px;opacity:0.8;margin-bottom:24px;}
                    .instructions{margin-top:24px;font-size:12px;color:rgba(0,212,255,0.7);}
                    .shortcut{background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;}
                    </style></head><body><div class="card">
                    <div class="checkmark">&#10003;</div>
                    <div class="message">Connexion Spotify réussie !</div>
                    <div class="submessage">Retournez sur Lorica. Vous pouvez fermer cet onglet.</div>
                    <div class="instructions">
                    Appuyez sur <span class="shortcut">Ctrl+W</span> (Windows/Linux) ou <span class="shortcut">Cmd+W</span> (Mac) pour fermer cet onglet.
                    </div>
                    </div></body></html>"#;
                    
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    return;
                } else if let Some(error) = error {
                    log::warn!("Spotify OAuth error: {}", error);
                    
                    // FIX: Émettre un event d'erreur pour le frontend
                    let _ = app.emit("spotify-oauth-error", &error);
                    
                    let body = format!("<!DOCTYPE html><html><body><h1>OAuth Error: {}</h1><p>Please try again.</p></body></html>", error);
                    let response = format!(
                        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
            }
        }
        
        // Fallback response
        let body = "Not found";
        let response = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    }
}

/// Start the OAuth callback server on an available port (3000-3010)
/// Returns the port number used
#[tauri::command]
pub fn start_spotify_auth_server(app: tauri::AppHandle) -> Result<u16, String> {
    // FIX: Essayer les ports 3001-3010 en priorité pour éviter le conflit avec Vite (port 3000)
    // En dev, Vite utilise 3000, donc on commence à 3001
    let ports_to_try = (3001..=3010).chain(3000..=3000);
    
    for port in ports_to_try {
        match TcpListener::bind(format!("127.0.0.1:{}", port)) {
            Ok(listener) => {
                // FIX: Pas de race condition - on passe le listener déjà bound au thread
                let app_clone = app.clone();
                let server_state = Arc::new(ServerState::new());
                let server_state_clone = server_state.clone();
                
                // FIX: Configurer le listener en mode non-bloquant pour le timeout
                if let Err(e) = listener.set_nonblocking(true) {
                    log::warn!("Could not set nonblocking on listener: {}", e);
                }
                
                let app_emit = app.clone();
                thread::spawn(move || {
                    if let Err(e) = start_auth_server(listener, app_clone, server_state_clone) {
                        log::error!("Spotify auth server error on port {}: {}", port, e);
                        // FIX: Émettre un event d'erreur pour informer le frontend
                        let _ = app_emit.emit("spotify-server-error", &format!("Server error: {}", e));
                    }
                });
                
                SERVER_PORT.store(port, Ordering::Relaxed);
                log::info!("Spotify OAuth callback server started on port {}", port);
                
                // FIX: Lancer un thread de surveillance pour le timeout
                let app_timeout = app.clone();
                let server_state_timeout = server_state.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(300)); // 5 minutes
                    if !server_state_timeout.should_stop() {
                        log::info!("Spotify OAuth server timeout after 5 minutes on port {}", port);
                        server_state_timeout.stop();
                        // Informer le frontend que le serveur s'est arrêté
                        let _ = app_timeout.emit("spotify-server-timeout", "Server stopped after 5 minutes timeout");
                    }
                });
                
                return Ok(port);
            }
            Err(e) => {
                log::debug!("Port {} unavailable: {}", port, e);
                continue;
            }
        }
    }
    Err("No available port in range 3000-3010".to_string())
}

/// Open a URL in the system browser. Only accepts http(s) — anything else
/// (file://, javascript:, weird schemes) is rejected because this is
/// reachable from the frontend and we don't want a rogue UI to be able
/// to launch arbitrary local files or custom-protocol handlers.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("Refusing to open URL with scheme '{}'", parsed.scheme()));
    }
    // Normalize back from the parser so we never pass raw user input to
    // the shell. `Url::to_string()` re-encodes any control chars.
    let safe_url = parsed.to_string();

    if cfg!(target_os = "windows") {
        // `start` eats the first quoted arg as the window title, so pass an
        // empty title first and then the URL. We still route through cmd
        // because Rust stdlib has no direct equivalent for `start`.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &safe_url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(&safe_url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    } else {
        std::process::Command::new("xdg-open")
            .arg(&safe_url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    Ok(())
}
