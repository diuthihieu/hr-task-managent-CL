import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, readJson, route } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { workspaceId: string };
const schema = z.object({ memberDays: z.number().int().min(0).max(365) });

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { projectHistoryMemberDays: true } });
  return NextResponse.json({ memberDays: workspace.projectHistoryMemberDays, canManage: ctx.role === "owner" });
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "owner");
  const body = schema.parse(await readJson(req));
  const memberDays = await prisma.$transaction(async (tx) => {
    const before = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { projectHistoryMemberDays: true } });
    const after = await tx.workspace.update({ where: { id: workspaceId }, data: { projectHistoryMemberDays: body.memberDays, updatedById: user.id }, select: { projectHistoryMemberDays: true } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: "Changed Project Version History access", changes: { projectHistoryMemberDays: { from: before.projectHistoryMemberDays, to: after.projectHistoryMemberDays } } });
    return after.projectHistoryMemberDays;
  });
  return NextResponse.json({ memberDays, canManage: true });
});
