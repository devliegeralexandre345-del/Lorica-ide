use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tokio::process::Command as AsyncCommand;
use dirs;

use crate::filesystem::CmdResult;

// ======================================================
// Types
// ======================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Extension {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub category: String,        // "debugger" | "language" | "theme" | "tool"
    pub languages: Vec<String>,  // supported languages
    pub installed: bool,
    pub install_cmd: Option<String>,  // command to install
    pub install_note: Option<String>, // helpful note when install_cmd is None
    pub binary: Option<String>,       // path to binary when installed
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DebugConfig {
    pub name: String,
    pub language: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DebugOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

// ======================================================
// Binary detection utilities
// ======================================================

/// Search for a binary in common installation paths
fn find_binary(binary_name: &str) -> Option<String> {
    // First try which/where in PATH
    let cmd = if cfg!(target_os = "windows") {
        Command::new("where").arg(binary_name).output()
    } else {
        Command::new("which").arg(binary_name).output()
    };
    
    if let Ok(output) = cmd {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout);
            let first_path = path.lines().next().map(|s| s.trim().to_string());
            if let Some(p) = first_path {
                return Some(p);
            }
        }
    }

    // Check common installation paths
    let common_paths: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            PathBuf::from(r"C:\Program Files\LLVM\bin"),
            PathBuf::from(r"C:\msys64\usr\bin"),
            PathBuf::from(r"C:\msys64\mingw64\bin"),
            PathBuf::from(r"C:\mingw\bin"),
            PathBuf::from(r"C:\mingw64\bin"),
            PathBuf::from(r"C:\Program Files\Git\usr\bin"),
            PathBuf::from(r"C:\Program Files\nodejs"),
            PathBuf::from(r"C:\Users").join(std::env::var("USERNAME").unwrap_or_default()).join(r".cargo\bin"),
            PathBuf::from(r"C:\ProgramData\chocolatey\bin"),
            // Lorica-managed tools (netcoredbg, etc.)
            dirs::data_local_dir()
                .unwrap_or_default()
                .join("Lorica").join("tools").join("netcoredbg"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/opt/local/bin"),
            PathBuf::from("/usr/local/opt/llvm/bin"),
            dirs::home_dir().map(|h| h.join(".cargo/bin")).unwrap_or_default(),
            dirs::home_dir().map(|h| h.join(".local/bin")).unwrap_or_default(),
        ]
    } else { // linux
        vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/snap/bin"),
            PathBuf::from("/opt/bin"),
            PathBuf::from("/usr/lib/llvm-*/bin"),
            dirs::home_dir().map(|h| h.join(".cargo/bin")).unwrap_or_default(),
            dirs::home_dir().map(|h| h.join(".local/bin")).unwrap_or_default(),
        ]
    };

    for path in common_paths {
        let full_path = path.join(binary_name);
        if full_path.exists() {
            return Some(full_path.to_string_lossy().to_string());
        }
    }

    None
}

// ======================================================
// Extension Registry
// ======================================================

fn get_extensions_dir() -> PathBuf {
    let dir = directories::ProjectDirs::from("com", "Lorica", "Lorica")
        .map(|d| d.data_dir().join("extensions"))
        .unwrap_or_else(|| PathBuf::from(".Lorica/extensions"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn get_registry() -> Vec<Extension> {
    let ext_dir = get_extensions_dir();

    let mut exts = vec![
        // === DEBUGGERS ===
        Extension {
            id: "debugger-python".into(),
            name: "Python Debugger (debugpy)".into(),
            description: "Debug Python scripts with breakpoints, step-through, and variable inspection".into(),
            version: "1.8.0".into(),
            category: "debugger".into(),
            languages: vec!["python".into()],
            installed: false,
            install_cmd: Some("pip install debugpy".into()),
            install_note: None,
            binary: Some("python".into()),
        },
        Extension {
            id: "debugger-cpp".into(),
            name: "C/C++ Debugger (LLDB/GDB)".into(),
            description: "Debug C and C++ programs with LLDB (Windows/macOS) or GDB (Linux)".into(),
            version: "14.0".into(),
            category: "debugger".into(),
            languages: vec!["c".into(), "cpp".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                // --accept flags make winget fully non-interactive
                "winget install -e --id LLVM.LLVM --accept-source-agreements --accept-package-agreements --disable-interactivity".into()
            } else if cfg!(target_os = "linux") {
                "sudo apt-get install -y gdb lldb".into()
            } else {
                "brew install llvm".into()
            }),
            install_note: Some("Windows: installe LLVM/LLDB. Linux: installe gdb+lldb. macOS: installe LLVM via Homebrew.".into()),
            // Windows LLVM provides lldb.exe (not gdb), Linux/macOS use gdb or lldb
            binary: Some(if cfg!(target_os = "windows") {
                "lldb.exe".into()
            } else if cfg!(target_os = "linux") {
                "gdb".into()
            } else {
                "lldb".into()
            }),
        },
        Extension {
            id: "debugger-rust".into(),
            name: "Rust Debugger (LLDB)".into(),
            description: "Debug Rust programs via LLDB with Cargo integration".into(),
            version: "1.0".into(),
            category: "debugger".into(),
            languages: vec!["rust".into()],
            installed: false,
            install_cmd: Some("rustup component add rust-analyzer llvm-tools-preview".into()),
            install_note: Some("Installs rust-analyzer and LLVM tools for debugging".into()),
            binary: Some(if cfg!(target_os = "windows") { "rust-lldb.exe" } else { "rust-lldb" }.into()),
        },
        Extension {
            id: "debugger-csharp".into(),
            name: "C# Debugger (netcoredbg)".into(),
            description: "Debug .NET et C# avec Samsung netcoredbg (DAP)".into(),
            version: "3.1".into(),
            category: "debugger".into(),
            languages: vec!["csharp".into()],
            installed: false,
            // netcoredbg is NOT a dotnet global tool — it is a standalone binary
            // distributed via GitHub releases (Samsung/netcoredbg).
            install_cmd: Some(if cfg!(target_os = "windows") {
                // Download latest win64 zip from GitHub and extract to %LOCALAPPDATA%\Lorica\tools\netcoredbg\
                concat!(
                    "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"",
                    "$r = Invoke-RestMethod 'https://api.github.com/repos/Samsung/netcoredbg/releases/latest'; ",
                    "$u = ($r.assets | Where-Object { $_.name -eq 'netcoredbg-win64.zip' }).browser_download_url; ",
                    "$d = Join-Path $env:LOCALAPPDATA 'Lorica\\tools\\netcoredbg'; ",
                    "New-Item -Force -ItemType Directory $d | Out-Null; ",
                    "$t = Join-Path $env:TEMP 'netcoredbg.zip'; ",
                    "Invoke-WebRequest $u -OutFile $t -UseBasicParsing; ",
                    "Expand-Archive -Force $t -DestinationPath $d; ",
                    "Write-Output ('Installed to ' + $d)\""
                ).into()
            } else if cfg!(target_os = "linux") {
                concat!(
                    "VER=$(curl -s 'https://api.github.com/repos/Samsung/netcoredbg/releases/latest' | grep -oP '(?<=\"tag_name\":\")([^\"]+)'); ",
                    "curl -L \"https://github.com/Samsung/netcoredbg/releases/download/$VER/netcoredbg-linux-amd64.tar.gz\" ",
                    "| sudo tar xz -C /usr/local/bin"
                ).into()
            } else {
                // macOS
                concat!(
                    "VER=$(curl -s 'https://api.github.com/repos/Samsung/netcoredbg/releases/latest' | grep -oE '\"tag_name\":\"[^\"]+\"' | cut -d'\"' -f4); ",
                    "curl -L \"https://github.com/Samsung/netcoredbg/releases/download/$VER/netcoredbg-osx-amd64.tar.gz\" ",
                    "| sudo tar xz -C /usr/local/bin"
                ).into()
            }),
            install_note: None,
            binary: Some(if cfg!(target_os = "windows") { "netcoredbg.exe" } else { "netcoredbg" }.into()),
        },
        Extension {
            id: "debugger-node".into(),
            name: "Node.js Debugger".into(),
            description: "Debug JavaScript and TypeScript with Node.js inspect protocol".into(),
            version: "1.0".into(),
            category: "debugger".into(),
            languages: vec!["javascript".into(), "typescript".into()],
            installed: false,
            install_cmd: None,
            install_note: Some("Node.js must be installed manually from nodejs.org".into()),
            binary: Some("node".into()),
        },
        Extension {
            id: "debugger-go".into(),
            name: "Go Debugger (Delve)".into(),
            description: "Debug Go programs with Delve".into(),
            version: "1.22".into(),
            category: "debugger".into(),
            languages: vec!["go".into()],
            installed: false,
            install_cmd: Some("go install github.com/go-delve/delve/cmd/dlv@latest".into()),
            install_note: None,
            binary: Some("dlv".into()),
        },
        // === TOOLS ===
        Extension {
            id: "tool-prettier".into(),
            name: "Prettier — Code Formatter".into(),
            description: "Format JS, TS, CSS, HTML, JSON, Markdown automatically".into(),
            version: "3.2".into(),
            category: "tool".into(),
            languages: vec!["javascript".into(), "typescript".into(), "css".into(), "html".into(), "json".into(), "markdown".into()],
            installed: false,
            install_cmd: Some("npm install -g prettier".into()),
            install_note: None,
            binary: Some("prettier".into()),
        },
        Extension {
            id: "tool-eslint".into(),
            name: "ESLint — JS/TS Linter".into(),
            description: "Find and fix problems in JavaScript and TypeScript code".into(),
            version: "9.0".into(),
            category: "tool".into(),
            languages: vec!["javascript".into(), "typescript".into()],
            installed: false,
            install_cmd: Some("npm install -g eslint".into()),
            install_note: None,
            binary: Some("eslint".into()),
        },
        Extension {
            id: "tool-rustfmt".into(),
            name: "rustfmt — Rust Formatter".into(),
            description: "Format Rust code according to style guidelines".into(),
            version: "1.7".into(),
            category: "tool".into(),
            languages: vec!["rust".into()],
            installed: false,
            install_cmd: Some("rustup component add rustfmt".into()),
            install_note: None,
            binary: Some("rustfmt".into()),
        },
    ];

    // Check which are installed by looking for binaries
    for ext in &mut exts {
        if let Some(ref bin) = ext.binary {
            ext.installed = find_binary(bin).is_some();
        }

        // Also check marker file
        let marker = ext_dir.join(format!("{}.installed", ext.id));
        if marker.exists() {
            ext.installed = true;
        }
    }

    exts
}

// ======================================================
// Commands
// ======================================================

#[tauri::command]
pub fn cmd_list_extensions() -> CmdResult<Vec<Extension>> {
    CmdResult::ok(get_registry())
}

#[tauri::command]
pub async fn cmd_install_extension(id: String) -> CmdResult<String> {
    let registry = get_registry();
    let ext = match registry.iter().find(|e| e.id == id) {
        Some(e) => e,
        None => return CmdResult::err(format!("Extension not found: {}", id)),
    };

    if ext.installed {
        return CmdResult::ok("Already installed".into());
    }

    let install_cmd = match &ext.install_cmd {
        Some(cmd) => cmd.clone(),
        None => return CmdResult::err(format!("{} must be installed manually", ext.name)),
    };

    // Run install command async
    let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let output = AsyncCommand::new(shell)
        .args(&[flag, &install_cmd])
        .output()
        .await
        .map_err(|e| format!("Install failed: {}", e));

    match output {
        Ok(out) => {
            if out.status.success() {
                // Mark as installed
                let ext_dir = get_extensions_dir();
                let marker = ext_dir.join(format!("{}.installed", id));
                let _ = fs::write(&marker, chrono::Utc::now().to_rfc3339());
                CmdResult::ok(format!("{} installed successfully", ext.name))
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                CmdResult::err(format!("Install failed: {}", stderr.trim()))
            }
        }
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_uninstall_extension(id: String) -> CmdResult<bool> {
    let ext_dir = get_extensions_dir();
    let marker = ext_dir.join(format!("{}.installed", id));
    let _ = fs::remove_file(&marker);
    CmdResult::ok(true)
}

/// Run a program for debugging (captures stdout/stderr)
#[tauri::command]
pub fn cmd_debug_run(config: DebugConfig) -> CmdResult<DebugOutput> {
    let program = &config.program;

    // Use project path as cwd, or derive from file path
    let cwd = config.cwd.clone().unwrap_or_else(|| {
        // Extract parent directory from the program path
        std::path::Path::new(program)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    // Get just the filename for compilers
    let filename = std::path::Path::new(program)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| program.clone());

    // Determine how to run based on language
    let (cmd, args) = match config.language.as_str() {
        "python" => {
            let py = if cfg!(target_os = "windows") { "python" } else { "python3" };
            (py.to_string(), {
                let mut a = vec![program.clone()];
                a.extend(config.args);
                a
            })
        },
        "javascript" | "typescript" => ("node".to_string(), {
            let mut a = vec![program.clone()];
            a.extend(config.args);
            a
        }),
        "rust" => ("cargo".to_string(), {
            let mut a = vec!["run".to_string()];
            if !config.args.is_empty() {
                a.push("--".to_string());
                a.extend(config.args);
            }
            a
        }),
        "cpp" | "c" => {
            // Compile first in the file's directory
            let out_name = if cfg!(target_os = "windows") { "lorica_debug.exe" } else { "./lorica_debug" };
            let compiler = if config.language == "c" { "gcc" } else { "g++" };

            log::info!("Compiling {} with {} in {}", filename, compiler, cwd);

            let compile = Command::new(compiler)
                .args(&[filename.as_str(), "-o", out_name, "-g", "-std=c++17"])
                .current_dir(&cwd)
                .output();

            match compile {
                Ok(c) if c.status.success() => {
                    log::info!("Compilation successful, running {}", out_name);
                    (out_name.to_string(), config.args)
                },
                Ok(c) => {
                    return CmdResult::ok(DebugOutput {
                        stdout: String::from_utf8_lossy(&c.stdout).to_string(),
                        stderr: format!("Compilation failed:\n{}", String::from_utf8_lossy(&c.stderr)),
                        exit_code: Some(c.status.code().unwrap_or(1)),
                    });
                }
                Err(e) => return CmdResult::ok(DebugOutput {
                    stdout: String::new(),
                    stderr: format!("Compiler '{}' not found: {}\n\nInstall MinGW or MSVC Build Tools.", compiler, e),
                    exit_code: Some(127),
                }),
            }
        }
        "csharp" => ("dotnet".to_string(), {
            let mut a = vec!["run".to_string()];
            a.extend(config.args);
            a
        }),
        "go" => ("go".to_string(), {
            let mut a = vec!["run".to_string(), program.clone()];
            a.extend(config.args);
            a
        }),
        _ => (program.clone(), config.args),
    };

    let mut command = Command::new(&cmd);
    command.args(&args).current_dir(&cwd);

    for (k, v) in &config.env {
        command.env(k, v);
    }

    match command.output() {
        Ok(output) => CmdResult::ok(DebugOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: Some(output.status.code().unwrap_or(-1)),
        }),
        Err(e) => CmdResult::ok(DebugOutput {
            stdout: String::new(),
            stderr: format!("Failed to run '{}': {}", cmd, e),
            exit_code: Some(127),
        }),
    }
}

