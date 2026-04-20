use std::sync::Mutex;
use tauri::AppHandle;

use crate::security::VaultState;
use crate::terminal::TerminalManager;
use crate::buffer::BufferManager;
use crate::watcher::FileWatcherState;
use crate::lsp::LspManager;
use crate::dap::DapManager;

// Shared app-level state. Everything in here outlives individual Tauri
// command invocations, which is the whole point — LSP / DAP / terminal
// sessions would reset on every call otherwise.
pub struct AppState {
    pub vault: Mutex<VaultState>,
    pub terminals: Mutex<TerminalManager>,
    pub buffers: Mutex<BufferManager>,
    pub watcher: Mutex<FileWatcherState>,
    pub lsp: LspManager,
    pub dap: DapManager,
    pub app_handle: AppHandle,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            vault: Mutex::new(VaultState::new(&app_handle)),
            terminals: Mutex::new(TerminalManager::new()),
            buffers: Mutex::new(BufferManager::new()),
            watcher: Mutex::new(FileWatcherState::new()),
            lsp: LspManager::new(),
            dap: DapManager::new(),
            app_handle,
        }
    }
}

/// Take a std Mutex guard even when it's poisoned. Rust marks a Mutex
/// poisoned if a thread panics while holding it. The data inside is
/// almost always still usable (just half-written in the worst case);
/// panicking the command on top of that just compounds the failure.
///
/// We use this everywhere instead of `.lock().unwrap()` so one bad
/// background thread can't cascade into the entire IDE process dying.
pub fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            log::warn!("Mutex was poisoned — recovering inner data");
            poisoned.into_inner()
        }
    }
}
