use argon2::Argon2;
use base64::Engine as _;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use zeroize::Zeroize;

use crate::filesystem::CmdResult;
use crate::state::AppState;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

// ======================================================
// Secure memory type
// ======================================================

#[derive(Clone)]
struct SecureBytes {
    inner: Vec<u8>,
}

impl SecureBytes {
    fn new(data: Vec<u8>) -> Self {
        #[cfg(unix)]
        unsafe {
            libc::mlock(data.as_ptr() as *const libc::c_void, data.len());
        }
        Self { inner: data }
    }
    fn as_slice(&self) -> &[u8] {
        &self.inner
    }
}

impl Drop for SecureBytes {
    fn drop(&mut self) {
        self.inner.zeroize();
        #[cfg(unix)]
        unsafe {
            libc::munlock(self.inner.as_ptr() as *const libc::c_void, self.inner.len());
        }
    }
}

// ======================================================
// Data types
// ======================================================

#[derive(Serialize, Deserialize, Clone)]
struct EncryptedSecret {
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct VaultFile {
    version: u32,
    /// **Legacy field — vaults created before v2.2 used a bare SHA-256 for
    /// password verification, which is brute-forceable on GPU.** Kept for
    /// upgrade-path compatibility only; new vaults write `verify_canary`
    /// instead and leave this empty. During unlock, if `verify_canary` is
    /// present we use it (Argon2-gated AEAD tag check); otherwise we fall
    /// back to the legacy hash and transparently upgrade on success.
    #[serde(default)]
    password_verify: String,
    /// Argon2-gated verification canary: a constant plaintext encrypted
    /// with the same key used for secrets. To verify a password we
    /// re-derive the key via Argon2id (slow) and attempt to decrypt the
    /// canary. Correct password → AEAD tag validates; wrong password →
    /// decryption fails. This forces an attacker to pay the full Argon2
    /// cost per guess, same as breaking the secret ciphertext directly.
    #[serde(default)]
    verify_canary: Option<EncryptedSecret>,
    salt: String,
    secrets: HashMap<String, EncryptedSecret>,
}

/// Plaintext wrapped in the canary. The prefix pins it to this codebase
/// so a canary file can't be confused with a random blob. Length stays
/// small so the AEAD overhead is minimal.
const VAULT_CANARY_PLAINTEXT: &[u8] = b"lorica-vault-canary-v2";

#[derive(Serialize, Deserialize, Clone)]
pub struct AuditEntry {
    pub timestamp: String,
    pub action: String,
    pub detail: String,
    pub hash: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct AuditFile {
    entries: Vec<AuditEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SecretScanResult {
    pub line: usize,
    pub pattern: String,
    pub severity: String,
}

// ======================================================
// Vault State
// ======================================================

pub struct VaultState {
    vault_path: PathBuf,
    audit_path: PathBuf,
    derived_key: Option<SecureBytes>,
    rng: SystemRandom,
}

impl VaultState {
    pub fn new(_app_handle: &AppHandle) -> Self {
        let data_dir = directories::ProjectDirs::from("com", "Lorica", "Lorica")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from(".Lorica"));

        let _ = fs::create_dir_all(&data_dir);

        Self {
            vault_path: data_dir.join("vault.enc"),
            audit_path: data_dir.join("audit.json"),
            derived_key: None,
            rng: SystemRandom::new(),
        }
    }

    fn is_initialized(&self) -> bool {
        self.vault_path.exists()
    }

    fn is_unlocked(&self) -> bool {
        self.derived_key.is_some()
    }

    /// Derive 32-byte key from password + salt via Argon2id
    fn derive_key(password: &str, salt: &[u8]) -> Result<Vec<u8>, String> {
        let mut output = vec![0u8; 32];
        let argon2 = Argon2::new(
            argon2::Algorithm::Argon2id,
            argon2::Version::V0x13,
            argon2::Params::new(65536, 3, 1, Some(32))
                .map_err(|e| format!("Argon2 params error: {}", e))?,
        );
        argon2
            .hash_password_into(password.as_bytes(), salt, &mut output)
            .map_err(|e| format!("Argon2 key derivation failed: {}", e))?;
        Ok(output)
    }

    /// Create a password verification hash (separate from encryption key)
    fn hash_for_verify(password: &str, salt: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"lorica-verify-v1:");
        hasher.update(password.as_bytes());
        hasher.update(b":");
        hasher.update(salt);
        format!("{:x}", hasher.finalize())
    }

    fn encrypt(&self, plaintext: &[u8], key: &[u8]) -> Result<EncryptedSecret, String> {
        let unbound = UnboundKey::new(&CHACHA20_POLY1305, key)
            .map_err(|e| format!("Invalid key: {:?}", e))?;
        let seal_key = LessSafeKey::new(unbound);

        let mut nonce_bytes = [0u8; 12];
        self.rng.fill(&mut nonce_bytes).map_err(|_| "RNG failed")?;
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);

        let mut buf = plaintext.to_vec();
        seal_key
            .seal_in_place_append_tag(nonce, Aad::empty(), &mut buf)
            .map_err(|_| "Encryption failed")?;

        Ok(EncryptedSecret {
            nonce: hex::encode(nonce_bytes),
            ciphertext: B64.encode(&buf),
        })
    }

    fn decrypt(&self, secret: &EncryptedSecret, key: &[u8]) -> Result<Vec<u8>, String> {
        let unbound = UnboundKey::new(&CHACHA20_POLY1305, key)
            .map_err(|e| format!("Invalid key: {:?}", e))?;
        let open_key = LessSafeKey::new(unbound);

        let nonce_bytes: Vec<u8> = hex::decode(&secret.nonce).map_err(|e| format!("Bad nonce: {}", e))?;
        if nonce_bytes.len() != 12 {
            return Err("Invalid nonce length".into());
        }
        let mut arr = [0u8; 12];
        arr.copy_from_slice(&nonce_bytes);
        let nonce = Nonce::assume_unique_for_key(arr);

        let mut ciphertext = B64.decode(&secret.ciphertext).map_err(|e| format!("Bad ciphertext: {}", e))?;

        let plaintext = open_key
            .open_in_place(nonce, Aad::empty(), &mut ciphertext)
            .map_err(|_| "Decryption failed — wrong password or corrupted data")?;

        Ok(plaintext.to_vec())
    }

    fn load_vault(&self) -> Result<VaultFile, String> {
        let data = fs::read_to_string(&self.vault_path).map_err(|e| format!("Cannot read vault: {}", e))?;
        serde_json::from_str(&data).map_err(|e| format!("Corrupted vault: {}", e))
    }

    fn save_vault(&self, vault: &VaultFile) -> Result<(), String> {
        let data = serde_json::to_string_pretty(vault).map_err(|e| format!("Serialize error: {}", e))?;
        // Atomic write via tmp + rename. Crashing mid-save would
        // otherwise leave an unparseable vault, locking the user out of
        // their own secrets — worst possible failure mode.
        let parent = self.vault_path.parent().unwrap_or_else(|| Path::new("."));
        let _ = fs::create_dir_all(parent);
        let file_name = self.vault_path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "vault.enc".to_string());
        let tmp = parent.join(format!(".{}.tmp-{}", file_name, std::process::id()));
        use std::io::Write;
        {
            let mut f = fs::File::create(&tmp).map_err(|e| format!("Cannot open vault tmp: {}", e))?;
            f.write_all(data.as_bytes()).map_err(|e| format!("Cannot write vault tmp: {}", e))?;
            f.sync_all().map_err(|e| format!("Cannot fsync vault tmp: {}", e))?;
        }
        if let Err(e) = fs::rename(&tmp, &self.vault_path) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("Cannot promote vault: {}", e));
        }
        Ok(())
    }

    fn add_audit(&self, action: &str, detail: &str) {
        let mut audit = if self.audit_path.exists() {
            fs::read_to_string(&self.audit_path)
                .ok()
                .and_then(|s| serde_json::from_str::<AuditFile>(&s).ok())
                .unwrap_or(AuditFile { entries: vec![] })
        } else {
            AuditFile { entries: vec![] }
        };

        let prev_hash = audit.entries.last().map(|e| e.hash.as_str()).unwrap_or("genesis");
        let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string();
        let chain_input = format!("{}{}{}{}", prev_hash, action, detail, timestamp);
        let hash = format!("{:x}", Sha256::digest(chain_input.as_bytes()));

        audit.entries.push(AuditEntry {
            timestamp,
            action: action.to_string(),
            detail: detail.to_string(),
            hash,
        });

        if audit.entries.len() > 1000 {
            audit.entries = audit.entries.split_off(audit.entries.len() - 1000);
        }

        let _ = fs::write(&self.audit_path, serde_json::to_string_pretty(&audit).unwrap_or_default());
    }
}

// ======================================================
// Secret scanning
// ======================================================

fn scan_secrets(code: &str) -> Vec<SecretScanResult> {
    let mut results = Vec::new();

    for (line_num, line) in code.lines().enumerate() {
        let lower = line.to_lowercase();
        let trimmed = line.trim();

        // Skip comments
        if trimmed.starts_with("//") || trimmed.starts_with('#') || trimmed.starts_with("/*") {
            continue;
        }

        let checks: &[(&str, Box<dyn Fn() -> bool>, &str)] = &[
            ("AWS Key", Box::new(|| line.contains("AKIA")), "critical"),
            ("Private Key", Box::new(|| line.contains("PRIVATE KEY")), "critical"),
            ("JWT", Box::new(|| line.contains("eyJ") && line.matches('.').count() >= 2), "warning"),
            ("Password", Box::new(|| {
                (lower.contains("password") || lower.contains("passwd") || lower.contains("pwd"))
                    && (line.contains('=') || line.contains(':'))
            }), "warning"),
            ("API Key", Box::new(|| {
                (lower.contains("api_key") || lower.contains("apikey") || lower.contains("api-key"))
                    && (line.contains('=') || line.contains(':'))
            }), "warning"),
            ("Token", Box::new(|| {
                (lower.contains("token") || lower.contains("secret") || lower.contains("bearer"))
                    && (line.contains('=') || line.contains(':'))
            }), "warning"),
            ("Connection String", Box::new(|| {
                lower.contains("mongodb://") || lower.contains("postgres://")
                    || lower.contains("mysql://") || lower.contains("redis://")
            }), "warning"),
        ];

        for (name, check_fn, severity) in checks {
            if check_fn() {
                results.push(SecretScanResult {
                    line: line_num + 1,
                    pattern: name.to_string(),
                    severity: severity.to_string(),
                });
                break; // One match per line
            }
        }
    }

    results
}

// ======================================================
// Tauri Commands
// ======================================================

#[tauri::command]
pub fn cmd_init_vault(master_password: String, state: tauri::State<AppState>) -> CmdResult<bool> {
    let mut vault = crate::state::lock_or_recover(&state.vault);

    if vault.is_initialized() {
        return CmdResult::err("Vault already initialized");
    }

    let mut salt = [0u8; 32];
    if let Err(_) = vault.rng.fill(&mut salt) {
        return CmdResult::err("Failed to generate random salt");
    }
    let salt_hex = hex::encode(salt);

    let key = match VaultState::derive_key(&master_password, &salt) {
        Ok(k) => k,
        Err(e) => return CmdResult::err(e),
    };
    // Encrypt the canary under the freshly-derived key; that encrypted
    // blob serves as the Argon2-gated verifier.
    let canary = match vault.encrypt(VAULT_CANARY_PLAINTEXT, &key) {
        Ok(c) => c,
        Err(e) => return CmdResult::err(e),
    };

    let vault_file = VaultFile {
        version: 2,
        password_verify: String::new(), // legacy slot, left empty
        verify_canary: Some(canary),
        salt: salt_hex,
        secrets: HashMap::new(),
    };

    if let Err(e) = vault.save_vault(&vault_file) {
        return CmdResult::err(e);
    }

    vault.derived_key = Some(SecureBytes::new(key));
    vault.add_audit("VAULT_INIT", "Vault initialized");
    CmdResult::ok(true)
}

#[tauri::command]
pub fn cmd_unlock_vault(master_password: String, state: tauri::State<AppState>) -> CmdResult<bool> {
    let mut vault = crate::state::lock_or_recover(&state.vault);

    if !vault.is_initialized() {
        return CmdResult::err("Vault not initialized");
    }

    let vault_file = match vault.load_vault() {
        Ok(v) => v,
        Err(e) => return CmdResult::err(e),
    };

    let salt = match hex::decode(&vault_file.salt) {
        Ok(s) => s,
        Err(e) => {
            vault.add_audit("VAULT_UNLOCK_FAILED", "Corrupted vault salt");
            return CmdResult::err(format!("Corrupted vault salt: {}", e));
        }
    };

    // Derive the key FIRST. We must pay the Argon2 cost regardless of
    // which verification path is taken — that's exactly the property
    // that makes offline brute-force expensive.
    let key = match VaultState::derive_key(&master_password, &salt) {
        Ok(k) => k,
        Err(e) => {
            vault.add_audit("VAULT_UNLOCK_FAILED", "Key derivation failed");
            return CmdResult::err(format!("Key derivation failed: {}", e));
        }
    };

    // v2+ path: verify by trying to decrypt the canary. Wrong key =>
    // AEAD tag mismatch => decryption error. Timing is dominated by
    // Argon2 above, not by this cheap tag check, so no side channel.
    let mut migrated = false;
    if let Some(canary) = &vault_file.verify_canary {
        match vault.decrypt(canary, &key) {
            Ok(plain) if plain == VAULT_CANARY_PLAINTEXT => { /* OK */ }
            _ => {
                vault.add_audit("VAULT_UNLOCK_FAILED", "Wrong password");
                return CmdResult::err("Wrong password");
            }
        }
    } else {
        // Legacy v1 path: old SHA-256 verify. We honour it so existing
        // vaults still open, then immediately re-save in v2 format with
        // a canary to close the GPU-brute-force window.
        let legacy_verify = VaultState::hash_for_verify(&master_password, &salt);
        if legacy_verify != vault_file.password_verify {
            vault.add_audit("VAULT_UNLOCK_FAILED", "Wrong password");
            return CmdResult::err("Wrong password");
        }
        migrated = true;
    }

    // Opportunistic migration: write a canary + bump version so the
    // next unlock is Argon2-gated even for legacy vaults.
    if migrated {
        match vault.encrypt(VAULT_CANARY_PLAINTEXT, &key) {
            Ok(canary) => {
                let upgraded = VaultFile {
                    version: 2,
                    password_verify: String::new(),
                    verify_canary: Some(canary),
                    salt: vault_file.salt.clone(),
                    secrets: vault_file.secrets.clone(),
                };
                if vault.save_vault(&upgraded).is_ok() {
                    vault.add_audit("VAULT_MIGRATE_V2", "Vault migrated to Argon2-gated verifier");
                }
            }
            Err(_) => { /* keep legacy behaviour if encryption failed */ }
        }
    }

    vault.derived_key = Some(SecureBytes::new(key));
    vault.add_audit("VAULT_UNLOCK", "Vault unlocked");
    CmdResult::ok(true)
}

#[tauri::command]
pub fn cmd_lock_vault(state: tauri::State<AppState>) -> CmdResult<bool> {
    let mut vault = crate::state::lock_or_recover(&state.vault);
    vault.derived_key = None; // SecureBytes::drop() zeroizes
    vault.add_audit("VAULT_LOCK", "Vault locked");
    CmdResult::ok(true)
}

#[tauri::command]
pub fn cmd_add_secret(key: String, value: String, state: tauri::State<AppState>) -> CmdResult<bool> {
    let vault = crate::state::lock_or_recover(&state.vault);
    if !vault.is_unlocked() { return CmdResult::err("Vault is locked"); }

    let dk = vault.derived_key.as_ref().unwrap();
    let encrypted = match vault.encrypt(value.as_bytes(), dk.as_slice()) {
        Ok(e) => e,
        Err(e) => return CmdResult::err(e),
    };

    let mut vf = match vault.load_vault() { Ok(v) => v, Err(e) => return CmdResult::err(e) };
    vf.secrets.insert(key.clone(), encrypted);
    if let Err(e) = vault.save_vault(&vf) { return CmdResult::err(e); }

    vault.add_audit("SECRET_ADD", &format!("Added: {}", key));
    CmdResult::ok(true)
}

#[tauri::command]
pub fn cmd_get_secret(key: String, state: tauri::State<AppState>) -> CmdResult<String> {
    let vault = crate::state::lock_or_recover(&state.vault);
    if !vault.is_unlocked() { return CmdResult::err("Vault is locked"); }

    let vf = match vault.load_vault() { Ok(v) => v, Err(e) => return CmdResult::err(e) };
    let enc = match vf.secrets.get(&key) { Some(e) => e, None => return CmdResult::err("Secret not found") };
    let dk = vault.derived_key.as_ref().unwrap();

    match vault.decrypt(enc, dk.as_slice()) {
        Ok(pt) => {
            vault.add_audit("SECRET_READ", &format!("Read: {}", key));
            CmdResult::ok(String::from_utf8_lossy(&pt).to_string())
        }
        Err(e) => CmdResult::err(e),
    }
}

#[tauri::command]
pub fn cmd_delete_secret(key: String, state: tauri::State<AppState>) -> CmdResult<bool> {
    let vault = crate::state::lock_or_recover(&state.vault);
    if !vault.is_unlocked() { return CmdResult::err("Vault is locked"); }

    let mut vf = match vault.load_vault() { Ok(v) => v, Err(e) => return CmdResult::err(e) };
    if vf.secrets.remove(&key).is_none() { return CmdResult::err("Secret not found"); }
    if let Err(e) = vault.save_vault(&vf) { return CmdResult::err(e); }

    vault.add_audit("SECRET_DELETE", &format!("Deleted: {}", key));
    CmdResult::ok(true)
}

#[tauri::command]
pub fn cmd_list_secrets(state: tauri::State<AppState>) -> CmdResult<Vec<String>> {
    let vault = crate::state::lock_or_recover(&state.vault);
    if !vault.is_unlocked() { return CmdResult::err("Vault is locked"); }
    let vf = match vault.load_vault() { Ok(v) => v, Err(e) => return CmdResult::err(e) };
    CmdResult::ok(vf.secrets.keys().cloned().collect())
}

#[tauri::command]
pub fn cmd_is_vault_initialized(state: tauri::State<AppState>) -> CmdResult<bool> {
    CmdResult::ok(crate::state::lock_or_recover(&state.vault).is_initialized())
}

#[tauri::command]
pub fn cmd_is_vault_unlocked(state: tauri::State<AppState>) -> CmdResult<bool> {
    CmdResult::ok(crate::state::lock_or_recover(&state.vault).is_unlocked())
}

#[tauri::command]
pub fn cmd_get_audit_log(state: tauri::State<AppState>) -> CmdResult<Vec<AuditEntry>> {
    let vault = crate::state::lock_or_recover(&state.vault);
    if vault.audit_path.exists() {
        match fs::read_to_string(&vault.audit_path) {
            Ok(data) => {
                let audit: AuditFile = serde_json::from_str(&data).unwrap_or(AuditFile { entries: vec![] });
                CmdResult::ok(audit.entries)
            }
            Err(e) => CmdResult::err(format!("Cannot read audit: {}", e)),
        }
    } else {
        CmdResult::ok(vec![])
    }
}

#[tauri::command]
pub fn cmd_add_audit_entry(action: String, detail: String, state: tauri::State<AppState>) -> CmdResult<bool> {
    crate::state::lock_or_recover(&state.vault).add_audit(&action, &detail);
    CmdResult::ok(true)
}

#[tauri::command]
pub fn cmd_scan_for_secrets(code: String) -> CmdResult<Vec<SecretScanResult>> {
    CmdResult::ok(scan_secrets(&code))
}

