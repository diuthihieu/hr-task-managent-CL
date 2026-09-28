import "server-only";
import { prisma } from "@/lib/prisma";
import { wikiRoleOf, type SessionUser } from "@/lib/authz";
import type { WorkspaceRole } from "@prisma/client";

/**
 * Active workspace members who can open this wiki (the people a comment may
 * @mention). With a page's source projects, people hidden from one of them are left out.
 */
export async function wikiReaders(wikiId: string, workspaceId: string, sourceProjectIds: string[] = []) {
  const hiddenFromPage = sourceProjectIds.length
    ? new Set((await prisma.projectHiddenMember.findMany({ where: { projectId: { in: sourceProjectIds } }, select: { userId: true } })).map((h) => h.userId))
    : new Set<string>();
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, user: { isActive: true, deletedAt: null } },
    select: { role: true, user: { select: { id: true, name: true, email: true, avatarColor: true, systemRole: true, mustChangePassword: true, locale: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const out: { id: string; name: string; email: string; avatarColor: string }[] = [];
  for (const m of members) {
    const role = await wikiRoleOf(m.user as SessionUser, wikiId, m.role as WorkspaceRole);
    if (hiddenFromPage.has(m.user.id) && m.user.systemRole !== "ADMIN") continue;
    if (role) out.push({ id: m.user.id, name: m.user.name, email: m.user.email, avatarColor: m.user.avatarColor });
  }
  return out;
}

export const WIKI_COMMENT_SELECT = {
  id: true,
  body: true,
  parentCommentId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, avatarColor: true } },
  attachments: { where: { deletedAt: null }, select: { id: true, fileName: true, contentType: true, sizeBytes: true } },
} as const;
