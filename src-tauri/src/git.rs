use serde::{Deserialize, Serialize};
use std::process::Command;
use std::thread;

use crate::filesystem::CmdResult;

// ======================================================
// Types
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,       // "M", "A", "D", "?", "R", "C", "U"
    pub staged: bool,
    pub status_text: String,  // "modified", "added", "deleted", etc.
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<GitFileStatus>,
    pub is_repo: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

// ======================================================
// Helpers
// ======================================================

fn run_git(project_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(project_path)
        .args(args)
        .output()
        .map_err(|e| format!("git not found: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(stderr.trim().to_string())
    }
}

fn parse_status_code(code: &str) -> &str {
    match code {
        "M" => "modified",
        "A" => "added",
        "D" => "deleted",
        "R" => "renamed",
        "C" => "copied",
        "U" => "unmerged",
        "?" => "untracked",
        "!" => "ignored",
        _ => "unknown",
    }
}

// ======================================================
// Commands
// ======================================================

#[tauri::command]
pub fn cmd_git_status(project_path: String) -> CmdResult<GitStatus> {
    // Check if it's a git repo
    if run_git(&project_path, &["rev-parse", "--git-dir"]).is_err() {
        return CmdResult::ok(GitStatus {
            branch: String::new(),
            ahead: 0,
            behind: 0,
            files: vec![],
            is_repo: false,
        });
    }

    // Get branch name
    let branch = run_git(&project_path, &["branch", "--show-current"])
        .unwrap_or_default()
        .trim()
        .to_string();

    // Get ahead/behind
    let mut ahead = 0;
    let mut behind = 0;
    if let Ok(ab) = run_git(&project_path, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) {
        let parts: Vec<&str> = ab.trim().split_whitespace().collect();
        if parts.len() == 2 {
            ahead = parts[0].parse().unwrap_or(0);
            behind = parts[1].parse().unwrap_or(0);
        }
    }

    // Get file statuses
    let status_output = run_git(&project_path, &["status", "--porcelain=v1"])
        .unwrap_or_default();

    let mut files = Vec::new();
    for line in status_output.lines() {
        if line.len() < 4 { continue; }
        let index_status = &line[0..1];
        let work_status = &line[1..2];
        let file_path = line[3..].trim().to_string();

        // Determine the display status
        let (status, staged) = if index_status != " " && index_status != "?" {
            (index_status.to_string(), true)
        } else {
            let s = if work_status == "?" { "?" } else { work_status };
            (s.to_string(), false)
        };

        files.push(GitFileStatus {
            status_text: parse_status_code(&status).to_string(),
            path: file_path,
            status,
            staged,
        });
    }

    CmdResult::ok(GitStatus {
        branch,
        ahead,
        behind,
        files,
        is_repo: true,
    })
}

#[tauri::command]
pub fn cmd_git_stage(project_path: String, file_path: String) -> CmdResult<bool> {
    run_git(&project_path, &["add", &file_path])
        .map(|_| CmdResult::ok(true))
        .unwrap_or_else(|e| CmdResult::err(e))
}

#[tauri::command]
pub fn cmd_git_unstage(project_path: String, file_path: String) -> CmdResult<bool> {
    run_git(&project_path, &["restore", "--staged", &file_path])
        .map(|_| CmdResult::ok(true))
        .unwrap_or_else(|e| CmdResult::err(e))
}

#[tauri::command]
pub fn cmd_git_stage_all(project_path: String) -> CmdResult<bool> {
    run_git(&project_path, &["add", "-A"])
        .map(|_| CmdResult::ok(true))
        .unwrap_or_else(|e| CmdResult::err(e))
}

#[tauri::command]
pub fn cmd_git_commit(project_path: String, message: String) -> CmdResult<String> {
    match run_git(&project_path, &["commit", "-m", &message]) {
        Ok(output) => CmdResult::ok(output.trim().to_string()),
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_git_push(project_path: String) -> CmdResult<String> {
    match run_git(&project_path, &["push"]) {
        Ok(output) => CmdResult::ok(output.trim().to_string()),
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_git_pull(project_path: String) -> CmdResult<String> {
    match run_git(&project_path, &["pull"]) {
        Ok(output) => CmdResult::ok(output.trim().to_string()),
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_git_log(project_path: String, count: Option<usize>) -> CmdResult<Vec<GitLogEntry>> {
    let count_str = format!("-{}", count.unwrap_or(50));
    let format = "--pretty=format:%H||%h||%s||%an||%ar";

    match run_git(&project_path, &["log", &count_str, format]) {
        Ok(output) => {
            let entries: Vec<GitLogEntry> = output
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.splitn(5, "||").collect();
                    if parts.len() == 5 {
                        Some(GitLogEntry {
                            hash: parts[0].to_string(),
                            short_hash: parts[1].to_string(),
                            message: parts[2].to_string(),
                            author: parts[3].to_string(),
                            date: parts[4].to_string(),
                        })
                    } else {
                        None
                    }
                })
                .collect();
            CmdResult::ok(entries)
        }
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_git_diff(project_path: String, file_path: Option<String>) -> CmdResult<String> {
    let mut args = vec!["diff", "--no-color"];
    let fp;
    if let Some(ref f) = file_path {
        fp = f.clone();
        args.push("--");
        args.push(&fp);
    }
    match run_git(&project_path, &args) {
        Ok(output) => CmdResult::ok(output),
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_git_branches(project_path: String) -> CmdResult<Vec<GitBranch>> {
    match run_git(&project_path, &["branch", "--list"]) {
        Ok(output) => {
            let branches: Vec<GitBranch> = output
                .lines()
                .map(|line| {
                    let current = line.starts_with('*');
                    let name = line.trim_start_matches('*').trim().to_string();
                    GitBranch { name, current }
                })
                .collect();
            CmdResult::ok(branches)
        }
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_git_checkout(project_path: String, branch: String) -> CmdResult<bool> {
    run_git(&project_path, &["checkout", &branch])
        .map(|_| CmdResult::ok(true))
        .unwrap_or_else(|e| CmdResult::err(e))
}

#[tauri::command]
pub fn cmd_git_discard(project_path: String, file_path: String) -> CmdResult<bool> {
    run_git(&project_path, &["checkout", "--", &file_path])
        .map(|_| CmdResult::ok(true))
        .unwrap_or_else(|e| CmdResult::err(e))
}

// Returns the full unified diff of the *staged* changes. Used by the AI
// commit-message generator — the model reads this to produce a concise
// subject line. Separate from `cmd_git_diff` because that one reports the
// unstaged working tree.
#[tauri::command]
pub fn cmd_git_diff_staged(project_path: String) -> CmdResult<String> {
    match run_git(&project_path, &["diff", "--cached", "--no-color"]) {
        Ok(output) => CmdResult::ok(output),
        Err(e) => CmdResult::err(e),
    }
}

// ======================================================
// Consolidated summary — runs status, log, branches in parallel.
// Cuts a typical panel refresh from ~6-10 sequential subprocess
// spawns down to 3 concurrent ones with a single IPC round-trip.
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitSummary {
    pub status: GitStatus,
    pub log: Vec<GitLogEntry>,
    pub branches: Vec<GitBranch>,
}

#[tauri::command]
pub fn cmd_git_summary(
    project_path: String,
    log_count: Option<usize>,
    include_log: Option<bool>,
    include_branches: Option<bool>,
) -> CmdResult<GitSummary> {
    let want_log = include_log.unwrap_or(true);
    let want_branches = include_branches.unwrap_or(true);
    let count = log_count.unwrap_or(20);

    // Spawn threads so the three (potentially slow) subprocess calls
    // overlap instead of serializing.
    let pp_status = project_path.clone();
    let t_status = thread::spawn(move || cmd_git_status(pp_status));

    let t_log = if want_log {
        let pp = project_path.clone();
        Some(thread::spawn(move || cmd_git_log(pp, Some(count))))
    } else {
        None
    };

    let t_branches = if want_branches {
        let pp = project_path.clone();
        Some(thread::spawn(move || cmd_git_branches(pp)))
    } else {
        None
    };

    let status_res = t_status.join().unwrap_or_else(|_| CmdResult::<GitStatus>::err("status thread panicked"));
    let status = match status_res.data {
        Some(s) => s,
        None => {
            return CmdResult::err(status_res.error.unwrap_or_else(|| "git status failed".into()));
        }
    };

    let log = if let Some(h) = t_log {
        h.join().ok().and_then(|r| r.data).unwrap_or_default()
    } else {
        Vec::new()
    };

    let branches = if let Some(h) = t_branches {
        h.join().ok().and_then(|r| r.data).unwrap_or_default()
    } else {
        Vec::new()
    };

    CmdResult::ok(GitSummary { status, log, branches })
}

// ======================================================
// PR context — everything needed to generate a PR description.
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrContext {
    pub current_branch: String,
    pub base_branch: String,
    pub commits: Vec<GitLogEntry>,
    pub diff: String,
    pub files_changed: Vec<String>,
}

fn detect_base_branch(project_path: &str) -> String {
    // Prefer "main", fall back to "master", else empty.
    for candidate in &["main", "master"] {
        if run_git(
            project_path,
            &["rev-parse", "--verify", &format!("refs/heads/{}", candidate)],
        )
        .is_ok()
        {
            return candidate.to_string();
        }
    }
    // Last resort: try origin/HEAD, which is the remote default branch.
    if let Ok(out) = run_git(project_path, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        if let Some(name) = out.trim().split('/').last() {
            return name.to_string();
        }
    }
    String::from("main")
}

fn current_branch_name(project_path: &str) -> Result<String, String> {
    let name = run_git(project_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(name.trim().to_string())
}

/// Assemble the diff + commit log + branch names needed to generate a PR
/// description. Uses `base...HEAD` (three-dot) so the diff is against the
/// merge-base — i.e. only the commits this branch actually introduces,
/// not anything that landed on base after divergence.
#[tauri::command]
pub fn cmd_git_pr_context(
    project_path: String,
    base_branch: Option<String>,
) -> CmdResult<PrContext> {
    let current = match current_branch_name(&project_path) {
        Ok(b) => b,
        Err(e) => return CmdResult::err(format!("Cannot read current branch: {}", e)),
    };

    let base = base_branch
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| detect_base_branch(&project_path));

    if current == base {
        return CmdResult::err(format!(
            "You are on the base branch ({}). Checkout a feature branch first.",
            base
        ));
    }

    let range = format!("{}...HEAD", base);

    // Commit log (newest first)
    let format = "--pretty=format:%H||%h||%s||%an||%ar";
    let log_output = match run_git(&project_path, &["log", &range, format]) {
        Ok(o) => o,
        Err(e) => return CmdResult::err(format!("git log failed: {}", e)),
    };
    let commits: Vec<GitLogEntry> = log_output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, "||").collect();
            if parts.len() == 5 {
                Some(GitLogEntry {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    date: parts[4].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    // Diff (limited to a reasonable size — the prompt clipper will trim
    // further if needed).
    let diff = run_git(&project_path, &["diff", "--no-color", &range]).unwrap_or_default();

    // Files changed (unique, stable order)
    let files_raw = run_git(&project_path, &["diff", "--name-only", &range]).unwrap_or_default();
    let files_changed: Vec<String> = files_raw
        .lines()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .collect();

    CmdResult::ok(PrContext {
        current_branch: current,
        base_branch: base,
        commits,
        diff,
        files_changed,
    })
}
