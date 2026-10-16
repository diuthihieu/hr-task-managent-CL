import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest } from "./http-errors";

type Tx = Prisma.TransactionClient;

/**
 * Moving everything of one project into another project of the same workspace:
 * tasks (deleted ones too, so they stay restorable) with their comments, files,
 * history, focus time, approvals, sub-tasks and dependencies; their category
 * and custom-field values (columns and categories are matched by name, missing
 * ones are created in the target); optionally the project's objectives; and the
 * ideas, decisions, AI conversations, reports and agent work that point at it.
 * Views are not moved (the target keeps its own).
 */

const norm = (s: string) => s.trim().toLowerCase();

export interface TransferPlan {
  tasks: number;
  deletedTasks: number;
  comments: number;
  attachments: number;
  objectives: number;
  ideas: number;
  fields: { name: string; type: string; action: "reuse" | "create" }[];
  categories: { name: string; action: "reuse" | "create" }[];
}

export async function planTransfer(sourceId: string, targetId: string, db: Tx | typeof prisma = prisma): Promise<TransferPlan> {
  const [tasks, deletedTasks, comments, attachments, objectives, ideas, srcFields, dstFields, srcCats, dstCats] = await Promise.all([
    db.task.count({ where: { projectId: sourceId, deletedAt: null } }),
    db.task.count({ where: { projectId: sourceId, deletedAt: { not: null } } }),
    db.comment.count({ where: { task: { projectId: sourceId }, deletedAt: null } }),
    db.attachment.count({ where: { task: { projectId: sourceId } } }),
    db.objective.count({ where: { projectId: sourceId, deletedAt: null } }),
    db.capturedThought.count({ where: { projectId: sourceId } }),
    db.customField.findMany({ where: { projectId: sourceId, deletedAt: null }, select: { name: true, type: true } }),
    db.customField.findMany({ where: { projectId: targetId, deletedAt: null }, select: { name: true, type: true } }),
    db.category.findMany({ where: { projectId: sourceId }, select: { name: true } }),
    db.category.findMany({ where: { projectId: targetId }, select: { name: true } }),
  ]);
  const dstKey = new Set(dstFields.map((f) => `${norm(f.name)}|${f.type}`));
  const dstCat = new Set(dstCats.map((c) => norm(c.name)));
  return {
    tasks,
    deletedTasks,
    comments,
    attachments,
    objectives,
    ideas,
    fields: srcFields.map((f) => ({ name: f.name, type: f.type, action: dstKey.has(`${norm(f.name)}|${f.type}`) ? "reuse" : "create" })),
    categories: srcCats.map((c) => ({ name: c.name, action: dstCat.has(norm(c.name)) ? "reuse" : "create" })),
  };
}

/** Replace every occurrence of old ids (fields, the source project) in a settings object. */
function remapJson(value: unknown, ids: Map<string, string>): Prisma.InputJsonValue {
  let text = JSON.stringify(value ?? {});
  for (const [from, to] of ids) text = text.split(from).join(to);
  return JSON.parse(text) as Prisma.InputJsonValue;
}

export async function runTransfer(tx: Tx, o: { sourceId: string; targetId: string; workspaceId: string; actorId: string; includeObjectives: boolean; archiveSource: boolean }) {
  const { sourceId, targetId, workspaceId, actorId } = o;
  if (sourceId === targetId) throw badRequest("Choose another project");
  // One transfer at a time per project pair; lock both projects.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM projects WHERE id IN (${sourceId}::uuid, ${targetId}::uuid) ORDER BY id FOR UPDATE`);

  // 1) Categories: reuse by name, create the missing ones.
  const [srcCats, dstCats] = await Promise.all([
    tx.category.findMany({ where: { projectId: sourceId } }),
    tx.category.findMany({ where: { projectId: targetId } }),
  ]);
  const catMap = new Map<string, string>();
  let catOrder = dstCats.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  for (const c of srcCats) {
    const hit = dstCats.find((d) => norm(d.name) === norm(c.name));
    const id = hit?.id ?? (await tx.category.create({ data: { workspaceId, projectId: targetId, name: c.name, color: c.color, sortOrder: ++catOrder, createdById: actorId, updatedById: actorId } })).id;
    catMap.set(c.id, id);
  }

  // 2) Columns: reuse a live column with the same name and type, else create one
  //    (deleted source columns get a deleted copy so their values stay restorable).
  const [srcFields, dstFields] = await Promise.all([
    tx.customField.findMany({ where: { projectId: sourceId }, include: { options: true }, orderBy: { sortOrder: "asc" } }),
    tx.customField.findMany({ where: { projectId: targetId, deletedAt: null }, include: { options: true } }),
  ]);
  const fieldMap = new Map<string, string>();
  const usedTarget = new Set<string>();
  const optionMap = new Map<string, string>();
  const created: { id: string; settings: Prisma.JsonValue }[] = [];
  let fieldOrder = dstFields.reduce((m, f) => Math.max(m, f.sortOrder), 0);
  for (const f of srcFields) {
    const hit = f.deletedAt ? null : dstFields.find((d) => d.type === f.type && norm(d.name) === norm(f.name) && !usedTarget.has(d.id));
    let targetField = hit;
    if (!targetField) {
      targetField = await tx.customField.create({
        data: { projectId: targetId, name: f.name, type: f.type, description: f.description, isRequired: f.isRequired, settings: f.settings ?? {}, sortOrder: ++fieldOrder, createdById: actorId, updatedById: actorId, deletedAt: f.deletedAt },
        include: { options: true },
      });
      created.push({ id: targetField.id, settings: f.settings });
    }
    usedTarget.add(targetField.id);
    fieldMap.set(f.id, targetField.id);
    let optOrder = targetField.options.reduce((m, x) => Math.max(m, x.sortOrder), 0);
    for (const opt of f.options) {
      const same = targetField.options.find((x) => norm(x.label) === norm(opt.label));
      const id = same?.id ?? (await tx.customFieldOption.create({ data: { customFieldId: targetField.id, label: opt.label, color: opt.color, sortOrder: ++optOrder } })).id;
      optionMap.set(opt.id, id);
    }
  }
  // Created columns may point at other columns (lookups) or at the source project (links).
  const idMap = new Map<string, string>([...fieldMap, [sourceId, targetId]]);
  for (const c of created) await tx.customField.update({ where: { id: c.id }, data: { settings: remapJson(c.settings, idMap) } });

  // 3) Tasks. Sub-tasks must stay in their parent's project at every step, so
  //    parents are detached first and re-attached after the move.
  const tasks = await tx.task.findMany({ where: { projectId: sourceId }, select: { id: true, parentTaskId: true, categoryId: true } });
  const taskIds = tasks.map((t) => t.id);
  const parents = tasks.filter((t) => t.parentTaskId);
  if (parents.length) await tx.task.updateMany({ where: { id: { in: parents.map((t) => t.id) } }, data: { parentTaskId: null } });
  const byCat = new Map<string | null, string[]>();
  for (const t of tasks) byCat.set(t.categoryId, [...(byCat.get(t.categoryId) ?? []), t.id]);
  for (const [cat, ids] of byCat) await tx.task.updateMany({ where: { id: { in: ids } }, data: { projectId: targetId, categoryId: cat ? catMap.get(cat) ?? null : null } });
  for (const t of parents) await tx.task.update({ where: { id: t.id }, data: { parentTaskId: t.parentTaskId } });

  // 4) Custom values follow their (mapped) column and options.
  if (taskIds.length) {
    const values = await tx.taskCustomFieldValue.findMany({ where: { taskId: { in: taskIds } }, select: { taskId: true, customFieldId: true, valueOptionId: true, valueOptionIds: true } });
    for (const v of values) {
      const to = fieldMap.get(v.customFieldId);
      if (!to || to === v.customFieldId) continue;
      await tx.taskCustomFieldValue.update({
        where: { taskId_customFieldId: { taskId: v.taskId, customFieldId: v.customFieldId } },
        data: {
          customFieldId: to,
          valueOptionId: v.valueOptionId ? optionMap.get(v.valueOptionId) ?? null : null,
          valueOptionIds: v.valueOptionIds.map((id) => optionMap.get(id)).filter((id): id is string => Boolean(id)),
        },
      });
    }
  }

  // 5) Everything else that points at the project.
  let objectives = 0;
  if (o.includeObjectives) objectives = (await tx.objective.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } })).count;
  const ideas = await tx.capturedThought.findMany({ where: { projectId: sourceId }, select: { id: true, categoryId: true } });
  for (const i of ideas) await tx.capturedThought.update({ where: { id: i.id }, data: { projectId: targetId, categoryId: i.categoryId ? catMap.get(i.categoryId) ?? null : null } });
  await tx.decision.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  await tx.aiConversation.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  await tx.savedReport.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  await tx.kudos.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  await tx.notification.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  // Agent work: runs before their outputs (outputs must match their run).
  await tx.agentRun.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  await tx.agentOutput.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
  // Wiki pages built from the source keep the right visibility.
  await tx.$executeRaw`UPDATE wiki_pages SET source_project_ids = array_remove(array_replace(source_project_ids, ${sourceId}::uuid, ${targetId}::uuid), NULL) WHERE ${sourceId}::uuid = ANY(source_project_ids)`;
  await tx.$executeRaw`UPDATE wiki_pages SET source_project_ids = ARRAY(SELECT DISTINCT unnest(source_project_ids)) WHERE ${targetId}::uuid = ANY(source_project_ids)`;

  if (o.archiveSource) await tx.project.update({ where: { id: sourceId }, data: { status: "archived", updatedById: actorId } });
  return { tasks: taskIds.length, objectives, ideas: ideas.length, fieldsCreated: created.length, categoriesCreated: srcCats.length - [...catMap.values()].filter((id) => dstCats.some((d) => d.id === id)).length };
}
