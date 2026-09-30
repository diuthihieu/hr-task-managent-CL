import "server-only";
import type { HomeTemplate, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest } from "./authz";
import { normalizeWidgets, widgetsSchema, type HomeWidget } from "./home-widgets";

export const TEMPLATE_INCLUDE = {
  owner: { select: { id: true, name: true } },
  shares: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.HomeTemplateInclude;
type Row = HomeTemplate & Prisma.HomeTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

/** Widget lists stored in a Json column. */
export const asJson = (w: HomeWidget[]) => w as unknown as Prisma.InputJsonValue;

export function parseWidgets(v: unknown): HomeWidget[] {
  const r = widgetsSchema.safeParse(Array.isArray(v) ? v : (v as { widgets?: unknown } | null)?.widgets);
  return r.success ? normalizeWidgets(r.data) : [];
}

export function serializeTemplate(t: Row, viewerId: string, canModerate: boolean) {
  const mine = t.ownerId === viewerId;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    visibility: t.visibility,
    owner: t.owner,
    widgets: parseWidgets(t.widgets),
    // Who it is shared with is the owner's business.
    sharedWith: mine ? t.shares.map((s) => s.user) : [],
    useCount: t.useCount,
    mine,
    canDelete: mine || (canModerate && t.visibility === "workspace"),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Templates a member may see: their own, the workspace's, and those shared with them. */
export const visibleTemplateWhere = (workspaceId: string, userId: string): Prisma.HomeTemplateWhereInput => ({
  workspaceId,
  OR: [{ ownerId: userId }, { visibility: "workspace" }, { visibility: "shared", shares: { some: { userId } } }],
});

/** Share targets must be active members of the workspace. */
export async function checkShareTargets(workspaceId: string, ownerId: string, ids: string[]) {
  const unique = [...new Set(ids)].filter((id) => id !== ownerId);
  if (!unique.length) return [];
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId, userId: { in: unique }, user: { isActive: true, deletedAt: null } }, select: { userId: true } });
  if (members.length !== unique.length) throw badRequest("Templates can only be shared with members of this workspace");
  return unique;
}

type Tx = Prisma.TransactionClient;
/** Tell people a template was shared with them (links to the Home template picker). */
export async function notifyShared(tx: Tx, workspaceId: string, actorId: string, templateId: string, name: string, userIds: string[]) {
  if (!userIds.length) return;
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } });
  await tx.notification.createMany({
    data: userIds.map((userId) => ({ userId, workspaceId, actorId, type: "template_shared", title: name, data: { templateId }, link: `/w/${ws.slug}?customize=templates` })),
  });
}
