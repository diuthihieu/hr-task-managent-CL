import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath } from "./safe-redirect";

test("only same-origin app paths survive as a post-sign-in redirect", () => {
  for (const bad of ["/\\evil.com", "/\t/evil.com", "/\n/evil.com", "//evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", " /w/a", "/w/a\u0000", undefined, null, 42, ["/w/a", "/w/b"]]) {
    assert.equal(safeRedirectPath(bad), "/workspaces", JSON.stringify(bad));
  }
  for (const ok of ["/w/hr/p/1?x=1#y", "/invite/abc", "/workspaces", "/"]) assert.equal(safeRedirectPath(ok), ok);
  assert.equal(safeRedirectPath("//evil.com", "/home"), "/home", "custom fallback");
});
