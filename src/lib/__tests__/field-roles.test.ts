import { test } from "node:test";
import assert from "node:assert/strict";
import { findFieldByRole, isDoneLabel, normalizeName, rolesForType } from "../field-roles";
import { detectCaptureFieldRoles } from "../capture-engine";
import { field } from "./helpers";

test("normalizeName strips Vietnamese diacritics", () => {
  assert.equal(normalizeName("Trạng Thái"), "trang thai");
  assert.equal(normalizeName("Người phụ trách"), "nguoi phu trach");
  assert.equal(normalizeName("Đầu ra"), "dau ra");
});

test("matches English and Vietnamese field names", () => {
  const fields = [
    field("cat", "Phân loại", "single_select"),
    field("st", "Trạng thái", "status"),
    field("pr", "Mức độ ưu tiên", "single_select"),
    field("start", "Ngày bắt đầu", "date"),
    field("due", "Hạn chót", "date"),
    field("own", "Người phụ trách", "person"),
  ];
  assert.equal(findFieldByRole(fields, "status")?.id, "st");
  assert.equal(findFieldByRole(fields, "priority")?.id, "pr");
  assert.equal(findFieldByRole(fields, "category")?.id, "cat");
  assert.equal(findFieldByRole(fields, "start_date")?.id, "start");
  assert.equal(findFieldByRole(fields, "due_date")?.id, "due");
  assert.equal(findFieldByRole(fields, "owner")?.id, "own");
});

test("explicit role beats name match, and a pinned field is not reused for another role", () => {
  const fields = [
    field("s1", "Status", "single_select", { role: "category" }),
    field("s2", "Giai đoạn", "status", { role: "status" }),
  ];
  assert.equal(findFieldByRole(fields, "status")?.id, "s2");
  assert.equal(findFieldByRole(fields, "category")?.id, "s1");
});

test("type fallback is opt-in", () => {
  const fields = [field("d", "Ngày", "date")];
  assert.equal(findFieldByRole(fields, "due_date"), null);
  assert.equal(findFieldByRole(fields, "due_date", { fallbackToType: true })?.id, "d");
});

test("'hạn' does not match inside other words", () => {
  const fields = [field("d", "Ngày hoàn thành thực tế", "date")];
  assert.equal(findFieldByRole(fields, "due_date"), null);
});

test("rolesForType lists compatible roles", () => {
  assert.deepEqual(rolesForType("person"), ["owner"]);
  assert.ok(rolesForType("status").includes("status"));
  assert.deepEqual(rolesForType("text"), []);
});

test("isDoneLabel", () => {
  for (const l of ["Done", "Completed", " hoàn thành ", "Đã xong", "Đã đóng"]) assert.ok(isDoneLabel(l), l);
  for (const l of ["In Progress", "Đang làm", ""]) assert.ok(!isDoneLabel(l), l);
});

test("capture roles on a Vietnamese task table", () => {
  const fields = [
    field("name", "Tên công việc", "text", undefined, { isPrimary: true }),
    field("cat", "Danh mục", "single_select"),
    field("st", "Trạng thái", "status"),
    field("pr", "Ưu tiên", "single_select"),
    field("start", "Bắt đầu", "date"),
    field("due", "Deadline", "date"),
    field("hrs", "Số giờ ước tính", "number"),
    field("out", "Kết quả đầu ra", "long_text"),
    field("proc", "Kế hoạch thực hiện", "long_text"),
  ];
  const r = detectCaptureFieldRoles(fields);
  assert.equal(r.primaryField?.id, "name");
  assert.equal(r.categoryField?.id, "cat");
  assert.equal(r.statusField?.id, "st");
  assert.equal(r.priorityField?.id, "pr");
  assert.equal(r.startField?.id, "start");
  assert.equal(r.dueField?.id, "due");
  assert.equal(r.durationField?.id, "hrs");
  assert.equal(r.outputField?.id, "out");
  assert.equal(r.processField?.id, "proc");
});
