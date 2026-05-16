//! Extension trait to keep Windows from popping a console window every
//! time we spawn a child process.
//!
//! On Windows, `std::process::Command::new("git")` (and friends) flashes
//! a black cmd.exe window for any console subsystem binary — git, cmd,
//! powershell, where, node, npm, cargo, you name it. The fix is the
//! `CREATE_NO_WINDOW` (0x08000000) creation flag from the Win32 process
//! API. It's a one-liner, but it has to be applied to EVERY spawn site
//! we own, otherwise the user sees a console flash from whichever site
//! we missed.
//!
//! Usage:
//! ```ignore
//! use crate::cmd_ext::CommandExt;
//! Command::new("git").no_window().args(["status"]).output()
//! ```
//! On non-Windows targets `no_window()` is a no-op so the same code
//! compiles unchanged.

pub trait CommandExt {
    /// Hide the console window for this child on Windows. No-op elsewhere.
    fn no_window(&mut self) -> &mut Self;
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
impl CommandExt for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt as _;
        self.creation_flags(CREATE_NO_WINDOW)
    }
}

#[cfg(not(target_os = "windows"))]
impl CommandExt for std::process::Command {
    fn no_window(&mut self) -> &mut Self { self }
}

#[cfg(target_os = "windows")]
impl CommandExt for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        self.creation_flags(CREATE_NO_WINDOW)
    }
}

#[cfg(not(target_os = "windows"))]
impl CommandExt for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self { self }
}
