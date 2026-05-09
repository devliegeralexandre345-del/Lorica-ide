// src-tauri/src/extension_loader.rs
//
// Extension loader v0 — phase 1: scan the user data dir for installed
// extensions and return their manifests. Phase 2 (Wave 23+) will load
// the extension's `entry` JS via Tauri fs + a blob URL + dynamic
// import, plus the v0 sandbox API surface.
//
// Per `docs/EXTENSION_API.md`, extensions live under:
//   <user-data-dir>/Lorica/extensions/<id>/
//     manifest.json
//     extension.js
//     icon.svg          (optional)
//
// We accept three roots so users (and the in-tree reference extension)
// can develop / test:
//   1. The platform user-data dir (production install location).
//   2. `<project>/.lorica/extensions/` (per-project extensions).
//   3. The in-tree `extensions/` folder of a Lorica checkout (only
//      when running in dev — useful for the `extensions/focus-timer`
//      reference).
//
// All three are scanned and merged. If two extensions claim the same
// `id`, the first found wins (project local > user data > in-tree).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::filesystem::CmdResult;

// Manifest field names match `docs/EXTENSION_API.md` exactly — snake_
// case for `lorica_api_version` and `root_path` so the JSON the user
// authors stays readable. We avoid `rename_all = "camelCase"` because
// the spec file already canonicalises the field shape and changing it
// would silently invalidate every authored manifest in the wild.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub version: String,
    /// Major API version the extension targets. Today only "0" is
    /// supported; extensions declaring a different value are rejected
    /// at manifest-validation time so they can't load against an
    /// incompatible API.
    pub lorica_api_version: String,
    /// Relative path from the extension's directory to its main JS
    /// file. Resolved during phase 2 when we actually load the code.
    pub entry: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    pub permissions: Vec<String>,
    /// Absolute path to the extension's directory on disk. Filled in
    /// by the loader, NOT read from the manifest file. Defaults to
    /// empty so manifests authored without it deserialize cleanly.
    #[serde(default, rename = "rootPath")]
    pub root_path: String,
    /// Where this extension was found: `user`, `project`, or `builtin`.
    /// Filled in by the loader.
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ExtensionScanResult {
    pub manifests: Vec<ExtensionManifest>,
    /// Per-directory parse errors so the UI can show "extension X
    /// failed to load" without fighting through the success path.
    pub errors: Vec<String>,
}

// Resolve the user data dir for installed extensions. Mirrors the
// pattern used by `extensions::get_extensions_dir` so users have ONE
// install root regardless of whether the extension came from the LSP
// marketplace or a manual drop.
fn user_extensions_dir() -> Option<PathBuf> {
    let base = dirs::data_local_dir()?;
    Some(base.join("Lorica").join("extensions"))
}

fn project_extensions_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".lorica").join("extensions")
}

/// Scan a single directory for extensions. Returns the parsed
/// manifests + per-extension parse errors. Robust to a missing root
/// (returns an empty list — common when the user has no installed
/// extensions yet).
fn scan_dir(root: &Path, source: &str, out: &mut Vec<ExtensionManifest>, errors: &mut Vec<String>, seen_ids: &mut std::collections::HashSet<String>) {
    if !root.is_dir() { return; }
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let manifest_path = dir.join("manifest.json");
        if !manifest_path.is_file() { continue; }
        match read_manifest(&manifest_path, source) {
            Ok(mut m) => {
                m.root_path = dir.to_string_lossy().to_string();
                if seen_ids.contains(&m.id) {
                    // First-found-wins. We could surface a "shadowed
                    // by another source" warning here later, but for
                    // v0 a silent skip is fine.
                    continue;
                }
                seen_ids.insert(m.id.clone());
                out.push(m);
            }
            Err(e) => {
                errors.push(format!("{}: {}", manifest_path.display(), e));
            }
        }
    }
}

fn read_manifest(path: &Path, source: &str) -> Result<ExtensionManifest, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read failed: {}", e))?;
    let mut m: ExtensionManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid JSON: {}", e))?;
    if m.id.is_empty() { return Err("manifest.id is required".into()); }
    if !m.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("manifest.id must be ascii [a-zA-Z0-9-_]".into());
    }
    if m.entry.is_empty() { return Err("manifest.entry is required".into()); }
    if m.lorica_api_version != "0" {
        return Err(format!(
            "unsupported lorica_api_version `{}` (this Lorica supports `0`)",
            m.lorica_api_version
        ));
    }
    // Reject permissions we don't recognise so a typo doesn't silently
    // grant nothing. Phase-2 sandbox additions will extend this list.
    const KNOWN_PERMISSIONS: &[&str] = &[
        "ui.statusBar", "ui.dock", "ui.settingsTab", "ui.commandPalette",
        "storage.local", "storage.settings",
        "events.editor", "events.git",
        "agent.tools",
    ];
    for p in &m.permissions {
        if !KNOWN_PERMISSIONS.contains(&p.as_str()) {
            return Err(format!("unknown permission `{}`", p));
        }
    }
    m.source = source.to_string();
    m.root_path = String::new(); // filled in by scan_dir
    Ok(m)
}

#[tauri::command]
pub fn cmd_extension_scan(project_path: Option<String>, builtin_dir: Option<String>) -> CmdResult<ExtensionScanResult> {
    let mut manifests: Vec<ExtensionManifest> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut seen_ids = std::collections::HashSet::<String>::new();

    // Project-local first (highest priority — overrides user installs).
    if let Some(pp) = project_path.as_deref() {
        let dir = project_extensions_dir(pp);
        scan_dir(&dir, "project", &mut manifests, &mut errors, &mut seen_ids);
    }
    // User-installed second.
    if let Some(dir) = user_extensions_dir() {
        scan_dir(&dir, "user", &mut manifests, &mut errors, &mut seen_ids);
    }
    // In-tree built-ins last (so a user-installed copy of the same id
    // can override the bundled reference).
    if let Some(b) = builtin_dir.as_deref() {
        scan_dir(Path::new(b), "builtin", &mut manifests, &mut errors, &mut seen_ids);
    }
    CmdResult::ok(ExtensionScanResult { manifests, errors })
}

/// Read a single extension's `entry` JS file off disk. The frontend
/// turns this string into a Blob URL and dynamic-imports it once
/// phase 2 ships the runtime. v0 returns the raw text — sandboxing
/// happens in JS, not here.
#[tauri::command]
pub fn cmd_extension_read_entry(root_path: String, entry: String) -> CmdResult<String> {
    let root = Path::new(&root_path);
    if !root.is_dir() { return CmdResult::err("extension root is not a directory"); }
    // Reject path traversal — `entry` is meant to be a relative path
    // within the extension's own root.
    if entry.contains("..") || entry.starts_with('/') || entry.starts_with('\\') {
        return CmdResult::err("entry path must be relative and stay within the extension root");
    }
    let path = root.join(&entry);
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(e) => return CmdResult::err(format!("entry not found: {}", e)),
    };
    let canonical_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return CmdResult::err(format!("root canonicalize failed: {}", e)),
    };
    if !canonical.starts_with(&canonical_root) {
        return CmdResult::err("entry resolved outside the extension root");
    }
    match fs::read_to_string(&canonical) {
        Ok(s) => CmdResult::ok(s),
        Err(e) => CmdResult::err(format!("read failed: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_zero_api_version() {
        let dir = std::env::temp_dir().join(format!("lorica-ext-bad-v-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("ext")).unwrap();
        let m = r#"{
            "id": "ext",
            "name": "Bad",
            "version": "1.0.0",
            "lorica_api_version": "99",
            "entry": "./e.js",
            "permissions": []
        }"#;
        std::fs::write(dir.join("ext").join("manifest.json"), m).unwrap();
        let mut out = vec![];
        let mut errs = vec![];
        let mut seen = std::collections::HashSet::new();
        scan_dir(&dir, "test", &mut out, &mut errs, &mut seen);
        assert!(out.is_empty());
        assert!(errs.iter().any(|e| e.contains("99")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_permission() {
        let dir = std::env::temp_dir().join(format!("lorica-ext-bad-p-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("ext")).unwrap();
        let m = r#"{
            "id": "ext",
            "name": "Bad",
            "version": "1.0.0",
            "lorica_api_version": "0",
            "entry": "./e.js",
            "permissions": ["mystery.power"]
        }"#;
        std::fs::write(dir.join("ext").join("manifest.json"), m).unwrap();
        let mut out = vec![];
        let mut errs = vec![];
        let mut seen = std::collections::HashSet::new();
        scan_dir(&dir, "test", &mut out, &mut errs, &mut seen);
        assert!(out.is_empty());
        assert!(errs.iter().any(|e| e.contains("mystery.power")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_valid_focus_timer_manifest() {
        let dir = std::env::temp_dir().join(format!("lorica-ext-good-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("focus-timer")).unwrap();
        let m = r#"{
            "id": "focus-timer",
            "name": "Focus Timer",
            "version": "1.0.0",
            "lorica_api_version": "0",
            "entry": "./extension.js",
            "permissions": ["ui.statusBar", "ui.commandPalette", "storage.local", "storage.settings"]
        }"#;
        std::fs::write(dir.join("focus-timer").join("manifest.json"), m).unwrap();
        let mut out = vec![];
        let mut errs = vec![];
        let mut seen = std::collections::HashSet::new();
        scan_dir(&dir, "builtin", &mut out, &mut errs, &mut seen);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "focus-timer");
        assert_eq!(out[0].source, "builtin");
        assert!(errs.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn entry_path_traversal_blocked() {
        let dir = std::env::temp_dir().join(format!("lorica-ext-trav-{}", std::process::id()));
        let ext_dir = dir.join("ext");
        std::fs::create_dir_all(&ext_dir).unwrap();
        let r = cmd_extension_read_entry(
            ext_dir.to_string_lossy().to_string(),
            "../../etc/passwd".into(),
        );
        assert!(!r.success);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
