import { test } from "node:test";
import assert from "node:assert/strict";
import { exportCell, exportSummary, toCsv, type ExportTask } from "./my-export-format";

const task = (o: Partial<ExportTask>): ExportTask => ({
  id: "t1", workspace: "WS A", workspaceSlug: "ws-a", projectId: "p1", project: "P1", title: "Task", parent: null, status: "Done", category: null, priority: "medium",
  assignees: [], reportTo: [], startDate: null, dueDate: null, completedAt: null, estimateMinutes: null, actualMinutes: null, ownActualMinutes: 0, ownEstimateMinutes: 0, progress: 0,
  createdAt: new Date("2026-10-01T03:00:00Z"), createdBy: null, ...o,
});

test("cells: dates as days, hours with 2 decimals, people joined, link to the task", () => {
  const t = task({ assignees: [{ id: "a", name: "Lan" }, { id: "b", name: "Minh" }], actualMinutes: 95, completedAt: new Date("2026-10-15T05:00:00Z") });
  assert.equal(exportCell(t, "assignees", ""), "Lan, Minh");
  assert.equal(exportCell(t, "actualH", ""), 1.58);
  assert.equal(exportCell(t, "estimateH", ""), "");
  assert.equal(exportCell(t, "completedAt", ""), "2026-10-15");
  assert.equal(exportCell(t, "link", "https://x.test"), "https://x.test/w/ws-a/p/p1/t/t1");
});

test("CSV: BOM, quoting, CRLF", () => {
  const csv = toCsv(["Task", "Hours"], [["A, \"quoted\"", 2], ["B\nline", 1.5]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1), 'Task,Hours\r\n"A, ""quoted""",2\r\n"B\nline",1.5\r\n');
});

test("summary: own hours per project (no double counting), person-hours per assignee", () => {
  const lan = { id: "a", name: "Lan" };
  const minh = { id: "b", name: "Minh" };
  const s = exportSummary([
    task({ id: "p", title: "Parent", actualMinutes: 600, ownActualMinutes: 360, assignees: [lan] }),
    task({ id: "c", title: "Child", parent: "Parent", actualMinutes: 240, ownActualMinutes: 240, assignees: [lan, minh] }),
    task({ id: "o", workspace: "WS B", workspaceSlug: "ws-b", projectId: "p2", project: "P2", ownActualMinutes: 180, assignees: [] }),
  ]);
  assert.equal(s.totalActualH, 13);
  assert.deepEqual(s.projects.map((p) => [p.workspace, p.project, p.tasks, p.actualH]), [["WS A", "P1", 2, 10], ["WS B", "P2", 1, 3]]);
  assert.deepEqual(s.people.map((p) => [p.person, p.workspace, p.tasks, p.actualH]), [["(unassigned)", "WS B", 1, 3], ["Lan", "WS A", 2, 10], ["Minh", "WS A", 1, 4]]);
});

test("CSV: text that looks like a formula is shown as text, numbers stay numbers", () => {
  const csv = toCsv(["Task", "Hours"], [["=1+1", -2], ["@SUM(A1)", 1], ["+x", 0], ["-y", 3]]);
  assert.equal(csv.slice(1), "Task,Hours\r\n'=1+1,-2\r\n'@SUM(A1),1\r\n'+x,0\r\n'-y,3\r\n");
});

test("summary: projects and workspaces with the same name stay apart", () => {
  const lan = { id: "a", name: "Lan" };
  const s = exportSummary([
    task({ id: "1", projectId: "p1", project: "Same", ownActualMinutes: 60, assignees: [lan] }),
    task({ id: "2", projectId: "p9", project: "Same", ownActualMinutes: 120, assignees: [lan] }),
    task({ id: "3", workspaceSlug: "ws-a2", projectId: "p3", project: "Other", ownActualMinutes: 30, assignees: [lan] }),
  ]);
  assert.deepEqual(s.projects.map((p) => [p.project, p.actualH]).sort(), [["Other", 0.5], ["Same", 1], ["Same", 2]]);
  assert.deepEqual(s.people.map((p) => p.actualH).sort(), [0.5, 3]);
});
