# Basework Desktop (Windows)

## Architecture

```
Browser ──────────────┐
                      ├──► Next.js on Vercel (UI + API + NextAuth) ──► PostgreSQL
Desktop (Tauri) ──────┘        one backend, one database
```

The desktop app is a **native window around the production web app**
(Tauri 2 + Microsoft Edge WebView2). It is not a second client
implementation:

- The UI, API routes, authentication (NextAuth session cookie), role checks
  and PostgreSQL data are exactly the ones the browser uses. A task edited on
  the web shows up on the desktop on the next load, and vice versa.
- No business data is stored on the PC. WebView2 keeps the session cookie and
  HTTP cache in the user's profile (`%LOCALAPPDATA%\app.basework.desktop`),
  like a browser does.
- The bundled `desktop/shell/` page only checks that the server is reachable
  (offline screen + retry), then navigates to the web app.
- Remote pages get **no** Tauri IPC permissions. The native side only enforces
  a navigation policy: the window stays on the server's origin, and every
  other link opens in the default browser (`src-tauri/src/lib.rs`).
- The desktop client identifies itself with `BaseworkDesktop/<version>` in its
  User-Agent. The web app uses it to hide "Download desktop app" and to show
  the installed version on `/download`.

This design means there is **nothing to duplicate**: every feature shipped to
the web is immediately in the desktop app without a new installer. A new
desktop release is only needed when the native shell itself changes (window
behaviour, icon, update mechanism, server URL).

### Files

| Path | Purpose |
|---|---|
| `desktop/package.json` | Desktop version (single source of truth) and Tauri CLI scripts |
| `desktop/shell/` | Bundled bootstrap/offline page; `config.js` is generated |
| `desktop/scripts/prepare-shell.mjs` | Writes `shell/config.js` from `BASEWORK_SERVER_URL` |
| `desktop/scripts/prepare-updater-config.mjs` | Generates the updater config overlay when signing is configured |
| `desktop/src-tauri/` | Rust crate, `tauri.conf.json`, capabilities (none for remote content), icons |
| `prisma/schema.prisma` → `desktop_releases` | Registry of published installers (same database) |
| `src/app/api/desktop/**` | `releases` (register/list), `releases/latest`, `download/latest` (302 to the newest installer), `update/{target}/{arch}/{version}` (Tauri updater) |
| `src/app/download/page.tsx` | Public Download page (version, supported OS, release date, checksum) |
| `.github/workflows/desktop-*.yml` | CI build on every desktop change; release on `desktop-v*` tags |
| `scripts/desktop/publish-release.mjs` | Registers a built installer with the server (used by CI) |

## One-time setup

**Release environment (repository admin, before the first release).** Signing
keys and the release token must exist only in the job that publishes a
release, never in CI builds of branches or pull requests:

1. Settings → Environments → New environment `release`: Required reviewers
   (at least one), Prevent self-review, untick "Allow administrators to bypass".
   Deployment branches and tags: **Selected tags only** - `desktop-v*` and
   `android-v*`, no branches. (With a single reviewer, Prevent self-review
   can't be on - note that in docs/OPERATIONS.md.)
2. Settings → Rules → New tag ruleset for `desktop-v*` and `android-v*`:
   restrict creations, updates and deletions; only repository admins bypass.
   Without it anyone with push access can create a release tag on any commit.
3. Put the secrets below in the `release` environment (not the repository),
   then delete any repository-level copies.

| Kind | Where | Name | Value |
|---|---|---|---|
| Variable | repository | `BASEWORK_SERVER_URL` | **Required**, no default: the production web origin (`https://` + the same host as `ANDROID_APP_HOST`). Release builds fail without it; it is baked into the app and its update channel |
| Secret | `release` environment | `DESKTOP_RELEASE_TOKEN` | Random string, ≥ 32 characters (`openssl rand -hex 32`) |

Vercel project → Environment Variables (Production): the **same**
`DESKTOP_RELEASE_TOKEN`. Without it, CI still builds and uploads the installer
to GitHub Releases, and an admin can register it by hand in
**Admin console → Desktop releases → Register release**.

## Releasing a new desktop version

1. Bump the version in `desktop/package.json` (e.g. `0.1.0` → `0.2.0`) and
   in `desktop/src-tauri/Cargo.toml`, then commit.
   `tauri.conf.json` reads the version from `package.json`.
2. Tag and push:
   ```bash
   git tag desktop-v0.2.0
   git push origin desktop-v0.2.0
   ```
   (or Actions → **Desktop release** → Run workflow, version `0.2.0`, choosing the
   **tag** in "Use workflow from" - the `release` environment refuses branches.
   Channel `beta` registers a trial build that the Download button doesn't offer.)
3. After a reviewer approves the `release` environment, the workflow, on `windows-latest`:
   - checks the tag matches `desktop/package.json`,
   - runs the Rust tests and `tauri build` (NSIS `-setup.exe` + `.msi`),
   - creates the GitHub Release `desktop-v0.2.0` with both installers,
   - registers the `-setup.exe` with `POST /api/desktop/releases`.
4. Done. **You don't need to update any link:** the web Download button
   points to `/api/desktop/download/latest`, which always redirects to the
   highest published version for the platform. The Download page shows the
   new version, supported OS and release date immediately.

To pull a bad build: Admin console → Desktop releases → switch off
**Published**. The download link and the updater fall back to the previous
version at once.

Build locally (Windows, with Rust + Node + WebView2):

```powershell
cd desktop
npm ci
$env:BASEWORK_SERVER_URL = "https://your-production-url"
npm run build        # -> src-tauri/target/release/bundle/{nsis,msi}/
npm run dev          # opens the window against BASEWORK_SERVER_URL, or http://localhost:3000 when it isn't set
```

`npm run build` (and `npm run prepare-shell`, which `cargo build` / `cargo test`
need first) refuses to run without `BASEWORK_SERVER_URL` - there is no default
host to fall back to. Only `npm run dev` / `npm run prepare-shell:dev` use
`http://localhost:3000`.

Installers: the NSIS `-setup.exe` installs per-user with no admin rights (the
one on the Download page). The `.msi` installs per-machine, for IT deployment
(Intune/GPO). Both are attached to every GitHub Release.

## Enabling automatic updates (prepared, off by default)

Everything server-side already exists: `desktop_releases.updater_url` /
`updater_signature` and `GET /api/desktop/update/{target}/{arch}/{current_version}`,
which returns the Tauri updater JSON for the newest *signed* release, or 204.

To turn it on:

1. Generate a signing key pair once:
   `cd desktop && npx tauri signer generate -w ~/.tauri/basework.key`
2. GitHub → `release` environment secrets: `TAURI_SIGNING_PRIVATE_KEY` (file
   contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Repository variable:
   `TAURI_UPDATER_PUBKEY` (the `.pub` contents; not secret). CI builds of
   branches and pull requests never see the key and are never signed.
3. Release as usual. CI then builds with `--features updater` and the
   generated config overlay, uploads the `.sig`, and registers the signature.
   Installed apps check the endpoint at startup, install the update
   (passive mode) and restart.

Installed apps accept only signatures that carry the version
(`requireSignedVersion` in the generated config), so an old signature can't
be replayed under a newer version number to force a downgrade. CI builds sign
the version automatically. If you ever sign an update by hand, always pass it:
`npx tauri signer sign --app-version <version> ...` — without it the CLI only
warns, and installed apps will reject the update.

Keep the private key backed up: losing it means existing installs can't
verify future updates, and users must reinstall manually.

## Code signing (Authenticode) - prepared, waiting for a certificate

Today the `.exe` and `.msi` are **not code-signed**: `Get-AuthenticodeSignature` reports `NotSigned`
and SmartScreen shows "Windows protected your PC". The updater signature (minisign) protects automatic
updates only, not the first install. IT policies (AppLocker, Intune, EDR) often block unsigned files.

**Company task (not code):** since 1 June 2023 the private key of every new OV/EV code-signing
certificate must live on hardware or an HSM, so a `.pfx` can't be imported into a GitHub runner, and the
old `certificateThumbprint` approach no longer works. Choose a remote signing service:

| Option | Login from CI | Notes |
| --- | --- | --- |
| Azure Trusted Signing | OIDC (`azure/login`, no stored secret) | Cheapest; check first that a Vietnamese legal entity is eligible (country list and organisation validation) |
| DigiCert KeyLocker, SSL.com eSigner | API key / credentials in the `release` environment's secrets | OV or EV certificate from the CA, key held in their cloud HSM |

Record here: provider, certificate subject, expiry date, who renews it.

**Wiring (already in the release job, `.github/workflows/desktop-build.yml`):**

1. Add the provider's login/tool-install step to the `release` job before *Build installers*. For Azure:
   `permissions: id-token: write` on the job, and a federated credential with subject
   `repo:diuthihieu/hr-task-managent-CL:environment:release`.
2. Set the `release` environment **variable** `WINDOWS_SIGN_COMMAND` to the provider's sign command with
   `%1` for the file, e.g. `trusted-signing-cli -e https://weu.codesigning.azure.net -a <account> -c <profile> -d woli %1`.
   The command must timestamp the signature (the provider tools do by default). Tauri splits it on spaces,
   so no argument may contain one.
3. That's it. `desktop/scripts/prepare-signing-config.mjs` turns the variable into
   `tauri.signing.generated.json`, merged with `--config` into the release build only. Tauri signs the
   app and both installers while bundling, **before** it writes the updater `.sig`, so the `.sig`
   matches the signed installer. Never sign in a later job: that would break the `.sig`.
4. The step *Check Authenticode signatures* then fails the release unless both the `.exe` and the `.msi`
   are `Valid` and timestamped. Without the variable, releases still build, unsigned, with a warning.

Pull-request and branch builds (the `ci` job) never sign and can't read signing settings.

After the first signed beta release, check on Windows:
`Get-AuthenticodeSignature .\woli_<version>_x64-setup.exe | Format-List Status, SignerCertificate, TimeStamperCertificate`
(and the same for the `.msi`), and that the `.sig` verifies against the signed installer with
`minisign -V -m <installer> -x <decoded .sig> -p <decoded public key>`.
An EV certificate no longer skips SmartScreen's reputation check, so expect the warning to fade with
downloads rather than vanish on day one.

## Limitations / next steps

- **Online only.** Core data is intentionally never stored on the device. For
  future offline support, add a service-worker cache for read-only views in
  the web app (it benefits browser and desktop alike) rather than a local
  database.
- The desktop build targets Windows x64. macOS/Linux bundles are possible
  with the same code (add runners and `platform` values).
