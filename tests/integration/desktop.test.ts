// Desktop distribution: release registry, "latest" download redirect, the
// public Download page and the Tauri updater endpoint - against the same
// server and database as the web app. Runs after api.test.ts (same database).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { Client, BASE } from "./client";

const TOKEN = process.env.DESKTOP_RELEASE_TOKEN ?? "";
const prisma = new PrismaClient();
const admin = new Client();
const anon = new Client();

test.after(() => prisma.$disconnect());

async function publish(body: Record<string, unknown>, token: string | null = TOKEN) {
  const res = await fetch(`${BASE}/api/desktop/releases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token !== null ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> };
}

const asset = (v: string) => ({
  version: v,
  installerUrl: `https://github.com/example/basework/releases/download/desktop-v${v}/Basework_${v}_x64-setup.exe`,
  installerFileName: `Basework_${v}_x64-setup.exe`,
  installerSizeBytes: 5_242_880,
  sha256: "a".repeat(64),
});

test("before any release: 404 metadata, download falls back to the Download page, no update", async () => {
  assert.equal((await anon.get("/api/desktop/releases/latest")).status, 404);
  const dl = await fetch(`${BASE}/api/desktop/download/latest`, { redirect: "manual" });
  assert.equal(dl.status, 302);
  assert.match(dl.headers.get("location") ?? "", /\/download\?unavailable=1$/);
  assert.equal((await anon.get("/api/desktop/update/windows/x86_64/0.1.0")).status, 204);
  const page = await fetch(`${BASE}/download`);
  assert.equal(page.status, 200, "Download page is public");
  assert.match(await page.text(), /desktop-unavailable/);
});

test("only CI (release token) or a system admin can register releases", async () => {
  assert.ok(TOKEN.length >= 32, "integration runner sets DESKTOP_RELEASE_TOKEN");
  assert.equal((await publish(asset("0.1.0"), null)).status, 401);
  assert.equal((await publish(asset("0.1.0"), "x".repeat(TOKEN.length))).status, 401);
  const member = new Client();
  await member.login("viewer@integration.test", "doesnt-matter"); // not signed in -> still 401
  assert.equal((await member.post("/api/desktop/releases", asset("0.1.0"))).status, 401);
  assert.equal((await publish({ ...asset("0.1.0"), version: "latest" })).status, 400);
  assert.equal((await publish({ ...asset("0.1.0"), installerUrl: "http://insecure.example.com/a.exe" })).status, 400);
  assert.equal((await publish({ ...asset("0.1.0"), installerUrl: "https://evil.example.com/a.exe" })).status, 400, "only allowed artifact hosts");
  const { sha256: _omit, ...noHash } = asset("0.1.0");
  void _omit;
  assert.equal((await publish(noHash)).status, 400, "a checksum is required");
  assert.equal(await prisma.desktopRelease.count(), 0);
});

test("CI registers releases; 'latest' is the highest version, not the newest row", async () => {
  assert.equal((await publish(asset("1.10.0"))).status, 201);
  assert.equal((await publish({ ...asset("1.9.0"), releaseNotes: "older" })).status, 201);
  const latest = await anon.get<{ version: string; minOsVersion: string; publishedAt: string; downloadUrl: string }>("/api/desktop/releases/latest");
  assert.equal(latest.status, 200);
  assert.equal(latest.body.version, "1.10.0");
  assert.match(latest.body.minOsVersion, /Windows 10/);
  const dl = await fetch(`${BASE}/api/desktop/download/latest`, { redirect: "manual" });
  assert.equal(dl.status, 302);
  assert.equal(dl.headers.get("location"), asset("1.10.0").installerUrl);
  // Re-registering the same version is an idempotent upsert.
  assert.equal((await publish(asset("1.10.0"))).status, 201);
  assert.equal(await prisma.desktopRelease.count(), 2);
  const log = await prisma.activityLog.findFirst({ where: { entityType: "desktop_release", action: "published" } });
  assert.ok(log, "publishing is audited");
});

test("Download page shows version, supported OS and release date", async () => {
  const html = await (await fetch(`${BASE}/download`)).text();
  assert.match(html, /data-testid="desktop-version">1\.10\.0</);
  assert.match(html, /data-testid="desktop-os">Windows 10/);
  assert.match(html, /data-testid="desktop-release-date">/);
  assert.match(html, /href="\/api\/desktop\/download\/latest"/);
  const inApp = await (await fetch(`${BASE}/download`, { headers: { "user-agent": "Mozilla/5.0 Edg/131 BaseworkDesktop/1.9.0", cookie: "bw_locale=en" } })).text();
  assert.match(inApp, /You are using the desktop app/);
  assert.match(inApp, /Version 1\.10\.0 is available/);
});

test("updater endpoint offers only newer, signed releases", async () => {
  assert.equal((await anon.get("/api/desktop/update/windows/x86_64/1.9.0")).status, 204, "1.10.0 is not signed yet");
  await publish({ ...asset("1.10.0"), updaterUrl: asset("1.10.0").installerUrl, updaterSignature: "dW50cnVzdGVkIGNvbW1lbnQ=" });
  const up = await anon.get<{ version: string; url: string; signature: string; pub_date: string }>("/api/desktop/update/windows/x86_64/1.9.0");
  assert.equal(up.status, 200);
  assert.equal(up.body.version, "1.10.0");
  assert.equal(up.body.signature, "dW50cnVzdGVkIGNvbW1lbnQ=");
  assert.equal((await anon.get("/api/desktop/update/windows/x86_64/1.10.0")).status, 204);
  assert.equal((await anon.get("/api/desktop/update/darwin/aarch64/1.0.0")).status, 204);
});

test("admins can pull a bad build; the download link falls back to the previous version", async () => {
  assert.ok((await admin.login("admin@integration.test", "AdminPass456")) || (await admin.login("admin@integration.test", "Bootstrap123")));
  const list = await admin.get<{ id: string; version: string }[]>("/api/desktop/releases");
  assert.equal(list.status, 200);
  const bad = list.body.find((r) => r.version === "1.10.0")!;
  assert.equal((await anon.get("/api/desktop/releases")).status, 401, "full list is admin-only");
  assert.equal((await admin.patch(`/api/admin/desktop-releases/${bad.id}`, { isPublished: false })).status, 200);
  const latest = await anon.get<{ version: string }>("/api/desktop/releases/latest");
  assert.equal(latest.body.version, "1.9.0");
  assert.equal((await anon.get("/api/desktop/update/windows/x86_64/1.0.0")).status, 204, "unpublished builds are not offered as updates");
  // An admin session can register releases too (manual fallback when CI isn't configured).
  assert.equal((await admin.post("/api/desktop/releases", asset("1.9.1"))).status, 201);
});
