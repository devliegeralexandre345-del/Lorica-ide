// src-tauri/src/devcontainer.rs
//
// First-pass dev-container support — Wave 8 of the v2.3 roadmap.
// Read-only "open shell in container" parity, no LSP/DAP forwarding,
// no port forwarding, no remote VS Code-style file editing. The user
// reads .devcontainer/devcontainer.json or .devcontainer.json (the two
// canonical locations the spec defines), we surface name + image, and
// the frontend constructs a `docker run` command for an interactive
// shell when the user clicks the badge.
//
// We deliberately don't implement the full devcontainer spec parser
// here. The fields we need are a small subset: `name` (display label),
// `image` (the simple case, ~70% of repos), and `dockerComposeFile`
// (compose-based — a hint for the UI, not actually launchable from
// this v1). Build-from-Dockerfile (`build`) is detected and reported
// so the UI can say "build-based config not yet supported".
//
// Comment-stripping: devcontainer.json is technically jsonc, so we
// strip `// line` and `/* block */` comments before serde_json parse.
// Cheap regex; not a full jsonc parser, but covers what teams write.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::filesystem::CmdResult;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DevContainerInfo {
    pub config_path: String,
    pub name: Option<String>,
    pub image: Option<String>,
    pub workspace_folder: Option<String>,
    /// Set when devcontainer.json declares `dockerComposeFile`. Compose
    /// flows aren't supported in v1 — reported so the UI can warn.
    pub compose_file: Option<String>,
    /// Set when devcontainer.json declares a `build` block (Dockerfile
    /// + build args). v1 doesn't trigger builds — reported so the UI
    /// can warn.
    pub has_build: bool,
}

#[tauri::command]
pub fn cmd_devcontainer_detect(project_path: String) -> CmdResult<Option<DevContainerInfo>> {
    let candidates = [
        format!("{}/.devcontainer/devcontainer.json", project_path),
        format!("{}/.devcontainer.json", project_path),
    ];
    for path in &candidates {
        if !Path::new(path).is_file() { continue; }
        let raw = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let cleaned = strip_jsonc_comments(&raw);
        let parsed: serde_json::Value = match serde_json::from_str(&cleaned) {
            Ok(v) => v,
            Err(e) => {
                return CmdResult::err(format!(
                    "{}: invalid JSON ({})",
                    path, e
                ));
            }
        };
        let obj = parsed.as_object();
        let info = DevContainerInfo {
            config_path: path.clone(),
            name: obj
                .and_then(|o| o.get("name"))
                .and_then(|v| v.as_str())
                .map(String::from),
            image: obj
                .and_then(|o| o.get("image"))
                .and_then(|v| v.as_str())
                .map(String::from),
            workspace_folder: obj
                .and_then(|o| o.get("workspaceFolder"))
                .and_then(|v| v.as_str())
                .map(String::from),
            compose_file: obj
                .and_then(|o| o.get("dockerComposeFile"))
                .and_then(|v| {
                    if let Some(s) = v.as_str() {
                        Some(s.to_string())
                    } else if let Some(arr) = v.as_array() {
                        arr.first().and_then(|x| x.as_str()).map(String::from)
                    } else {
                        None
                    }
                }),
            has_build: obj.and_then(|o| o.get("build")).is_some(),
        };
        return CmdResult::ok(Some(info));
    }
    CmdResult::ok(None)
}

// Tiny jsonc → json normalizer. Not a full parser — strings can contain
// `//` or `/*` and we shouldn't strip those — so we walk the input
// character by character with a simple state machine. Tracks whether
// we're inside a string literal (with backslash-aware skipping) before
// honouring comment markers.
pub fn strip_jsonc_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let bytes = src.as_bytes();
    let mut i = 0;
    let mut in_string = false;
    let mut escape = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            out.push(b as char);
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        // Line comment: // ... \n
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' { i += 1; }
            continue;
        }
        // Block comment: /* ... */
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') { i += 1; }
            // Step past the closing */
            if i + 1 < bytes.len() { i += 2; } else { break; }
            continue;
        }
        out.push(b as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_basic_line_comment() {
        let s = "{\n  // comment\n  \"a\": 1\n}";
        assert_eq!(strip_jsonc_comments(s), "{\n  \n  \"a\": 1\n}");
    }

    #[test]
    fn keep_doubleslash_inside_string() {
        let s = r#"{"url": "http://example.com"}"#;
        assert_eq!(strip_jsonc_comments(s), s);
    }

    #[test]
    fn strip_block_comment() {
        let s = "{\n /* block\n    spans lines */ \"a\": 1\n}";
        let expected = "{\n  \"a\": 1\n}";
        assert_eq!(strip_jsonc_comments(s), expected);
    }

    // String escaping: an escaped quote inside a string should NOT end
    // the string (and thus not flip us back into "comments are real"
    // mode). This was the most likely bug source when I wrote the
    // state machine — pinning it.
    #[test]
    fn escaped_quote_inside_string_keeps_string_state() {
        let s = r#"{"v": "say \"hi\" // not a comment"}"#;
        assert_eq!(strip_jsonc_comments(s), s);
    }

    // Block-comment markers inside a string must survive untouched.
    #[test]
    fn block_marker_inside_string_is_literal() {
        let s = r#"{"a": "/* not a comment */"}"#;
        assert_eq!(strip_jsonc_comments(s), s);
    }

    // Unterminated block comment at EOF: state machine must NOT panic
    // and must consume the rest of the input rather than emit half.
    #[test]
    fn unterminated_block_comment_is_swallowed() {
        let s = "{\n  \"a\": 1 /* never closed";
        let out = strip_jsonc_comments(s);
        assert!(out.starts_with("{\n  \"a\": 1 "));
        // No `/*` survives in the output.
        assert!(!out.contains("/*"));
    }

    // The whole pipeline: detect parses the cleaned blob into the
    // expected struct fields.
    #[test]
    fn detect_parses_image_and_name_from_jsonc() {
        let dir = std::env::temp_dir().join(format!("lorica-dc-test-{}", std::process::id()));
        let inner = dir.join(".devcontainer");
        std::fs::create_dir_all(&inner).unwrap();
        let cfg = r#"{
            // dev container for the docs site
            "name": "Docs",
            "image": "node:20-bullseye",
            "workspaceFolder": "/workspaces/docs"
        }"#;
        std::fs::write(inner.join("devcontainer.json"), cfg).unwrap();

        let res = cmd_devcontainer_detect(dir.to_string_lossy().to_string());
        assert!(res.success, "detect should succeed: {:?}", res.error);
        let info = res.data.expect("Some(info)").expect("inner Some");
        assert_eq!(info.name.as_deref(), Some("Docs"));
        assert_eq!(info.image.as_deref(), Some("node:20-bullseye"));
        assert_eq!(info.workspace_folder.as_deref(), Some("/workspaces/docs"));
        assert!(!info.has_build);
        assert!(info.compose_file.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // No devcontainer.json at all → returns Ok(None), not an error.
    // The caller relies on this to decide "hide the badge" vs "show an
    // error toast".
    #[test]
    fn detect_returns_none_when_no_config() {
        let dir = std::env::temp_dir().join(format!("lorica-dc-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let res = cmd_devcontainer_detect(dir.to_string_lossy().to_string());
        assert!(res.success);
        assert!(res.data.expect("Some").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
