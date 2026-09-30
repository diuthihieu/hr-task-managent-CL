import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfStatus, badRequest } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { serializeStatus } from "@/lib/serializers";
import { statusSchema, uuid } from "@/lib/validation";

type P = { statusId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { statusId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfStatus(statusId), "admin");
  const raw = await readJson<Record<string, unknown>>(req);
  const body = statusSchema.partial().parse(raw);
  const order = typeof raw.order === "number" ? Math.round(raw.order) : undefined;
  const before = await prisma.status.findUniqueOrThrow({ where: { id: statusId } });
  if (body.isDefault === false && before.isDefault) throw badRequest("Pick another default status instead of unsetting this one");
  const after = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.status.updateMany({ where: { workspaceId: ctx.workspaceId, id: { not: statusId } }, data: { isDefault: false } });
    const s = await tx.status.update({ where: { id: statusId }, data: { ...body, sortOrder: order, updatedById: user.id } });
    // A status moving in or out of "done" re-counts its tasks the same way a status change would.
    if (body.category && body.category !== before.category) {
      if (body.category === "done") await tx.task.updateMany({ where: { statusId, completedAt: null }, data: { completedAt: new Date(), progress: 100 } });
      else if (before.category === "done") await tx.task.updateMany({ where: { statusId }, data: { completedAt: null } });
    }
    const changes = diff(before, s, ["name", "color", "category", "isDefault"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "status", entityId: statusId, action: "updated", changes });
    return s;
  });
  return NextResponse.json(serializeStatus(after));
});

/**
 * Tasks can't be left without a status: if any (incl. soft-deleted) task
 * uses this one, the caller must pass `?reassignTo=<statusId>`.
 */
export const DELETE = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { statusId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfStatus(statusId), "admin");
  const reassignTo = new URL(req.url).searchParams.get("reassignTo");
  const status = await prisma.status.findUniqueOrThrow({ where: { id: statusId } });
  if ((await prisma.status.count({ where: { workspaceId: ctx.workspaceId } })) <= 1) throw badRequest("A workspace needs at least one status");
  const inUse = await prisma.task.count({ where: { statusId } });
  if (inUse && !reassignTo) throw badRequest(`${inUse} task(s) use this status - choose a status to move them to`);
  if (reassignTo) {
    z.object({ r: uuid }).parse({ r: reassignTo });
    if (reassignTo === statusId || !(await prisma.status.findFirst({ where: { id: reassignTo, workspaceId: ctx.workspaceId } }))) throw badRequest("Invalid replacement status");
  }
  await prisma.$transaction(async (tx) => {
    if (reassignTo) await tx.task.updateMany({ where: { statusId }, data: { statusId: reassignTo, updatedById: user.id } });
    await tx.status.delete({ where: { id: statusId } });
    // Delete first: the partial unique index allows only one default at a time.
    if (status.isDefault) {
      const next = await tx.status.findFirst({ where: { workspaceId: ctx.workspaceId }, orderBy: { sortOrder: "asc" } });
      if (next) await tx.status.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "status", entityId: statusId, action: "deleted", summary: `Deleted status "${status.name}"${inUse ? `, moved ${inUse} task(s)` : ""}` });
  });
  return new NextResponse(null, { status: 204 });
});
