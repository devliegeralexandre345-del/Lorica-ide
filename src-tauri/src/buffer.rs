use memmap2::Mmap;

use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;

use crate::filesystem::CmdResult;
use crate::state::AppState;

// ======================================================
// Piece Table implementation
// ======================================================

#[derive(Debug, Clone, Copy, PartialEq)]
enum PieceSource {
    Original, // Points into the mmap'd original file
    Add,      // Points into the additions buffer
}

#[derive(Debug, Clone)]
struct Piece {
    source: PieceSource,
    start: usize,  // byte offset in source
    length: usize, // byte length
}

/// A buffer backed by mmap (original) + append-only additions buffer
struct HelixBuffer {
    /// Memory-mapped original file (immutable, zero-copy)
    original: Option<Mmap>,
    /// All inserted text goes here (append-only)
    additions: String,
    /// Ordered list of pieces describing the current document
    pieces: Vec<Piece>,
    /// Line start byte offsets (cached for O(log n) line access)
    line_starts: Vec<usize>,
    /// File path
    #[allow(dead_code)]
    path: PathBuf,
    /// Total length in bytes
    total_len: usize,
}

impl HelixBuffer {
    fn open(path: &str) -> Result<Self, String> {
        let file_path = PathBuf::from(path);
        let file = File::open(&file_path)
            .map_err(|e| format!("Cannot open file: {}", e))?;

        let metadata = file.metadata()
            .map_err(|e| format!("Cannot read metadata: {}", e))?;

        let file_len = metadata.len() as usize;

        if file_len == 0 {
            return Ok(Self {
                original: None,
                additions: String::new(),
                pieces: vec![],
                line_starts: vec![0],
                path: file_path,
                total_len: 0,
            });
        }

        // Memory-map the file (zero copy — OS loads pages on demand)
        let mmap = unsafe { Mmap::map(&file) }
            .map_err(|e| format!("mmap failed: {}", e))?;

        // Initial state: one piece covering the entire original file
        let pieces = vec![Piece {
            source: PieceSource::Original,
            start: 0,
            length: file_len,
        }];

        // Build line index
        let line_starts = Self::build_line_index_from_bytes(&mmap);

        Ok(Self {
            original: Some(mmap),
            additions: String::new(),
            pieces,
            line_starts,
            path: file_path,
            total_len: file_len,
        })
    }

    fn build_line_index_from_bytes(data: &[u8]) -> Vec<usize> {
        let mut starts = vec![0usize];
        for (i, &byte) in data.iter().enumerate() {
            if byte == b'\n' && i + 1 < data.len() {
                starts.push(i + 1);
            }
        }
        starts
    }

    /// Materialize a byte range from the piece table
    fn slice(&self, byte_offset: usize, length: usize) -> String {
        let mut result = String::with_capacity(length);
        let mut remaining = length;
        let mut pos = 0;

        for piece in &self.pieces {
            if pos + piece.length <= byte_offset {
                pos += piece.length;
                continue;
            }

            let piece_start = if byte_offset > pos { byte_offset - pos } else { 0 };
            let piece_available = piece.length - piece_start;
            let to_take = remaining.min(piece_available);

            let data_start = piece.start + piece_start;
            let data_end = data_start + to_take;

            match piece.source {
                PieceSource::Original => {
                    if let Some(ref mmap) = self.original {
                        let bytes = &mmap[data_start..data_end];
                        result.push_str(&String::from_utf8_lossy(bytes));
                    }
                }
                PieceSource::Add => {
                    if data_end <= self.additions.len() {
                        result.push_str(&self.additions[data_start..data_end]);
                    }
                }
            }

            remaining -= to_take;
            pos += piece.length;

            if remaining == 0 {
                break;
            }
        }

        result
    }

    /// Get a range of lines (0-indexed, inclusive start, exclusive end)
    fn get_lines(&self, start_line: usize, end_line: usize) -> Vec<String> {
        let mut lines = Vec::new();
        let total_lines = self.line_count();

        let start = start_line.min(total_lines);
        let end = end_line.min(total_lines);

        // For simplicity in v1, materialize the full text and split
        // (In v2, we'd use the line index with the piece table directly)
        let full = self.materialize();
        let all_lines: Vec<&str> = full.lines().collect();

        for i in start..end {
            if i < all_lines.len() {
                lines.push(all_lines[i].to_string());
            }
        }

        lines
    }

    /// Materialize the full document (for save operations)
    fn materialize(&self) -> String {
        self.slice(0, self.total_len)
    }

    /// Insert text at a byte offset
    fn insert(&mut self, offset: usize, text: &str) {
        let add_start = self.additions.len();
        self.additions.push_str(text);
        let new_piece = Piece {
            source: PieceSource::Add,
            start: add_start,
            length: text.len(),
        };

        // Find which piece to split
        let mut pos = 0;
        let mut insert_idx = self.pieces.len();

        for (i, piece) in self.pieces.iter().enumerate() {
            if pos + piece.length >= offset {
                if offset == pos {
                    // Insert before this piece
                    insert_idx = i;
                } else if offset == pos + piece.length {
                    // Insert after this piece
                    insert_idx = i + 1;
                } else {
                    // Split this piece
                    let split_point = offset - pos;
                    let left = Piece {
                        source: piece.source,
                        start: piece.start,
                        length: split_point,
                    };
                    let right = Piece {
                        source: piece.source,
                        start: piece.start + split_point,
                        length: piece.length - split_point,
                    };
                    self.pieces.splice(i..=i, [left, new_piece, right]);
                    self.total_len += text.len();
                    self.rebuild_line_index();
                    return;
                }
                break;
            }
            pos += piece.length;
        }

        self.pieces.insert(insert_idx, new_piece);
        self.total_len += text.len();
        self.rebuild_line_index();
    }

    /// Delete a range of bytes
    fn delete(&mut self, offset: usize, length: usize) {
        let delete_end = offset + length;
        let mut new_pieces = Vec::new();
        let mut pos = 0;

        for piece in &self.pieces {
            let piece_end = pos + piece.length;

            if piece_end <= offset || pos >= delete_end {
                // Outside delete range — keep as-is
                new_pieces.push(piece.clone());
            } else {
                // Partially or fully in delete range
                if pos < offset {
                    // Keep left portion
                    new_pieces.push(Piece {
                        source: piece.source,
                        start: piece.start,
                        length: offset - pos,
                    });
                }
                if piece_end > delete_end {
                    // Keep right portion
                    let skip = delete_end - pos;
                    new_pieces.push(Piece {
                        source: piece.source,
                        start: piece.start + skip,
                        length: piece.length - skip,
                    });
                }
            }

            pos += piece.length;
        }

        self.pieces = new_pieces;
        self.total_len -= length;
        self.rebuild_line_index();
    }

    fn line_count(&self) -> usize {
        self.line_starts.len()
    }

    fn rebuild_line_index(&mut self) {
        let full = self.materialize();
        self.line_starts = vec![0];
        for (i, ch) in full.bytes().enumerate() {
            if ch == b'\n' && i + 1 < full.len() {
                self.line_starts.push(i + 1);
            }
        }
    }
}

// ======================================================
// Buffer Manager
// ======================================================

pub struct BufferManager {
    buffers: HashMap<String, HelixBuffer>,
}

impl BufferManager {
    pub fn new() -> Self {
        Self {
            buffers: HashMap::new(),
        }
    }
}

// ======================================================
// Commands
// ======================================================

#[tauri::command]
pub fn cmd_open_large_file(
    file_path: String,
    state: tauri::State<AppState>,
) -> CmdResult<u64> {
    let buffer = match HelixBuffer::open(&file_path) {
        Ok(b) => b,
        Err(e) => return CmdResult::err(e),
    };

    let line_count = buffer.line_count() as u64;
    let mut manager = state.buffers.lock().unwrap();
    manager.buffers.insert(file_path, buffer);

    CmdResult::ok(line_count)
}

#[tauri::command]
pub fn cmd_get_lines(
    file_path: String,
    start_line: usize,
    end_line: usize,
    state: tauri::State<AppState>,
) -> CmdResult<Vec<String>> {
    let manager = state.buffers.lock().unwrap();
    match manager.buffers.get(&file_path) {
        Some(buffer) => CmdResult::ok(buffer.get_lines(start_line, end_line)),
        None => CmdResult::err("Buffer not found — open the file first"),
    }
}

#[tauri::command]
pub fn cmd_insert_text(
    file_path: String,
    offset: usize,
    text: String,
    state: tauri::State<AppState>,
) -> CmdResult<bool> {
    let mut manager = state.buffers.lock().unwrap();
    match manager.buffers.get_mut(&file_path) {
        Some(buffer) => {
            buffer.insert(offset, &text);
            CmdResult::ok(true)
        }
        None => CmdResult::err("Buffer not found"),
    }
}

#[tauri::command]
pub fn cmd_delete_range(
    file_path: String,
    offset: usize,
    length: usize,
    state: tauri::State<AppState>,
) -> CmdResult<bool> {
    let mut manager = state.buffers.lock().unwrap();
    match manager.buffers.get_mut(&file_path) {
        Some(buffer) => {
            buffer.delete(offset, length);
            CmdResult::ok(true)
        }
        None => CmdResult::err("Buffer not found"),
    }
}

#[tauri::command]
pub fn cmd_get_line_count(
    file_path: String,
    state: tauri::State<AppState>,
) -> CmdResult<usize> {
    let manager = state.buffers.lock().unwrap();
    match manager.buffers.get(&file_path) {
        Some(buffer) => CmdResult::ok(buffer.line_count()),
        None => CmdResult::err("Buffer not found"),
    }
} 
