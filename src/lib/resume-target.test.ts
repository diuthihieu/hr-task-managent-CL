import { test } from "node:test";
import assert from "node:assert/strict";
import { isPhone, isWorkspaceSlug, workspaceLanding, workspaceSlugOf } from "./resume-target";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

test("phones get the All page, computers and tablets get Home", () => {
  assert.equal(isPhone(IPHONE), true);
  assert.equal(isPhone(ANDROID_PHONE), true);
  assert.equal(isPhone(ANDROID_TABLET), false);
  assert.equal(isPhone(WINDOWS), false);
  assert.equal(isPhone(IPAD), false);
  assert.equal(isPhone(WINDOWS, "?1"), true, "client hint wins");
  assert.equal(isPhone(null), false);
  assert.equal(workspaceLanding("hr-team", true), "/w/hr-team/apps");
  assert.equal(workspaceLanding("hr-team", false), "/w/hr-team");
});

test("only plain workspace slugs are remembered", () => {
  assert.equal(workspaceSlugOf("/w/hr-team/p/123"), "hr-team");
  assert.equal(workspaceSlugOf("/w/hr-team"), "hr-team");
  assert.equal(workspaceSlugOf("/workspaces"), null);
  assert.equal(workspaceSlugOf("/w/../admin"), null);
  assert.equal(workspaceSlugOf("/w/%2e%2e"), null);
  assert.equal(isWorkspaceSlug("hr-team"), true);
  assert.equal(isWorkspaceSlug("HR Team"), false);
  assert.equal(isWorkspaceSlug(""), false);
  assert.equal(isWorkspaceSlug("a".repeat(101)), false);
});
