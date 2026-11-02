import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const desktop = path.resolve(__dirname, "../../../desktop");
const out = path.join(desktop, "src-tauri/tauri.updater.generated.json");

test("updater config rejects signatures without a signed version (BUG-34)", () => {
  try {
    execFileSync(process.execPath, [path.join(desktop, "scripts/prepare-updater-config.mjs")], {
      env: { ...process.env, TAURI_UPDATER_PUBKEY: "test-pubkey", BASEWORK_SERVER_URL: "https://woli.example.invalid/x" },
      stdio: "pipe",
    });
    const updater = JSON.parse(readFileSync(out, "utf8")).plugins.updater;
    assert.equal(updater.requireSignedVersion, true, "a server must not be able to replay an old signature without a version");
    assert.deepEqual(updater.endpoints, ["https://woli.example.invalid/api/desktop/update/{{target}}/{{arch}}/{{current_version}}"]);
  } finally {
    rmSync(out, { force: true });
  }
});
