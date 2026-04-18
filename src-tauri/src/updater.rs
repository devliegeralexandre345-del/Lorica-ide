//! Auto-updater backed by GitHub Releases.
//!
//! Design:
//! - Query `repos/<owner>/<repo>/releases/latest` with a short timeout.
//! - Compare the release tag against `CARGO_PKG_VERSION` using a lenient
//!   semver compare (tolerates a leading `v`).
//! - Pick the asset matching the current platform (Windows/macOS/Linux).
//! - Stream the installer to a temp file, emitting `update:progress` events
//!   so the UI can show a real progress bar.
//! - Launch the installer in a platform-appropriate way.
//!
//! Errors from `check_for_update` bubble up to the frontend instead of being
//! silently dropped — the frontend chooses whether to toast or log.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/devliegeralexandre345-del/Lorica-ide/releases/latest";

/// GitHub Release asset structure
#[derive(Debug, Deserialize, Serialize, Clone)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

/// GitHub Release structure
#[derive(Debug, Deserialize, Serialize, Clone)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

/// Release info exposed to the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub download_url: String,
    pub body: String,
    pub published_at: String,
    pub size: u64,
    pub asset_name: String,
}

/// Progress event payload emitted during download.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: u8,
}

/// Compares two semantic version strings (format "1.2.3" or "v1.2.3").
/// Returns true if `new` > `current`.
fn is_newer_version(current: &str, new: &str) -> bool {
    fn normalize(v: &str) -> &str {
        v.trim_start_matches('v').trim()
    }
    let current_parts: Vec<u32> = normalize(current)
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let new_parts: Vec<u32> = normalize(new)
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    for (c, n) in current_parts.iter().zip(new_parts.iter()) {
        if n > c {
            return true;
        } else if n < c {
            return false;
        }
    }
    new_parts.len() > current_parts.len()
}

/// Fetches the latest release from GitHub.
async fn fetch_latest_release() -> Result<GitHubRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    let response = client
        .get(GITHUB_RELEASES_URL)
        .header("User-Agent", "Lorica-Updater")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!("GitHub API {} — {}", status, snippet));
    }

    response
        .json::<GitHubRelease>()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))
}

/// Picks the installer asset for the current platform.
/// Returns `None` if no suitable asset is found.
fn find_platform_asset(release: &GitHubRelease) -> Option<&GitHubAsset> {
    #[cfg(target_os = "windows")]
    let preferred: &[&str] = &[".msi", ".exe"];
    #[cfg(target_os = "macos")]
    let preferred: &[&str] = &[".dmg", ".app.tar.gz", ".pkg"];
    #[cfg(target_os = "linux")]
    let preferred: &[&str] = &[".AppImage", ".deb", ".rpm"];
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let preferred: &[&str] = &[];

    for ext in preferred {
        if let Some(asset) = release
            .assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(&ext.to_lowercase()))
        {
            return Some(asset);
        }
    }
    None
}

fn release_to_info(release: GitHubRelease, asset: &GitHubAsset) -> ReleaseInfo {
    ReleaseInfo {
        version: release.tag_name.trim_start_matches('v').to_string(),
        download_url: asset.browser_download_url.clone(),
        body: release.body,
        published_at: release.published_at,
        size: asset.size,
        asset_name: asset.name.clone(),
    }
}

/// Returns the running app version (from Cargo.toml at build time).
#[tauri::command]
pub fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Checks GitHub Releases for a newer version.
///
/// `Ok(Some(_))` — newer release found.
/// `Ok(None)`    — up to date.
/// `Err(_)`      — check failed (network, rate limit, parse error…). The
///                 frontend decides whether to show this or stay quiet.
#[tauri::command]
pub async fn check_for_update() -> Result<Option<ReleaseInfo>, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let release = fetch_latest_release().await?;

    if !is_newer_version(current_version, &release.tag_name) {
        return Ok(None);
    }

    let asset = find_platform_asset(&release).ok_or_else(|| {
        format!(
            "No installer asset found for this platform in release {}",
            release.tag_name
        )
    })?;

    Ok(Some(release_to_info(release.clone(), asset)))
}

/// Downloads the installer with streaming + progress events, then launches
/// it in a platform-specific manner.
///
/// Emits `update:progress` events with `{ downloaded, total, percent }`.
#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    let response = client
        .get(&download_url)
        .header("User-Agent", "Lorica-Updater")
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let temp_dir = std::env::temp_dir();
    let file_name = download_url
        .split('/')
        .last()
        .filter(|n| !n.is_empty())
        .unwrap_or("lorica-installer.bin");
    let installer_path = temp_dir.join(file_name);

    let mut file = File::create(&installer_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_percent: i16 = -1;

    // Emit a starting event so the UI can switch to progress mode immediately.
    let _ = app.emit(
        "update:progress",
        DownloadProgress {
            downloaded: 0,
            total,
            percent: 0,
        },
    );

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        file.write_all(&bytes)
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += bytes.len() as u64;

        let percent: i16 = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0) as i16
        } else {
            0
        };
        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "update:progress",
                DownloadProgress {
                    downloaded,
                    total,
                    percent: percent as u8,
                },
            );
        }
    }

    file.flush().map_err(|e| format!("Flush error: {}", e))?;
    drop(file);
    log::info!(
        "Installer downloaded to {:?} ({} bytes)",
        installer_path,
        downloaded
    );

    // Emit final 100% so the UI can transition to "launching" state.
    let _ = app.emit(
        "update:progress",
        DownloadProgress {
            downloaded,
            total: if total > 0 { total } else { downloaded },
            percent: 100,
        },
    );

    let path_str = installer_path
        .to_str()
        .ok_or_else(|| String::from("Invalid installer path"))?;

    launch_installer(path_str, &installer_path)?;
    log::info!("Installer launched: {}", path_str);
    Ok(())
}

#[cfg(target_os = "windows")]
fn launch_installer(path_str: &str, _path: &std::path::Path) -> Result<(), String> {
    // `cmd /C start "" "<path>"` detaches the child so the installer survives
    // our process exiting — needed because the installer will want to
    // overwrite our binary.
    Command::new("cmd")
        .args(["/C", "start", "", path_str])
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {}", e))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_installer(path_str: &str, _path: &std::path::Path) -> Result<(), String> {
    Command::new("open")
        .arg(path_str)
        .spawn()
        .map_err(|e| format!("Failed to open installer: {}", e))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn launch_installer(path_str: &str, path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if path_str.to_lowercase().ends_with(".appimage") {
        let metadata = std::fs::metadata(path)
            .map_err(|e| format!("Stat failed: {}", e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("chmod failed: {}", e))?;
        Command::new(path_str)
            .spawn()
            .map_err(|e| format!("Launch failed: {}", e))?;
    } else {
        Command::new("xdg-open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("xdg-open failed: {}", e))?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn launch_installer(_path_str: &str, _path: &std::path::Path) -> Result<(), String> {
    Err("Automatic installation is not supported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer_version() {
        assert!(is_newer_version("1.1.0", "1.2.0"));
        assert!(is_newer_version("1.1.0", "2.0.0"));
        assert!(is_newer_version("1.1.0", "1.1.1"));
        assert!(!is_newer_version("1.2.0", "1.1.0"));
        assert!(!is_newer_version("1.2.0", "1.2.0"));
        assert!(is_newer_version("v1.1.0", "v1.2.0"));
        assert!(is_newer_version("1.1.0", "v1.2.0"));
        // Longer version wins when equal prefix
        assert!(is_newer_version("1.2.3", "1.2.3.1"));
    }
}
