use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child as AsyncChild, Command as AsyncCommand};
use tokio::sync::mpsc::{channel, Receiver, Sender};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::filesystem::CmdResult;

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
        "java" => Some((
            "jdtls".to_string(),
            vec!["-configuration".to_string(), "~/.config/jdtls/config".to_string(), "-data".to_string(), "~/.cache/jdtls/workspace".to_string()],
        )),
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

// ======================================================
// LSP Session
// ======================================================

pub struct LspSession {
    pub id: String,
    pub language: String,
    pub root_uri: String,
    pub process: Option<AsyncChild>,
    pub stdin_tx: Option<Sender<String>>,
    pub stdout_rx: Option<Receiver<String>>,
    pub diagnostics: HashMap<String, Vec<Diagnostic>>,
    pub completions: HashMap<String, Vec<CompletionItem>>,
    pub symbols: HashMap<String, Vec<SymbolInformation>>,
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
            stdout_rx: None,
            diagnostics: HashMap::new(),
            completions: HashMap::new(),
            symbols: HashMap::new(),
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
            None => return CmdResult::err(format!("No LSP server found for language: {}", options.language)),
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
            Err(e) => return CmdResult::err(format!("Failed to spawn LSP server: {}", e)),
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
        session.stdout_rx = Some(stdout_rx);
        session.process = Some(child);
        session.state = LspSessionState::Running;

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

    // Send LSP request
    pub async fn send_request(&self, session_id: &str, method: String, params: Option<Value>) -> CmdResult<Value> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        if session.state != LspSessionState::Initialized && session.state != LspSessionState::Running {
            return CmdResult::err(format!("Session is not ready: {:?}", session.state));
        }

        let id = session.next_seq();
        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.clone(),
            params,
        };

        let request_json = match serde_json::to_string(&request) {
            Ok(json) => json,
            Err(e) => return CmdResult::err(format!("Failed to serialize request: {}", e)),
        };

        let content_length = request_json.len();
        let full_message = format!("Content-Length: {}\r\n\r\n{}", content_length, request_json);

        // Send the request
        if let Some(stdin_tx) = &session.stdin_tx {
            if let Err(e) = stdin_tx.send(full_message).await {
                return CmdResult::err(format!("Failed to send request: {}", e));
            }
        } else {
            return CmdResult::err("LSP stdin not available".to_string());
        }

        // In a real implementation, we would wait for the response and match by id
        // For now, return a placeholder result
        CmdResult::ok(serde_json::json!({ "result": "placeholder" }))
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

    // Get diagnostics for a language
    pub async fn get_diagnostics(&self, session_id: &str) -> CmdResult<Vec<Diagnostic>> {
        let sessions = self.sessions.lock().await;
        let session = match sessions.get(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        let mut all_diagnostics = Vec::new();
        for diagnostics in session.diagnostics.values() {
            all_diagnostics.extend(diagnostics.clone());
        }

        CmdResult::ok(all_diagnostics)
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

#[tauri::command]
pub async fn cmd_lsp_start(
    state: tauri::State<'_, crate::state::AppState>,
    options: LspInitOptions,
) -> CmdResult<String> {
    state.lsp.start_server(options).await
}

#[tauri::command]
pub async fn cmd_lsp_stop(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> CmdResult<()> {
    state.lsp.stop_server(&session_id).await
}

#[tauri::command]
pub async fn cmd_lsp_request(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    method: String,
    params: Option<Value>,
) -> CmdResult<Value> {
    state.lsp.send_request(&session_id, method, params).await
}

#[tauri::command]
pub async fn cmd_lsp_notify(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    method: String,
    params: Option<Value>,
) -> CmdResult<()> {
    state.lsp.send_notification(&session_id, method, params).await
}

#[tauri::command]
pub async fn cmd_lsp_diagnostics(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> CmdResult<Vec<Diagnostic>> {
    state.lsp.get_diagnostics(&session_id).await
}