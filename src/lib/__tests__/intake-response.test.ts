import test from "node:test";
import assert from "node:assert/strict";
import { naturalIntakeMessage, parseIntakeModelResponse } from "../ai/intake-response";

test("task intake returns only the natural message from valid structured output", () => {
  const raw = JSON.stringify({ type: "answer", message: "Xin chào\n\nDự án đang hoạt động.", draft: null });
  assert.equal(naturalIntakeMessage(raw, "fallback"), "Xin chào\n\nDự án đang hoạt động.");
  assert.equal(parseIntakeModelResponse(raw)?.type, "answer");
});

test("task intake recovers the message from a malformed JSON wrapper", () => {
  const raw = '{"type":"answer","message":"Có 1 file đính kèm.\\n\\nTôi đã đọc nội dung file", "draft":';
  assert.equal(naturalIntakeMessage(raw, "fallback"), "Có 1 file đính kèm.\n\nTôi đã đọc nội dung file");
});

test("task intake never leaks schema keys when no natural message can be recovered", () => {
  assert.equal(naturalIntakeMessage('{"type":"answer","draft":null}', "Không thể tạo câu trả lời."), "Không thể tạo câu trả lời.");
});

test("plain natural-language answers are preserved", () => {
  assert.equal(naturalIntakeMessage("Dự án có một công việc đang thực hiện.", "fallback"), "Dự án có một công việc đang thực hiện.");
});
