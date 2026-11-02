import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReleasePayload, ReleasePayloadError } from "../release-payload";

const URL_WIN = "https://github.com/diuthihieu/hr-task-managent-CL/releases/download/desktop-v1.2.0/woli_1.2.0_x64-setup.exe";
const HASH = "ab".repeat(32);

test("payload carries sha256 and platform, as the API requires", () => {
  const p = buildReleasePayload({ version: "v1.2.0", installerUrl: ` ${URL_WIN} `, sha256: HASH, platform: "windows-x86_64", notes: "" });
  assert.deepEqual(p, {
    version: "1.2.0",
    platform: "windows-x86_64",
    installerUrl: URL_WIN,
    installerFileName: "woli_1.2.0_x64-setup.exe",
    sha256: HASH,
    releaseNotes: undefined,
  });
});

test("Get-FileHash output (upper case, spaces) is normalised to lower-case hex", () => {
  const p = buildReleasePayload({ version: "1.0.0", installerUrl: URL_WIN, sha256: ` ${HASH.toUpperCase().slice(0, 32)} ${HASH.toUpperCase().slice(32)}\n`, platform: "android", notes: "Fixes" });
  assert.equal(p.sha256, HASH);
  assert.equal(p.platform, "android");
  assert.equal(p.releaseNotes, "Fixes");
});

test("file name is decoded from the URL path", () => {
  const p = buildReleasePayload({ version: "1.0.0", installerUrl: "https://github.com/a/b/releases/download/android-v1.0.0/woli%20app.apk", sha256: HASH, platform: "android", notes: "" });
  assert.equal(p.installerFileName, "woli app.apk");
});

test("a SHA-256 of the wrong length or with non-hex characters is rejected", () => {
  for (const bad of [HASH.slice(0, 63), HASH + "a", "zz" + HASH.slice(2), ""]) {
    assert.throws(() => buildReleasePayload({ version: "1.0.0", installerUrl: URL_WIN, sha256: bad, platform: "windows-x86_64", notes: "" }), (e: unknown) => e instanceof ReleasePayloadError && e.field === "sha256");
  }
});

test("an unknown platform or a URL that isn't https is rejected", () => {
  assert.throws(() => buildReleasePayload({ version: "1.0.0", installerUrl: URL_WIN, sha256: HASH, platform: "macos", notes: "" }), (e: unknown) => e instanceof ReleasePayloadError && e.field === "platform");
  assert.throws(() => buildReleasePayload({ version: "1.0.0", installerUrl: "http://github.com/x.exe", sha256: HASH, platform: "windows-x86_64", notes: "" }), (e: unknown) => e instanceof ReleasePayloadError && e.field === "installerUrl");
  assert.throws(() => buildReleasePayload({ version: "1.0.0", installerUrl: "not a url", sha256: HASH, platform: "windows-x86_64", notes: "" }), (e: unknown) => e instanceof ReleasePayloadError && e.field === "installerUrl");
});
