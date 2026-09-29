import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, forbidden, badRequest, roleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { recoContext } from "@/lib/recognition/route-helpers";
import { uuid } from "@/lib/validation";

type P = { workspaceId: string };

/** Workspace admins delegate recognition management (rules, visibility, rewards, approvals) to members. */
export const PUT = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, ctx } = await recoContext(workspaceId, { sync: false });
  if (!(user.systemRole === "ADMIN" || roleAtLeast(ctx.role, "admin"))) throw forbidden("Only workspace admins can delegate recognition management");
  const { userIds } = z.object({ userIds: z.array(uuid).max(100) }).parse(await readJson(req));
  const n = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: userIds } } });
  if (n !== new Set(userIds).size) throw badRequest("Managers must be members of this workspace");
  await prisma.$transaction(async (tx) => {
    await tx.recognitionManager.deleteMany({ where: { workspaceId, userId: { notIn: userIds } } });
    await tx.recognitionManager.createMany({ data: userIds.map((userId) => ({ workspaceId, userId, grantedById: user.id })), skipDuplicates: true });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: `Recognition managers: ${userIds.length}` });
  });
  return NextResponse.json({ userIds });
});
