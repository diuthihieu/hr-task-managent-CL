import "server-only";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest } from "./http-errors";
import { mapProjectSchema } from "./project-transfer";
import { copyTaskAttachmentBlob, deleteAttachmentBlob, storageConfigured } from "./storage";
import { logActivity } from "./activity";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * Moving or duplicating selected tasks into another project of the same workspace.
 *
 * Both take the selected tasks with all their sub-tasks (a sub-task must live in its parent's project).
 * Categories and columns are matched by name (columns: name + type); missing ones are created when the
 * caller may manage them, else those values are left out (the preview says so).
 *
 * - Move keeps the tasks themselves: comments, files, history, focus time, approvals and dependencies stay
 *   attached. A selected task whose parent stays behind becomes a top-level task.
 * - Duplicate creates new tasks: fields, people, dependencies and sub-tasks; optionally the comments
 *   (same authors and dates) and the files (each file is copied in storage, never shared). Time tracking,
 *   approvals and history start fresh; the history notes where the copy came from.
 */

export const MAX_TRANSFER_TASKS = 200;
export type TransferMode = "move" | "duplicate";

export interface TaskTransferOptions {
  sourceProjectId: string;
  targetProjectId: string;
  workspaceId: string;
  actorId: string;
  taskIds: string[];
  mode: TransferMode;
  includeComments: boolean;
  includeFiles: boolean;
  createFields: boolean;
  createCategories: boolean;
}

interface ClosureTask {
  id: string;
  title: string;
  parentTaskId: string | null;
  categoryId: string | null;
  deletedAt: Date | null;
  sortOrder: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The selected tasks plus all their sub-tasks, parents before children. Selected tasks must be live tasks of
 * the source project. Move also takes deleted sub-tasks (so restoring one later still finds its parent);
 * duplicate only copies live ones.
 */
async function collectTasks(db: Db, o: Pick<TaskTransferOptions, "sourceProjectId" | "taskIds" | "mode">): Promise<{ tasks: ClosureTask[]; selected: Set<string> }> {
  const ids = [...new Set(o.taskIds)];
  if (!ids.length) throw badRequest("Select at least one task");
  if (ids.length > MAX_TRANSFER_TASKS) throw badRequest(`Select at most ${MAX_TRANSFER_TASKS} tasks at a time`);
  const select = { id: true, title: true, parentTaskId: true, categoryId: true, deletedAt: true, sortOrder: true } as const;
  const roots = await db.task.findMany({ where: { id: { in: ids }, projectId: o.sourceProjectId, deletedAt: null }, select, orderBy: { sortOrder: "asc" } });
  if (roots.length !== ids.length) throw badRequest("Some selected tasks are not in this project (or were deleted)");
  const tasks: ClosureTask[] = [...roots];
  const seen = new Set(roots.map((t) => t.id));
  let frontier = roots.map((t) => t.id);
  while (frontier.length) {
    const children = await db.task.findMany({
      where: { parentTaskId: { in: frontier }, projectId: o.sourceProjectId, ...(o.mode === "duplicate" ? { deletedAt: null } : {}) },
      select,
      orderBy: { sortOrder: "asc" },
    });
    frontier = [];
    for (const c of children) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      tasks.push(c);
      frontier.push(c.id);
    }
    if (tasks.length > MAX_TRANSFER_TASKS) throw badRequest(`Too many tasks including sub-tasks (max ${MAX_TRANSFER_TASKS})`);
  }
  // Parents before children (a selected task may itself be a sub-task of another selected task).
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depth = (t: ClosureTask): number => (t.parentTaskId && byId.has(t.parentTaskId) ? 1 + depth(byId.get(t.parentTaskId)!) : 0);
  tasks.sort((a, b) => depth(a) - depth(b) || a.sortOrder - b.sortOrder);
  return { tasks, selected: new Set(ids) };
}

/** Ids of the live tasks a transfer would take (selection + sub-tasks), for per-task permission checks. */
export async function transferTaskIds(o: Pick<TaskTransferOptions, "sourceProjectId" | "taskIds" | "mode">): Promise<string[]> {
  const { tasks } = await collectTasks(prisma, o);
  return tasks.filter((t) => !t.deletedAt).map((t) => t.id);
}

export interface TaskTransferPlan {
  mode: TransferMode;
  tasks: number;
  subtasks: number;
  comments: number;
  files: number;
  fields: { name: string; type: string; action: "reuse" | "create" | "skip" }[];
  categories: { name: string; action: "reuse" | "create" | "skip" }[];
  /** Selected sub-tasks whose parent is not selected: they become top-level tasks in the target. */
  detached: number;
  /** "Linked task" values pointing at tasks that are not part of the transfer (left out). */
  droppedLinks: number;
  /** Files can only be duplicated when file storage is configured. */
  filesAvailable: boolean;
}

export async function planTaskTransfer(o: TaskTransferOptions, db: Db = prisma): Promise<TaskTransferPlan> {
  const { tasks, selected } = await collectTasks(db, o);
  const ids = tasks.map((t) => t.id);
  const live = tasks.filter((t) => !t.deletedAt).map((t) => t.id);
  const same = o.sourceProjectId === o.targetProjectId;
  const [comments, files, values, dstFields, dstCats] = await Promise.all([
    db.comment.count({ where: { taskId: { in: live }, deletedAt: null } }),
    db.attachment.count({ where: { taskId: { in: live }, deletedAt: null } }),
    db.taskCustomFieldValue.findMany({ where: { taskId: { in: ids } }, select: { customFieldId: true, valueTaskIds: true, customField: { select: { name: true, type: true, deletedAt: true } } } }),
    db.customField.findMany({ where: { projectId: o.targetProjectId, deletedAt: null }, select: { name: true, type: true } }),
    db.category.findMany({ where: { projectId: o.targetProjectId }, select: { name: true } }),
  ]);
  const idSet = new Set(ids);
  const catIds = [...new Set(tasks.map((t) => t.categoryId).filter((c): c is string => !!c))];
  const srcCats = await db.category.findMany({ where: { id: { in: catIds } }, select: { name: true } });
  const fieldsUsed = new Map<string, { name: string; type: string }>();
  let droppedLinks = 0;
  for (const v of values) {
    if (!v.customField.deletedAt) fieldsUsed.set(v.customFieldId, { name: v.customField.name, type: v.customField.type });
    if (!same) droppedLinks += v.valueTaskIds.filter((id) => !idSet.has(id)).length;
  }
  const dstKey = new Set(dstFields.map((f) => `${norm(f.name)}|${f.type}`));
  const dstCat = new Set(dstCats.map((c) => norm(c.name)));
  return {
    mode: o.mode,
    tasks: selected.size,
    subtasks: tasks.length - selected.size,
    comments: o.mode === "move" || o.includeComments ? comments : 0,
    files: o.mode === "move" || o.includeFiles ? files : 0,
    fields: same ? [] : [...fieldsUsed.values()].map((f) => ({ ...f, action: dstKey.has(`${norm(f.name)}|${f.type}`) ? "reuse" : o.createFields ? "create" : "skip" })),
    categories: same ? [] : srcCats.map((c) => ({ name: c.name, action: dstCat.has(norm(c.name)) ? "reuse" : o.createCategories ? "create" : "skip" })),
    detached: same ? 0 : tasks.filter((t) => selected.has(t.id) && t.parentTaskId && !idSet.has(t.parentTaskId)).length,
    droppedLinks,
    filesAvailable: o.mode === "move" || storageConfigured(),
  };
}

/** Lock both projects so two transfers into / out of them never interleave. */
async function lockProjects(tx: Tx, a: string, b: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM projects WHERE id IN (${a}::uuid, ${b}::uuid) ORDER BY id FOR UPDATE`);
}

async function appendOrderStart(tx: Tx, projectId: string) {
  const last = await tx.task.aggregate({ where: { projectId, deletedAt: null }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export async function moveTasks(tx: Tx, o: TaskTransferOptions) {
  const { sourceProjectId: sourceId, targetProjectId: targetId, workspaceId, actorId } = o;
  if (sourceId === targetId) throw badRequest("Choose another project");
  await lockProjects(tx, sourceId, targetId);
  const { tasks, selected } = await collectTasks(tx, o);
  const ids = tasks.map((t) => t.id);
  const idSet = new Set(ids);
  const liveIds = tasks.filter((t) => !t.deletedAt).map((t) => t.id);

  const values = await tx.taskCustomFieldValue.findMany({ where: { taskId: { in: ids } } });
  const schema = await mapProjectSchema(tx, {
    sourceId,
    targetId,
    workspaceId,
    actorId,
    categoryIds: new Set(tasks.map((t) => t.categoryId).filter((c): c is string => !!c)),
    fieldIds: new Set(values.map((v) => v.customFieldId)),
    createCategories: o.createCategories,
    createFields: o.createFields,
  });

  // Tasks: detach parents first (a sub-task must be in its parent's project at every step), move, re-attach
  // the parents that moved too. Moved tasks go to the end of the target, in their current order.
  const parented = tasks.filter((t) => t.parentTaskId);
  if (parented.length) await tx.task.updateMany({ where: { id: { in: parented.map((t) => t.id) } }, data: { parentTaskId: null } });
  let order = await appendOrderStart(tx, targetId);
  for (const t of tasks) {
    await tx.task.update({
      where: { id: t.id },
      data: { projectId: targetId, categoryId: t.categoryId ? schema.catMap.get(t.categoryId) ?? null : null, sortOrder: order++, updatedById: actorId },
    });
  }
  for (const t of parented) if (idSet.has(t.parentTaskId!)) await tx.task.update({ where: { id: t.id }, data: { parentTaskId: t.parentTaskId } });

  // Column values follow their mapped column; values of columns that could not be created are removed;
  // "linked task" values keep only tasks that moved along (links must stay inside one project).
  let valuesDropped = 0;
  for (const v of values) {
    const to = schema.fieldMap.get(v.customFieldId);
    const key = { taskId_customFieldId: { taskId: v.taskId, customFieldId: v.customFieldId } };
    if (!to) {
      await tx.taskCustomFieldValue.delete({ where: key });
      valuesDropped++;
      continue;
    }
    await tx.taskCustomFieldValue.update({
      where: key,
      data: {
        customFieldId: to,
        valueOptionId: v.valueOptionId ? schema.optionMap.get(v.valueOptionId) ?? null : null,
        valueOptionIds: v.valueOptionIds.map((id) => schema.optionMap.get(id)).filter((id): id is string => !!id),
        valueTaskIds: v.valueTaskIds.filter((id) => idSet.has(id) && liveIds.includes(id)),
      },
    });
  }

  // Records that point at both the task and its project follow the task.
  const inMoved = { taskId: { in: ids }, projectId: sourceId };
  await tx.notification.updateMany({ where: inMoved, data: { projectId: targetId } });
  await tx.decision.updateMany({ where: inMoved, data: { projectId: targetId } });
  await tx.kudos.updateMany({ where: inMoved, data: { projectId: targetId } });
  await tx.aiConversation.updateMany({ where: inMoved, data: { projectId: targetId } });
  // Agent work: runs before their outputs (outputs must match their run; runs need a live task).
  await tx.agentRun.updateMany({ where: { taskId: { in: liveIds }, projectId: sourceId }, data: { projectId: targetId } });
  await tx.agentOutput.updateMany({ where: { taskId: { in: liveIds }, projectId: sourceId }, data: { projectId: targetId } });

  const [source, target] = await Promise.all([
    tx.project.findUniqueOrThrow({ where: { id: sourceId }, select: { name: true } }),
    tx.project.findUniqueOrThrow({ where: { id: targetId }, select: { name: true } }),
  ]);
  for (const t of tasks) {
    if (t.deletedAt) continue;
    await logActivity(tx, {
      workspaceId,
      actorId,
      entityType: "task",
      entityId: t.id,
      action: "updated",
      summary: `Moved task "${t.title}" from "${source.name}" to "${target.name}"`,
      changes: { project: { from: sourceId, to: targetId } },
    });
  }
  return { tasks: selected.size, subtasks: tasks.length - selected.size, valuesDropped, fieldsCreated: schema.fieldsCreated, categoriesCreated: schema.categoriesCreated, taskIds: [...selected] };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

const TASK_COPY_SELECT = {
  id: true,
  title: true,
  description: true,
  content: true,
  parentTaskId: true,
  statusId: true,
  categoryId: true,
  keyResultId: true,
  objectiveId: true,
  priority: true,
  importance: true,
  urgency: true,
  startDate: true,
  dueDate: true,
  estimateMinutes: true,
  progress: true,
  okrWeight: true,
  sortOrder: true,
  completedAt: true,
  recurrenceFreq: true,
  recurrenceInterval: true,
  assignees: { select: { userId: true } },
  reportTo: { select: { userId: true } },
  dependencies: { select: { dependsOnTaskId: true, type: true, lagDays: true, dependsOn: { select: { deletedAt: true } } } },
  // Values of deleted columns are not copied.
  customValues: { where: { customField: { deletedAt: null } } },
} satisfies Prisma.TaskSelect;

interface CopiedFile {
  sourceId: string;
  taskId: string;
  url: string;
  pathname: string;
  provider: string;
}

/**
 * Duplicate in three steps so a failure never leaves half a copy: read everything, copy the files in
 * storage (outside the database transaction - network calls), then write all rows in one transaction.
 * If that transaction fails, the copied files are deleted again.
 */
export async function duplicateTasks(o: TaskTransferOptions) {
  const { sourceProjectId: sourceId, targetProjectId: targetId, workspaceId, actorId } = o;
  const same = sourceId === targetId;
  const { tasks: closure, selected } = await collectTasks(prisma, o);
  const ids = closure.map((t) => t.id);
  const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: TASK_COPY_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const newId = new Map(ids.map((id) => [id, randomUUID()]));

  const comments = o.includeComments
    ? await prisma.comment.findMany({
        where: { taskId: { in: ids } },
        select: { id: true, taskId: true, authorId: true, parentCommentId: true, body: true, createdAt: true, updatedAt: true, deletedAt: true, mentions: { select: { userId: true } }, reactions: { select: { userId: true, emoji: true, createdAt: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const attachments = o.includeFiles
    ? await prisma.attachment.findMany({
        where: { taskId: { in: ids }, deletedAt: null },
        select: { id: true, taskId: true, fileName: true, contentType: true, sizeBytes: true, storageProvider: true, url: true, uploadedById: true, extractedText: true, createdAt: true },
      })
    : [];

  // Files first (network). One failed copy skips that file only.
  const copied: CopiedFile[] = [];
  let filesFailed = 0;
  if (attachments.length) {
    if (!storageConfigured()) filesFailed = attachments.length;
    else {
      const queue = [...attachments];
      const worker = async () => {
        for (let a = queue.shift(); a; a = queue.shift()) {
          try {
            const taskId = newId.get(a.taskId!)!;
            const r = await copyTaskAttachmentBlob({ url: a.url, provider: a.storageProvider, workspaceId, taskId, fileName: a.fileName, contentType: a.contentType });
            copied.push({ sourceId: a.id, taskId, url: r.url, pathname: r.pathname, provider: r.provider });
          } catch (e) {
            console.error("[task-transfer] file copy failed", a.id, e);
            filesFailed++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    }
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockProjects(tx, sourceId, targetId);
        const schema = same
          ? null
          : await mapProjectSchema(tx, {
              sourceId,
              targetId,
              workspaceId,
              actorId,
              categoryIds: new Set(rows.map((t) => t.categoryId).filter((c): c is string => !!c)),
              fieldIds: new Set(rows.flatMap((t) => t.customValues.map((v) => v.customFieldId))),
              createCategories: o.createCategories,
              createFields: o.createFields,
            });
        const mapCat = (id: string | null) => (!id ? null : schema ? schema.catMap.get(id) ?? null : id);
        const mapField = (id: string) => (schema ? schema.fieldMap.get(id) : id);
        const mapOption = (id: string) => (schema ? schema.optionMap.get(id) : id);
        // Linked tasks: inside the copy -> the new task; outside -> kept only when staying in the same project.
        const mapLink = (id: string) => newId.get(id) ?? (same ? id : undefined);

        let order = await appendOrderStart(tx, targetId);
        for (const t of closure) {
          const r = byId.get(t.id)!;
          const parent = r.parentTaskId ? newId.get(r.parentTaskId) ?? (same ? r.parentTaskId : null) : null;
          await tx.task.create({
            data: {
              id: newId.get(r.id)!,
              workspaceId,
              projectId: targetId,
              parentTaskId: parent,
              statusId: r.statusId,
              categoryId: mapCat(r.categoryId),
              keyResultId: r.keyResultId,
              objectiveId: r.objectiveId,
              title: r.title,
              description: r.description,
              content: r.content,
              priority: r.priority,
              importance: r.importance,
              urgency: r.urgency,
              startDate: r.startDate,
              dueDate: r.dueDate,
              estimateMinutes: r.estimateMinutes,
              progress: r.progress,
              okrWeight: r.okrWeight,
              completedAt: r.completedAt,
              recurrenceFreq: r.recurrenceFreq,
              recurrenceInterval: r.recurrenceInterval,
              sortOrder: order++,
              createdById: actorId,
              updatedById: actorId,
            },
          });
        }
        for (const r of rows) {
          const id = newId.get(r.id)!;
          if (r.assignees.length) await tx.taskAssignee.createMany({ data: r.assignees.map((a) => ({ taskId: id, userId: a.userId, assignedById: actorId })) });
          if (r.reportTo.length) await tx.taskReportRecipient.createMany({ data: r.reportTo.map((a) => ({ taskId: id, userId: a.userId, assignedById: actorId })) });
          const deps = r.dependencies.filter((d) => !d.dependsOn.deletedAt).map((d) => ({ taskId: id, dependsOnTaskId: newId.get(d.dependsOnTaskId) ?? d.dependsOnTaskId, type: d.type, lagDays: d.lagDays, createdById: actorId }));
          if (deps.length) await tx.taskDependency.createMany({ data: deps });
          for (const v of r.customValues) {
            const fieldId = mapField(v.customFieldId);
            if (!fieldId) continue;
            await tx.taskCustomFieldValue.create({
              data: {
                taskId: id,
                customFieldId: fieldId,
                valueText: v.valueText,
                valueNumber: v.valueNumber,
                valueDate: v.valueDate,
                valueBool: v.valueBool,
                valueOptionId: v.valueOptionId ? mapOption(v.valueOptionId) ?? null : null,
                valueOptionIds: v.valueOptionIds.map(mapOption).filter((x): x is string => !!x),
                valueUserId: v.valueUserId,
                valueTeamId: v.valueTeamId,
                valueTaskIds: v.valueTaskIds.map(mapLink).filter((x): x is string => !!x),
                valueJson: v.valueJson ?? Prisma.JsonNull,
                updatedById: actorId,
              },
            });
          }
        }

        // Comments keep their author, text and date (a reply keeps its thread); agent-run links are not copied.
        const commentId = new Map(comments.map((c) => [c.id, randomUUID()]));
        for (const c of comments) {
          const id = commentId.get(c.id)!;
          await tx.comment.create({
            data: {
              id,
              taskId: newId.get(c.taskId)!,
              authorId: c.authorId,
              parentCommentId: c.parentCommentId ? commentId.get(c.parentCommentId) ?? null : null,
              body: c.body,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
              deletedAt: c.deletedAt,
            },
          });
          if (c.mentions.length) await tx.commentMention.createMany({ data: c.mentions.map((m) => ({ commentId: id, userId: m.userId })) });
          if (c.reactions.length) await tx.commentReaction.createMany({ data: c.reactions.map((m) => ({ commentId: id, userId: m.userId, emoji: m.emoji, createdAt: m.createdAt })) });
        }

        const bySource = new Map(attachments.map((a) => [a.id, a]));
        for (const f of copied) {
          const a = bySource.get(f.sourceId)!;
          await tx.attachment.create({
            data: { workspaceId, taskId: f.taskId, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, storageProvider: f.provider, storageKey: f.pathname, url: f.url, uploadedById: a.uploadedById, extractedText: a.extractedText, createdAt: a.createdAt },
          });
        }

        const [source, target] = await Promise.all([
          tx.project.findUniqueOrThrow({ where: { id: sourceId }, select: { name: true } }),
          tx.project.findUniqueOrThrow({ where: { id: targetId }, select: { name: true } }),
        ]);
        for (const r of rows) {
          await logActivity(tx, {
            workspaceId,
            actorId,
            entityType: "task",
            entityId: newId.get(r.id)!,
            action: "created",
            summary: `Duplicated from task "${r.title}" (project "${source.name}")${same ? "" : ` into "${target.name}"`}`,
            changes: { duplicatedFrom: { from: r.id, to: newId.get(r.id) } },
          });
        }
        return {
          tasks: selected.size,
          subtasks: closure.length - selected.size,
          comments: comments.filter((c) => !c.deletedAt).length,
          files: copied.length,
          filesFailed,
          fieldsCreated: schema?.fieldsCreated ?? 0,
          categoriesCreated: schema?.categoriesCreated ?? 0,
          taskIds: [...selected].map((id) => newId.get(id)!),
        };
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
    return result;
  } catch (e) {
    // Nothing was written: remove the file copies made for it.
    await Promise.all(copied.map((f) => deleteAttachmentBlob(f.url).catch((err) => console.error("[task-transfer] cleanup failed", f.url, err))));
    throw e;
  }
}
