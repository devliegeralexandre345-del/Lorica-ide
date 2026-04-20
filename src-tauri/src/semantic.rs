// src-tauri/src/semantic.rs
//
// Local semantic search. Runs an ONNX embedding model (all-MiniLM-L6-v2,
// 384-dim, ~23 MB) on the user's machine so nothing leaves the box. The
// index lives at `<project>/.lorica/semantic.bin` (bincode).
//
// Design choices:
//   • Chunking is line-window based (50 lines, 10-line overlap). AST-aware
//     chunking is better but pulls in tree-sitter per language — not worth
//     the complexity for v1. A 50-line window still captures enough context
//     for the embedding to be meaningful.
//   • In-memory brute-force cosine similarity. For a typical repo (<50k
//     chunks) this is ~5–20 ms per query on modern CPU and avoids dragging
//     in a vector database dependency. Upgrade to HNSW only if it becomes
//     a bottleneck.
//   • fastembed returns L2-normalized vectors, so `dot == cosine`. We skip
//     the divide.
//   • The model is lazy-loaded inside each command because `TextEmbedding`
//     isn't `Send + Sync` (contains `!Send` ort internals on some targets).
//     Loading is cheap after the one-time model download — fastembed keeps
//     the weights in the OS cache.

use chrono::Utc;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};
use walkdir::WalkDir;

use crate::filesystem::CmdResult;

// ======================================================
// Tuning constants
// ======================================================

/// Directories that should never be indexed. Matches the rules used by
/// `search.rs` so the two stay consistent.
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", "__pycache__",
    ".next", ".nuxt", ".cache", "vendor", ".venv", "venv", ".lorica",
];

/// File extensions we know carry no useful text content.
const BINARY_EXTS: &[&str] = &[
    // Images
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg", "webp", "avif", "heic", "tiff",
    // Fonts
    "woff", "woff2", "ttf", "otf", "eot",
    // Archives
    "zip", "tar", "gz", "bz2", "xz", "zst", "rar", "7z",
    // Native / compiled
    "exe", "dll", "so", "dylib", "bin", "a", "o", "obj", "lib", "node", "wasm",
    "class", "jar", "war", "pyc", "pyo", "pdb",
    // Documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    // Media
    "mp3", "mp4", "avi", "mov", "wav", "flac", "ogg", "m4a", "mkv", "webm",
    // Lockfiles / checksum bundles (noisy, rarely searched)
    "lock", "sum",
];

/// Lines per chunk. 50 is a sweet spot — long enough for semantic
/// meaning, short enough that similarity scores aren't washed out.
const CHUNK_LINES: usize = 50;

/// Overlap between consecutive chunks. Lets matches that straddle a
/// chunk boundary still show up.
const CHUNK_OVERLAP: usize = 10;

/// Skip files bigger than this. Huge files (minified JS, generated code)
/// swamp the index and rarely contain text the user would search for.
const MAX_FILE_BYTES: u64 = 512 * 1024;

/// Current on-disk format version. Bump when the struct shape changes so
/// old indexes are rebuilt instead of mis-read.
///   v1 — initial (chunks + vectors only, no file manifest)
///   v2 — adds `files` manifest for incremental reindexing
const INDEX_VERSION: u32 = 2;

/// Chars per chunk text sent to the embedder — a safety cap so a 50-line
/// chunk full of minified code doesn't blow past the model's context.
const MAX_CHUNK_CHARS: usize = 4000;

// ======================================================
// Types
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chunk {
    pub path: String,       // absolute path on disk
    pub relative: String,   // relative to project root (display / dedup key)
    pub start_line: usize,  // 1-indexed, inclusive
    pub end_line: usize,    // 1-indexed, inclusive
    pub text: String,       // raw chunk content
}

/// Per-file manifest entry. `mtime_ms` is the fast-path change detector —
/// if mtime matches what we have, we keep the existing chunks/vectors
/// untouched. `chunk_indices` records which positions in the global
/// `chunks` / `vectors` arrays belong to this file so a rebuild can copy
/// them forward unchanged.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileMeta {
    pub mtime_ms: u64,
    pub chunk_indices: Vec<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SemanticIndex {
    pub version: u32,
    pub model: String,
    pub dim: usize,
    pub built_at: String,                   // ISO 8601 UTC
    pub chunks: Vec<Chunk>,
    pub vectors: Vec<Vec<f32>>,
    /// Keyed by the file's path relative to the project root.
    pub files: HashMap<String, FileMeta>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SemanticHit {
    pub path: String,
    pub relative: String,
    pub start_line: usize,
    pub end_line: usize,
    pub snippet: String,   // first ~6 lines of the chunk for preview
    pub score: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SemanticIndexStatus {
    pub exists: bool,
    pub built_at: Option<String>,
    pub chunks: usize,
    pub dim: usize,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndexBuildReport {
    pub chunks: usize,          // total chunks in the final index
    pub files: usize,           // total eligible files on disk
    pub files_reused: usize,    // unchanged since last build
    pub files_changed: usize,   // mtime changed → re-embedded
    pub files_new: usize,       // didn't exist in the previous index
    pub files_deleted: usize,   // in the previous index but gone from disk
    pub chunks_embedded: usize, // chunks we actually ran through the model
    pub duration_ms: u128,
    pub model: String,
    pub dim: usize,
    pub incremental: bool,      // false on a full (re)build, true otherwise
}

// ======================================================
// Helpers
// ======================================================

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

fn is_binary(ext: &str) -> bool {
    BINARY_EXTS.contains(&ext.to_lowercase().as_str())
}

fn index_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".lorica").join("semantic.bin")
}

/// Milliseconds since the Unix epoch. Used as the cheap change detector
/// for incremental reindexing. Cross-platform (via `SystemTime`) so the
/// same index file works on Windows / macOS / Linux.
fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Try to load an existing valid index. Returns `None` on missing,
/// corrupt, or stale-version files — any of those should trigger a
/// full rebuild.
fn load_index_if_valid(project_path: &str) -> Option<SemanticIndex> {
    let p = index_path(project_path);
    if !p.exists() { return None; }
    let bytes = fs::read(&p).ok()?;
    let idx: SemanticIndex = bincode::deserialize(&bytes).ok()?;
    if idx.version != INDEX_VERSION { return None; }
    Some(idx)
}

/// Split a single file's content into line-windowed chunks. Empty files
/// produce zero chunks; tiny files (<10 lines) still produce one.
fn chunk_file(content: &str, path: &str, relative: &str) -> Vec<Chunk> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() { return Vec::new(); }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < lines.len() {
        let end = (start + CHUNK_LINES).min(lines.len());
        let mut text = lines[start..end].join("\n");
        if text.len() > MAX_CHUNK_CHARS {
            text.truncate(MAX_CHUNK_CHARS);
        }
        // Skip near-empty chunks (pure whitespace is noise for the embedder).
        if text.trim().len() >= 16 {
            chunks.push(Chunk {
                path: path.to_string(),
                relative: relative.to_string(),
                start_line: start + 1,
                end_line: end,
                text,
            });
        }
        if end >= lines.len() { break; }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }
    chunks
}

/// If the project has a `.gitignore`, make sure `.lorica/` is in it so
/// the semantic index (which can be megabytes of vectors) doesn't leak
/// into commits. We only touch an *existing* .gitignore — creating one
/// where none existed would be presumptuous for a non-git project.
fn ensure_gitignore_has_lorica(project_path: &str) {
    let gi = Path::new(project_path).join(".gitignore");
    let current = match fs::read_to_string(&gi) {
        Ok(s) => s,
        Err(_) => return,   // no .gitignore (or unreadable) — leave it alone
    };
    // Already covered?
    for line in current.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') { continue; }
        if matches!(t, ".lorica" | ".lorica/" | "/.lorica" | "/.lorica/") {
            return;
        }
    }
    let mut updated = current;
    if !updated.ends_with('\n') { updated.push('\n'); }
    updated.push_str("\n# Lorica IDE local data (semantic index, per-project cache)\n");
    updated.push_str(".lorica/\n");
    // If the write fails, silently skip — user can add the entry manually.
    let _ = fs::write(&gi, updated);
}

fn init_model() -> Result<TextEmbedding, String> {
    TextEmbedding::try_new(
        InitOptions::new(EmbeddingModel::AllMiniLML6V2)
    ).map_err(|e| format!("Failed to load embedding model: {}", e))
}

/// L2-normalized → dot product == cosine similarity. fastembed already
/// normalizes its output, so we do too (defensive) and then take the dot.
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut dot = 0.0f32;
    for i in 0..n { dot += a[i] * b[i]; }
    dot
}

/// Build a short snippet (first 6 non-empty lines, trimmed) for display.
fn make_snippet(chunk_text: &str) -> String {
    let mut out = String::new();
    let mut n = 0;
    for line in chunk_text.lines() {
        if line.trim().is_empty() { continue; }
        if n > 0 { out.push('\n'); }
        // Keep individual lines reasonable for list display.
        let trimmed: String = line.chars().take(180).collect();
        out.push_str(&trimmed);
        n += 1;
        if n >= 6 { break; }
    }
    out
}

// ======================================================
// Commands
// ======================================================

/// Lightweight per-file scan result used during the walk phase.
struct FileScan {
    relative: String,   // path relative to project root
    full: String,       // absolute path
    mtime: u64,
}

/// Walk the project and collect one `FileScan` per indexable file. This
/// is the mtime-cheap phase — we don't read contents yet.
fn scan_files(project_path: &str) -> Vec<FileScan> {
    let mut out = Vec::new();
    for entry in WalkDir::new(project_path)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                return !should_skip_dir(&e.file_name().to_string_lossy());
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() { continue; }
        let path = entry.path();
        let ext = path.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_binary(&ext) { continue; }

        // Reject huge files before touching mtime/metadata again.
        if let Ok(meta) = fs::metadata(path) {
            if meta.len() > MAX_FILE_BYTES { continue; }
            // We already have metadata — pull mtime from it to avoid a
            // second syscall.
            let mt = meta.modified().ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let full = path.to_string_lossy().to_string();
            let rel = pathdiff::diff_paths(path, project_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| full.clone());
            out.push(FileScan { relative: rel, full, mtime: mt });
        } else {
            // Couldn't read metadata — fall back to the slow helper.
            let mt = mtime_ms(path);
            let full = path.to_string_lossy().to_string();
            let rel = pathdiff::diff_paths(path, project_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| full.clone());
            out.push(FileScan { relative: rel, full, mtime: mt });
        }
    }
    out
}

/// Build or update the semantic index. Runs incrementally by default:
/// unchanged files (same mtime as last build) keep their existing chunks
/// and vectors verbatim, changed/new files get re-chunked and re-embedded,
/// and files that disappeared are dropped.
///
/// Pass `force = Some(true)` to force a full rebuild from scratch (ignores
/// any existing index). Useful when switching models or debugging.
#[tauri::command]
pub fn cmd_semantic_index_project(
    project_path: String,
    force: Option<bool>,
) -> CmdResult<IndexBuildReport> {
    let started = Instant::now();
    let force_full = force.unwrap_or(false);

    // Step 1: maybe load the previous index.
    let existing = if force_full { None } else { load_index_if_valid(&project_path) };
    let incremental = existing.is_some();

    // Step 2: walk the project.
    let scans = scan_files(&project_path);
    if scans.is_empty() {
        return CmdResult::err("No indexable files found in project.");
    }

    // Step 3: partition files into reuse vs re-embed buckets.
    //
    //   reused  — mtime unchanged, copy chunks + vectors forward as-is.
    //   changed — mtime differs or file is new → needs re-embedding.
    //
    // We keep two indices into `scans` rather than cloning the structs —
    // pending borrows make this a little awkward but avoids allocations.
    let mut reused_idx: Vec<usize> = Vec::new();
    let mut changed_idx: Vec<usize> = Vec::new();
    let mut files_new = 0usize;

    if let Some(ref old) = existing {
        for (i, scan) in scans.iter().enumerate() {
            match old.files.get(&scan.relative) {
                Some(old_meta) if old_meta.mtime_ms == scan.mtime => reused_idx.push(i),
                Some(_) => changed_idx.push(i),           // mtime moved
                None => { changed_idx.push(i); files_new += 1; }  // brand new
            }
        }
    } else {
        for i in 0..scans.len() { changed_idx.push(i); }
        files_new = scans.len();
    }

    // Files that disappeared from disk: were in old manifest, not in scans.
    let files_deleted = if let Some(ref old) = existing {
        let on_disk: std::collections::HashSet<&str> = scans.iter()
            .map(|s| s.relative.as_str())
            .collect();
        old.files.keys().filter(|k| !on_disk.contains(k.as_str())).count()
    } else {
        0
    };

    // Step 4: build new index layout. Reused chunks go in first (so
    // their indices match file manifest entries we write alongside),
    // then freshly embedded ones.
    let mut new_chunks: Vec<Chunk> = Vec::new();
    let mut new_vectors: Vec<Vec<f32>> = Vec::new();
    let mut new_files: HashMap<String, FileMeta> = HashMap::new();

    if let Some(ref old) = existing {
        for &i in &reused_idx {
            let scan = &scans[i];
            let old_meta = match old.files.get(&scan.relative) {
                Some(m) => m,
                None => continue,   // unreachable by construction
            };
            let mut new_indices = Vec::with_capacity(old_meta.chunk_indices.len());
            for &idx in &old_meta.chunk_indices {
                if idx >= old.chunks.len() || idx >= old.vectors.len() {
                    // Shouldn't happen with a valid index — skip defensively.
                    continue;
                }
                new_indices.push(new_chunks.len());
                new_chunks.push(old.chunks[idx].clone());
                new_vectors.push(old.vectors[idx].clone());
            }
            new_files.insert(scan.relative.clone(), FileMeta {
                mtime_ms: scan.mtime,
                chunk_indices: new_indices,
            });
        }
    }

    // Step 5: chunk every changed file. We keep per-file chunk groups
    // so we can slice the embedding output back into file manifests.
    struct Pending {
        relative: String,
        mtime: u64,
        chunks: Vec<Chunk>,
    }
    let mut pending: Vec<Pending> = Vec::with_capacity(changed_idx.len());
    for &i in &changed_idx {
        let scan = &scans[i];
        let content = match fs::read_to_string(&scan.full) {
            Ok(c) => c,
            Err(_) => continue,   // probably binary masquerading as text
        };
        let chunks = chunk_file(&content, &scan.full, &scan.relative);
        if chunks.is_empty() { continue; }
        pending.push(Pending {
            relative: scan.relative.clone(),
            mtime: scan.mtime,
            chunks,
        });
    }

    // Step 6: embed all pending chunks in one batched call. Skips the
    // model-load entirely if nothing changed, which is the common case
    // for a steady-state project after a hot save somewhere else.
    let chunks_embedded = pending.iter().map(|p| p.chunks.len()).sum::<usize>();

    let new_embeds: Vec<Vec<f32>> = if chunks_embedded == 0 {
        Vec::new()
    } else {
        let mut model = match init_model() {
            Ok(m) => m,
            Err(e) => return CmdResult::err(e),
        };
        let texts: Vec<String> = pending.iter()
            .flat_map(|p| p.chunks.iter().map(|c| c.text.clone()))
            .collect();
        match model.embed(texts, None) {
            Ok(v) => v,
            Err(e) => return CmdResult::err(format!("Embedding failed: {}", e)),
        }
    };

    // Step 7: splice the new embeddings in alongside reused ones.
    let mut cursor = 0usize;
    for p in pending {
        let mut indices = Vec::with_capacity(p.chunks.len());
        for chunk in p.chunks {
            if cursor >= new_embeds.len() { break; }   // defensive
            indices.push(new_chunks.len());
            new_chunks.push(chunk);
            new_vectors.push(new_embeds[cursor].clone());
            cursor += 1;
        }
        new_files.insert(p.relative.clone(), FileMeta {
            mtime_ms: p.mtime,
            chunk_indices: indices,
        });
    }

    // Figure out the final dim. If we embedded anything fresh, trust
    // that; otherwise fall back to the old index's dim (for a pure-
    // reuse run); model default as last resort.
    let dim = new_vectors.first().map(|v| v.len())
        .or_else(|| existing.as_ref().map(|o| o.dim))
        .unwrap_or(384);

    let index = SemanticIndex {
        version: INDEX_VERSION,
        model: "AllMiniLML6V2".to_string(),
        dim,
        built_at: Utc::now().to_rfc3339(),
        chunks: new_chunks,
        vectors: new_vectors,
        files: new_files,
    };

    // Step 8: persist.
    let out_path = index_path(&project_path);
    if let Some(parent) = out_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return CmdResult::err(format!("Cannot create .lorica dir: {}", e));
        }
    }
    let encoded = match bincode::serialize(&index) {
        Ok(b) => b,
        Err(e) => return CmdResult::err(format!("Serialize failed: {}", e)),
    };
    // Atomic write: the index can be multi-MB and a crash mid-write
    // would leave a corrupt file that forces a full rebuild.
    if let Err(e) = crate::filesystem::atomic_write(&out_path, &encoded) {
        return CmdResult::err(format!("Cannot write index file: {}", e));
    }

    // Best-effort — never fails the build if this step hiccups.
    ensure_gitignore_has_lorica(&project_path);

    let files_changed = changed_idx.len().saturating_sub(files_new);
    CmdResult::ok(IndexBuildReport {
        chunks: index.chunks.len(),
        files: scans.len(),
        files_reused: reused_idx.len(),
        files_changed,
        files_new,
        files_deleted,
        chunks_embedded,
        duration_ms: started.elapsed().as_millis(),
        model: index.model.clone(),
        dim: index.dim,
        incremental,
    })
}

/// Report whether a usable index exists on disk. Cheap — only reads the
/// metadata header. Lets the UI show "Build index" vs "Search" without
/// paying the load cost.
#[tauri::command]
pub fn cmd_semantic_index_status(project_path: String) -> CmdResult<SemanticIndexStatus> {
    let p = index_path(&project_path);
    if !p.exists() {
        return CmdResult::ok(SemanticIndexStatus {
            exists: false,
            built_at: None,
            chunks: 0,
            dim: 0,
            model: String::new(),
        });
    }

    let bytes = match fs::read(&p) {
        Ok(b) => b,
        Err(e) => return CmdResult::err(format!("Cannot read index: {}", e)),
    };
    let index: SemanticIndex = match bincode::deserialize(&bytes) {
        Ok(i) => i,
        Err(_) => {
            // Corrupt or schema-mismatched — report as absent so the UI
            // offers to rebuild.
            return CmdResult::ok(SemanticIndexStatus {
                exists: false,
                built_at: None,
                chunks: 0,
                dim: 0,
                model: String::new(),
            });
        }
    };

    if index.version != INDEX_VERSION {
        return CmdResult::ok(SemanticIndexStatus {
            exists: false,
            built_at: Some(index.built_at),
            chunks: index.chunks.len(),
            dim: index.dim,
            model: index.model,
        });
    }

    CmdResult::ok(SemanticIndexStatus {
        exists: true,
        built_at: Some(index.built_at),
        chunks: index.chunks.len(),
        dim: index.dim,
        model: index.model,
    })
}

/// Run a semantic query against the on-disk index. Returns top-K hits
/// sorted by cosine similarity, highest first.
#[tauri::command]
pub fn cmd_semantic_search(
    project_path: String,
    query: String,
    top_k: Option<usize>,
) -> CmdResult<Vec<SemanticHit>> {
    if query.trim().is_empty() {
        return CmdResult::ok(Vec::new());
    }
    let k = top_k.unwrap_or(20).max(1).min(200);

    let p = index_path(&project_path);
    if !p.exists() {
        return CmdResult::err("No semantic index yet — click \"Build index\" first.");
    }
    let bytes = match fs::read(&p) {
        Ok(b) => b,
        Err(e) => return CmdResult::err(format!("Cannot read index: {}", e)),
    };
    let index: SemanticIndex = match bincode::deserialize(&bytes) {
        Ok(i) => i,
        Err(e) => return CmdResult::err(format!(
            "Index file is corrupt or outdated — rebuild it. ({})", e
        )),
    };
    if index.version != INDEX_VERSION {
        return CmdResult::err("Index is from an older version — rebuild it.");
    }

    let mut model = match init_model() {
        Ok(m) => m,
        Err(e) => return CmdResult::err(e),
    };
    let mut qvec = match model.embed(vec![query.clone()], None) {
        Ok(v) => v,
        Err(e) => return CmdResult::err(format!("Query embedding failed: {}", e)),
    };
    let qv = match qvec.pop() {
        Some(v) => v,
        None => return CmdResult::err("Empty query embedding."),
    };

    // If dims don't match, cosine would silently truncate and return
    // garbage scores — make that visible and force a rebuild instead.
    if !index.vectors.is_empty() && qv.len() != index.dim {
        return CmdResult::err(format!(
            "Index dimension mismatch (query {}, index {}) — rebuild the semantic index.",
            qv.len(), index.dim
        ));
    }

    // Score every chunk. Brute force is fine up to ~50k chunks.
    let mut scored: Vec<(usize, f32)> = index.vectors.iter()
        .enumerate()
        .map(|(i, v)| (i, cosine(&qv, v)))
        .collect();

    // Partial sort — we only need top-K.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);

    let hits = scored.into_iter().map(|(i, score)| {
        let c = &index.chunks[i];
        SemanticHit {
            path: c.path.clone(),
            relative: c.relative.clone(),
            start_line: c.start_line,
            end_line: c.end_line,
            snippet: make_snippet(&c.text),
            score,
        }
    }).collect();

    CmdResult::ok(hits)
}

/// Delete the on-disk index. Mostly useful for "reset" / troubleshooting.
#[tauri::command]
pub fn cmd_semantic_index_clear(project_path: String) -> CmdResult<bool> {
    let p = index_path(&project_path);
    if p.exists() {
        if let Err(e) = fs::remove_file(&p) {
            return CmdResult::err(format!("Cannot delete index: {}", e));
        }
    }
    CmdResult::ok(true)
}
