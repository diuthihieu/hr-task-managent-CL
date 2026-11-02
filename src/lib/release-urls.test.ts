import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedArtifactUrl, artifactPrefixes } from "./release-urls";

const P = ["https://github.com/acme/app/releases/download/"];

test("release artifact URLs (BUG-26): only under the configured release prefixes", () => {
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download/desktop-v1.0.0/app.exe", P), true);
  assert.equal(allowedArtifactUrl("https://github.com/stranger/repo/releases/download/v1/x.exe", P), false, "another repo on github.com");
  assert.equal(allowedArtifactUrl("https://evil.public.blob.vercel-storage.com/x.exe", P), false, "any public Blob store");
  assert.equal(allowedArtifactUrl("http://github.com/acme/app/releases/download/v1/x.exe", P), false, "https only");
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download/../../../stranger/repo/x.exe", P), false, "..");
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download/%2e%2e/%2E%2E/x.exe", P), false, "encoded dots");
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download/v1%2fx.exe", P), false, "encoded slash");
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download\\..\\x.exe", P), false, "backslash");
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download/v1/x.exe@evil.com", P), false, "@");
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/downloadX/x.exe", P), false, "prefix must match whole segments");
  assert.equal(allowedArtifactUrl("not a url", P), false);
  assert.equal(allowedArtifactUrl("https://github.com/acme/app/releases/download/v1/x.exe", []), false, "no prefixes: refuse");
});

test("artifact prefixes: env list, else this repository's GitHub releases", () => {
  assert.deepEqual(artifactPrefixes({ DESKTOP_ARTIFACT_PREFIXES: " https://a.example/x/ , https://b.example/y/" }), ["https://a.example/x/", "https://b.example/y/"]);
  assert.deepEqual(artifactPrefixes({}), ["https://github.com/diuthihieu/hr-task-managent-CL/releases/download/"]);
});
