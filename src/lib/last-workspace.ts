import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { LAST_WORKSPACE_COOKIE, isPhone, isWorkspaceSlug, workspaceLanding } from "@/lib/resume-target";

/**
 * Where to reopen woli for this user on this device: the workspace they last had open (if they are still
 * a member of it), else their only workspace. Home on a computer, the "All" page on a phone. Null when
 * there is no obvious choice (no workspace, or several and none remembered): show the chooser.
 */
export async function resumePath(userId: string): Promise<string | null> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const phone = isPhone(h.get("user-agent"), h.get("sec-ch-ua-mobile"));
  const remembered = jar.get(LAST_WORKSPACE_COOKIE)?.value;
  if (isWorkspaceSlug(remembered)) {
    const member = await prisma.workspaceMember.findFirst({ where: { userId, workspace: { slug: remembered, deletedAt: null } }, select: { id: true } });
    if (member) return workspaceLanding(remembered, phone);
  }
  const memberships = await prisma.workspaceMember.findMany({ where: { userId, workspace: { deletedAt: null } }, select: { workspace: { select: { slug: true } } }, take: 2 });
  return memberships.length === 1 ? workspaceLanding(memberships[0].workspace.slug, phone) : null;
}
