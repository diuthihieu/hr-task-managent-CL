import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSemver, pickLatest, buildUpdaterManifest, desktopVersionFromUserAgent, isSemver } from "../desktop-releases";

test("compareSemver orders numerically, not lexically", () => {
  assert.ok(compareSemver("1.10.0", "1.9.9") > 0);
  assert.ok(compareSemver("2.0.0", "10.0.0") < 0);
  assert.equal(compareSemver("v1.2.3", "1.2.3"), 0);
});

test("prereleases sort before their release", () => {
  assert.ok(compareSemver("1.0.0-beta.2", "1.0.0") < 0);
  assert.ok(compareSemver("1.0.0-beta.10", "1.0.0-beta.2") > 0);
  assert.ok(compareSemver("1.0.0-alpha", "1.0.0-beta") < 0);
});

test("isSemver", () => {
  assert.ok(isSemver("0.1.0"));
  assert.ok(isSemver("1.2.3-rc.1"));
  assert.ok(!isSemver("1.2"));
  assert.ok(!isSemver("latest"));
});

test("pickLatest uses version order, not insertion order", () => {
  assert.equal(pickLatest([{ version: "1.9.0" }, { version: "1.10.0" }, { version: "1.2.0" }])?.version, "1.10.0");
  assert.equal(pickLatest([]), null);
});

const rel = (version: string, signed: boolean) => ({
  version,
  releaseNotes: `notes ${version}`,
  publishedAt: new Date("2026-09-01T00:00:00Z"),
  updaterUrl: signed ? `https://example.com/${version}.exe` : null,
  updaterSignature: signed ? `sig-${version}` : null,
});

test("updater manifest: newest signed release above the current version", () => {
  const m = buildUpdaterManifest([rel("1.0.0", true), rel("1.1.0", true), rel("1.2.0", false)], "1.0.0");
  assert.deepEqual(m, { version: "1.1.0", notes: "notes 1.1.0", pub_date: "2026-09-01T00:00:00.000Z", url: "https://example.com/1.1.0.exe", signature: "sig-1.1.0" });
});

test("updater manifest: none when up to date, unsigned, or current version is garbage", () => {
  assert.equal(buildUpdaterManifest([rel("1.1.0", true)], "1.1.0"), null);
  assert.equal(buildUpdaterManifest([rel("1.1.0", true)], "2.0.0"), null);
  assert.equal(buildUpdaterManifest([rel("9.0.0", false)], "1.0.0"), null);
  assert.equal(buildUpdaterManifest([rel("9.0.0", true)], "not-a-version"), null);
});

test("desktop client detection from the User-Agent", () => {
  assert.equal(desktopVersionFromUserAgent("Mozilla/5.0 ... Edg/131.0.0.0 BaseworkDesktop/1.4.2"), "1.4.2");
  assert.equal(desktopVersionFromUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/131"), null);
  assert.equal(desktopVersionFromUserAgent(null), null);
});
