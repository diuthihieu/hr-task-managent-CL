import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

// BUG-27: Authenticode signing is merged in only for release builds, through Tauri's signCommand.
const desktop = path.resolve(__dirname, "../../../desktop");
const script = path.join(desktop, "scripts/prepare-signing-config.mjs");
const out = path.join(desktop, "src-tauri/tauri.signing.generated.json");
const run = (cmd: string | undefined) => {
  const env = { ...process.env };
  delete env.WINDOWS_SIGN_COMMAND;
  if (cmd !== undefined) env.WINDOWS_SIGN_COMMAND = cmd;
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
};

test("signing config carries the provider's sign command", () => {
  try {
    const r = run("trusted-signing-cli -e https://weu.codesigning.azure.net -a acct -c profile -d woli %1");
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(cfg, { bundle: { windows: { signCommand: "trusted-signing-cli -e https://weu.codesigning.azure.net -a acct -c profile -d woli %1" } } });
  } finally {
    rmSync(out, { force: true });
  }
});

test("no command, or one without the %1 file placeholder, fails and writes nothing", () => {
  for (const cmd of [undefined, "  ", "signtool sign /fd sha256"]) {
    const r = run(cmd);
    assert.notEqual(r.status, 0, `should fail for ${JSON.stringify(cmd)}`);
    assert.equal(existsSync(out), false);
  }
});
