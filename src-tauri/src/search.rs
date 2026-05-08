use serde::{Deserialize, Serialize};
use std::fs;

use walkdir::WalkDir;

use crate::filesystem::CmdResult;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub name: String,
    pub line: usize,
    pub col: usize,
    pub text: String,       // the matching line content (trimmed)
    pub preview: String,    // surrounding context
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub total: usize,
    pub files_searched: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub relative: String,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", "__pycache__",
    ".next", ".nuxt", ".cache", "vendor", ".venv", "venv",
];

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg", "webp",
    "woff", "woff2", "ttf", "otf", "eot",
    "zip", "tar", "gz", "rar", "7z",
    "exe", "dll", "so", "dylib", "bin",
    "pdf", "doc", "docx", "xls", "xlsx",
    "mp3", "mp4", "avi", "mov", "wav",
    "lock", "sum",
];

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

fn is_binary(ext: &str) -> bool {
    BINARY_EXTS.contains(&ext.to_lowercase().as_str())
}

/// Compute (line_number_1_based, col_1_based, line_text) for a byte offset in `content`.
/// Used by multi-line search to surface a sensible line/column in the UI.
fn byte_offset_to_line_col(content: &str, byte_offset: usize) -> (usize, usize, String) {
    let mut line_no = 1usize;
    let mut line_start = 0usize;
    for (i, b) in content.as_bytes().iter().enumerate() {
        if i >= byte_offset {
            break;
        }
        if *b == b'\n' {
            line_no += 1;
            line_start = i + 1;
        }
    }
    // Find end of the line that contains `byte_offset`.
    let line_end = content.as_bytes()[line_start..]
        .iter()
        .position(|&b| b == b'\n')
        .map(|p| line_start + p)
        .unwrap_or(content.len());
    let line_text = content.get(line_start..line_end).unwrap_or("").to_string();
    let col = byte_offset.saturating_sub(line_start) + 1;
    (line_no, col, line_text)
}

/// Search for a query string across all files in a directory.
///
/// `multiline = true` makes the query match across newlines (ripgrep `-U`
/// equivalent): the entire file is scanned as one buffer rather than line
/// by line. Defaults to `false` to preserve the original line-oriented
/// behavior for existing callers (Agent tool, Cmd+Shift+F single-line).
#[tauri::command]
pub fn cmd_search_in_files(
    project_path: String,
    query: String,
    case_sensitive: Option<bool>,
    max_results: Option<usize>,
    multiline: Option<bool>,
) -> CmdResult<SearchResult> {
    let case_sensitive = case_sensitive.unwrap_or(false);
    let max_results = max_results.unwrap_or(500);
    let multiline = multiline.unwrap_or(false);
    let search_query = if case_sensitive { query.clone() } else { query.to_lowercase() };

    let mut matches = Vec::new();
    let mut files_searched = 0;
    let mut truncated = false;

    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                return !should_skip_dir(&name);
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let ext = path.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        if is_binary(&ext) {
            continue;
        }

        // Skip large files (> 1MB)
        if let Ok(meta) = fs::metadata(path) {
            if meta.len() > 1_048_576 {
                continue;
            }
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        files_searched += 1;

        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let file_path = path.to_string_lossy().to_string();
        let relative = pathdiff::diff_paths(path, &project_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());

        if multiline {
            // Scan the whole file content. We collapse adjacent matches by
            // walking forward from the previous match end, which both avoids
            // O(n²) reuse of `find` from index 0 and yields stable line/col
            // numbers for each hit.
            let haystack = if case_sensitive { content.clone() } else { content.to_lowercase() };
            let mut start = 0usize;
            while let Some(pos) = haystack[start..].find(&search_query) {
                let abs = start + pos;
                let (line_no, col, line_text) = byte_offset_to_line_col(&content, abs);
                matches.push(SearchMatch {
                    path: file_path.clone(),
                    name: file_name.clone(),
                    line: line_no,
                    col,
                    text: line_text.trim().chars().take(200).collect(),
                    preview: relative.clone(),
                });
                if matches.len() >= max_results {
                    truncated = true;
                    break;
                }
                // Advance past this match (at least one byte to avoid loops on empty queries).
                start = abs + search_query.len().max(1);
                if start >= haystack.len() {
                    break;
                }
            }
        } else {
            for (line_idx, line) in content.lines().enumerate() {
                let search_line = if case_sensitive { line.to_string() } else { line.to_lowercase() };

                if let Some(col) = search_line.find(&search_query) {
                    matches.push(SearchMatch {
                        path: file_path.clone(),
                        name: file_name.clone(),
                        line: line_idx + 1,
                        col: col + 1,
                        text: line.trim().chars().take(200).collect(),
                        preview: relative.clone(),
                    });

                    if matches.len() >= max_results {
                        truncated = true;
                        break;
                    }
                }
            }
        }

        if truncated {
            break;
        }
    }

    let total = matches.len();
    CmdResult::ok(SearchResult {
        matches,
        total,
        files_searched,
        truncated,
    })
}

/// Search-and-replace across files.
///
/// `multiline` is accepted purely so the IPC signature matches the search
/// command. The replacement logic itself already crosses newlines (we
/// `replace` over the whole file content), so this flag does not change
/// behavior — it's there so the frontend can pass the user's current
/// multi-line toggle without a signature mismatch and so future regex-aware
/// modes have a place to branch.
#[tauri::command]
pub fn cmd_search_replace_in_files(
    project_path: String,
    query: String,
    replacement: String,
    case_sensitive: Option<bool>,
    multiline: Option<bool>,
) -> CmdResult<usize> {
    let case_sensitive = case_sensitive.unwrap_or(false);
    let _multiline = multiline.unwrap_or(false);
    let mut total_replacements = 0;

    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                return !should_skip_dir(&name);
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() { continue; }

        let path = entry.path();
        let ext = path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        if is_binary(&ext) { continue; }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (new_content, count) = if case_sensitive {
            let count = content.matches(&query).count();
            (content.replace(&query, &replacement), count)
        } else {
            // Case-insensitive replace
            let lower_content = content.to_lowercase();
            let lower_query = query.to_lowercase();
            let count = lower_content.matches(&lower_query).count();
            if count > 0 {
                let mut result = String::with_capacity(content.len());
                let mut last_end = 0;
                let lower = content.to_lowercase();
                for (start, _) in lower.match_indices(&lower_query) {
                    result.push_str(&content[last_end..start]);
                    result.push_str(&replacement);
                    last_end = start + query.len();
                }
                result.push_str(&content[last_end..]);
                (result, count)
            } else {
                continue;
            }
        };

        if count > 0 {
            let _ = fs::write(path, &new_content);
            total_replacements += count;
        }
    }

    CmdResult::ok(total_replacements)
}

/// List all files in project (for fuzzy file finder)
#[tauri::command]
pub fn cmd_list_project_files(project_path: String) -> CmdResult<Vec<FileEntry>> {
    let mut files = Vec::new();

    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                return !should_skip_dir(&name);
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() { continue; }

        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let ext = path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        let full_path = path.to_string_lossy().to_string();
        let relative = pathdiff::diff_paths(path, &project_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| full_path.clone());

        files.push(FileEntry {
            path: full_path,
            name,
            extension: ext,
            relative,
        });
    }

    CmdResult::ok(files)
}
