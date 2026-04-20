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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitBlameLine {
    pub line: usize,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub summary: String,
    pub is_uncommitted: bool,
}

// Per-file churn stats over a time window. Used by the Code Heatmap to
// colour-tint the file tree. A single `GitChurn` describes one file.
//
// `authors` is a compact per-author breakdown: name → commit count in
// the window. We don't track lines-per-author because it balloons the
// response for big repos and is rarely more useful than commit count.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GitChurn {
    pub path: String,
    pub commits: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub last_change: String,
    pub authors: Vec<(String, u32)>, // sorted descending by commit count
}

// ======================================================
// Helpers
// ======================================================

// Heuristic branch name validation. `git check-ref-format` has the full
// rules; we cover the common dangerous shapes here to reject input that
// would otherwise be interpreted as a command-line flag or shell trick.
// This is belt-and-braces — args never go through a shell — but it
// also catches cases where the string leaks into error messages / diff
// output unexpectedly.
fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() { return Err("Empty branch name".into()); }
    if name.starts_with('-') { return Err("Branch name cannot start with '-'".into()); }
    if name.contains("..") || name.contains('\0') || name.contains("@{") {
        return Err("Illegal character in branch name".into());
    }
    for c in name.chars() {
        if c.is_control() || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\') {
            return Err(format!("Illegal character '{}' in branch name", c));
        }
    }
    Ok(())
}

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
    // `--` stops git from parsing any further arg as a flag — defends
    // against pathological filenames like `--exec=rm`.
    run_git(&project_path, &["add", "--", &file_path])
        .map(|_| CmdResult::ok(true))
        .unwrap_or_else(|e| CmdResult::err(e))
}

#[tauri::command]
pub fn cmd_git_unstage(project_path: String, file_path: String) -> CmdResult<bool> {
    run_git(&project_path, &["restore", "--staged", "--", &file_path])
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
    if let Err(e) = validate_branch_name(&branch) {
        return CmdResult::err(e);
    }
    // `--` before the ref stops git from parsing `-something` as an option.
    run_git(&project_path, &["checkout", "--", &branch])
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

// ======================================================
// git blame — per-line authorship lookup
// ======================================================
//
// We use `git blame --line-porcelain` and parse each "HEAD" chunk. The
// porcelain output is stable across git versions and easy to parse line-by-
// line without shelling out to a diff tool per line.
//
// For performance: we only return a compact row per source line (hash,
// author, date, summary). Uncommitted lines surface as `is_uncommitted: true`
// with hash "0000000" — the frontend renders them in an accent color.

#[tauri::command]
pub fn cmd_git_blame(project_path: String, file_path: String) -> CmdResult<Vec<GitBlameLine>> {
    // `--` separator — filenames starting with `-` are not flags.
    let output = match run_git(
        &project_path,
        &["blame", "--line-porcelain", "--date=short", "--", &file_path],
    ) {
        Ok(o) => o,
        Err(e) => return CmdResult::err(format!("git blame failed: {}", e)),
    };

    let mut result: Vec<GitBlameLine> = Vec::new();
    let mut line_num: usize = 0;
    let mut cur_hash = String::new();
    let mut cur_author = String::new();
    let mut cur_date = String::new();
    let mut cur_summary = String::new();

    for raw in output.lines() {
        if raw.starts_with('\t') {
            // Source code line — this marks the end of the metadata block.
            let is_zero = cur_hash.chars().all(|c| c == '0');
            result.push(GitBlameLine {
                line: line_num,
                short_hash: cur_hash.chars().take(7).collect(),
                author: cur_author.clone(),
                date: cur_date.clone(),
                summary: cur_summary.clone(),
                is_uncommitted: is_zero,
            });
            continue;
        }

        // Header line: "<hash> <orig_line> <final_line> [<group_size>]"
        if !raw.is_empty() && raw.chars().next().map(|c| c.is_ascii_hexdigit()).unwrap_or(false)
            && raw.split_whitespace().count() >= 3
        {
            let parts: Vec<&str> = raw.split_whitespace().collect();
            if parts[0].len() >= 7 && parts[0].chars().all(|c| c.is_ascii_hexdigit()) {
                cur_hash = parts[0].to_string();
                if let Some(ln) = parts.get(2).and_then(|s| s.parse::<usize>().ok()) {
                    line_num = ln;
                }
                continue;
            }
        }

        if let Some(rest) = raw.strip_prefix("author ") {
            cur_author = rest.to_string();
        } else if let Some(rest) = raw.strip_prefix("author-time ") {
            // We prefer the short date set by --date=short, but fall back to
            // unix time formatted roughly if author-time is all we see.
            if cur_date.is_empty() {
                cur_date = rest.to_string();
            }
        } else if let Some(rest) = raw.strip_prefix("committer-time ") {
            if cur_date.is_empty() {
                cur_date = rest.to_string();
            }
        } else if let Some(rest) = raw.strip_prefix("summary ") {
            cur_summary = rest.to_string();
        } else if let Some(rest) = raw.strip_prefix("author-mail ") {
            // Useful fallback when `author` is empty (rare).
            if cur_author.is_empty() {
                cur_author = rest.trim_matches(|c| c == '<' || c == '>').to_string();
            }
        }
    }

    CmdResult::ok(result)
}

// ======================================================
// git churn — per-file activity over a time window
// ======================================================
//
// We call `git log --since=<days> --numstat --pretty=format:%H|%at` and
// stream-parse the output. Each commit block looks like:
//
//     <hash>|<unix_timestamp>
//     10  3  src/foo.rs
//     0   2  src/bar.rs
//     ...
//     <blank>
//     <hash>|<unix_timestamp>
//     ...
//
// We accumulate per-path totals in a single pass. Complexity is O(lines)
// in the log output. For a 5k-commit month-long window that's about 1 MB
// of text and ~20 ms on a warm disk.
//
// Renames appear as `M => N` — we attribute to the new path (`N`) so the
// heatmap reflects the current tree layout. If `git log` can't follow a
// rename (short history), the old path just stops getting hits, which is
// fine: heatmap recency is what the user cares about.

#[tauri::command]
pub fn cmd_git_churn(
    project_path: String,
    since_days: u32,
) -> CmdResult<Vec<GitChurn>> {
    let since = format!("{} days ago", since_days.max(1));
    // We encode the author name into the commit header so we can attribute
    // every numstat line to the person who wrote it. Format tokens:
    //   %H   — full hash
    //   %at  — author timestamp (unix)
    //   %an  — author name
    // Use `|` as separator — names with pipes are vanishingly rare; if
    // they happen, we just truncate at the first pipe.
    let pretty = "--pretty=format:%H|%at|%an";
    let output = match run_git(
        &project_path,
        &["log", &format!("--since={}", since), "--numstat", pretty],
    ) {
        Ok(o) => o,
        Err(e) => return CmdResult::err(format!("git log failed: {}", e)),
    };

    use std::collections::HashMap;
    let mut map: HashMap<String, GitChurn> = HashMap::new();
    let mut author_by_path: HashMap<String, HashMap<String, u32>> = HashMap::new();
    let mut cur_ts: String = String::new();
    let mut cur_author: String = String::new();

    for raw in output.lines() {
        let line = raw.trim_end();
        if line.is_empty() { continue; }

        // Commit header? Format: "<hash>|<timestamp>|<author>"
        if let Some(sep) = line.find('|') {
            let before = &line[..sep];
            let after = &line[sep + 1..];
            if before.len() >= 7 && before.chars().all(|c| c.is_ascii_hexdigit()) {
                // Split the remainder into timestamp + author.
                if let Some(sep2) = after.find('|') {
                    cur_ts = after[..sep2].to_string();
                    cur_author = after[sep2 + 1..].to_string();
                } else {
                    cur_ts = after.to_string();
                    cur_author = String::new();
                }
                continue;
            }
        }

        // Numstat line: "<added>\t<removed>\t<path>"
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() != 3 { continue; }
        // `-` means "binary file" for either field; treat as 0.
        let added: u32 = parts[0].parse().unwrap_or(0);
        let removed: u32 = parts[1].parse().unwrap_or(0);
        // Renames: "old => new" or "prefix/{old => new}/suffix"
        let mut path = parts[2].to_string();
        if let Some(arrow) = path.find(" => ") {
            // Simple rename form "old => new"
            if !path.contains('{') {
                path = path[arrow + 4..].to_string();
            } else {
                // Complex rename — find the brace segment and reconstruct.
                if let (Some(lb), Some(rb)) = (path.find('{'), path.find('}')) {
                    if lb < rb {
                        let mid = &path[lb + 1..rb];
                        if let Some(a) = mid.find(" => ") {
                            let new_mid = &mid[a + 4..];
                            let reconstructed = format!("{}{}{}", &path[..lb], new_mid, &path[rb + 1..]);
                            path = reconstructed.replace("//", "/");
                        }
                    }
                }
            }
        }

        let entry = map.entry(path.clone()).or_insert_with(|| GitChurn {
            path: path.clone(), ..Default::default()
        });
        entry.commits += 1;
        entry.lines_added += added;
        entry.lines_removed += removed;
        if entry.last_change.is_empty() || cur_ts > entry.last_change {
            entry.last_change = cur_ts.clone();
        }
        if !cur_author.is_empty() {
            let authors = author_by_path.entry(path).or_default();
            *authors.entry(cur_author.clone()).or_insert(0) += 1;
        }
    }

    // Fold per-author tallies into each GitChurn entry, sorted desc by commits.
    for (path, entry) in map.iter_mut() {
        if let Some(authors) = author_by_path.get(path) {
            let mut list: Vec<(String, u32)> = authors.iter()
                .map(|(n, c)| (n.clone(), *c))
                .collect();
            list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            entry.authors = list;
        }
    }

    let mut out: Vec<GitChurn> = map.into_values().collect();
    // Stable order so the frontend can diff cheaply between calls.
    out.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.path.cmp(&b.path)));
    CmdResult::ok(out)
}

// ======================================================
// git worktree — parallel isolation for Swarm Development
// ======================================================
//
// Swarm agents work in parallel on different aspects of a feature. To
// keep them from stepping on each other's writes we hand each agent its
// own git worktree — a separate directory on disk sharing the same .git
// object store. The orchestrator:
//   1. Calls cmd_git_worktree_add() per sub-task, each on a fresh branch
//   2. Agents write to the worktree's path
//   3. When all sub-tasks finish, caller runs cmd_git_worktree_merge()
//      which does a sequential `git merge --no-ff` for each branch and
//      reports conflicts
//   4. cmd_git_worktree_remove() cleans up
//
// Worktree branches are namespaced with a "lorica/swarm/<id>/" prefix so
// they're easy to identify and GC.

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head: String,
}

#[tauri::command]
pub fn cmd_git_worktree_add(
    project_path: String,
    task_id: String,
    base_ref: Option<String>,
) -> CmdResult<WorktreeInfo> {
    // Aggressively sanitize the task-id so the constructed branch name
    // can never smuggle in a git ref pattern, whitespace, or a dash.
    let clean_id: String = task_id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let branch = format!("lorica/swarm/{}", clean_id.trim_matches('-'));
    if let Err(e) = validate_branch_name(&branch) {
        return CmdResult::err(e);
    }
    // Base ref might be any revision; reject shell-y inputs defensively.
    if let Some(br) = &base_ref {
        if br.starts_with('-') || br.contains('\0') {
            return CmdResult::err("Illegal base-ref");
        }
    }
    // Worktree lives next to the project in a hidden dir.
    let parent = std::path::Path::new(&project_path)
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_string_lossy()
        .to_string();
    let leaf = std::path::Path::new(&project_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    let wt_path = format!("{}/.lorica-worktrees/{}-{}", parent, leaf, branch.replace('/', "-"));

    // Ensure parent dir exists.
    let _ = std::fs::create_dir_all(format!("{}/.lorica-worktrees", parent));

    let base = base_ref.unwrap_or_else(|| "HEAD".to_string());
    match run_git(&project_path, &["worktree", "add", "-b", &branch, &wt_path, &base]) {
        Ok(_) => {}
        Err(e) => {
            // If branch exists, try plain add without -b.
            if e.contains("already exists") || e.contains("already used") {
                let _ = run_git(&project_path, &["worktree", "add", &wt_path, &branch]);
            } else {
                return CmdResult::err(format!("worktree add failed: {}", e));
            }
        }
    }
    let head = run_git(&wt_path, &["rev-parse", "HEAD"]).unwrap_or_default().trim().to_string();
    CmdResult::ok(WorktreeInfo { path: wt_path, branch, head })
}

#[tauri::command]
pub fn cmd_git_worktree_remove(
    project_path: String,
    worktree_path: String,
    force: bool,
) -> CmdResult<bool> {
    let args: Vec<&str> = if force {
        vec!["worktree", "remove", "--force", &worktree_path]
    } else {
        vec!["worktree", "remove", &worktree_path]
    };
    match run_git(&project_path, &args) {
        Ok(_) => CmdResult::ok(true),
        Err(e) => CmdResult::err(format!("worktree remove failed: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_git_worktree_list(project_path: String) -> CmdResult<Vec<String>> {
    match run_git(&project_path, &["worktree", "list", "--porcelain"]) {
        Ok(s) => {
            let mut out = Vec::new();
            for line in s.lines() {
                if let Some(path) = line.strip_prefix("worktree ") { out.push(path.to_string()); }
            }
            CmdResult::ok(out)
        }
        Err(e) => CmdResult::err(e),
    }
}

// Merge a list of Swarm branches back into the current branch sequentially.
// Returns a per-branch outcome so the UI can surface conflicts.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorktreeMergeResult {
    pub branch: String,
    pub ok: bool,
    pub conflicts: Vec<String>,
    pub message: String,
}

#[tauri::command]
pub fn cmd_git_worktree_merge(
    project_path: String,
    branches: Vec<String>,
) -> CmdResult<Vec<WorktreeMergeResult>> {
    let mut results = Vec::new();
    for branch in branches {
        // Be conservative: try a clean merge, abort on conflict so the
        // user's working tree stays safe. The caller can decide how to
        // reconcile.
        match run_git(&project_path, &["merge", "--no-ff", "--no-edit", &branch]) {
            Ok(msg) => {
                results.push(WorktreeMergeResult { branch, ok: true, conflicts: vec![], message: msg.lines().take(3).collect::<Vec<_>>().join(" ") });
            }
            Err(err) => {
                // Parse conflict paths from `git status` to tell the user
                // exactly what collided.
                let status = run_git(&project_path, &["status", "--porcelain"]).unwrap_or_default();
                let conflicts: Vec<String> = status.lines()
                    .filter(|l| l.starts_with("UU ") || l.starts_with("AA ") || l.starts_with("DD "))
                    .map(|l| l[3..].to_string())
                    .collect();
                // Abort so the next branch can still be attempted.
                let _ = run_git(&project_path, &["merge", "--abort"]);
                results.push(WorktreeMergeResult { branch: branch.clone(), ok: false, conflicts, message: err });
            }
        }
    }
    CmdResult::ok(results)
}
