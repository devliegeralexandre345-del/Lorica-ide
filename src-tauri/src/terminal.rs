use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use std::collections::HashMap;
use std::io::{Read, Write};

use std::thread;
use tauri::Emitter;

use crate::filesystem::CmdResult;
use crate::state::AppState;

// ======================================================
// Terminal Manager
// ======================================================

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
}

pub struct TerminalManager {
    instances: HashMap<u32, PtyInstance>,
    next_id: u32,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            instances: HashMap::new(),
            next_id: 1,
        }
    }
}

// ======================================================
// Commands
// ======================================================

// Serializable payload for the terminal:data event. Frontend reads
// `session_id` to route to the correct xterm instance when multiple
// tabs are open. Older callers that listen for the flat string still
// work because they just ignore structured payloads.
#[derive(serde::Serialize, Clone)]
pub struct TerminalDataEvent {
    pub session_id: u32,
    pub data: String,
}

#[tauri::command]
pub fn cmd_terminal_create(
    window: tauri::Window,
    state: tauri::State<AppState>,
) -> CmdResult<u32> {
    let pty_system = native_pty_system();

    let pair = match pty_system.openpty(PtySize {
        rows: 30,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => return CmdResult::err(format!("PTY open failed: {}", e)),
    };

    let shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => return CmdResult::err(format!("Shell spawn failed: {}", e)),
    };

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => return CmdResult::err(format!("Cannot clone reader: {}", e)),
    };

    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => return CmdResult::err(format!("Cannot take writer: {}", e)),
    };

    let mut manager = crate::state::lock_or_recover(&state.terminals);
    let id = manager.next_id;
    manager.next_id += 1;
    manager.instances.insert(id, PtyInstance { writer, master: pair.master });
    drop(manager);

    // Reader thread — emits data tagged with this session's id so the
    // frontend can dispatch it to the correct tab. Legacy consumers that
    // listen for the flat "terminal:data" payload still get a copy so
    // old bridges don't need to change synchronously.
    let win = window.clone();
    let term_id = id;
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    log::info!("Terminal {} EOF", term_id);
                    // Emit a final close event so the frontend can drop the tab.
                    let _ = win.emit("terminal:close", term_id);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let event = TerminalDataEvent { session_id: term_id, data: data.clone() };
                    // Session-scoped event — new listeners use this.
                    if win.emit(&format!("terminal:data:{}", term_id), &event).is_err() {
                        log::warn!("Terminal {} emit failed", term_id);
                        break;
                    }
                    // Broadcast event — legacy listeners still work.
                    let _ = win.emit("terminal:data", &event);
                }
                Err(e) => {
                    log::warn!("Terminal {} read error: {}", term_id, e);
                    break;
                }
            }
        }
    });

    thread::spawn(move || {
        match child.wait() {
            Ok(status) => log::info!("Terminal shell exited: {:?}", status),
            Err(e) => log::warn!("Terminal wait error: {}", e),
        }
    });

    log::info!("Terminal {} created with shell: {}", id, shell);
    CmdResult::ok(id)
}

// Session-aware write. If `session_id` is None we fall back to the first
// instance for backward compatibility — the old single-terminal behavior.
#[tauri::command]
pub fn cmd_terminal_write(
    data: String,
    session_id: Option<u32>,
    state: tauri::State<AppState>,
) -> CmdResult<bool> {
    let mut manager = crate::state::lock_or_recover(&state.terminals);
    let target = match session_id {
        Some(id) => manager.instances.get_mut(&id),
        None => manager.instances.values_mut().next(),
    };
    match target {
        Some(instance) => match instance.writer.write_all(data.as_bytes()) {
            Ok(_) => { let _ = instance.writer.flush(); CmdResult::ok(true) }
            Err(e) => CmdResult::err(format!("Write failed: {}", e)),
        },
        None => CmdResult::err("No terminal instance for that session id"),
    }
}

// Session-aware resize. We now actually call master.resize(); earlier
// versions left this as a TODO which meant xterm's reported size never
// matched the PTY's idea of columns/rows — responsible for weird line-
// wrap issues when the panel got resized.
#[tauri::command]
pub fn cmd_terminal_resize(
    cols: u16,
    rows: u16,
    session_id: Option<u32>,
    state: tauri::State<AppState>,
) -> CmdResult<bool> {
    let mut manager = crate::state::lock_or_recover(&state.terminals);
    let target = match session_id {
        Some(id) => manager.instances.get_mut(&id),
        None => manager.instances.values_mut().next(),
    };
    match target {
        Some(instance) => {
            if let Err(e) = instance.master.resize(PtySize {
                rows, cols, pixel_width: 0, pixel_height: 0,
            }) {
                return CmdResult::err(format!("Resize failed: {}", e));
            }
            CmdResult::ok(true)
        }
        None => CmdResult::err("No terminal instance for that session id"),
    }
}

// Kill a specific session (or everything if `session_id` is None).
#[tauri::command]
pub fn cmd_terminal_kill(
    session_id: Option<u32>,
    state: tauri::State<AppState>,
) -> CmdResult<bool> {
    let mut manager = crate::state::lock_or_recover(&state.terminals);
    match session_id {
        Some(id) => { manager.instances.remove(&id); }
        None     => { manager.instances.clear(); }
    }
    CmdResult::ok(true)
}

// Enumerate live session ids so the frontend can reconcile after a
// hot reload / agent-triggered terminal creation.
#[tauri::command]
pub fn cmd_terminal_list(state: tauri::State<AppState>) -> CmdResult<Vec<u32>> {
    let manager = crate::state::lock_or_recover(&state.terminals);
    let mut ids: Vec<u32> = manager.instances.keys().copied().collect();
    ids.sort();
    CmdResult::ok(ids)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

#[tauri::command]
pub fn cmd_run_command(command: String, cwd: Option<String>) -> CmdResult<CommandOutput> {
    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };
    let shell_flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let mut cmd = std::process::Command::new(shell);
    cmd.arg(shell_flag).arg(&command);

    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            CmdResult::ok(CommandOutput {
                stdout,
                stderr,
                exit_code,
                success: output.status.success(),
            })
        }
        Err(e) => CmdResult::err(format!("Failed to run command: {}", e)),
    }
}
