import test from "node:test";
import assert from "node:assert/strict";
import type { FieldRow } from "@/types";
import {
  clipboardEntryToField,
  clipboardTextToField,
  createRowClipboardPayload,
  rowClipboardPatch,
} from "../grid-clipboard";

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

test("cell clipboard preserves typed values and safely converts numeric fields", () => {
  const result = clipboardEntryToField(
    { fieldId: "hours", fieldType: "number", fieldConfig: "{}", value: 12.5 },
    field("cost", "currency")
  );
  assert.deepEqual(result, { ok: true, value: 12.5 });
});

test("select clipboard maps options by label when pasting into another field", () => {
  const result = clipboardEntryToField(
    { fieldId: "priority-a", fieldType: "single_select", fieldConfig: JSON.stringify({ options: [{ id: "a-high", label: "High", color: "#f00" }] }), value: "a-high" },
    field("priority-b", "single_select", { options: [{ id: "b-high", label: "High", color: "#f00" }] })
  );
  assert.deepEqual(result, { ok: true, value: "b-high" });
});

test("row paste skips calculated fields and preserves editable fields", () => {
  const fields = [field("title", "text"), field("score", "number"), field("formula", "formula", {}, { readOnly: true })];
  const payload = createRowClipboardPayload(fields, ["Task A", 9, 18], "Task A\t9\t18");
  assert.deepEqual(rowClipboardPatch(payload, fields), { title: "Task A", score: 9 });
});

test("plain text paste validates the target field type", () => {
  assert.deepEqual(clipboardTextToField("42", field("score", "number")), { ok: true, value: 42 });
  assert.deepEqual(clipboardTextToField("not a number", field("score", "number")), { ok: false });
  assert.deepEqual(clipboardTextToField("Có", field("done", "checkbox")), { ok: true, value: true });
});
