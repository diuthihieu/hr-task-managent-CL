import { test } from "node:test";
import assert from "node:assert/strict";
import { safeContentType } from "./content-type";
import { attachmentDataFromUpload, clientTokenOptions } from "./upload-meta";

const payload = (fileName: string, contentType: string, sizeBytes = 50_000_000) => ({ taskId: "t1", fileName, contentType, sizeBytes, workspaceId: "w1", uploadedById: "u1" });
const blob = { pathname: "workspaces/w1/tasks/t1/a-xyz.bin", url: "https://blob.example/a" };

test("direct uploads store the checked type and the real size, never the browser's claim", () => {
  const data = attachmentDataFromUpload(payload("a.pdf", "application/pdf", 90_000_000), blob, { size: 5_242_880 }, "vercel_blob");
  assert.equal(data.sizeBytes, 5_242_880, "size from the stored blob");
  assert.equal(data.contentType, "application/pdf");
  assert.equal(attachmentDataFromUpload(payload("a.xml", "text/xml"), blob, { size: 1 }, "vercel_blob").contentType, "application/octet-stream");
  assert.equal(attachmentDataFromUpload(payload("a.png", "application/pdf"), blob, { size: 1 }, "vercel_blob").contentType, "application/octet-stream");
  assert.deepEqual(
    { ...attachmentDataFromUpload(payload("clip.mov", "video/quicktime"), blob, { size: 7 }, "vercel_blob_public") },
    { workspaceId: "w1", taskId: "t1", fileName: "clip.mov", contentType: "video/quicktime", sizeBytes: 7, storageProvider: "vercel_blob_public", storageKey: blob.pathname, url: blob.url, uploadedById: "u1" }
  );
});

test("the upload token only allows the checked type", () => {
  assert.deepEqual(clientTokenOptions(payload("a.xml", "text/xml", 10)).allowedContentTypes, ["application/octet-stream"]);
  assert.deepEqual(clientTokenOptions(payload("a.pdf", "application/pdf", 10)), { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 10 });
});

test("types the in-app viewer plays keep their type (video and audio over 4 MB go this way)", () => {
  for (const [name, type] of [["a.mov", "video/quicktime"], ["a.webm", "video/webm"], ["a.webm", "audio/webm"], ["a.ogg", "audio/ogg"], ["a.ogg", "video/ogg"], ["a.wav", "audio/wav"], ["a.wav", "audio/x-wav"], ["a.m4a", "audio/mp4"], ["a.m4a", "audio/x-m4a"], ["a.aac", "audio/aac"], ["a.avif", "image/avif"], ["a.bmp", "image/bmp"], ["a.mp4", "video/mp4"]]) {
    assert.equal(safeContentType({ name, type }), type, name);
  }
  assert.equal(safeContentType({ name: "a.html", type: "text/html" }), "application/octet-stream");
});
