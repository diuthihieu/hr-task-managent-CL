import { test } from "node:test";
import assert from "node:assert/strict";
import { field, record } from "./helpers";
import { appendSources, mergeSource, PROJECT_FIELD_ID } from "../data-combine";
import { getCellValue } from "../query-engine";

// U8b: Power Query-like Append (stack the tasks of several projects) and Merge (left join on a key).
const cat = (opts: { id: string; label: string }[]) => field("sys_category", "Category", "single_select", { options: opts });

test("append stacks projects, matching fields by id or name, merging select options, adding Project", () => {
  const a = { name: "HR", fields: [field("sys_title", "Title", "text"), cat([{ id: "c1", label: "Payroll" }]), field("fa", "Points", "number")], records: [record("t1", { sys_title: "A1", sys_category: "c1", fa: 2 })] };
  const b = { name: "IT", fields: [field("sys_title", "Title", "text"), cat([{ id: "c9", label: "Infra" }]), field("fb", "points", "number"), field("fx", "Only in IT", "text")], records: [record("t2", { sys_title: "B1", sys_category: "c9", fb: 5, fx: "?" })] };
  const out = appendSources(a, [b]);
  assert.deepEqual(out.records.map((r) => [r.data.sys_title, r.data.fa, r.data[PROJECT_FIELD_ID]]), [["A1", 2, "HR"], ["B1", 5, "IT"]]);
  assert.equal(out.records[1].data.fx, undefined, "fields only in another project are dropped");
  const category = out.fields.find((f) => f.id === "sys_category")!;
  assert.equal(getCellValue(out.records[1], category, out.fields) !== undefined, true);
  assert.deepEqual(JSON.parse(category.config!).options.map((o: { label: string }) => o.label), ["Payroll", "Infra"]);
  assert.ok(out.fields.some((f) => f.id === PROJECT_FIELD_ID));
});

test("merge adds the matched right-hand columns (left join on a key, text compared case-insensitively)", () => {
  const left = { name: "Tasks", fields: [field("sys_title", "Title", "text"), field("emp", "Employee code", "text")], records: [record("t1", { sys_title: "Payroll", emp: "nv01" }), record("t2", { sys_title: "Hiring", emp: "NV02 " }), record("t3", { sys_title: "No match", emp: "x" })] };
  const right = { name: "Staff", fields: [field("code", "Code", "text"), field("dept", "Department", "single_select", { options: [{ id: "d1", label: "Finance" }] }), field("rate", "Rate", "number")], records: [record("s1", { code: "NV01", dept: "d1", rate: 10 }), record("s2", { code: "nv02", dept: null, rate: 12 })] };
  const out = mergeSource(left, right, { leftFieldId: "emp", rightFieldId: "code", fieldIds: ["dept", "rate"] });
  const dept = out.fields.find((f) => f.id === "m:dept")!;
  assert.equal(dept.name, "Staff · Department");
  assert.deepEqual(out.records.map((r) => [r.data["m:dept"] ?? null, r.data["m:rate"] ?? null]), [["d1", 10], [null, 12], [null, null]]);
  assert.equal(getCellValue(out.records[0], dept, out.fields), "d1");
  assert.equal(out.records.length, 3, "left join keeps every left row");
});
