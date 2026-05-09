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
        let local_app = dirs::data_local_dir().unwrap_or_default();
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
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
            // Toolchain-installed LSP binaries.
            PathBuf::from(&user_profile).join(".dotnet").join("tools"),  // csharp-ls
            PathBuf::from(&user_profile).join("go").join("bin"),         // gopls
            PathBuf::from(&appdata).join("npm"),                         // npm globals (Windows default)
            PathBuf::from(&user_profile).join("AppData").join("Roaming").join("Python").join("Python311").join("Scripts"),
            PathBuf::from(&user_profile).join("AppData").join("Roaming").join("Python").join("Python312").join("Scripts"),
            PathBuf::from(&user_profile).join("AppData").join("Roaming").join("Python").join("Python313").join("Scripts"),
            // Lorica-managed tools (netcoredbg, elixir-ls, kotlin-ls).
            local_app.join("Lorica").join("tools").join("netcoredbg"),
            local_app.join("Lorica").join("tools").join("elixir-ls"),
            local_app.join("Lorica").join("tools").join("kotlin-language-server"),
            local_app.join("Lorica").join("tools").join("kotlin-language-server").join("server").join("bin"),
        ]
    } else if cfg!(target_os = "macos") {
        let home = dirs::home_dir().unwrap_or_default();
        vec![
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/opt/local/bin"),
            PathBuf::from("/usr/local/opt/llvm/bin"),
            home.join(".cargo/bin"),
            home.join(".local/bin"),
            // Toolchain-installed LSP binaries.
            home.join(".dotnet/tools"),         // csharp-ls
            home.join("go/bin"),                // gopls
            home.join(".npm-global/bin"),       // npm globals if user set prefix
            home.join("Library/Python/3.11/bin"),
            home.join("Library/Python/3.12/bin"),
            home.join("Library/Python/3.13/bin"),
            // LSPs that drop into a subfolder of ~/.local/bin.
            home.join(".local/bin/elixir-ls"),
            home.join(".local/bin/kotlin-language-server/server/bin"),
            // `gem install --user-install` puts solargraph here.
            home.join(".gem/bin"),
            home.join(".gem/ruby/bin"),
        ]
    } else { // linux
        let home = dirs::home_dir().unwrap_or_default();
        vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/snap/bin"),
            PathBuf::from("/opt/bin"),
            PathBuf::from("/usr/lib/llvm-*/bin"),
            home.join(".cargo/bin"),
            home.join(".local/bin"),
            // Toolchain-installed LSP binaries.
            home.join(".dotnet/tools"),         // csharp-ls
            home.join("go/bin"),                // gopls
            home.join(".npm-global/bin"),       // npm globals if user set prefix
            // LSPs that drop into a subfolder of ~/.local/bin.
            home.join(".local/bin/elixir-ls"),
            home.join(".local/bin/kotlin-language-server/server/bin"),
            home.join(".local/bin/lua-language-server/bin"),
            // `gem install --user-install` puts solargraph here.
            home.join(".gem/bin"),
            home.join(".gem/ruby/bin"),
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
        // === LANGUAGE SERVERS (LSP) ===
        // Each entry uses category="language". `binary` is the executable
        // name `find_binary()` walks PATH looking for. `install_cmd` is
        // shelled out by `cmd_install_extension` — embed toolchain
        // pre-checks directly so the user gets an actionable
        // `XXX_MISSING:` marker rather than a cryptic "command not found".
        Extension {
            id: "lsp-python".into(),
            name: "Python Language Server (pylsp)".into(),
            description: "Type-aware completion, hover, and diagnostics for Python (.py)".into(),
            version: "1.10".into(),
            category: "language".into(),
            languages: vec!["python".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                // brackets aren't special on cmd.exe — DON'T quote `[all]`,
                // re-quoting via Command::args produces literal `""...""` which
                // pip rejects as "Invalid requirement".
                "where python >nul 2>&1 || where py >nul 2>&1 || (echo PYTHON_MISSING:Install Python from https://python.org & exit /b 1) && (python -m pip install --user python-lsp-server[all] || py -m pip install --user python-lsp-server[all])".into()
            } else if cfg!(target_os = "linux") {
                // Debian/Ubuntu need --break-system-packages since PEP 668.
                "command -v python3 >/dev/null 2>&1 || { echo 'PYTHON_MISSING:Install Python first: sudo apt-get install -y python3 python3-pip'; exit 1; }; python3 -m pip install --user --break-system-packages 'python-lsp-server[all]' 2>/dev/null || python3 -m pip install --user 'python-lsp-server[all]'".into()
            } else {
                "command -v python3 >/dev/null 2>&1 || { echo 'PYTHON_MISSING:Install Python first: brew install python'; exit 1; }; python3 -m pip install --user 'python-lsp-server[all]'".into()
            }),
            install_note: None,
            binary: Some("pylsp".into()),
        },
        Extension {
            id: "lsp-typescript".into(),
            name: "TypeScript / JavaScript Language Server".into(),
            description: "IntelliSense, refactor, and diagnostics for TypeScript and JavaScript (.ts/.tsx/.js/.jsx)".into(),
            version: "4.3".into(),
            category: "language".into(),
            languages: vec!["typescript".into(), "javascript".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where npm >nul 2>&1 || (echo NODE_MISSING:Install Node.js from https://nodejs.org/ & exit /b 1) && npm install -g typescript typescript-language-server".into()
            } else {
                "command -v npm >/dev/null 2>&1 || { echo 'NODE_MISSING:Install Node.js from https://nodejs.org/'; exit 1; }; npm install -g typescript typescript-language-server".into()
            }),
            install_note: None,
            binary: Some("typescript-language-server".into()),
        },
        Extension {
            id: "lsp-rust".into(),
            name: "Rust Analyzer".into(),
            description: "Type inference, completion, and inlay hints for Rust (.rs)".into(),
            version: "0.4".into(),
            category: "language".into(),
            languages: vec!["rust".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where rustup >nul 2>&1 || (echo RUSTUP_MISSING:Install rustup from https://rustup.rs/ & exit /b 1) && rustup component add rust-analyzer".into()
            } else {
                "command -v rustup >/dev/null 2>&1 || { echo 'RUSTUP_MISSING:Install rustup from https://rustup.rs/'; exit 1; }; rustup component add rust-analyzer".into()
            }),
            install_note: None,
            binary: Some("rust-analyzer".into()),
        },
        Extension {
            id: "lsp-go".into(),
            name: "Go Language Server (gopls)".into(),
            description: "Completion, refactor, and diagnostics for Go (.go)".into(),
            version: "0.18".into(),
            category: "language".into(),
            languages: vec!["go".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where go >nul 2>&1 || (echo GO_MISSING:Install Go from https://go.dev/ & exit /b 1) && go install golang.org/x/tools/gopls@latest".into()
            } else {
                "command -v go >/dev/null 2>&1 || { echo 'GO_MISSING:Install Go from https://go.dev/'; exit 1; }; go install golang.org/x/tools/gopls@latest".into()
            }),
            install_note: None,
            binary: Some("gopls".into()),
        },
        Extension {
            id: "lsp-clangd".into(),
            name: "C/C++ Language Server (clangd)".into(),
            description: "Cross-file navigation, code actions, and diagnostics for C/C++ (.c/.cpp/.h/.hpp)".into(),
            version: "18".into(),
            category: "language".into(),
            languages: vec!["c".into(), "cpp".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                // LLVM bundles clangd. winget package is `LLVM.LLVM`.
                "winget install -e --id LLVM.LLVM --accept-source-agreements --accept-package-agreements --disable-interactivity".into()
            } else if cfg!(target_os = "linux") {
                "command -v apt-get >/dev/null 2>&1 && sudo apt-get install -y clangd || { echo 'Install clangd manually: see https://clangd.llvm.org/installation'; exit 1; }".into()
            } else {
                "command -v brew >/dev/null 2>&1 || { echo 'Install Homebrew first: https://brew.sh/'; exit 1; }; brew install llvm".into()
            }),
            install_note: None,
            binary: Some("clangd".into()),
        },
        Extension {
            id: "lsp-csharp".into(),
            name: "C# Language Server (csharp-ls)".into(),
            description: "Completion and diagnostics for C# (.cs). Auto-bootstraps the .NET SDK if missing.".into(),
            version: "0.18".into(),
            category: "language".into(),
            languages: vec!["csharp".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                // Auto-bootstrap .NET SDK via Microsoft's official script
                // (no admin required — installs to %USERPROFILE%\.dotnet),
                // then install csharp-ls as a global tool.
                concat!(
                    "where dotnet >nul 2>&1 || (",
                    "  powershell -NoProfile -ExecutionPolicy Bypass -Command \"",
                    "    & ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://dot.net/v1/dotnet-install.ps1').Content)) -InstallDir \"$env:USERPROFILE\\.dotnet\" -Channel LTS",
                    "  \"",
                    ") && set \"PATH=%USERPROFILE%\\.dotnet;%USERPROFILE%\\.dotnet\\tools;%PATH%\" && dotnet tool install --global csharp-ls"
                ).into()
            } else {
                concat!(
                    "command -v dotnet >/dev/null 2>&1 || { ",
                    "  curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --install-dir \"$HOME/.dotnet\" --channel LTS; ",
                    "}; export PATH=\"$HOME/.dotnet:$HOME/.dotnet/tools:$PATH\"; dotnet tool install --global csharp-ls"
                ).into()
            }),
            install_note: None,
            binary: Some("csharp-ls".into()),
        },
        Extension {
            id: "lsp-web".into(),
            name: "HTML / CSS / JSON Language Servers".into(),
            description: "VS Code's web language servers — HTML, CSS, JSON in one package".into(),
            version: "4.10".into(),
            category: "language".into(),
            languages: vec!["html".into(), "css".into(), "json".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where npm >nul 2>&1 || (echo NODE_MISSING:Install Node.js from https://nodejs.org/ & exit /b 1) && npm install -g vscode-langservers-extracted".into()
            } else {
                "command -v npm >/dev/null 2>&1 || { echo 'NODE_MISSING:Install Node.js from https://nodejs.org/'; exit 1; }; npm install -g vscode-langservers-extracted".into()
            }),
            install_note: None,
            binary: Some("vscode-html-language-server".into()),
        },
        Extension {
            id: "lsp-php".into(),
            name: "PHP Language Server (intelephense)".into(),
            description: "PHP completion, refactor, and diagnostics".into(),
            version: "1.12".into(),
            category: "language".into(),
            languages: vec!["php".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where npm >nul 2>&1 || (echo NODE_MISSING:Install Node.js from https://nodejs.org/ & exit /b 1) && npm install -g intelephense".into()
            } else {
                "command -v npm >/dev/null 2>&1 || { echo 'NODE_MISSING:Install Node.js from https://nodejs.org/'; exit 1; }; npm install -g intelephense".into()
            }),
            install_note: None,
            binary: Some("intelephense".into()),
        },
        Extension {
            id: "lsp-sql".into(),
            name: "SQL Language Server".into(),
            description: "SQL completion and linting (PostgreSQL, MySQL, SQLite)".into(),
            version: "1.4".into(),
            category: "language".into(),
            languages: vec!["sql".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where npm >nul 2>&1 || (echo NODE_MISSING:Install Node.js from https://nodejs.org/ & exit /b 1) && npm install -g sql-language-server".into()
            } else {
                "command -v npm >/dev/null 2>&1 || { echo 'NODE_MISSING:Install Node.js from https://nodejs.org/'; exit 1; }; npm install -g sql-language-server".into()
            }),
            install_note: None,
            binary: Some("sql-language-server".into()),
        },
        Extension {
            id: "lsp-java".into(),
            name: "Java Language Server (jdtls)".into(),
            description: "Eclipse JDT — Java completion, refactor, and diagnostics".into(),
            version: "1.30".into(),
            category: "language".into(),
            languages: vec!["java".into()],
            installed: false,
            install_cmd: None, // jdtls install is non-trivial cross-platform; show guide
            install_note: Some(concat!(
                "Install jdtls manually:\n",
                "• macOS: brew install jdtls\n",
                "• Linux: sudo apt-get install jdtls (or download from eclipse.org/jdtls/)\n",
                "• Windows: download from https://download.eclipse.org/jdtls/snapshots/ and unpack to your PATH.\n",
                "Requires Java 17+."
            ).into()),
            binary: Some("jdtls".into()),
        },
        Extension {
            id: "lsp-ruby".into(),
            name: "Ruby Language Server (solargraph)".into(),
            description: "IntelliSense, hover, and diagnostics for Ruby (.rb)".into(),
            version: "0.50".into(),
            category: "language".into(),
            languages: vec!["ruby".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                // Pre-check `gem` so we surface a friendly install hint
                // instead of "'gem' is not recognized".
                "where gem >nul 2>&1 || (echo RUBY_MISSING:Install Ruby from https://rubyinstaller.org/ then re-run & exit /b 1) && gem install --user-install solargraph".into()
            } else if cfg!(target_os = "linux") {
                "command -v gem >/dev/null 2>&1 || { echo 'RUBY_MISSING:Install Ruby first: sudo apt-get install -y ruby-full'; exit 1; }; gem install --user-install solargraph".into()
            } else {
                "command -v gem >/dev/null 2>&1 || { echo 'RUBY_MISSING:Install Ruby first: brew install ruby'; exit 1; }; gem install --user-install solargraph".into()
            }),
            install_note: None,
            binary: Some("solargraph".into()),
        },
        Extension {
            id: "lsp-bash".into(),
            name: "Bash Language Server".into(),
            description: "Shellcheck-powered diagnostics and completion for Bash (.sh)".into(),
            version: "5.1".into(),
            category: "language".into(),
            languages: vec!["bash".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                "where npm >nul 2>&1 || (echo NODE_MISSING:Install Node.js from https://nodejs.org/ & exit /b 1) && npm install -g bash-language-server".into()
            } else {
                "command -v npm >/dev/null 2>&1 || { echo 'NODE_MISSING:Install Node.js from https://nodejs.org/'; exit 1; }; npm install -g bash-language-server".into()
            }),
            install_note: None,
            binary: Some("bash-language-server".into()),
        },
        Extension {
            id: "lsp-lua".into(),
            name: "Lua Language Server (sumneko)".into(),
            description: "Type-aware diagnostics and completion for Lua (.lua)".into(),
            version: "3.7".into(),
            category: "language".into(),
            languages: vec!["lua".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                // winget ships sumneko's lua-language-server.
                "winget install -e --id LuaLS.lua-language-server --accept-source-agreements --accept-package-agreements --disable-interactivity".into()
            } else if cfg!(target_os = "linux") {
                // apt has it on recent distros; otherwise download the
                // GitHub release tarball into ~/.local/bin/lua-language-server/.
                concat!(
                    "if command -v apt-get >/dev/null 2>&1 && apt-cache show lua-language-server >/dev/null 2>&1; then ",
                    "  sudo apt-get install -y lua-language-server; ",
                    "else ",
                    "  mkdir -p \"$HOME/.local/bin/lua-language-server\" && ",
                    "  VER=$(curl -s 'https://api.github.com/repos/LuaLS/lua-language-server/releases/latest' | grep -oE '\"tag_name\":\"[^\"]+\"' | cut -d'\"' -f4) && ",
                    "  curl -L \"https://github.com/LuaLS/lua-language-server/releases/download/$VER/lua-language-server-$VER-linux-x64.tar.gz\" ",
                    "  | tar xz -C \"$HOME/.local/bin/lua-language-server\" && ",
                    "  ln -sf \"$HOME/.local/bin/lua-language-server/bin/lua-language-server\" \"$HOME/.local/bin/lua-language-server-bin\"; ",
                    "fi"
                ).into()
            } else {
                "brew install lua-language-server".into()
            }),
            install_note: None,
            binary: Some("lua-language-server".into()),
        },
        Extension {
            id: "lsp-elixir".into(),
            name: "Elixir Language Server (elixir-ls)".into(),
            description: "Compile-on-save diagnostics, completion, and hover for Elixir (.ex/.exs)".into(),
            version: "0.20".into(),
            category: "language".into(),
            languages: vec!["elixir".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                concat!(
                    "where elixir >nul 2>&1 || (echo ELIXIR_MISSING:Install Elixir from https://elixir-lang.org/install.html & exit /b 1) && ",
                    "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"",
                    "$r = Invoke-RestMethod 'https://api.github.com/repos/elixir-lsp/elixir-ls/releases/latest'; ",
                    "$u = ($r.assets | Where-Object { $_.name -like 'elixir-ls-*.zip' } | Select-Object -First 1).browser_download_url; ",
                    "$d = Join-Path $env:LOCALAPPDATA 'Lorica\\tools\\elixir-ls'; ",
                    "New-Item -Force -ItemType Directory $d | Out-Null; ",
                    "$t = Join-Path $env:TEMP 'elixir-ls.zip'; ",
                    "Invoke-WebRequest $u -OutFile $t -UseBasicParsing; ",
                    "Expand-Archive -Force $t -DestinationPath $d; ",
                    "Write-Output ('Installed to ' + $d)\""
                ).into()
            } else {
                // Linux + macOS: drop the release zip into ~/.local/bin/elixir-ls/
                concat!(
                    "command -v elixir >/dev/null 2>&1 || { echo 'ELIXIR_MISSING:Install Elixir first: https://elixir-lang.org/install.html'; exit 1; }; ",
                    "mkdir -p \"$HOME/.local/bin/elixir-ls\" && ",
                    "VER=$(curl -s 'https://api.github.com/repos/elixir-lsp/elixir-ls/releases/latest' | grep -oE '\"tag_name\":\"[^\"]+\"' | cut -d'\"' -f4) && ",
                    "curl -L \"https://github.com/elixir-lsp/elixir-ls/releases/download/$VER/elixir-ls-$VER.zip\" -o /tmp/elixir-ls.zip && ",
                    "unzip -o /tmp/elixir-ls.zip -d \"$HOME/.local/bin/elixir-ls\" && ",
                    "chmod +x \"$HOME/.local/bin/elixir-ls/language_server.sh\" && ",
                    "ln -sf \"$HOME/.local/bin/elixir-ls/language_server.sh\" \"$HOME/.local/bin/elixir-ls\""
                ).into()
            }),
            install_note: None,
            binary: Some(if cfg!(target_os = "windows") {
                "language_server.bat".into()
            } else {
                "elixir-ls".into()
            }),
        },
        Extension {
            id: "lsp-dart".into(),
            name: "Dart Language Server".into(),
            description: "Built-in `dart language-server` (Dart SDK) for Dart (.dart)".into(),
            version: "3.4".into(),
            category: "language".into(),
            languages: vec!["dart".into()],
            installed: false,
            // Dart's LSP is bundled with the SDK and shipped via
            // `dart language-server` — there's no separate binary to
            // install. So this entry is documentation-only: if the user
            // doesn't have `dart` we point them at the install page.
            install_cmd: None,
            install_note: Some(
                "Dart's language server ships with the Dart SDK. Install Dart from https://dart.dev/get-dart and ensure `dart` is on your PATH. The LSP launches via `dart language-server`.".into()
            ),
            binary: Some(if cfg!(target_os = "windows") { "dart.exe".into() } else { "dart".into() }),
        },
        Extension {
            id: "lsp-kotlin".into(),
            name: "Kotlin Language Server (fwcd)".into(),
            description: "Completion, hover, and diagnostics for Kotlin (.kt/.kts)".into(),
            version: "1.3".into(),
            category: "language".into(),
            languages: vec!["kotlin".into()],
            installed: false,
            install_cmd: Some(if cfg!(target_os = "windows") {
                concat!(
                    "where java >nul 2>&1 || (echo JAVA_MISSING:Install a Java 11+ JDK (e.g. https://adoptium.net/) & exit /b 1) && ",
                    "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"",
                    "$r = Invoke-RestMethod 'https://api.github.com/repos/fwcd/kotlin-language-server/releases/latest'; ",
                    "$u = ($r.assets | Where-Object { $_.name -eq 'server.zip' }).browser_download_url; ",
                    "$d = Join-Path $env:LOCALAPPDATA 'Lorica\\tools\\kotlin-language-server'; ",
                    "New-Item -Force -ItemType Directory $d | Out-Null; ",
                    "$t = Join-Path $env:TEMP 'kotlin-ls.zip'; ",
                    "Invoke-WebRequest $u -OutFile $t -UseBasicParsing; ",
                    "Expand-Archive -Force $t -DestinationPath $d; ",
                    "Write-Output ('Installed to ' + $d)\""
                ).into()
            } else {
                concat!(
                    "command -v java >/dev/null 2>&1 || { echo 'JAVA_MISSING:Install a Java 11+ JDK (e.g. https://adoptium.net/)'; exit 1; }; ",
                    "mkdir -p \"$HOME/.local/bin/kotlin-language-server\" && ",
                    "VER=$(curl -s 'https://api.github.com/repos/fwcd/kotlin-language-server/releases/latest' | grep -oE '\"tag_name\":\"[^\"]+\"' | cut -d'\"' -f4) && ",
                    "curl -L \"https://github.com/fwcd/kotlin-language-server/releases/download/$VER/server.zip\" -o /tmp/kotlin-ls.zip && ",
                    "unzip -o /tmp/kotlin-ls.zip -d \"$HOME/.local/bin/kotlin-language-server\" && ",
                    "chmod +x \"$HOME/.local/bin/kotlin-language-server/server/bin/kotlin-language-server\" && ",
                    "ln -sf \"$HOME/.local/bin/kotlin-language-server/server/bin/kotlin-language-server\" \"$HOME/.local/bin/kotlin-language-server\""
                ).into()
            }),
            install_note: None,
            binary: Some(if cfg!(target_os = "windows") {
                "kotlin-language-server.bat".into()
            } else {
                "kotlin-language-server".into()
            }),
        },
        Extension {
            id: "lsp-swift".into(),
            name: "Swift Language Server (sourcekit-lsp)".into(),
            description: "Apple's sourcekit-lsp for Swift (.swift). Ships with Swift toolchain.".into(),
            version: "5.10".into(),
            category: "language".into(),
            languages: vec!["swift".into()],
            installed: false,
            // sourcekit-lsp ships with the Swift toolchain. We can't
            // package-install it cleanly across OSes — direct the user
            // to swift.org instead. On Windows it's effectively
            // unsupported (no first-class sourcekit-lsp); we surface
            // that in the install_note.
            install_cmd: None,
            install_note: Some(if cfg!(target_os = "windows") {
                "sourcekit-lsp on Windows is experimental. Install the Swift toolchain from https://www.swift.org/install/windows/ and ensure `sourcekit-lsp.exe` is on your PATH.".into()
            } else if cfg!(target_os = "macos") {
                "sourcekit-lsp ships with Xcode. Run `xcode-select --install` if not already present, then verify with `xcrun -f sourcekit-lsp`.".into()
            } else {
                "Install the Swift toolchain from https://www.swift.org/install/linux/ — sourcekit-lsp is bundled with it.".into()
            }),
            binary: Some(if cfg!(target_os = "windows") {
                "sourcekit-lsp.exe".into()
            } else {
                "sourcekit-lsp".into()
            }),
        },

        // ----------------------------------------------------------------
        // MCP server marketplace (Wave 8 / V2.3 medium-tier).
        //
        // Surfaces a small curated catalog of well-known Model Context
        // Protocol servers in the Extensions panel so the user can
        // install them from one place. v1 only handles the install side
        // — the runtime that wires installed servers into the agent's
        // tool layer is queued for v2.4. We mark the category as `mcp`
        // so the UI can filter / badge them differently from LSPs and
        // debuggers.
        Extension {
            id: "mcp-filesystem".into(),
            name: "MCP — Filesystem".into(),
            description: "Anthropic's reference Filesystem MCP server (read/write files, list directories) for use as an agent tool.".into(),
            version: "latest".into(),
            category: "mcp".into(),
            languages: vec![],
            installed: false,
            install_cmd: Some("npm install -g @modelcontextprotocol/server-filesystem".into()),
            install_note: Some("Requires Node.js 18+. Once installed the binary is available as `mcp-server-filesystem`. Runtime wiring into the agent toolbox lands in v2.4.".into()),
            binary: Some("mcp-server-filesystem".into()),
        },
        Extension {
            id: "mcp-github".into(),
            name: "MCP — GitHub".into(),
            description: "Official GitHub MCP server. Exposes repos, issues, and PRs as agent tools (requires a GitHub PAT in the vault).".into(),
            version: "latest".into(),
            category: "mcp".into(),
            languages: vec![],
            installed: false,
            install_cmd: Some("npm install -g @modelcontextprotocol/server-github".into()),
            install_note: Some("Requires Node.js 18+. After install, store a GitHub PAT under `mcp.github.token` in the Lorica vault. Runtime wiring into the agent toolbox lands in v2.4.".into()),
            binary: Some("mcp-server-github".into()),
        },
        Extension {
            id: "mcp-postgres".into(),
            name: "MCP — Postgres".into(),
            description: "Read-only Postgres MCP server. Lets the agent run SELECT queries and inspect schemas, with no write access.".into(),
            version: "latest".into(),
            category: "mcp".into(),
            languages: vec![],
            installed: false,
            install_cmd: Some("npm install -g @modelcontextprotocol/server-postgres".into()),
            install_note: Some("Requires Node.js 18+. Configure the connection URL once installed. Runtime wiring into the agent toolbox lands in v2.4.".into()),
            binary: Some("mcp-server-postgres".into()),
        },
        Extension {
            id: "mcp-slack".into(),
            name: "MCP — Slack".into(),
            description: "Slack MCP server — search channels, post messages, fetch threads from the agent.".into(),
            version: "latest".into(),
            category: "mcp".into(),
            languages: vec![],
            installed: false,
            install_cmd: Some("npm install -g @modelcontextprotocol/server-slack".into()),
            install_note: Some("Requires Node.js 18+. Needs a Slack bot token. Runtime wiring into the agent toolbox lands in v2.4.".into()),
            binary: Some("mcp-server-slack".into()),
        },
        Extension {
            id: "mcp-puppeteer".into(),
            name: "MCP — Puppeteer".into(),
            description: "Headless Chromium controller. Lets the agent navigate, screenshot, and scrape pages as a tool call.".into(),
            version: "latest".into(),
            category: "mcp".into(),
            languages: vec![],
            installed: false,
            install_cmd: Some("npm install -g @modelcontextprotocol/server-puppeteer".into()),
            install_note: Some("Requires Node.js 18+ and downloads Chromium on first install (~150 MB). Runtime wiring into the agent toolbox lands in v2.4.".into()),
            binary: Some("mcp-server-puppeteer".into()),
        },
        Extension {
            id: "mcp-fetch".into(),
            name: "MCP — Fetch".into(),
            description: "Generic HTTP fetch MCP server. Useful for web research without a full headless browser.".into(),
            version: "latest".into(),
            category: "mcp".into(),
            languages: vec![],
            installed: false,
            install_cmd: Some("pip install mcp-server-fetch".into()),
            install_note: Some("Python-based — requires Python 3.10+. Runtime wiring into the agent toolbox lands in v2.4.".into()),
            binary: Some("mcp-server-fetch".into()),
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

    // Reserved for future error messages that mention the filename when
    // a compile or run step fails. Unused today — prefix to silence the
    // warning without losing the line so we don't have to redo the path
    // logic when we plumb the message through.
    let _filename = std::path::Path::new(program)
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
        "javascript" => ("node".to_string(), {
            let mut a = vec![program.clone()];
            a.extend(config.args);
            a
        }),
        "typescript" => {
            // `node foo.ts` silently fails — Node has no TS loader by
            // default. Prefer whatever the user has installed: `tsx`
            // (modern ESM-friendly) → `ts-node` (classic). Falls back
            // to `node` with a note if neither is on PATH.
            let finder = if cfg!(target_os = "windows") { "where" } else { "which" };
            let has = |bin: &str| std::process::Command::new(finder)
                .arg(bin).output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            let runner = if has("tsx") {
                "tsx"
            } else if has("ts-node") {
                "ts-node"
            } else {
                // No loader → tell the user instead of silently
                // producing cryptic SyntaxError.
                return CmdResult::ok(DebugOutput {
                    stdout: String::new(),
                    stderr: "TypeScript runner not found.\n\nInstall one of:\n  npm i -g tsx\n  npm i -g ts-node\n".to_string(),
                    exit_code: Some(127),
                });
            };
            (runner.to_string(), {
                let mut a = vec![program.clone()];
                a.extend(config.args);
                a
            })
        },
        "rust" => ("cargo".to_string(), {
            let mut a = vec!["run".to_string()];
            if !config.args.is_empty() {
                a.push("--".to_string());
                a.extend(config.args);
            }
            a
        }),
        "cpp" | "c" => {
            // Decisions baked into this branch:
            //   1. Pass the SOURCE as an absolute path so we don't rely on
            //      cwd matching the file's directory — the frontend often
            //      forces cwd = projectPath, which breaks the basename path.
            //   2. Put the output binary in the OS temp dir so repeated
            //      runs don't litter the user's source folder and so
            //      Windows exe-discovery rules don't bite us.
            //   3. Use the right standard flag per language — gcc rejects
            //      `-std=c++17` on a .c file, so C and C++ get separate
            //      flags.
            //   4. Add `-pthread` on Unix — a huge chunk of real-world
            //      C/C++ needs it and it's harmless otherwise.
            let is_c = config.language == "c";
            let compiler = if is_c { "gcc" } else { "g++" };
            let std_flag = if is_c { "-std=c11" } else { "-std=c++17" };

            // Absolute source path. If `program` is already absolute we
            // keep it; otherwise join with cwd (best-effort).
            let src_path = std::path::Path::new(program);
            let src_abs = if src_path.is_absolute() {
                program.clone()
            } else {
                std::path::Path::new(&cwd)
                    .join(src_path)
                    .to_string_lossy()
                    .to_string()
            };

            // Output binary: `<tmp>/lorica_debug_<pid>[.exe]`. Unique per
            // running IDE instance so two Loricas don't stomp on each
            // other's binaries.
            let exe_suffix = if cfg!(target_os = "windows") { ".exe" } else { "" };
            let out_path = std::env::temp_dir().join(format!(
                "lorica_debug_{}{}", std::process::id(), exe_suffix
            ));
            let out_str = out_path.to_string_lossy().to_string();

            // Compile args. `-pthread` only makes sense on Unix toolchains;
            // MinGW wants `-pthread` too but it's a no-op if the runtime
            // doesn't need it. MSVC via `cl.exe` isn't supported here (the
            // user would need a separate MSVC path — out of scope for v2.2).
            let mut compile_args: Vec<&str> = vec![
                &src_abs, "-o", &out_str, "-g", std_flag,
            ];
            if !cfg!(target_os = "windows") {
                compile_args.push("-pthread");
            }

            log::info!("Compiling {:?} with {} → {:?}", src_abs, compiler, out_path);

            let compile = Command::new(compiler)
                .args(&compile_args)
                .current_dir(&cwd)
                .output();

            match compile {
                Ok(c) if c.status.success() => {
                    log::info!("Compilation successful, running {:?}", out_path);
                    (out_str, config.args)
                },
                Ok(c) => {
                    return CmdResult::ok(DebugOutput {
                        stdout: String::from_utf8_lossy(&c.stdout).to_string(),
                        stderr: format!("Compilation failed:\n{}", String::from_utf8_lossy(&c.stderr)),
                        exit_code: Some(c.status.code().unwrap_or(1)),
                    });
                }
                Err(e) => {
                    let hint = if cfg!(target_os = "windows") {
                        "Install MinGW-w64 (https://www.mingw-w64.org) or the Visual C++ Build Tools, then restart Lorica."
                    } else if cfg!(target_os = "macos") {
                        "Install Xcode Command Line Tools: `xcode-select --install`."
                    } else {
                        "Install g++ / gcc: `sudo apt install build-essential` (Debian/Ubuntu) or equivalent."
                    };
                    return CmdResult::ok(DebugOutput {
                        stdout: String::new(),
                        stderr: format!("Compiler '{}' not found: {}\n\n{}", compiler, e, hint),
                        exit_code: Some(127),
                    });
                }
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

