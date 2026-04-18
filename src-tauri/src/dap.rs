use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
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

    // Get DAP adapter command for a language
    pub fn get_dap_adapter(language: &str) -> Option<(String, Vec<String>, DapTransport)> {
        match language {
            "python" => Some((
                "python".to_string(),
                vec!["-m".to_string(), "debugpy".to_string(), "--listen".to_string(), "0".to_string()],
                DapTransport::Tcp { port: None },
            )),
            "javascript" | "typescript" => Some((
                "node".to_string(),
                vec!["--inspect".to_string(), "--inspect-brk=0".to_string()],
                DapTransport::Tcp { port: None },
            )),
            "c" | "cpp" | "rust" => {
                // Use codelldb if available
                if let Ok(output) = std::process::Command::new("which")
                    .arg("codelldb")
                    .output()
                {
                    if output.status.success() {
                        return Some((
                            "codelldb".to_string(),
                            vec!["--port".to_string(), "0".to_string()],
                            DapTransport::Tcp { port: None },
                        ));
                    }
                }
                // Fallback to lldb
                Some((
                    "lldb".to_string(),
                    vec!["--batch".to_string(), "-o".to_string(), "run".to_string()],
                    DapTransport::Stdio,
                ))
            }
            "csharp" => {
                if let Ok(output) = std::process::Command::new("which")
                    .arg("netcoredbg")
                    .output()
                {
                    if output.status.success() {
                        return Some((
                            "netcoredbg".to_string(),
                            vec!["--interpreter=vscode".to_string()],
                            DapTransport::Stdio,
                        ));
                    }
                }
                None
            }
            "java" => {
                // jdtls with DAP
                if let Ok(output) = std::process::Command::new("which")
                    .arg("java")
                    .output()
                {
                    if output.status.success() {
                        return Some((
                            "java".to_string(),
                            vec![
                                "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005".to_string(),
                            ],
                            DapTransport::Tcp { port: Some(5005) },
                        ));
                    }
                }
                None
            }
            "php" => {
                // Xdebug
                Some((
                    "php".to_string(),
                    vec!["-dxdebug.mode=debug".to_string(), "-dxdebug.start_with_request=yes".to_string()],
                    DapTransport::Tcp { port: Some(9003) },
                ))
            }
            "go" => {
                if let Ok(output) = std::process::Command::new("which")
                    .arg("dlv")
                    .output()
                {
                    if output.status.success() {
                        return Some((
                            "dlv".to_string(),
                            vec!["dap".to_string(), "--listen=:38697".to_string()],
                            DapTransport::Tcp { port: Some(38697) },
                        ));
                    }
                }
                None
            }
            _ => None,
        }
    }

    // Launch a DAP session
    pub async fn launch_session(&self, config: DapLaunchConfig) -> CmdResult<String> {
        let adapter = match Self::get_dap_adapter(&config.language) {
            Some(adapter) => adapter,
            None => return CmdResult::err(format!("No DAP adapter found for language: {}", config.language)),
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

            // Spawn writer task
            let mut stdin_writer = tokio::io::BufWriter::new(stdin);
            tokio::spawn(async move {
                while let Some(message) = stdin_rx.recv().await {
                    if let Err(e) = stdin_writer.write_all(message.as_bytes()).await {
                        log::error!("Failed to write to DAP stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin_writer.write_all(b"\n").await {
                        log::error!("Failed to write newline to DAP stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin_writer.flush().await {
                        log::error!("Failed to flush DAP stdin: {}", e);
                        break;
                    }
                }
            });

            // Spawn reader task
            let stdout_reader = tokio::io::BufReader::new(stdout);
            tokio::spawn(async move {
                let mut lines = stdout_reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Err(e) = stdout_tx.send(line).await {
                        log::error!("Failed to send DAP stdout line: {}", e);
                        break;
                    }
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

#[tauri::command]
pub async fn cmd_dap_launch(config: DapLaunchConfig) -> CmdResult<String> {
    let manager = DapManager::new();
    manager.launch_session(config).await
}

#[tauri::command]
pub async fn cmd_dap_continue(session_id: String) -> CmdResult<()> {
    let manager = DapManager::new();
    manager.continue_execution(&session_id).await
}

#[tauri::command]
pub async fn cmd_dap_step_over(session_id: String, thread_id: u64) -> CmdResult<()> {
    let manager = DapManager::new();
    manager.step_over(&session_id, thread_id).await
}

#[tauri::command]
pub async fn cmd_dap_step_in(session_id: String, thread_id: u64) -> CmdResult<()> {
    let manager = DapManager::new();
    manager.step_in(&session_id, thread_id).await
}

#[tauri::command]
pub async fn cmd_dap_step_out(session_id: String, thread_id: u64) -> CmdResult<()> {
    let manager = DapManager::new();
    manager.step_out(&session_id, thread_id).await
}

#[tauri::command]
pub async fn cmd_dap_pause(session_id: String) -> CmdResult<()> {
    let manager = DapManager::new();
    manager.pause(&session_id).await
}

#[tauri::command]
pub async fn cmd_dap_terminate(session_id: String) -> CmdResult<()> {
    let manager = DapManager::new();
    manager.terminate(&session_id).await
}

#[tauri::command]
pub async fn cmd_dap_set_breakpoints(session_id: String, file: String, lines: Vec<u32>) -> CmdResult<Vec<Breakpoint>> {
    let manager = DapManager::new();
    manager.set_breakpoints(&session_id, file, lines).await
}

#[tauri::command]
pub async fn cmd_dap_get_variables(session_id: String, variables_reference: u64) -> CmdResult<Vec<Variable>> {
    let manager = DapManager::new();
    manager.get_variables(&session_id, variables_reference).await
}

#[tauri::command]
pub async fn cmd_dap_evaluate(session_id: String, expression: String, frame_id: u64) -> CmdResult<String> {
    let manager = DapManager::new();
    manager.evaluate(&session_id, expression, frame_id).await
}

#[tauri::command]
pub async fn cmd_dap_get_stack_trace(session_id: String, thread_id: u64) -> CmdResult<Vec<StackFrame>> {
    let manager = DapManager::new();
    manager.get_stack_trace(&session_id, thread_id).await
}