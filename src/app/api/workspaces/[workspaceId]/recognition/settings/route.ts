import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { recoContext } from "@/lib/recognition/route-helpers";
import { pointRules, requireRecognitionManager } from "@/lib/recognition/points";
import { POINT_ACTIONS } from "@/lib/recognition/core";
import { supportAccess } from "@/lib/authz";

type P = { workspaceId: string };

/** Scoring rules, visibility and delegation (admins / recognition managers). */
export const GET = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { user, ctx, settings } = await recoContext(workspaceId, { sync: false });
  await requireRecognitionManager(user, workspaceId, ctx.role);
  const [rules, members, managers, overrides] = await Promise.all([
    pointRules(workspaceId),
    prisma.workspaceMember.findMany({ where: { workspaceId, user: { isActive: true, deletedAt: null } }, select: { role: true, user: { select: { id: true, name: true, email: true, avatarColor: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.recognitionManager.findMany({ where: { workspaceId }, select: { userId: true } }),
    prisma.recognitionMember.findMany({ where: { workspaceId } }),
  ]);
  return NextResponse.json({
    enabled: settings.enabled,
    membersSeePoints: settings.membersSeePoints,
    pointsSince: settings.pointsSince?.toISOString().slice(0, 10) ?? null,
    canDelegate: ctx.role === "admin" || ctx.role === "owner" || supportAccess(user),
    rules: POINT_ACTIONS.map((a) => ({ action: a, ...rules[a] })),
    members: members.map((m) => ({
      ...m.user,
      role: m.role,
      isManager: managers.some((x) => x.userId === m.user.id),
      canViewOthersPoints: overrides.find((o) => o.userId === m.user.id)?.canViewOthersPoints ?? null,
    })),
  });
});

const schema = z.object({
  enabled: z.boolean().optional(),
  membersSeePoints: z.boolean().optional(),
  pointsSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  rules: z.array(z.object({ action: z.enum(POINT_ACTIONS), points: z.number().int().min(-1000).max(1000), enabled: z.boolean() })).optional(),
});

export const PUT = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, ctx } = await recoContext(workspaceId, { sync: false });
  await requireRecognitionManager(user, workspaceId, ctx.role);
  const body = schema.parse(await readJson(req));
  await prisma.$transaction(async (tx) => {
    await tx.recognitionSettings.update({
      where: { workspaceId },
      data: {
        enabled: body.enabled,
        membersSeePoints: body.membersSeePoints,
        pointsSince: body.pointsSince === undefined ? undefined : body.pointsSince ? new Date(`${body.pointsSince}T00:00:00Z`) : null,
        updatedById: user.id,
      },
    });
    for (const r of body.rules ?? []) await tx.pointRule.upsert({ where: { workspaceId_action: { workspaceId, action: r.action } }, create: { workspaceId, ...r }, update: { points: r.points, enabled: r.enabled } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: "Updated recognition settings", changes: { recognition: { from: null, to: body } } });
  });
  return NextResponse.json({ ok: true });
});
