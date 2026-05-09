pub mod filesystem;
pub mod security;
pub mod terminal;
pub mod buffer;
pub mod watcher;
pub mod search;
pub mod git;
pub mod extensions;
pub mod state;
pub mod updater;
pub mod spotify_auth;
pub mod dap;
pub mod lsp;
pub mod semantic;
pub mod devcontainer;
pub mod extension_loader;

use state::AppState;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let app_state = AppState::new(app.handle().clone());
            app.manage(app_state);
            log::info!("Lorica started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Window
            cmd_window_minimize,
            cmd_window_maximize,
            cmd_window_close,
            cmd_window_open_floating,
            // File system
            filesystem::cmd_read_dir,
            filesystem::cmd_read_file,
            filesystem::cmd_read_file_bytes,
            filesystem::cmd_write_file,
            filesystem::cmd_create_file,
            filesystem::cmd_create_dir,
            filesystem::cmd_delete_path,
            filesystem::cmd_rename,
            filesystem::cmd_stat,
            filesystem::cmd_exists,
            // Security
            security::cmd_init_vault,
            security::cmd_unlock_vault,
            security::cmd_lock_vault,
            security::cmd_add_secret,
            security::cmd_get_secret,
            security::cmd_delete_secret,
            security::cmd_list_secrets,
            security::cmd_is_vault_initialized,
            security::cmd_is_vault_unlocked,
            security::cmd_get_audit_log,
            security::cmd_add_audit_entry,
            security::cmd_scan_for_secrets,
            // Terminal
            terminal::cmd_terminal_create,
            terminal::cmd_terminal_write,
            terminal::cmd_terminal_resize,
            terminal::cmd_terminal_kill,
            terminal::cmd_terminal_list,
            terminal::cmd_run_command,
            // Buffer
            buffer::cmd_open_large_file,
            buffer::cmd_get_lines,
            buffer::cmd_insert_text,
            buffer::cmd_delete_range,
            buffer::cmd_get_line_count,
            buffer::cmd_close_buffer,
            // Search
            search::cmd_search_in_files,
            search::cmd_search_replace_in_files,
            search::cmd_list_project_files,
            // Git
            git::cmd_git_status,
            git::cmd_git_stage,
            git::cmd_git_unstage,
            git::cmd_git_stage_all,
            git::cmd_git_commit,
            git::cmd_git_get_author,
            git::cmd_git_set_author,
            git::cmd_git_push,
            git::cmd_git_pull,
            git::cmd_git_log,
            git::cmd_git_graph,
            git::cmd_git_diff,
            git::cmd_git_branches,
            git::cmd_git_checkout,
            git::cmd_git_discard,
            git::cmd_git_diff_staged,
            git::cmd_git_branch_diff,
            git::cmd_git_summary,
            git::cmd_git_pr_context,
            git::cmd_git_blame,
            git::cmd_git_churn,
            git::cmd_git_worktree_add,
            git::cmd_git_worktree_remove,
            git::cmd_git_worktree_list,
            git::cmd_git_worktree_merge,
            git::cmd_git_worktree_status,
            // Extensions & Debug
            extensions::cmd_list_extensions,
            extensions::cmd_install_extension,
            extensions::cmd_uninstall_extension,
            extensions::cmd_debug_run,
            // DAP (Debug Adapter Protocol)
            dap::cmd_dap_launch,
            dap::cmd_dap_continue,
            dap::cmd_dap_step_over,
            dap::cmd_dap_step_in,
            dap::cmd_dap_step_out,
            dap::cmd_dap_pause,
            dap::cmd_dap_terminate,
            dap::cmd_dap_set_breakpoints,
            dap::cmd_dap_get_variables,
            dap::cmd_dap_evaluate,
            dap::cmd_dap_get_stack_trace,
            // LSP (Language Server Protocol)
            lsp::cmd_lsp_start,
            lsp::cmd_lsp_stop,
            lsp::cmd_lsp_request,
            lsp::cmd_lsp_notify,
            lsp::cmd_lsp_diagnostics,
            // Semantic search (local embeddings)
            semantic::cmd_semantic_index_project,
            semantic::cmd_semantic_index_status,
            semantic::cmd_semantic_search,
            semantic::cmd_semantic_index_clear,
            // Dev containers (read-only first pass)
            devcontainer::cmd_devcontainer_detect,
            // Extension loader v0 (Wave 22 phase 1: scanner + entry read)
            extension_loader::cmd_extension_scan,
            extension_loader::cmd_extension_read_entry,
            // File watcher
            watcher::cmd_watch_project,
            watcher::cmd_unwatch_project,
            // Updater
            updater::check_for_update,
            updater::download_and_install_update,
            updater::get_current_version,
            // Spotify auth
            spotify_auth::start_spotify_auth_server,
            spotify_auth::open_url,
        ])
        .run(tauri::generate_context!())
        .map_err(|e| {
            log::error!("Failed to run Lorica: {}", e);
            eprintln!("Failed to run Lorica: {}", e);
            e
        })?;
    Ok(())
}

#[tauri::command]
fn cmd_window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn cmd_window_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn cmd_window_close(window: tauri::Window) {
    let _ = window.close();
}

// ----------------------------------------------------------------------
// Floating editor window — pop a single file out into its own OS window.
// First pass is read-only: the floating viewer renders CodeMirror with
// syntax highlighting + the active theme but does NOT save back. The
// roadmap calls this out (V2.3_ROADMAP.md, "Floating editor windows"
// row): "scope to read-only floating preview first".
//
// We pass the file path through a URL hash fragment (URL-safe base64)
// because Tauri's `WebviewUrl::App` does not allow query parameters in
// dev mode but hash fragments survive both dev (vite/webpack-dev-server)
// and bundled (tauri://localhost) navigation. The frontend's index.jsx
// inspects `location.hash`, sees the `#floating=` prefix, and renders
// `FloatingViewer` instead of the full `App`.
//
// Window labels are unique per file path so re-popping the same file
// re-focuses the existing window instead of opening a duplicate.
#[tauri::command]
fn cmd_window_open_floating(
    app: tauri::AppHandle,
    file_path: String,
    file_name: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    if file_path.is_empty() {
        return Err("file_path is required".to_string());
    }

    let label = label_for_path(&file_path);

    // Re-focus an already-open floating window for this file.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let encoded = URL_SAFE_NO_PAD.encode(file_path.as_bytes());
    let url = format!("index.html#floating={}", encoded);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&format!("{} — Lorica", file_name))
        .inner_size(900.0, 700.0)
        .min_inner_size(400.0, 300.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("failed to create floating window: {}", e))?;

    Ok(())
}

// Deterministic per-path label so reopening the same file re-focuses the
// existing window. Tauri labels must be ASCII alphanumerics, dashes, or
// underscores; we hash anything else away to satisfy that constraint.
fn label_for_path(file_path: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(file_path.as_bytes());
    let digest = h.finalize();
    // 16 hex chars is plenty for collision avoidance per session.
    let short: String = digest.iter().take(8).map(|b| format!("{:02x}", b)).collect();
    format!("floating-{}", short)
}

