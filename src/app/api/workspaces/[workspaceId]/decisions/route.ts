import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { brainAccess } from "@/lib/brain/access";
import { DECISION_INCLUDE, assertDecisionRefs, decisionData, decisionSchema, serializeDecision, supersede } from "@/lib/brain/decisions";

type P = { workspaceId: string };

/** Decision memory: decisions the caller may see. ?q=&status=&projectId=&pageId=&personId= */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const access = await brainAccess(user, workspaceId, ctx.role);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status");
  const where: Prisma.DecisionWhereInput = {
    ...access.decision,
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { reason: { contains: q, mode: "insensitive" } }, { evidence: { contains: q, mode: "insensitive" } }] } : {}),
    ...(status && ["proposed", "active", "superseded", "revoked"].includes(status) ? { status: status as "active" } : {}),
    ...(url.searchParams.get("projectId") ? { projectId: url.searchParams.get("projectId")! } : {}),
    ...(url.searchParams.get("pageId") ? { wikiPageId: url.searchParams.get("pageId")! } : {}),
    ...(url.searchParams.get("personId") ? { people: { some: { userId: url.searchParams.get("personId")! } } } : {}),
  };
  const [rows, ws] = await Promise.all([
    prisma.decision.findMany({ where, include: DECISION_INCLUDE, orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }], take: 300 }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } }),
  ]);
  return NextResponse.json(rows.map((r) => serializeDecision(r, `/w/${ws.slug}`)));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "contributor");
  const body = decisionSchema.parse(await readJson(req));
  await assertDecisionRefs(user, workspaceId, body);
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } });
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.decision.create({ data: { ...decisionData(body), supersedesId: undefined, workspaceId, createdById: user.id }, select: { id: true, decidedAt: true, title: true } });
    if (body.people?.length) await tx.decisionPerson.createMany({ data: [...new Set(body.people)].map((userId) => ({ decisionId: created.id, userId })) });
    if (body.supersedesId) await supersede(tx, workspaceId, created.id, body.supersedesId, created.decidedAt);
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "decision", entityId: created.id, action: "created", summary: `Recorded decision "${created.title}"` });
    return tx.decision.findUniqueOrThrow({ where: { id: created.id }, include: DECISION_INCLUDE });
  });
  return NextResponse.json(serializeDecision(row, `/w/${ws.slug}`), { status: 201 });
});
