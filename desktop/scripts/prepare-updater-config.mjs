// Generates src-tauri/tauri.updater.generated.json, merged into tauri.conf.json
// with `tauri build --config ...` when auto-updates are enabled. Requires:
//   TAURI_UPDATER_PUBKEY   public key from `tauri signer generate` (not secret)
//   BASEWORK_SERVER_URL    web app origin serving /api/desktop/update/...
// and, for the build itself, TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) as secrets.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pubkey = process.env.TAURI_UPDATER_PUBKEY?.trim();
if (!pubkey) {
  console.error("TAURI_UPDATER_PUBKEY is not set - cannot enable the updater.");
  process.exit(1);
}
const rawServer = (process.env.BASEWORK_SERVER_URL ?? "").trim();
if (!rawServer) {
  console.error("BASEWORK_SERVER_URL is not set - the updater must know which server to ask (docs/DESKTOP.md).");
  process.exit(1);
}
let server;
try {
  server = new URL(rawServer).origin;
} catch {
  console.error(`BASEWORK_SERVER_URL is not a valid URL (got ${rawServer})`);
  process.exit(1);
}
const config = {
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey,
      endpoints: [`${server}/api/desktop/update/{{target}}/{{arch}}/{{current_version}}`],
      windows: { installMode: "passive" },
      // Refuse signatures without a signed version: otherwise whoever controls
      // the update endpoint could pair a new version number with an old,
      // version-less signature and force a downgrade. `tauri build` always
      // signs the version; hand signing needs `tauri signer sign --app-version`.
      requireSignedVersion: true,
    },
  },
};
const out = fileURLToPath(new URL("../src-tauri/tauri.updater.generated.json", import.meta.url));
writeFileSync(out, JSON.stringify(config, null, 2) + "\n");
console.log(`[desktop] updater enabled -> ${config.plugins.updater.endpoints[0]}`);
