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
// DAP Types (Debug Adapter Protocol)
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DapLaunchConfig {
    pub language: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    pub stop_at_entry: bool,
    pub console: Option<String>, // "integrated", "external", "internalConsole"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DapAttachConfig {
    pub language: String,
    pub process_id: Option<u32>,
    pub host: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Breakpoint {
    pub id: u64,
    pub line: u32,
    pub column: Option<u32>,
    pub verified: bool,
    pub message: Option<String>,
    pub condition: Option<String>,
    pub hit_condition: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StackFrame {
    pub id: u64,
    pub name: String,
    pub line: u32,
    pub column: u32,
    pub source: Option<Source>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Source {
    pub name: String,
    pub path: String,
    pub source_reference: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Scope {
    pub name: String,
    pub variables_reference: u64,
    pub expensive: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Variable {
    pub name: String,
    pub value: String,
    pub type_name: Option<String>,
    pub variables_reference: u64,
    pub indexed_variables: Option<u64>,
    pub named_variables: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Thread {
    pub id: u64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DapRequest {
    pub seq: u64,
    pub command: String,
    pub arguments: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DapResponse {
    pub seq: u64,
    pub request_seq: u64,
    pub success: bool,
    pub command: String,
    pub message: Option<String>,
    pub body: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DapEvent {
    pub seq: u64,
    pub event: String,
    pub body: Option<Value>,
}

// ======================================================
// DAP Session
// ======================================================

pub struct DapSession {
    pub id: String,
    pub language: String,
    pub process: Option<AsyncChild>,
    pub stdin_tx: Option<Sender<String>>,
    pub stdout_rx: Option<Receiver<String>>,
    pub event_tx: Sender<DapEvent>,
    pub event_rx: Receiver<DapEvent>,
    pub breakpoints: HashMap<String, Vec<Breakpoint>>,
    pub threads: HashMap<u64, Thread>,
    pub stack_frames: HashMap<u64, Vec<StackFrame>>,
    pub variables: HashMap<u64, Vec<Variable>>,
    pub state: DapSessionState,
    pub seq_counter: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DapSessionState {
    Initializing,
    Running,
    Stopped,
    Terminated,
    Error(String),
}

impl DapSession {
    pub fn new(language: String) -> Self {
        let (event_tx, event_rx) = channel(100);
        Self {
            id: Uuid::new_v4().to_string(),
            language,
            process: None,
            stdin_tx: None,
            stdout_rx: None,
            event_tx,
            event_rx,
            breakpoints: HashMap::new(),
            threads: HashMap::new(),
            stack_frames: HashMap::new(),
            variables: HashMap::new(),
            state: DapSessionState::Initializing,
            seq_counter: 0,
        }
    }

    fn next_seq(&mut self) -> u64 {
        self.seq_counter += 1;
        self.seq_counter
    }
}

// ======================================================
// DAP Manager
// ======================================================

pub struct DapManager {
    sessions: Arc<TokioMutex<HashMap<String, DapSession>>>,
}

impl DapManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    /// Cross-platform `which`: looks for `bin` on PATH. Returns the absolute
    /// path if found. Uses `where` on Windows (it's the correct equivalent
    /// of `which`; the old code called `which` unconditionally, which
    /// silently failed on every Windows install).
    fn find_on_path(bin: &str) -> Option<String> {
        let finder = if cfg!(target_os = "windows") { "where" } else { "which" };
        let output = std::process::Command::new(finder).arg(bin).output().ok()?;
        if !output.status.success() { return None; }
        let first_line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()?
            .trim()
            .to_string();
        if first_line.is_empty() { None } else { Some(first_line) }
    }

    /// DAP adapter selection.
    ///
    /// Each arm returns `(binary, args, transport)` when a usable adapter
    /// is detected, or `None` when the user needs to install something.
    /// The frontend surfaces the `None` path as an actionable error; we
    /// never silently fall back to a non-DAP tool (the old code fell
    /// back to bare `lldb`, which is NOT a DAP server, so `cpp` sessions
    /// would spawn an interactive debugger the IDE couldn't talk to).
    pub fn get_dap_adapter(language: &str) -> Option<(String, Vec<String>, DapTransport)> {
        match language {
            "python" => {
                // debugpy is importable under whatever `python` is on PATH.
                // Port 0 ≠ valid — adapter needs a concrete port or
                // `--listen localhost:PORT`. We pick 0 here only to let
                // the OS allocate; the frontend should parse the banner
                // printed by debugpy to learn the actual port.
                let python = if cfg!(target_os = "windows") { "python" } else { "python3" };
                Some((
                    python.to_string(),
                    vec![
                        "-m".into(), "debugpy.adapter".into(),
                        "--host".into(), "127.0.0.1".into(),
                        "--port".into(), "0".into(),
                    ],
                    DapTransport::Tcp { port: None },
                ))
            }
            "javascript" | "typescript" => {
                // `js-debug` (the bundled VSCode Node debugger) IS a DAP
                // adapter; `node --inspect` is NOT. The old config was
                // wrong on both counts. We document the real requirement.
                if let Some(path) = Self::find_on_path("js-debug") {
                    Some((path, vec![], DapTransport::Stdio))
                } else {
                    log::warn!("DAP: install 'js-debug' for JS/TS debugging (npm i -g @vscode/js-debug or the bundled adapter).");
                    None
                }
            }
            "c" | "cpp" | "rust" => {
                // Preferred, in order:
                //   1. lldb-dap  — modern LLDB ships this as a DAP server
                //      (formerly named `lldb-vscode`). Stdio transport.
                //   2. codelldb  — VSCode's LLDB wrapper, also a DAP
                //      server; runs over TCP. Needs the caller to read
                //      stdout for the chosen port.
                //
                // Raw `lldb` is NOT a DAP server and was removed from
                // the fallback path.
                for candidate in &["lldb-dap", "lldb-vscode"] {
                    if let Some(path) = Self::find_on_path(candidate) {
                        return Some((path, vec![], DapTransport::Stdio));
                    }
                }
                if let Some(path) = Self::find_on_path("codelldb") {
                    return Some((
                        path,
                        vec!["--port".into(), "0".into()],
                        DapTransport::Tcp { port: None },
                    ));
                }
                log::warn!("DAP: install lldb-dap (ships with LLVM 18+) or codelldb for C/C++/Rust debugging.");
                None
            }
            "csharp" => {
                Self::find_on_path("netcoredbg").map(|path| (
                    path,
                    vec!["--interpreter=vscode".into()],
                    DapTransport::Stdio,
                ))
            }
            "java" => {
                // The previous config was fundamentally wrong: it used
                // JDWP (the Java Debug Wire Protocol), not DAP. DAP
                // support for Java requires the Eclipse `java-debug`
                // adapter invoked via jdtls. Until we embed that, Java
                // debugging goes through the Run tab only.
                log::warn!("DAP: Java debugging requires the Eclipse java-debug adapter — not yet bundled.");
                None
            }
            "php" => {
                // Same story — Xdebug is a protocol, not a DAP adapter.
                // Real PHP DAP needs `vscode-php-debug` which wraps
                // Xdebug. Not detected automatically here.
                log::warn!("DAP: PHP debugging requires the vscode-php-debug adapter.");
                None
            }
            "go" => {
                Self::find_on_path("dlv").map(|path| (
                    path,
                    vec!["dap".into(), "--listen=127.0.0.1:0".into()],
                    DapTransport::Tcp { port: None },
                ))
            }
            _ => None,
        }
    }

    // Launch a DAP session
    pub async fn launch_session(&self, config: DapLaunchConfig) -> CmdResult<String> {
        let adapter = match Self::get_dap_adapter(&config.language) {
            Some(adapter) => adapter,
            None => {
                // Hand the user an actionable install hint rather than a
                // generic "not found" — the old message told users
                // nothing about how to fix it.
                let hint = match config.language.as_str() {
                    "c" | "cpp" | "rust" =>
                        "Install lldb-dap (LLVM 18+ ships it) or codelldb, and ensure it's on PATH.",
                    "python" =>
                        "Install debugpy: `python -m pip install debugpy`.",
                    "javascript" | "typescript" =>
                        "Install the VSCode js-debug adapter (@vscode/js-debug) and expose `js-debug` on PATH.",
                    "csharp" =>
                        "Install netcoredbg (https://github.com/Samsung/netcoredbg/releases).",
                    "go" =>
                        "Install delve: `go install github.com/go-delve/delve/cmd/dlv@latest`.",
                    "java" =>
                        "Java debugging requires the Eclipse `java-debug` adapter — not yet bundled in Lorica.",
                    "php" =>
                        "PHP debugging requires the `vscode-php-debug` adapter — not yet bundled in Lorica.",
                    _ => "No DAP adapter is registered for this language.",
                };
                return CmdResult::err(format!(
                    "No debug adapter found for '{}'. {}",
                    config.language, hint
                ));
            }
        };

        let (command, args, transport) = adapter;
        let mut session = DapSession::new(config.language.clone());

        // Spawn the DAP adapter process
        let mut cmd = AsyncCommand::new(&command);
        cmd.args(&args);
        
        if let Some(cwd) = &config.cwd {
            cmd.current_dir(cwd);
        }
        
        for (key, value) in &config.env {
            cmd.env(key, value);
        }

        match transport {
            DapTransport::Stdio => {
                cmd.stdin(Stdio::piped())
                   .stdout(Stdio::piped())
                   .stderr(Stdio::piped());
            }
            DapTransport::Tcp { port: _ } => {
                // For TCP adapters, we just need to spawn the process
                // The frontend will connect to the TCP port
                cmd.stdout(Stdio::piped())
                   .stderr(Stdio::piped());
            }
        }

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => return CmdResult::err(format!("Failed to spawn DAP adapter: {}", e)),
        };

        // For stdio transport, set up communication channels
        if matches!(transport, DapTransport::Stdio) {
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

            // Writer task — wraps every JSON message in the DAP
            // envelope: `Content-Length: N\r\n\r\n<body>`. The old
            // version just appended `\n` which broke most adapters
            // (debugpy ignores unheadered messages silently).
            let mut stdin_writer = tokio::io::BufWriter::new(stdin);
            tokio::spawn(async move {
                while let Some(message) = stdin_rx.recv().await {
                    let envelope = format!(
                        "Content-Length: {}\r\n\r\n{}",
                        message.as_bytes().len(),
                        message,
                    );
                    if let Err(e) = stdin_writer.write_all(envelope.as_bytes()).await {
                        log::error!("Failed to write to DAP stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin_writer.flush().await {
                        log::error!("Failed to flush DAP stdin: {}", e);
                        break;
                    }
                }
            });

            // Reader task — DAP uses the same header-framed envelope as
            // LSP (Content-Length: N\r\n\r\n<N bytes>). Line-based reads
            // shred multi-line JSON responses; read exact byte counts.
            let mut stdout_reader = tokio::io::BufReader::new(stdout);
            tokio::spawn(async move {
                let mut header_buf = String::new();
                loop {
                    let mut content_length: usize = 0;
                    loop {
                        header_buf.clear();
                        match stdout_reader.read_line(&mut header_buf).await {
                            Ok(0) => return,
                            Ok(_) => {}
                            Err(e) => { log::error!("DAP header read: {}", e); return; }
                        }
                        let trimmed = header_buf.trim();
                        if trimmed.is_empty() { break; }
                        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
                            if let Ok(n) = rest.trim().parse::<usize>() { content_length = n; }
                        }
                    }
                    if content_length == 0 { continue; }
                    let mut body = vec![0u8; content_length];
                    if let Err(e) = stdout_reader.read_exact(&mut body).await {
                        log::error!("DAP body read: {}", e);
                        return;
                    }
                    let msg = match String::from_utf8(body) {
                        Ok(s) => s,
                        Err(e) => { log::warn!("DAP non-utf8: {}", e); continue; }
                    };
                    if stdout_tx.send(msg).await.is_err() { return; }
                }
            });

            session.stdin_tx = Some(stdin_tx);
            session.stdout_rx = Some(stdout_rx);
        }

        session.process = Some(child);
        session.state = DapSessionState::Running;

        let session_id = session.id.clone();
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session_id.clone(), session);

        CmdResult::ok(session_id)
    }

    // Send a DAP request
    pub async fn send_request(&self, session_id: &str, command: String, arguments: Option<Value>) -> CmdResult<DapResponse> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        if session.state != DapSessionState::Running {
            return CmdResult::err(format!("Session is not running: {:?}", session.state));
        }

        let seq = session.next_seq();
        let request = DapRequest {
            seq,
            command: command.clone(),
            arguments,
        };

        let request_json = match serde_json::to_string(&request) {
            Ok(json) => json,
            Err(e) => return CmdResult::err(format!("Failed to serialize request: {}", e)),
        };

        // Send the request
        if let Some(stdin_tx) = &session.stdin_tx {
            if let Err(e) = stdin_tx.send(request_json).await {
                return CmdResult::err(format!("Failed to send request: {}", e));
            }
        } else {
            // For TCP transport, the frontend handles communication
            return CmdResult::err("Direct DAP communication not supported for TCP transport".to_string());
        }

        // Wait for response (simplified - in real implementation would match request_seq)
        // For now, we'll just return a placeholder response
        CmdResult::ok(DapResponse {
            seq: 0,
            request_seq: seq,
            success: true,
            command,
            message: None,
            body: None,
        })
    }

    // Set breakpoints
    pub async fn set_breakpoints(&self, session_id: &str, file: String, lines: Vec<u32>) -> CmdResult<Vec<Breakpoint>> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        let breakpoints: Vec<Breakpoint> = lines.iter().enumerate().map(|(i, &line)| {
            Breakpoint {
                id: (i as u64) + 1,
                line,
                column: None,
                verified: true,
                message: None,
                condition: None,
                hit_condition: None,
            }
        }).collect();

        session.breakpoints.insert(file.clone(), breakpoints.clone());

        CmdResult::ok(breakpoints)
    }

    // Continue execution
    pub async fn continue_execution(&self, _session_id: &str) -> CmdResult<()> {
        let _sessions = self.sessions.lock().await;
        // In real implementation, send continue request
        CmdResult::ok(())
    }

    // Step over
    pub async fn step_over(&self, _session_id: &str, _thread_id: u64) -> CmdResult<()> {
        let _sessions = self.sessions.lock().await;
        // In real implementation, send stepOver request
        CmdResult::ok(())
    }

    // Step in
    pub async fn step_in(&self, _session_id: &str, _thread_id: u64) -> CmdResult<()> {
        let _sessions = self.sessions.lock().await;
        // In real implementation, send stepIn request
        CmdResult::ok(())
    }

    // Step out
    pub async fn step_out(&self, _session_id: &str, _thread_id: u64) -> CmdResult<()> {
        let _sessions = self.sessions.lock().await;
        // In real implementation, send stepOut request
        CmdResult::ok(())
    }

    // Pause execution
    pub async fn pause(&self, _session_id: &str) -> CmdResult<()> {
        let _sessions = self.sessions.lock().await;
        // In real implementation, send pause request
        CmdResult::ok(())
    }

    // Get stack trace
    pub async fn get_stack_trace(&self, session_id: &str, _thread_id: u64) -> CmdResult<Vec<StackFrame>> {
        let sessions = self.sessions.lock().await;
        let _session = match sessions.get(session_id) {
            Some(session) => session,
            None => return CmdResult::err(format!("Session not found: {}", session_id)),
        };

        // Return mock stack frames for now
        let frames = vec![
            StackFrame {
                id: 1,
                name: "main".to_string(),
                line: 10,
                column: 1,
                source: Some(Source {
                    name: "main.rs".to_string(),
                    path: "/path/to/main.rs".to_string(),
                    source_reference: None,
                }),
            }
        ];

        CmdResult::ok(frames)
    }

    // Get variables for a scope
    pub async fn get_variables(&self, _session_id: &str, _variables_reference: u64) -> CmdResult<Vec<Variable>> {
        // Return mock variables for now
        let variables = vec![
            Variable {
                name: "counter".to_string(),
                value: "42".to_string(),
                type_name: Some("i32".to_string()),
                variables_reference: 0,
                indexed_variables: None,
                named_variables: None,
            }
        ];

        CmdResult::ok(variables)
    }

    // Evaluate expression
    pub async fn evaluate(&self, _session_id: &str, expression: String, _frame_id: u64) -> CmdResult<String> {
        // Mock evaluation
        CmdResult::ok(format!("Evaluated: {}", expression))
    }

    // Terminate session
    pub async fn terminate(&self, session_id: &str) -> CmdResult<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            if let Some(mut process) = session.process.take() {
                let _ = process.kill().await;
            }
            session.state = DapSessionState::Terminated;
            sessions.remove(session_id);
        }
        CmdResult::ok(())
    }
}

// ======================================================
// DAP Transport
// ======================================================

#[derive(Debug, Clone)]
pub enum DapTransport {
    Stdio,
    Tcp { port: Option<u16> },
}

// ======================================================
// Tauri Commands
// ======================================================

// All DAP commands share the AppState-stored manager — same fix as LSP.
// `DapManager::new()` inside each command was dropping the child
// processes and sessions on every call, making breakpoints impossible
// to set after launch.

// Tauri requires async commands that borrow their inputs (via
// `tauri::State<'_, _>`) to return `Result<T, E>` directly, not a custom
// struct. The inner manager methods keep using `CmdResult<T>` for IPC
// consistency; we convert at the boundary with `.into_result()`.

#[tauri::command]
pub async fn cmd_dap_launch(
    state: tauri::State<'_, crate::state::AppState>,
    config: DapLaunchConfig,
) -> Result<String, String> {
    state.dap.launch_session(config).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_continue(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), String> {
    state.dap.continue_execution(&session_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_step_over(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    thread_id: u64,
) -> Result<(), String> {
    state.dap.step_over(&session_id, thread_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_step_in(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    thread_id: u64,
) -> Result<(), String> {
    state.dap.step_in(&session_id, thread_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_step_out(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    thread_id: u64,
) -> Result<(), String> {
    state.dap.step_out(&session_id, thread_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_pause(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), String> {
    state.dap.pause(&session_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_terminate(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), String> {
    state.dap.terminate(&session_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_set_breakpoints(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    file: String,
    lines: Vec<u32>,
) -> Result<Vec<Breakpoint>, String> {
    state.dap.set_breakpoints(&session_id, file, lines).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_get_variables(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    variables_reference: u64,
) -> Result<Vec<Variable>, String> {
    state.dap.get_variables(&session_id, variables_reference).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_evaluate(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    expression: String,
    frame_id: u64,
) -> Result<String, String> {
    state.dap.evaluate(&session_id, expression, frame_id).await.into_result()
}

#[tauri::command]
pub async fn cmd_dap_get_stack_trace(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    thread_id: u64,
) -> Result<Vec<StackFrame>, String> {
    state.dap.get_stack_trace(&session_id, thread_id).await.into_result()
}