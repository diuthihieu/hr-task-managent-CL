import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { badRequest, notFound, requireWorkspaceRole, workspaceOfObjective, workspaceOfProject, workspaceOfTask, workspaceOfWikiPage, type SessionUser } from "../authz";
import { entityHref } from "./links-core";
import { uuid } from "../validation";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const decisionSchema = z.object({
  title: z.string().trim().min(1).max(500),
  reason: z.string().max(20000).nullable().optional(),
  alternatives: z.array(z.object({ option: z.string().trim().min(1).max(500), whyNot: z.string().max(2000).optional().default("") })).max(20).optional(),
  evidence: z.string().max(20000).nullable().optional(),
  sourceUrl: z.string().trim().max(1000).refine((u) => /^(https?:\/\/|\/)/i.test(u), "Source link must be a web address or an app link").nullable().optional(),
  decidedAt: date.optional(),
  status: z.enum(["proposed", "active", "superseded", "revoked"]).optional(),
  validFrom: date.nullable().optional(),
  validTo: date.nullable().optional(),
  projectId: uuid.nullable().optional(),
  wikiPageId: uuid.nullable().optional(),
  sourceBlockId: z.string().regex(/^[a-z0-9]{6,16}$/).nullable().optional(),
  taskId: uuid.nullable().optional(),
  objectiveId: uuid.nullable().optional(),
  people: z.array(uuid).max(50).optional(),
  supersedesId: uuid.nullable().optional(),
  sourceType: z.enum(["manual", "imported", "ai_generated", "converted"]).optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

const d = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`));

export const DECISION_INCLUDE = {
  project: { select: { id: true, name: true } },
  wikiPage: { select: { id: true, title: true, wikiId: true, deletedAt: true } },
  task: { select: { id: true, title: true, projectId: true, deletedAt: true } },
  objective: { select: { id: true, title: true, deletedAt: true } },
  createdBy: { select: { id: true, name: true } },
  people: { select: { user: { select: { id: true, name: true, avatarColor: true } } } },
  supersedes: { select: { id: true, title: true, deletedAt: true } },
  supersededBy: { select: { id: true, title: true, deletedAt: true } },
} satisfies Prisma.DecisionInclude;

type Row = Prisma.DecisionGetPayload<{ include: typeof DECISION_INCLUDE }>;

export function serializeDecision(r: Row, base: string) {
  const live = <T extends { deletedAt: Date | null }>(x: T | null) => (x && !x.deletedAt ? x : null);
  const page = live(r.wikiPage);
  const task = live(r.task);
  const objective = live(r.objective);
  return {
    id: r.id,
    title: r.title,
    reason: r.reason,
    alternatives: (Array.isArray(r.alternatives) ? r.alternatives : []) as { option: string; whyNot?: string }[],
    evidence: r.evidence,
    sourceUrl: r.sourceUrl,
    decidedAt: r.decidedAt.toISOString().slice(0, 10),
    status: r.status,
    validFrom: r.validFrom?.toISOString().slice(0, 10) ?? null,
    validTo: r.validTo?.toISOString().slice(0, 10) ?? null,
    sourceType: r.sourceType,
    project: r.project,
    page: page ? { id: page.id, title: page.title, href: entityHref(base, { type: "wiki", id: page.id, wikiId: page.wikiId, blockId: r.sourceBlockId ?? undefined }) } : null,
    task: task ? { id: task.id, title: task.title, href: entityHref(base, { type: "task", id: task.id, projectId: task.projectId }) } : null,
    objective: objective ? { id: objective.id, title: objective.title, href: entityHref(base, { type: "objective", id: objective.id }) } : null,
    people: r.people.map((p) => p.user),
    createdBy: r.createdBy,
    supersedes: live(r.supersedes) ? { id: r.supersedes!.id, title: r.supersedes!.title } : null,
    supersededBy: live(r.supersededBy) ? { id: r.supersededBy!.id, title: r.supersededBy!.title } : null,
    href: entityHref(base, { type: "decision", id: r.id }),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type DecisionDto = ReturnType<typeof serializeDecision>;

/** Every reference must be something the caller can see, in the same workspace. */
export async function assertDecisionRefs(user: SessionUser, workspaceId: string, b: DecisionInput) {
  const check = async (scope: Awaited<ReturnType<typeof workspaceOfProject>>, what: string) => {
    if (!scope || scope.workspaceId !== workspaceId) throw badRequest(`Unknown ${what}`);
    await requireWorkspaceRole(user, scope, "viewer").catch(() => {
      throw badRequest(`Unknown ${what}`);
    });
  };
  if (b.projectId) await check(await workspaceOfProject(b.projectId), "project");
  if (b.wikiPageId) await check(await workspaceOfWikiPage(b.wikiPageId), "wiki page");
  if (b.taskId) await check(await workspaceOfTask(b.taskId), "task");
  if (b.objectiveId) await check(await workspaceOfObjective(b.objectiveId), "objective");
  if (b.people?.length) {
    const n = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: b.people } } });
    if (n !== new Set(b.people).size) throw badRequest("People must be members of this workspace");
  }
  if (b.validFrom && b.validTo && b.validTo < b.validFrom) throw badRequest("Valid to must be on or after valid from");
}

export function decisionData(b: DecisionInput) {
  return {
    title: b.title,
    reason: b.reason,
    alternatives: b.alternatives as unknown as Prisma.InputJsonValue | undefined,
    evidence: b.evidence,
    sourceUrl: b.sourceUrl,
    decidedAt: d(b.decidedAt) ?? undefined,
    status: b.status,
    validFrom: d(b.validFrom),
    validTo: d(b.validTo),
    projectId: b.projectId,
    wikiPageId: b.wikiPageId,
    sourceBlockId: b.sourceBlockId,
    taskId: b.taskId,
    objectiveId: b.objectiveId,
    sourceType: b.sourceType,
  };
}

/** Marks the older decision superseded (valid until the day before the new one). */
export async function supersede(tx: Prisma.TransactionClient, workspaceId: string, newId: string, oldId: string, decidedAt: Date) {
  const old = await tx.decision.findFirst({ where: { id: oldId, workspaceId, deletedAt: null }, select: { id: true, validFrom: true, supersededBy: { select: { id: true } } } });
  if (!old) throw notFound("Decision");
  if (old.supersededBy && old.supersededBy.id !== newId) throw badRequest("That decision was already superseded by another one");
  await tx.decision.update({ where: { id: newId }, data: { supersedesId: oldId } });
  const until = new Date(decidedAt.getTime() - 86400000);
  await tx.decision.update({ where: { id: oldId }, data: { status: "superseded", validTo: old.validFrom && old.validFrom > until ? old.validFrom : until } });
}
