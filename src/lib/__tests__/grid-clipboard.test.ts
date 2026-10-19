import test from "node:test";
import assert from "node:assert/strict";
import type { FieldRow } from "@/types";
import {
  clipboardEntryToField,
  clipboardTextToField,
  columnOf,
  createClipboardPayload,
  matchColumn,
  parseTsv,
  sanitizeForTarget,
  toTsv,
  type PasteTargetContext,
} from "../grid-clipboard";
import { planFillDown, planPaste } from "../grid-selection";

const field = (id: string, type: string, config: object = {}, extra: Partial<FieldRow> = {}): FieldRow => ({
  id,
  projectId: "project",
  name: id,
  type,
  config: JSON.stringify(config),
  order: 0,
  isPrimary: false,
  visible: true,
  description: null,
  defaultValue: null,
  ...extra,
});

const ctx: PasteTargetContext = { memberIds: new Set(["u1"]), linkIds: { sys_parent: new Set(["t1"]) }, okrIds: new Set() };

test("cell clipboard preserves typed values and safely converts numeric fields", () => {
  const result = clipboardEntryToField(columnOf(field("hours", "number")), 12.5, field("cost", "currency"));
  assert.deepEqual(result, { ok: true, value: 12.5 });
});

test("select clipboard maps options by label when pasting into another field", () => {
  const source = field("priority-a", "single_select", { options: [{ id: "a-high", label: "High", color: "#f00" }] });
  const target = field("priority-b", "single_select", { options: [{ id: "b-high", label: "High", color: "#f00" }] });
  assert.deepEqual(clipboardEntryToField(columnOf(source), "a-high", target), { ok: true, value: "b-high" });
});

test("the same built-in column of another project maps categories by name instead of copying foreign ids", () => {
  const catA = field("sys_category", "single_select", { options: [{ id: "cat-a", label: "Tuyển dụng", color: "#f00" }] }, { projectId: "A", system: true });
  const catB = field("sys_category", "single_select", { options: [{ id: "cat-b", label: "tuyển dụng", color: "#0f0" }] }, { projectId: "B", system: true });
  assert.deepEqual(clipboardEntryToField(columnOf(catA), "cat-a", catB), { ok: true, value: "cat-b" });
  const catC = field("sys_category", "single_select", { options: [{ id: "cat-c", label: "Đào tạo", color: "#00f" }] }, { projectId: "C", system: true });
  assert.deepEqual(clipboardEntryToField(columnOf(catA), "cat-a", catC), { ok: false });
  // Within one project the value is kept as-is.
  assert.deepEqual(clipboardEntryToField(columnOf(catA), "cat-a", catA), { ok: true, value: "cat-a" });
});

test("whole-row paste matches built-in columns by id and custom columns by name across projects", () => {
  const columns = [
    columnOf(field("sys_title", "text", {}, { projectId: "A", system: true })),
    columnOf(field("custom-a", "number", {}, { projectId: "A", name: "Ngân sách" })),
  ];
  assert.equal(matchColumn(columns, field("sys_title", "text", {}, { projectId: "B", system: true })), 0);
  assert.equal(matchColumn(columns, field("custom-b", "number", {}, { projectId: "B", name: " ngân sách " })), 1);
  assert.equal(matchColumn(columns, field("custom-c", "number", {}, { projectId: "B", name: "Khác" })), -1);
});

test("references the target project cannot accept are dropped instead of failing the row", () => {
  assert.deepEqual(sanitizeForTarget(field("sys_assignees", "people"), ["u1", "u-other"], ctx), { ok: true, value: ["u1"] });
  assert.deepEqual(sanitizeForTarget(field("sys_assignees", "people"), ["u-other"], ctx), { ok: false });
  assert.deepEqual(sanitizeForTarget(field("sys_parent", "link", { maxLinks: 1 }), ["t-foreign"], ctx), { ok: false });
  assert.deepEqual(sanitizeForTarget(field("sys_parent", "link", { maxLinks: 1 }), ["t1"], ctx), { ok: true, value: ["t1"] });
  const status = field("sys_status", "status", { options: [{ id: "s1", label: "To Do", color: "#000" }] });
  assert.deepEqual(sanitizeForTarget(status, "s-other-workspace", ctx), { ok: false });
  assert.deepEqual(sanitizeForTarget(status, null, ctx), { ok: false });
  assert.deepEqual(sanitizeForTarget(field("sys_title", "text", {}, { isPrimary: true }), "  ", ctx), { ok: false });
});

test("plain text paste validates the target field type", () => {
  assert.deepEqual(clipboardTextToField("42", field("score", "number")), { ok: true, value: 42 });
  assert.deepEqual(clipboardTextToField("not a number", field("score", "number")), { ok: false });
  assert.deepEqual(clipboardTextToField("Có", field("done", "checkbox")), { ok: true, value: true });
  assert.deepEqual(clipboardTextToField("31/10/2026", field("due", "date")), { ok: true, value: "2026-10-31" });
  assert.deepEqual(clipboardTextToField("31/02/2026", field("due", "date")), { ok: false });
  const lookup = { idForLabel: (_f: FieldRow, label: string) => (label === "Trần Lan" ? "u1" : null) };
  assert.deepEqual(clipboardTextToField("Trần Lan", field("sys_assignees", "people"), lookup), { ok: true, value: ["u1"] });
  assert.deepEqual(clipboardTextToField("Người lạ", field("sys_assignees", "people"), lookup), { ok: false });
});

test("TSV round-trips cells containing tabs, newlines and quotes (Excel format)", () => {
  const rows = [["Task A", "line 1\nline 2", 'say "hi"'], ["Task B", "", "x\ty"]];
  assert.deepEqual(parseTsv(toTsv(rows)), rows);
  assert.deepEqual(parseTsv("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTsv('"unterminated\tx'), [['"unterminated', "x"]]);
});

test("payload text is TSV of the display values", () => {
  const payload = createClipboardPayload("cells", [field("a", "text"), field("b", "number")], [["x", 1]], [["x", "1"]]);
  assert.equal(payload.text, "x\t1");
  assert.equal(payload.columns[1].fieldType, "number");
});

test("paste plan: one cell fills the selection, blocks tile exact multiples, overflow rows are new rows", () => {
  const grid = { rows: 3, cols: 4 };
  const fill = planPaste({ rows: 1, cols: 1 }, { top: 0, bottom: 2, left: 1, right: 1 }, grid);
  assert.deepEqual(fill.map((c) => c.row), [0, 1, 2]);
  const tiled = planPaste({ rows: 1, cols: 2 }, { top: 0, bottom: 1, left: 0, right: 3 }, grid);
  assert.equal(tiled.length, 8);
  assert.deepEqual(tiled.slice(0, 4).map((c) => c.srcCol), [0, 1, 0, 1]);
  const overflow = planPaste({ rows: 3, cols: 2 }, { top: 2, bottom: 2, left: 3, right: 3 }, grid);
  // Column 4 does not exist (dropped); rows 3 and 4 are new rows.
  assert.deepEqual(overflow.map((c) => [c.row, c.col]), [[2, 3], [3, 3], [4, 3]]);
});

test("fill down copies the top row, or the row above for a single row", () => {
  assert.deepEqual(planFillDown({ top: 1, bottom: 3, left: 0, right: 0 }), { sourceRow: 1, rows: [2, 3] });
  assert.deepEqual(planFillDown({ top: 2, bottom: 2, left: 0, right: 1 }), { sourceRow: 1, rows: [2] });
  assert.equal(planFillDown({ top: 0, bottom: 0, left: 0, right: 0 }), null);
});
