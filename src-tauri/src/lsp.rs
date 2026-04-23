use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child as AsyncChild, Command as AsyncCommand};
use tokio::sync::mpsc::{channel, Sender};
use tokio::sync::{oneshot, Mutex as TokioMutex};
use uuid::Uuid;

use crate::filesystem::CmdResult;

// Maximum time we wait for an LSP response before giving up. Generous
// because cold language servers (rust-analyzer indexing for example)
// can take a while on the first request.
const LSP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

// ======================================================
// LSP Types (Language Server Protocol)
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LspInitOptions {
    pub language: String,
    pub root_uri: String,
    pub workspace_folders: Option<Vec<WorkspaceFolder>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFolder {
    pub uri: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Diagnostic {
    pub range: Range,
    pub severity: Option<u8>, // 1=Error, 2=Warning, 3=Info, 4=Hint
    pub code: Option<Value>, // number or string
    pub source: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompletionItem {
    pub label: String,
    pub kind: Option<u8>, // CompletionItemKind
    pub detail: Option<String>,
    pub documentation: Option<Value>, // string | MarkupContent
    pub insert_text: Option<String>,
    pub filter_text: Option<String>,
    pub sort_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Hover {
    pub contents: Value, // MarkupContent | MarkedString | array
    pub range: Option<Range>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SymbolInformation {
    pub name: String,
    pub kind: u8, // SymbolKind
    pub location: Location,
    pub container_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LspRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LspResponse {
    pub jsonrpc: String,
    pub id: u64,
    pub result: Option<Value>,
    pub error: Option<LspError>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LspError {
    pub code: i32,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LspNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<Value>,
}

// ======================================================
// LSP Server Mapping
// ======================================================

pub fn get_lsp_server(language: &str) -> Option<(String, Vec<String>)> {
    match language {
        "python" => Some((
            "pylsp".to_string(),
            vec!["--stdio".to_string()],
        )),
        "javascript" | "typescript" => Some((
            "typescript-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "rust" => Some((
            "rust-analyzer".to_string(),
            vec![],
        )),
        "go" => Some((
            "gopls".to_string(),
            vec!["-mode=stdio".to_string()],
        )),
        "c" | "cpp" => Some((
            "clangd".to_string(),
            vec!["--background-index".to_string()],
        )),
        "csharp" => Some((
            "csharp-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "java" => {
            // jdtls needs concrete (expanded) paths for `-configuration`
            // and `-data`. Rust's `Command` never expands `~`, so the
            // old code passed the literal `~` through and jdtls either
            // crashed or created weird `~` directories. We resolve
            // against the real config/cache dirs via the `dirs` crate.
            let config_dir = dirs::config_dir()
                .map(|p| p.join("jdtls").join("config"))
                .unwrap_or_else(|| std::path::PathBuf::from(".jdtls/config"));
            let cache_dir = dirs::cache_dir()
                .map(|p| p.join("jdtls").join("workspace"))
                .unwrap_or_else(|| std::path::PathBuf::from(".jdtls/workspace"));
            Some((
                "jdtls".to_string(),
                vec![
                    "-configuration".to_string(), config_dir.to_string_lossy().to_string(),
                    "-data".to_string(), cache_dir.to_string_lossy().to_string(),
                ],
            ))
        },
        "html" => Some((
            "vscode-html-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "css" => Some((
            "vscode-css-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "sql" => Some((
            "sql-language-server".to_string(),
            vec!["up".to_string(), "--method".to_string(), "stdio".to_string()],
        )),
        "php" => Some((
            "intelephense".to_string(),
            vec!["--stdio".to_string()],
        )),
        "json" => Some((
            "vscode-json-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        _ => None,
    }
}

/// Install hint per LSP server, shown when `start_server` can't spawn
/// the binary. The language keys match `get_lsp_server` arms.
pub fn lsp_install_hint(language: &str) -> String {
    match language {
        "python" =>
            "Install pylsp: `pipx install 'python-lsp-server[all]'`.".to_string(),
        "javascript" | "typescript" =>
            "Install typescript-language-server: `npm i -g typescript typescript-language-server`.".to_string(),
        "rust" =>
            "Install rust-analyzer: `rustup component add rust-analyzer`.".to_string(),
        "go" =>
            "Install gopls: `go install golang.org/x/tools/gopls@latest`.".to_string(),
        "c" | "cpp" =>
            "Install clangd (ships with LLVM): apt install clangd / brew install llvm.".to_string(),
        "csharp" =>
            "Install csharp-language-server: `dotnet tool install -g csharp-ls`.".to_string(),
        "java" =>
            "Install jdtls: https://github.com/eclipse-jdtls/eclipse.jdt.ls#installation".to_string(),
        "html" | "css" | "json" =>
            format!("Install vscode-langservers-extracted: `npm i -g vscode-langservers-extracted`."),
        "sql" =>
            "Install sql-language-server: `npm i -g sql-language-server`.".to_string(),
        "php" =>
            "Install intelephense: `npm i -g intelephense`.".to_string(),
        _ => "No LSP server is registered for this language.".to_string(),
    }
}

// ======================================================
// LSP Session
// ======================================================

/// One-shot senders indexed by JSON-RPC request id. When a request is
/// sent we register a oneshot::Sender here, and the dispatcher task
/// (spawned in `start_server`) removes and fulfils it when the matching
/// response comes back. The value is `Result<Value, String>` so errors
/// from the server surface cleanly instead of looking like "placeholder".
type PendingMap = Arc<TokioMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// Diagnostics by URI. Populated by the dispatcher task whenever the
/// server sends a `textDocument/publishDiagnostics` notification, read
/// by `get_diagnostics` for the frontend.
type DiagnosticsMap = Arc<TokioMutex<HashMap<String, Vec<Diagnostic>>>>;

pub struct LspSession {
    pub id: String,
    pub language: String,
    pub root_uri: String,
    pub process: Option<AsyncChild>,
    pub stdin_tx: Option<Sender<String>>,
    /// Diagnostics by file URI — populated from `publishDiagnostics`
    /// notifications by the dispatcher task.
    pub diagnostics: DiagnosticsMap,
    /// Pending request map — registered by `send_request`, drained by
    /// the dispatcher task.
    pub pending: PendingMap,
    pub state: LspSessionState,
    pub seq_counter: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LspSessionState {
    Initializing,
    Initialized,
    Running,
    Stopped,
    Error(String),
}

impl LspSession {
    pub fn new(language: String, root_uri: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            language,
            root_uri,
            process: None,
            stdin_tx: None,
            diagnostics: Arc::new(TokioMutex::new(HashMap::new())),
            pending: Arc::new(TokioMutex::new(HashMap::new())),
            state: LspSessionState::Initializing,
            seq_counter: 0,
        }
    }

    fn next_seq(&mut self) -> u64 {
        self.seq_counter += 1;
        self.seq_counter
    }
}

// ======================================================
// LSP Manager
// ======================================================

pub struct LspManager {
    sessions: Arc<TokioMutex<HashMap<String, LspSession>>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    // Start an LSP server for a language
    pub async fn start_server(&self, options: LspInitOptions) -> CmdResult<String> {
        let (command, args) = match get_lsp_server(&options.language) {
            Some((cmd, args)) => (cmd, args),
            None => return CmdResult::err(format!(
                "No LSP server registered for '{}'. {}",
                options.language,
                lsp_install_hint(&options.language),
            )),
        };

        let mut session = LspSession::new(options.language.clone(), options.root_uri.clone());

        // Spawn the LSP server process
        let mut cmd = AsyncCommand::new(&command);
        cmd.args(&args);

        cmd.stdin(Stdio::piped())
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => return CmdResult::err(format!(
                "Cannot launch LSP server '{}': {}. {}",
                command, e, lsp_install_hint(&options.language),
            )),
        };

        // Set up communication channels
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => return CmdResult::err("Failed to open stdin"),
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => return CmdResult::err("Failed to open stdout"),
        };

        let (stdin_tx, mut stdin_rx) = channel::<String>(100);
        let (stdout_tx, stdout_rx) = channel::<String>(100);

        // Spawn writer task
        let mut stdin_writer = tokio::io::BufWriter::new(stdin);
        tokio::spawn(async move {
            while let Some(message) = stdin_rx.recv().await {
                if let Err(e) = stdin_writer.write_all(message.as_bytes()).await {
                    log::error!("Failed to write to LSP stdin: {}", e);
                    break;
                }
                if let Err(e) = stdin_writer.write_all(b"\r\n").await {
                    log::error!("Failed to write newline to LSP stdin: {}", e);
                    break;
                }
                if let Err(e) = stdin_writer.flush().await {
                    log::error!("Failed to flush LSP stdin: {}", e);
                    break;
                }
            }
        });

        // Spawn reader task.
        //
        // CRITICAL: LSP uses header-framed messages. Each message is:
        //
        //   Content-Length: N\r\n
        //   \r\n
        //   <N bytes of JSON>
        //
        // The JSON body almost always contains `\n` characters (pretty-
        // printed responses, embedded strings, etc.), so a line-based
        // reader shreds messages. We read header lines until we see the
        // blank separator, parse Content-Length, then read exactly N
        // bytes and emit one complete message per payload.
        let mut stdout_reader = tokio::io::BufReader::new(stdout);
        tokio::spawn(async move {
            let mut header_buf = String::new();
            loop {
                let mut content_length: usize = 0;
                header_buf.clear();
                // Read headers until blank line.
                loop {
                    header_buf.clear();
                    match stdout_reader.read_line(&mut header_buf).await {
                        Ok(0) => return, // EOF
                        Ok(_) => {}
                        Err(e) => { log::error!("LSP header read: {}", e); return; }
                    }
                    let trimmed = header_buf.trim();
                    if trimmed.is_empty() { break; } // end of headers
                    if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
                        if let Ok(n) = rest.trim().parse::<usize>() { content_length = n; }
                    }
                    // Ignore other headers (Content-Type, etc.)
                }
                if content_length == 0 { continue; }
                let mut body = vec![0u8; content_length];
                if let Err(e) = stdout_reader.read_exact(&mut body).await {
                    log::error!("LSP body read: {}", e);
                    return;
                }
                let msg = match String::from_utf8(body) {
                    Ok(s) => s,
                    Err(e) => { log::warn!("LSP non-utf8: {}", e); continue; }
                };
                if stdout_tx.send(msg).await.is_err() { return; }
            }
        });

        session.stdin_tx = Some(stdin_tx);
        session.process = Some(child);
        session.state = LspSessionState::Running;

        // Dispatcher task: reads incoming JSON-RPC messages, routes
        // responses back to their pending requests via the oneshot
        // channel, and buckets `publishDiagnostics` notifications into
        // the session's diagnostics map so the frontend can fetch them.
        //
        // Without this, the stdout channel would fill up and the LSP
        // server would block, and every `send_request` would return a
        // placeholder (which was the pre-v2.2 bug).
        let pending_for_dispatcher = session.pending.clone();
        let diagnostics_for_dispatcher = session.diagnostics.clone();
        let mut rx = stdout_rx;
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let v: Value = match serde_json::from_str(&msg) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("LSP: could not parse message as JSON: {}", e);
                        continue;
                    }
                };

                // Responses carry a numeric `id` and either a `result`
                // or an `error` field. Notifications carry a `method`
                // and no `id`.
                if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
                    let outcome = if let Some(err) = v.get("error") {
                        let msg = err.get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("LSP error");
                        Err(msg.to_string())
                    } else {
                        Ok(v.get("result").cloned().unwrap_or(Value::Null))
                    };
                    let mut map = pending_for_dispatcher.lock().await;
                    if let Some(sender) = map.remove(&id) {
                        let _ = sender.send(outcome);
                    }
                } else if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
                    match method {
                        "textDocument/publishDiagnostics" => {
                            if let Some(params) = v.get("params") {
                                let uri = params.get("uri")
                                    .and_then(|u| u.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let diags: Vec<Diagnostic> = params.get("diagnostics")
                                    .and_then(|d| serde_json::from_value(d.clone()).ok())
                                    .unwrap_or_default();
                                diagnostics_for_dispatcher.lock().await.insert(uri, diags);
                            }
                        }
                        // Server-initiated requests like `window/workDoneProgress/create`
                        // or `client/registerCapability` would require us to send a
                        // reply. For v2.2 we ignore them — all mainstream servers
                        // tolerate missing responses for these, the work just doesn't
                        // report progress.
                        _ => {
                            log::debug!("LSP notification '{}' ignored", method);
                        }
                    }
                }
            }
        });

        // Send initialize request
        let initialize_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": options.root_uri,
            "workspaceFolders": options.workspace_folders,
            "capabilities": {
                "textDocument": {
                    "completion": {
                        "completionItem": {
                            "snippetSupport": true,
                            "documentationFormat": ["plaintext", "markdown"]
                        }
                    },
                    "hover": {
                        "contentFormat": ["plaintext", "markdown"]
                    },
                    "signatureHelp": {
                        "signatureInformation": {
                            "parameterInformation": {
                                "labelOffsetSupport": true
                            }
                        }
                    }
                }
            },
            "trace": "off"
        });

        let session_id = session.id.clone();
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session_id.clone(), session);

        // Send initialize request
        if let Some(session) = sessions.get_mut(&session_id) {
            let id = session.next_seq();
            let request = LspRequest {
                jsonrpc: "2.0".to_string(),
                id,
                method: "initialize".to_string(),
                params: Some(initialize_params),
            };

            let request_json = match serde_json::to_string(&request) {
                Ok(json) => json,
                Err(e) => {
                    sessions.remove(&session_id);
                    return CmdResult::err(format!("Failed to serialize initialize request: {}", e));
                }
            };

            let content_length = request_json.len();
            let full_message = format!("Content-Length: {}\r\n\r\n{}", content_length, request_json);

            if let Some(stdin_tx) = &session.stdin_tx {
                if let Err(e) = stdin_tx.send(full_message).await {
                    sessions.remove(&session_id);
                    return CmdResult::err(format!("Failed to send initialize request: {}", e));
                }
            }

            // Send initialized notification
            let notification = LspNotification {
                jsonrpc: "2.0".to_string(),
                method: "initialized".to_string(),
                params: None,
            };

            let notification_json = match serde_json::to_string(&notification) {
                Ok(json) => json,
                Err(e) => {
                    sessions.remove(&session_id);
                    return CmdResult::err(format!("Failed to serialize initialized notification: {}", e));
                }
            };

            let notification_length = notification_json.len();
            let notification_message = format!("Content-Length: {}\r\n\r\n{}", notification_length, notification_json);

            if let Some(stdin_tx) = &session.stdin_tx {
                if let Err(e) = stdin_tx.send(notification_message).await {
                    sessions.remove(&session_id);
                    return CmdResult::err(format!("Failed to send initialized notification: {}", e));
                }
            }

            session.state = LspSessionState::Initialized;
        }

        CmdResult::ok(session_id)
    }

    // Send an LSP request and wait for the matching response.
    //
    // The flow:
    //   1. Assign a unique numeric id (session.seq_counter).
    //   2. Register a oneshot::Sender in session.pending keyed by id.
    //   3. Write the Content-Length-framed JSON to stdin.
    //   4. Await the oneshot receiver with a timeout. The dispatcher
    //      task set up in `start_server` parses incoming messages and
    //      fulfils the matching sender.
    //
    // Pre-v2.2 this returned a hard-coded placeholder — the frontend
    // could never actually receive completion / hover / definition
    // responses. Every LSP feature is blocked behind this fix.
    pub async fn send_request(&self, session_id: &str, method: String, params: Option<Value>) -> CmdResult<Value> {
        // Step 1: collect everything we need from the session under the
        // sessions lock, then drop it so we don't hold it across the
        // network wait.
        let (id, stdin_tx, pending, method_for_log) = {
            let mut sessions = self.sessions.lock().await;
            let session = match sessions.get_mut(session_id) {
                Some(session) => session,
                None => return CmdResult::err(format!("Session not found: {}", session_id)),
            };
            if session.state != LspSessionState::Initialized && session.state != LspSessionState::Running {
                return CmdResult::err(format!("Session is not ready: {:?}", session.state));
            }
            let id = session.next_seq();
            let stdin_tx = match session.stdin_tx.clone() {
                Some(tx) => tx,
                None => return CmdResult::err("LSP stdin not available".to_string()),
            };
            (id, stdin_tx, session.pending.clone(), method.clone())
        };

        // Step 2: register the pending oneshot BEFORE sending, so a
        // super-fast server can't reply before we're listening.
        let (tx, rx) = oneshot::channel::<Result<Value, String>>();
        pending.lock().await.insert(id, tx);

        // Step 3: serialize and send.
        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method,
            params,
        };
        let request_json = match serde_json::to_string(&request) {
            Ok(json) => json,
            Err(e) => {
                pending.lock().await.remove(&id);
                return CmdResult::err(format!("Failed to serialize request: {}", e));
            }
        };
        let framed = format!("Content-Length: {}\r\n\r\n{}", request_json.len(), request_json);
        if let Err(e) = stdin_tx.send(framed).await {
            pending.lock().await.remove(&id);
            return CmdResult::err(format!("Failed to send request: {}", e));
        }

        // Step 4: await the response. Timeout caps how long a broken
        // or overwhelmed server can stall the UI.
        match tokio::time::timeout(LSP_REQUEST_TIMEOUT, rx).await {
            Ok(Ok(Ok(value))) => CmdResult::ok(value),
            Ok(Ok(Err(err_msg))) => CmdResult::err(format!("LSP '{}': {}", method_for_log, err_msg)),
            Ok(Err(_canceled)) => CmdResult::err(format!("LSP '{}' pipe closed", method_for_log)),
            Err(_timeout) => {
                // Drop the pending entry so a late response doesn't
                // accumulate. The dispatcher's removal would also
                // handle this, but being explicit is cheaper than
                // leaking memory if the server never replies.
                pending.lock().await.remove(&id);
                CmdResult::err(format!("LSP '{}' timed out", method_for_log))
            }
        }
    }

    // Send LSP notification
    pub async fn send_notification(&self, session_id: &str, method: String, params: Option<Value>) -> CmdResult<()> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        if session.state != LspSessionState::Initialized && session.state != LspSessionState::Running {
            return CmdResult::err(format!("Session is not ready: {:?}", session.state));
        }

        let notification = LspNotification {
            jsonrpc: "2.0".to_string(),
            method: method.clone(),
            params,
        };

        let notification_json = match serde_json::to_string(&notification) {
            Ok(json) => json,
            Err(e) => return CmdResult::err(format!("Failed to serialize notification: {}", e)),
        };

        let content_length = notification_json.len();
        let full_message = format!("Content-Length: {}\r\n\r\n{}", content_length, notification_json);

        // Send the notification
        if let Some(stdin_tx) = &session.stdin_tx {
            if let Err(e) = stdin_tx.send(full_message).await {
                return CmdResult::err(format!("Failed to send notification: {}", e));
            }
        } else {
            return CmdResult::err("LSP stdin not available".to_string());
        }

        CmdResult::ok(())
    }

    // Return all diagnostics the dispatcher has received for this
    // session, across every file URI the server has reported on.
    // The frontend typically filters by the active file's URI.
    pub async fn get_diagnostics(&self, session_id: &str) -> CmdResult<Vec<Diagnostic>> {
        let diagnostics_arc = {
            let sessions = self.sessions.lock().await;
            match sessions.get(session_id) {
                Some(session) => session.diagnostics.clone(),
                None => return CmdResult::err(format!("Session not found: {}", session_id)),
            }
        };
        let diagnostics = diagnostics_arc.lock().await;
        let all: Vec<Diagnostic> = diagnostics.values().flat_map(|v| v.iter().cloned()).collect();
        CmdResult::ok(all)
    }

    // Stop LSP server
    pub async fn stop_server(&self, session_id: &str) -> CmdResult<()> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        // Send shutdown request
        let id = session.next_seq();
        let shutdown_request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: "shutdown".to_string(),
            params: None,
        };

        let shutdown_json = match serde_json::to_string(&shutdown_request) {
            Ok(json) => json,
            Err(e) => return CmdResult::err(format!("Failed to serialize shutdown request: {}", e)),
        };

        let content_length = shutdown_json.len();
        let shutdown_message = format!("Content-Length: {}\r\n\r\n{}", content_length, shutdown_json);

        if let Some(stdin_tx) = &session.stdin_tx {
            if let Err(e) = stdin_tx.send(shutdown_message).await {
                log::error!("Failed to send shutdown request: {}", e);
            }
        }

        // Send exit notification
        let exit_notification = LspNotification {
            jsonrpc: "2.0".to_string(),
            method: "exit".to_string(),
            params: None,
        };

        let exit_json = match serde_json::to_string(&exit_notification) {
            Ok(json) => json,
            Err(e) => return CmdResult::err(format!("Failed to serialize exit notification: {}", e)),
        };

        let exit_length = exit_json.len();
        let exit_message = format!("Content-Length: {}\r\n\r\n{}", exit_length, exit_json);

        if let Some(stdin_tx) = &session.stdin_tx {
            if let Err(e) = stdin_tx.send(exit_message).await {
                log::error!("Failed to send exit notification: {}", e);
            }
        }

        // Kill the process
        if let Some(mut process) = session.process.take() {
            let _ = process.kill().await;
        }

        session.state = LspSessionState::Stopped;
        sessions.remove(session_id);

        CmdResult::ok(())
    }
}

// ======================================================
// Tauri Commands
// ======================================================

// All LSP commands share a single manager stored in AppState. Earlier
// versions created `LspManager::new()` inside each command, which meant
// the sessions HashMap was fresh on every call — start_server succeeded
// but every follow-up request received "no such session" because the
// manager holding the spawned process had already dropped.

// Tauri async commands that borrow their inputs must return
// `Result<T, E>`. `.into_result()` does the CmdResult → Result hop.

#[tauri::command]
pub async fn cmd_lsp_start(
    state: tauri::State<'_, crate::state::AppState>,
    options: LspInitOptions,
) -> Result<String, String> {
    state.lsp.start_server(options).await.into_result()
}

#[tauri::command]
pub async fn cmd_lsp_stop(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), String> {
    state.lsp.stop_server(&session_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_lsp_request(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    state.lsp.send_request(&session_id, method, params).await.into_result()
}

#[tauri::command]
pub async fn cmd_lsp_notify(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    method: String,
    params: Option<Value>,
) -> Result<(), String> {
    state.lsp.send_notification(&session_id, method, params).await.into_result()
}

#[tauri::command]
pub async fn cmd_lsp_diagnostics(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<Vec<Diagnostic>, String> {
    state.lsp.get_diagnostics(&session_id).await.into_result()
}