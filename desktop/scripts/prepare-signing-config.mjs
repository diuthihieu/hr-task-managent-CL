// Generates src-tauri/tauri.signing.generated.json, merged with `tauri build --config ...`
// in the release job only, so Tauri Authenticode-signs the app and both installers while it
// bundles them - before the updater .sig is made, so the .sig matches the signed file (BUG-27).
//   WINDOWS_SIGN_COMMAND   the signing provider's command; "%1" is replaced with the file to
//                          sign. Tauri splits it on spaces, so no argument may contain one.
// Credentials stay with the provider tool (OIDC or the release environment's secrets).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const signCommand = (process.env.WINDOWS_SIGN_COMMAND ?? "").trim();
if (!signCommand) {
  console.error("WINDOWS_SIGN_COMMAND is not set - cannot sign the installers (docs/DESKTOP.md, Code signing).");
  process.exit(1);
}
if (!signCommand.split(" ").includes("%1")) {
  console.error('WINDOWS_SIGN_COMMAND must contain "%1" as its own argument (the file to sign).');
  process.exit(1);
}
const config = { bundle: { windows: { signCommand } } };
const out = fileURLToPath(new URL("../src-tauri/tauri.signing.generated.json", import.meta.url));
writeFileSync(out, JSON.stringify(config, null, 2) + "\n");
console.log(`[desktop] Authenticode signing enabled -> ${signCommand.split(" ")[0]}`);
