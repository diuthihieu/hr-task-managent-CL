import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { effectiveRole, getSessionUser, visibleProjectWhere, wikiRoleOf, type SessionUser } from "./authz";
import { serializeWiki, WIKI_SELECT } from "./wiki";

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

/** Project page: workspace access + the project (must belong to that workspace and not be deleted). */
export async function requireProjectPage(slug: string, projectId: string) {
  const ctx = await requireWorkspacePage(slug);
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId: ctx.workspace.id, deletedAt: null, ...visibleProjectWhere(ctx.user) } });
  if (!project) redirect(`/w/${slug}`);
  return { ...ctx, project };
}

/** Wiki page: workspace access + a wiki the caller can open (else back to the wiki list). */
export async function requireWikiPage(slug: string, wikiId: string) {
  const ctx = await requireWorkspacePage(slug);
  const w = /^[0-9a-f-]{36}$/i.test(wikiId) ? await prisma.wiki.findFirst({ where: { id: wikiId, workspaceId: ctx.workspace.id, deletedAt: null }, select: WIKI_SELECT }) : null;
  const role = w ? await wikiRoleOf(ctx.user, w.id, ctx.role) : null;
  if (!w || !role) redirect(`/w/${slug}/wiki`);
  return { ...ctx, wiki: serializeWiki(w, role) };
}
