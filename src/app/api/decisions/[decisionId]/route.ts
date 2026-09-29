import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, forbidden, roleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { workspaceOfDecision } from "@/lib/brain/access";
import { DECISION_INCLUDE, assertDecisionRefs, decisionData, decisionSchema, serializeDecision, supersede } from "@/lib/brain/decisions";

type P = { decisionId: string };

async function base(workspaceId: string) {
  return `/w/${(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } })).slug}`;
}

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { decisionId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfDecision(decisionId), "viewer");
  const row = await prisma.decision.findUniqueOrThrow({ where: { id: decisionId }, include: DECISION_INCLUDE });
  return NextResponse.json(serializeDecision(row, await base(ctx.workspaceId)));
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { decisionId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfDecision(decisionId), "contributor");
  const body = decisionSchema.partial().parse(await readJson(req));
  await assertDecisionRefs(user, ctx.workspaceId, { title: "x", ...body });
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.decision.update({ where: { id: decisionId }, data: { ...decisionData({ title: "", ...body }), title: body.title }, select: { decidedAt: true, validFrom: true, validTo: true, title: true } });
    if (updated.validFrom && updated.validTo && updated.validTo < updated.validFrom) throw forbidden("Valid to must be on or after valid from");
    if (body.people) {
      await tx.decisionPerson.deleteMany({ where: { decisionId } });
      if (body.people.length) await tx.decisionPerson.createMany({ data: [...new Set(body.people)].map((userId) => ({ decisionId, userId })) });
    }
    if (body.supersedesId) await supersede(tx, ctx.workspaceId, decisionId, body.supersedesId, updated.decidedAt);
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "decision", entityId: decisionId, action: "updated", summary: `Updated decision "${updated.title}"` });
    return tx.decision.findUniqueOrThrow({ where: { id: decisionId }, include: DECISION_INCLUDE });
  });
  return NextResponse.json(serializeDecision(row, await base(ctx.workspaceId)));
});

/** Soft delete: the person who recorded it, or a workspace admin. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { decisionId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfDecision(decisionId), "contributor");
  const row = await prisma.decision.findUniqueOrThrow({ where: { id: decisionId }, select: { createdById: true, title: true } });
  if (row.createdById !== user.id && !roleAtLeast(ctx.role, "admin")) throw forbidden("Only the person who recorded this decision or an admin can delete it");
  await prisma.$transaction(async (tx) => {
    await tx.decision.update({ where: { id: decisionId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "decision", entityId: decisionId, action: "deleted", summary: `Deleted decision "${row.title}"` });
  });
  return new NextResponse(null, { status: 204 });
});
