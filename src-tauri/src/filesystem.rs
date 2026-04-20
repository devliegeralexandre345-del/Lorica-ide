use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

// Write `content` to `path` atomically: stage into a tmp file in the
// same directory, fsync, then rename. A rename on the same filesystem is
// guaranteed atomic on POSIX and Windows NTFS. This prevents half-written
// files if the process dies mid-write — the caller always sees either
// the old content or the new, never a truncated state.
//
// Same-directory tmp placement matters because cross-device rename
// would fall back to a copy, losing the atomicity guarantee.
pub(crate) fn atomic_write(path: &Path, content: &[u8]) -> std::io::Result<()> {
    // Ensure parent exists so the tmp write doesn't fail.
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "lorica".to_string());
    let tmp: PathBuf = parent.join(format!(".{}.lorica-tmp-{}", file_name, std::process::id()));

    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content)?;
        f.sync_all()?;
    }
    // If the rename fails (e.g. permission) make a best-effort cleanup
    // of the tmp file so the user's directory doesn't accumulate junk.
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

// ======================================================
// Types
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub extension: Option<String>,
    pub children: Option<Vec<FileTreeEntry>>,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileData {
    pub name: String,
    pub content: String,
    pub extension: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileStat {
    pub size: u64,
    pub is_file: bool,
    pub is_dir: bool,
    pub modified: Option<String>,
    pub created: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CmdResult<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> CmdResult<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self { success: false, data: None, error: Some(msg.into()) }
    }
}

// ======================================================
// Directory reading (recursive, with depth limit)
// ======================================================

fn build_tree(path: &Path, depth: u32, max_depth: u32) -> Vec<FileTreeEntry> {
    if depth >= max_depth {
        return vec![];
    }

    let mut entries: Vec<FileTreeEntry> = Vec::new();

    let Ok(read_dir) = fs::read_dir(path) else {
        return entries;
    };

    let mut items: Vec<_> = read_dir
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Skip hidden files, node_modules, .git, target
            !name.starts_with('.')
                && name != "node_modules"
                && name != "target"
                && name != "dist"
                && name != "__pycache__"
        })
        .collect();

    // Sort: directories first, then alphabetical
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    for item in items {
        let name = item.file_name().to_string_lossy().to_string();
        let item_path = item.path();
        let is_dir = item.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

        if is_dir {
            let children = build_tree(&item_path, depth + 1, max_depth);
            entries.push(FileTreeEntry {
                name,
                path: item_path.to_string_lossy().to_string(),
                entry_type: "directory".to_string(),
                extension: None,
                children: Some(children),
                is_directory: true,
            });
        } else {
            let ext = item_path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            entries.push(FileTreeEntry {
                name,
                path: item_path.to_string_lossy().to_string(),
                entry_type: "file".to_string(),
                extension: Some(ext),
                children: None,
                is_directory: false,
            });
        }
    }

    entries
}

// ======================================================
// Tauri Commands
// ======================================================

#[tauri::command]
pub fn cmd_read_dir(dir_path: String) -> CmdResult<Vec<FileTreeEntry>> {
    let path = Path::new(&dir_path);
    if !path.exists() {
        return CmdResult::err(format!("Directory not found: {}", dir_path));
    }
    if !path.is_dir() {
        return CmdResult::err(format!("Not a directory: {}", dir_path));
    }

    let tree = build_tree(path, 0, 10);
    CmdResult::ok(tree)
}

#[tauri::command]
pub fn cmd_read_file(file_path: String) -> CmdResult<FileData> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return CmdResult::err(format!("File not found: {}", file_path));
    }

    let metadata = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => return CmdResult::err(format!("Cannot read metadata: {}", e)),
    };

    // Safety: don't read files > 50MB into memory (use buffer module instead)
    if metadata.len() > 50 * 1024 * 1024 {
        return CmdResult::err("File too large (>50MB). Use large file mode.".to_string());
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => {
            // Try reading as bytes and lossy convert
            match fs::read(&path) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Err(e) => return CmdResult::err(format!("Cannot read file: {}", e)),
            }
        }
    };

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    CmdResult::ok(FileData {
        name,
        content,
        extension,
        path: file_path,
        size: metadata.len(),
    })
}

#[tauri::command]
pub fn cmd_write_file(file_path: String, content: String) -> CmdResult<bool> {
    // Atomic write so a crash mid-save can't corrupt the user's file.
    match atomic_write(Path::new(&file_path), content.as_bytes()) {
        Ok(_) => CmdResult::ok(true),
        Err(e) => CmdResult::err(format!("Cannot write file: {}", e)),
    }
}

/// Read a file as raw bytes (Vec<u8> — serialized as an array of numbers to JS).
/// Used by binary previewers (PDF, DOCX, etc.). Capped at 50 MB for safety.
#[tauri::command]
pub fn cmd_read_file_bytes(file_path: String) -> CmdResult<Vec<u8>> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return CmdResult::err(format!("File not found: {}", file_path));
    }
    let metadata = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => return CmdResult::err(format!("Cannot read metadata: {}", e)),
    };
    if metadata.len() > 50 * 1024 * 1024 {
        return CmdResult::err("File too large (>50MB)".to_string());
    }
    match fs::read(&path) {
        Ok(bytes) => CmdResult::ok(bytes),
        Err(e) => CmdResult::err(format!("Cannot read file: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_create_file(file_path: String) -> CmdResult<bool> {
    let path = Path::new(&file_path);
    if path.exists() {
        return CmdResult::err("File already exists".to_string());
    }
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&file_path, "") {
        Ok(_) => CmdResult::ok(true),
        Err(e) => CmdResult::err(format!("Cannot create file: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_create_dir(dir_path: String) -> CmdResult<bool> {
    match fs::create_dir_all(&dir_path) {
        Ok(_) => CmdResult::ok(true),
        Err(e) => CmdResult::err(format!("Cannot create directory: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_delete_path(target_path: String) -> CmdResult<bool> {
    let path = Path::new(&target_path);
    if !path.exists() {
        return CmdResult::err("Path does not exist".to_string());
    }

    let result = if path.is_dir() {
        fs::remove_dir_all(&target_path)
    } else {
        fs::remove_file(&target_path)
    };

    match result {
        Ok(_) => CmdResult::ok(true),
        Err(e) => CmdResult::err(format!("Cannot delete: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_rename(old_path: String, new_path: String) -> CmdResult<bool> {
    match fs::rename(&old_path, &new_path) {
        Ok(_) => CmdResult::ok(true),
        Err(e) => CmdResult::err(format!("Cannot rename: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_stat(file_path: String) -> CmdResult<FileStat> {
    match fs::metadata(&file_path) {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .map(|t| {
                    chrono::DateTime::<chrono::Utc>::from(t)
                        .format("%Y-%m-%d %H:%M:%S")
                        .to_string()
                });
            let created = meta
                .created()
                .ok()
                .map(|t| {
                    chrono::DateTime::<chrono::Utc>::from(t)
                        .format("%Y-%m-%d %H:%M:%S")
                        .to_string()
                });
            CmdResult::ok(FileStat {
                size: meta.len(),
                is_file: meta.is_file(),
                is_dir: meta.is_dir(),
                modified,
                created,
            })
        }
        Err(e) => CmdResult::err(format!("Cannot stat: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_exists(file_path: String) -> CmdResult<bool> {
    CmdResult::ok(Path::new(&file_path).exists())
}
