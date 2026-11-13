import { test } from "node:test";
import assert from "node:assert/strict";
import { cellValue, markdownBlocks, plainInline, sheetName } from "./markdown-blocks";

test("tables become cells; the :--- row and --- rules are dropped", () => {
  const md = ["# Báo cáo", "", "- **Ngày:** 13/11", "---", "| Tên | Giờ | Tỷ lệ |", "| :--- | :---: | ---: |", "| **Hieu** | 45.8 | 59.61% |", "| Tam | 4.5 |", "", "Hết."].join("\n");
  assert.deepEqual(markdownBlocks(md), [
    { kind: "heading", level: 1, text: "Báo cáo" },
    { kind: "space" },
    { kind: "bullet", text: "Ngày: 13/11" },
    { kind: "table", header: ["Tên", "Giờ", "Tỷ lệ"], rows: [["Hieu", "45.8", "59.61%"], ["Tam", "4.5", ""]] },
    { kind: "space" },
    { kind: "paragraph", text: "Hết." },
  ]);
});

test("a row with too many cells keeps them in the last column; text with a pipe but no table stays text", () => {
  const t = markdownBlocks("| a | b |\n|---|---|\n| 1 | 2 | 3 |")[0];
  assert.deepEqual(t, { kind: "table", header: ["a", "b"], rows: [["1", "2 | 3"]] });
  assert.deepEqual(markdownBlocks("Chọn A | B tuỳ ý"), [{ kind: "paragraph", text: "Chọn A | B tuỳ ý" }]);
});

test("inline marks are removed, links keep their address", () => {
  assert.equal(plainInline("**Đậm** và `code` và *nghiêng* [xem](https://x.test/a)"), "Đậm và code và nghiêng xem (https://x.test/a)");
  assert.equal(plainInline("2 * 3 * 4"), "2 * 3 * 4");
});

test("cell values: numbers and percentages become numbers, codes stay text", () => {
  assert.equal(cellValue("45.8"), 45.8);
  assert.equal(cellValue("1,250"), 1250);
  assert.deepEqual(cellValue("59.61%"), { percent: 0.5961 });
  assert.equal(cellValue("2026-11"), "2026-11");
  assert.equal(cellValue("007"), "007");
  assert.equal(cellValue("-"), "-");
});

test("sheet names: valid for Excel and never repeated, even when the numbered name is taken too", () => {
  const used = new Set(["report"]);
  assert.equal(sheetName("Sales", used, 1), "Sales");
  assert.equal(sheetName("Sales 3", used, 2), "Sales 3");
  assert.equal(sheetName("sales", used, 3), "sales 4", "\"sales 3\" is taken, so it counts on");
  assert.equal(sheetName("Report", used, 4), "Report 4");
  assert.equal(sheetName("A/B: [x]?*", used, 5), "A B x");
  assert.equal(sheetName("", used, 6), "Table 6");
  const long = sheetName("3. Tình trạng tiến độ các task tồn đọng / đang triển khai", used, 7);
  assert.ok(long.length <= 31);
  const again = sheetName("3. Tình trạng tiến độ các task tồn đọng / đang triển khai", used, 8);
  assert.ok(again.length <= 31 && again !== long);
});
