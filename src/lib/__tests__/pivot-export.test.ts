import { test } from "node:test";
import assert from "node:assert/strict";
import { exportFileName, pivotMatrix, toCsv } from "../pivot-export";

const p = { rowField: "Assignees", colField: "Category", rows: [{ key: "a", label: "An" }, { key: "b", label: "Bình, Tâm" }], cols: [{ key: "x", label: "Payroll" }], cells: [[6], [2.5]], rowTotals: [6, 2.5], colTotals: [8.5], total: 8.5 };

test("pivot export: header, rows, totals; CSV is Excel-safe", () => {
  const m = pivotMatrix(p, "Tổng");
  assert.deepEqual(m, [["Assignees / Category", "Payroll", "Tổng"], ["An", 6, 6], ["Bình, Tâm", 2.5, 2.5], ["Tổng", 8.5, 8.5]]);
  const csv = toCsv([...m, ["=HYPERLINK(1)", 1]]);
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"Bình, Tâm",2.5,2.5/);
  assert.match(csv, /'=HYPERLINK\(1\),1$/, "formula injection neutralised");
});

test("export file name is ASCII: Vietnamese accents and đ removed, unsafe characters dropped", () => {
  assert.equal(exportFileName("Giờ thực tế theo người và danh mục"), "Gio thuc te theo nguoi va danh muc");
  assert.equal(exportFileName("Đào tạo / Q4: kế hoạch?"), "Dao tao Q4 ke hoach");
  assert.equal(exportFileName("📊"), "summary");
  assert.equal(exportFileName(""), "summary");
});
