import { test } from "node:test";
import assert from "node:assert/strict";
import { softDeleteModels, unguardedReads } from "../../../scripts/check-soft-delete.mjs";

const models = ["task", "comment"];
const reads = (code: string) => (unguardedReads("x.ts", code, models) as { line: number; query: string }[]).map((r) => r.query);

test("models with a deletedAt column are found in the schema", () => {
  const schema = "model Task {\n  id String @id\n  deletedAt DateTime?\n}\n\nmodel Status {\n  id String @id\n}\n";
  assert.deepEqual(softDeleteModels(schema), ["task"]);
});

test("a read without a deletedAt condition is reported", () => {
  assert.deepEqual(reads("prisma.task.findMany({ where: { projectId } })"), ["task.findMany"]);
  assert.deepEqual(reads("tx.comment.count()"), ["comment.count"]);
  assert.deepEqual(reads("prisma.task.findFirst({ select: { id: true } })"), ["task.findFirst"]);
  assert.deepEqual(reads("prisma.task.findMany({ ...pageArgs(p), where: { project: { deletedAt: null } } })"), ["task.findMany"], "a relation's deletedAt doesn't count");
});

test("deletedAt at the top, in AND / OR / NOT, or a where built elsewhere is accepted", () => {
  assert.deepEqual(reads("prisma.task.findMany({ where: { projectId, deletedAt: null } })"), []);
  assert.deepEqual(reads("prisma.task.findMany({ where: { AND: [{ projectId }, { deletedAt: null }] } })"), []);
  assert.deepEqual(reads("prisma.task.findFirst({ where: { id, deletedAt: { not: null } } })"), []);
  assert.deepEqual(reads("prisma.task.findMany({ where })"), []);
  assert.deepEqual(reads("prisma.task.findMany({ where: { ...access.task, id } })"), []);
  assert.deepEqual(reads("prisma.status.findMany({ where: { workspaceId } })"), [], "not a soft-deleted model");
});

test("a deliberate read of deleted rows is marked on the line above", () => {
  assert.deepEqual(reads("// soft-delete: restore needs the deleted row\nconst t = await prisma.task.findUnique({ where: { id } });"), []);
});

test("a marker covers only its own read, not the next statement or list item", () => {
  assert.deepEqual(
    reads("// soft-delete: restore needs the deleted row\nconst t = await prisma.task.findUnique({ where: { id } });\nconst c = await prisma.comment.findMany({ where: { taskId: id } });"),
    ["comment.findMany"],
  );
  assert.deepEqual(
    reads("const [t, c] = await Promise.all([\n  // soft-delete: restore needs the deleted row\n  prisma.task.findUnique({ where: { id } }),\n  prisma.comment.findMany({ where: { taskId: id } }),\n]);"),
    ["comment.findMany"],
  );
  assert.deepEqual(reads("const t = await prisma.task.findUnique({ // soft-delete: restore needs the deleted row\n  where: { id },\n});"), []);
  assert.deepEqual(reads("// soft-delete: restore needs the deleted row\nconst t = await prisma.task\n  .findUnique({ where: { id } });"), [], "a statement split over lines");
});
