// Registers a built desktop installer with the Basework server so the web
// Download button and the updater point at it. Run by CI after the installer
// has been uploaded to the GitHub Release.
//
// Required env:
//   BASEWORK_SERVER_URL    web app origin, e.g. https://basework.example.com
//   DESKTOP_RELEASE_TOKEN  same value as the server's DESKTOP_RELEASE_TOKEN (secret)
//   RELEASE_VERSION        e.g. 1.2.0
//   INSTALLER_PATH         local path of the installer that users download
//   INSTALLER_URL          public https URL of that installer
// Optional:
//   UPDATER_SIG_PATH       .sig file produced by Tauri (enables auto-update for this release)
//   RELEASE_NOTES, RELEASE_CHANNEL (stable|beta), MIN_OS_VERSION
import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { basename } from "node:path";

function need(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return v;
}

const server = new URL(need("BASEWORK_SERVER_URL")).origin;
const token = need("DESKTOP_RELEASE_TOKEN");
const version = need("RELEASE_VERSION").replace(/^v/, "");
const installerPath = need("INSTALLER_PATH");
const installerUrl = need("INSTALLER_URL");

const bytes = readFileSync(installerPath);
const sigPath = process.env.UPDATER_SIG_PATH;
const body = {
  version,
  platform: "windows-x86_64",
  channel: process.env.RELEASE_CHANNEL || "stable",
  installerUrl,
  installerFileName: basename(installerPath),
  installerSizeBytes: statSync(installerPath).size,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  ...(sigPath && existsSync(sigPath) ? { updaterUrl: installerUrl, updaterSignature: readFileSync(sigPath, "utf8").trim() } : {}),
  ...(process.env.RELEASE_NOTES ? { releaseNotes: process.env.RELEASE_NOTES } : {}),
  ...(process.env.MIN_OS_VERSION ? { minOsVersion: process.env.MIN_OS_VERSION } : {}),
};

const res = await fetch(`${server}/api/desktop/releases`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Registering release failed: HTTP ${res.status} ${text}`);
  process.exit(1);
}
console.log(`Registered Basework Desktop v${version} (${body.installerFileName}, sha256 ${body.sha256}${body.updaterSignature ? ", signed for auto-update" : ""})`);
