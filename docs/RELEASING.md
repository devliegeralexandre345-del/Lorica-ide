# Releasing Lorica IDE

End-to-end release procedure. Read this once before your first release, then
follow the **Shipping a release** checklist at the bottom.

## Why signing matters

Windows 11 ships with **Smart App Control (SAC)** and **SmartScreen** enabled
by default on new installs. Both block unsigned installers:

- **Unsigned MSI** → SAC refuses to run it. SmartScreen throws a red warning.
  Users have to know how to click "More info → Run anyway", or disable SAC —
  neither is acceptable for a mainstream IDE.
- **Signed MSI (Authenticode)** → SAC accepts it silently. SmartScreen may
  show a "publisher" dialog on first install while it builds reputation,
  which disappears after a few thousand installs.
- **EV Code Signing cert** → instant reputation, no SmartScreen dialog at all.

**Bottom line:** we must ship signed MSIs. The GitHub Actions workflow at
`.github/workflows/release.yml` does this automatically once the signing
secrets are configured.

## One-time setup: obtain a code-signing certificate

You have three realistic options, cheapest first:

### Option A — Azure Trusted Signing (~$10/month, recommended)

Microsoft's modern code-signing service. Certs are short-lived and issued
on-demand from Azure, there's no physical dongle to manage. Works seamlessly
with SAC.

1. Create an Azure subscription
2. Go to **Trusted Signing** (formerly "Code Signing") → create an account
3. Create a Certificate Profile (Public Trust)
4. Verify your identity / organization (1–3 business days)
5. In GitHub Actions, use the official `azure/trusted-signing-action` step
   instead of the `signtool`-based flow below. The workflow will need
   tweaking — see Microsoft's docs.

### Option B — SignPath Foundation (free for open source)

Free for qualifying OSS projects, run by a non-profit. They hold the
certificate on their HSM and sign your artifacts through a policy-gated
pipeline — you never touch a private key.

1. Read the terms: https://signpath.org/terms.html
2. Apply at: https://signpath.org/apply
3. Pre-filled application answers: see `docs/SIGNPATH_APPLICATION.md`
4. Wait for approval (typically 1-3 weeks)
5. Configure `SignPath-Foundation/SignPath-GitHub-Action` in the workflow
6. No secret management on your end — they handle the key

**Prerequisite:** publish at least one unsigned release before applying.
The foundation wants to see a real artifact they can evaluate, not just a
repo.

### Option C — Standard certificate from a CA (~$80–500/year)

Buy a Code Signing certificate from Sectigo, DigiCert, SSL.com, etc. Get the
**EV** (Extended Validation) variant if you can afford it — it unlocks
instant SmartScreen reputation, which is worth the extra cost for a
public-facing IDE.

1. Order the certificate
2. Complete the CA's identity verification
3. Export the private key + cert as a password-protected `.pfx` file
4. Base64-encode it: `certutil -encode codesign.pfx codesign.b64` on Windows
5. Store it as the `WINDOWS_CERT_PFX_BASE64` GitHub secret
6. Store the password as `WINDOWS_CERT_PASSWORD`

⚠ **EV certs usually ship on a physical USB HSM** — these can't be
base64-dumped. For an EV workflow you need either:
- Azure Key Vault + the `AzureSignTool` action (the modern path)
- A self-hosted Windows runner with the HSM plugged in

Most teams take Option A precisely to avoid the EV-HSM headache.

## GitHub Secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | When | Contents |
|---|---|---|
| `WINDOWS_CERT_PFX_BASE64` | Option C only | `certutil -encode` output of your `.pfx` |
| `WINDOWS_CERT_PASSWORD` | Option C only | Password of the `.pfx` |
| `TAURI_SIGNING_PRIVATE_KEY` | Updater sigs | Output of `tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater sigs | Password for the above |

The last two are for **Tauri's built-in updater signatures**, separate from
Windows code signing — they sign the `latest.json` manifest the in-app
updater reads. Generate them once with `cargo tauri signer generate -w`.

## Shipping a release

1. Bump the version in three places (they have to stay in sync):
   - `package.json` → `"version": "2.3.0"`
   - `src-tauri/tauri.conf.json` → `"version": "2.3.0"`
   - `src-tauri/Cargo.toml` → `version = "2.3.0"`
2. Update `CHANGELOG.md`.
3. Commit and push to `main`.
4. Tag and push:
   ```bash
   git tag v2.3.0
   git push origin v2.3.0
   ```
5. GitHub Actions kicks off. Watch the `Release` workflow in the Actions tab.
6. When it finishes, go to **Releases**, find the draft, review the
   artifacts (MSI + NSIS + dmg + deb + AppImage), and click **Publish**.

## Verifying a signed Windows build

After a release completes, download the MSI and run:

```powershell
Get-AuthenticodeSignature .\Lorica_2.3.0_x64_en-US.msi
```

Expected output:

```
SignerCertificate                         Status      Path
-----------------                         ------      ----
<thumbprint…>                             Valid       Lorica_2.3.0_x64_en-US.msi
```

If `Status` is anything other than `Valid`, do **not** publish — the release
is broken. Common causes: expired cert, missing timestamp, cross-signing
chain issue.

## Dev machine vs end-user machine

For the 100th time, in case it gets confused again:

- **End users** never compile Rust. They install a signed MSI. SAC on their
  machine is irrelevant as long as we signed the installer — this whole
  document is about making that true.
- **Developers** (us) compile Rust on our machines. Rust produces unsigned
  proc-macro DLLs as part of its normal build. SAC blocks loading those.
  The fix on a dev machine is to turn off SAC on that dev machine, period —
  signing every proc-macro DLL that every dependency ever compiles is not a
  real strategy.

The two problems look similar but the solutions are unrelated.
