import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { route, readJson, badRequest, HttpError, requireWorkspaceRole, workspaceOfTask, visibleProjectWhere } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { recoContext } from "@/lib/recognition/route-helpers";
import { KUDOS_INCLUDE, serializeKudos } from "@/lib/recognition/kudos";
import { syncPoints } from "@/lib/recognition/points";
import { KUDOS_STYLES } from "@/lib/recognition/core";
import { uuid } from "@/lib/validation";

type P = { workspaceId: string };

/**
 * Kudos: ?scope=wall (public letters, default) | received (mine, incl. private) | sent.
 * &userId= narrows the wall to one person's letters; &from=&to= by date.
 */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, base } = await recoContext(workspaceId, { sync: false });
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "wall";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const where: Prisma.KudosWhereInput = {
    workspaceId,
    deletedAt: null,
    ...(scope === "received" ? { toId: user.id } : scope === "sent" ? { fromId: user.id } : { OR: [{ isPublic: true }, { toId: user.id }, { fromId: user.id }] }),
    ...(url.searchParams.get("userId") ? { toId: url.searchParams.get("userId")! } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000) } : {}) } } : {}),
    // Letters tied to a project/task the viewer can't see stay private to sender & receiver.
    AND: [{ OR: [{ projectId: null }, { project: visibleProjectWhere(user) }, { toId: user.id }, { fromId: user.id }] }],
  };
  const [rows, stats] = await Promise.all([
    prisma.kudos.findMany({ where, include: KUDOS_INCLUDE, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.kudos.groupBy({ by: ["style"], where, _count: { _all: true } }),
  ]);
  return NextResponse.json({ items: rows.map((k) => serializeKudos(k, base, user.id)), byStyle: Object.fromEntries(stats.map((s) => [s.style, s._count._all])) });
});

const schema = z.object({
  toId: uuid,
  style: z.enum(KUDOS_STYLES).default("gratitude"),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(10, "Write a few words").max(8000),
  reason: z.string().trim().max(500).optional(),
  taskId: uuid.nullable().optional(),
  values: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  isPublic: z.boolean().default(true),
});

/** Send a thank-you letter. The receiver gets a notification (pop-up) that opens the letter. */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, base, settings } = await recoContext(workspaceId, { sync: false });
  if (!settings.enabled) throw badRequest("Recognition is turned off in this workspace");
  const body = schema.parse(await readJson(req));
  if (body.toId === user.id) throw badRequest("You can't send kudos to yourself");
  if (!rateLimit(`kudos:${user.id}`, 20, 24 * 3600_000)) throw new HttpError(429, "That's a lot of kudos today - try again tomorrow");
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: body.toId } }, select: { user: { select: { isActive: true } } } });
  if (!member?.user.isActive) throw badRequest("The receiver must be an active member of this workspace");
  let projectId: string | null = null;
  if (body.taskId) {
    const scope = await workspaceOfTask(body.taskId);
    if (!scope || scope.workspaceId !== workspaceId) throw badRequest("Unknown task");
    await requireWorkspaceRole(user, scope, "viewer");
    projectId = scope.projectId ?? null;
  }
  const k = await prisma.$transaction(async (tx) => {
    const created = await tx.kudos.create({ data: { workspaceId, fromId: user.id, toId: body.toId, style: body.style, title: body.title, message: body.message, reason: body.reason || null, taskId: body.taskId ?? null, projectId, values: body.values, isPublic: body.isPublic }, include: KUDOS_INCLUDE });
    await tx.notification.create({
      data: { userId: body.toId, workspaceId, actorId: user.id, type: "kudos", title: body.title, body: body.reason ?? null, data: { style: body.style }, link: `${base}/recognition/kudos/${created.id}` },
    });
    return created;
  });
  await syncPoints(workspaceId);
  return NextResponse.json(serializeKudos(k, base, user.id), { status: 201 });
});
