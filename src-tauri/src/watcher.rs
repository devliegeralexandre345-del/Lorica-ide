use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::state::AppState;

/// Path fragments we never forward to the frontend. `notify` fires an
/// event per touched file, and a single `npm install` or `cargo build`
/// can produce tens of thousands of events in these directories — none
/// of which the UI should be reacting to.
const NOISY_SEGMENTS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    ".lorica",
];

fn is_noisy_path(p: &Path) -> bool {
    for comp in p.components() {
        let name = comp.as_os_str().to_string_lossy();
        if NOISY_SEGMENTS.iter().any(|n| *n == name) {
            return true;
        }
    }
    false
}

/// Holds file watcher state
pub struct FileWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<PathBuf>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watched_path: None,
        }
    }

    /// Start watching a directory. Events are emitted to the Tauri window.
    pub fn watch(&mut self, path: &str, window: &tauri::Window) -> Result<(), String> {
        // Stop previous watcher
        self.watcher = None;
        self.watched_path = None;

        let window_clone = window.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    // Drop events entirely inside noisy build/vendor dirs.
                    // If ANY path in the event batch is user-visible we
                    // still forward — notify sometimes batches a rename
                    // across directories.
                    let interesting: Vec<&PathBuf> = event
                        .paths
                        .iter()
                        .filter(|p| !is_noisy_path(p))
                        .collect();
                    if interesting.is_empty() {
                        return;
                    }

                    let paths: Vec<String> = interesting
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();

                    let kind = format!("{:?}", event.kind);

                    let _ = window_clone.emit("fs:change", serde_json::json!({
                        "kind": kind,
                        "paths": paths,
                    }));
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Cannot create watcher: {}", e))?;

        watcher
            .watch(std::path::Path::new(path), RecursiveMode::Recursive)
            .map_err(|e| format!("Cannot watch path: {}", e))?;

        self.watcher = Some(watcher);
        self.watched_path = Some(PathBuf::from(path));

        Ok(())
    }

    pub fn unwatch(&mut self) {
        if let (Some(watcher), Some(path)) = (&mut self.watcher, &self.watched_path) {
            let _ = watcher.unwatch(path);
        }
        self.watcher = None;
        self.watched_path = None;
    }

    pub fn watched(&self) -> Option<&PathBuf> {
        self.watched_path.as_ref()
    }
}

/// Start watching the given project directory; emits `fs:change` events to
/// the frontend on any filesystem activity.
///
/// Idempotent: if already watching `path`, does nothing. Calling with a
/// different path replaces the previous watch.
#[tauri::command]
pub fn cmd_watch_project(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut w = crate::state::lock_or_recover(&state.watcher);
    if let Some(current) = w.watched() {
        if current == &PathBuf::from(&path) {
            return Ok(());
        }
    }
    w.watch(&path, &window)
}

#[tauri::command]
pub fn cmd_unwatch_project(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut w = crate::state::lock_or_recover(&state.watcher);
    w.unwatch();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noisy_path_detection() {
        assert!(is_noisy_path(Path::new("/proj/node_modules/react/index.js")));
        assert!(is_noisy_path(Path::new("/proj/.git/HEAD")));
        assert!(is_noisy_path(Path::new("/proj/target/debug/foo")));
        assert!(!is_noisy_path(Path::new("/proj/src/main.rs")));
        assert!(!is_noisy_path(Path::new("/proj/package.json")));
        // Segment boundary check — "modules_node" shouldn't match.
        assert!(!is_noisy_path(Path::new("/proj/modules_node/x")));
    }
}
