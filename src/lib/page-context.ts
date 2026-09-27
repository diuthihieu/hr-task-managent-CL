import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { effectiveRole, getSessionUser, type SessionUser } from "./authz";

/** Signed-in, active user for a server page; forces the first-login password change. */
export async function requirePageUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/account/password");
  return user;
}

/** Workspace by slug + the caller's role in it; redirects home when they have no access. */
export async function requireWorkspacePage(slug: string) {
  const user = await requirePageUser();
  const workspace = await prisma.workspace.findFirst({ where: { slug, deletedAt: null } });
  if (!workspace) redirect("/");
  const role = await effectiveRole(user, workspace.id);
  if (!role) redirect("/");
  return { user, workspace, role };
}
