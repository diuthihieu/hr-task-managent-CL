import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/page-context";
import { LAST_WORKSPACE_COOKIE, isWorkspaceSlug } from "@/lib/resume-target";

export const dynamic = "force-dynamic";

/** Links from push notifications: open Messages inside the workspace last used (or the first one). */
export default async function MessagesRedirect({ searchParams }: { searchParams: Promise<{ c?: string; tab?: string }> }) {
  const user = await requirePageUser();
  const { c, tab } = await searchParams;
  const remembered = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id, workspace: { deletedAt: null, ...(isWorkspaceSlug(remembered) ? { slug: remembered } : {}) } },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { slug: true } } },
  });
  const fallback = member ?? (await prisma.workspaceMember.findFirst({ where: { userId: user.id, workspace: { deletedAt: null } }, orderBy: { createdAt: "asc" }, select: { workspace: { select: { slug: true } } } }));
  if (!fallback) redirect("/workspaces");
  const q = new URLSearchParams();
  if (c && /^[0-9a-f-]{36}$/i.test(c)) q.set("c", c);
  if (tab === "contacts") q.set("tab", "contacts");
  redirect(`/w/${fallback.workspace.slug}/messages${q.size ? `?${q}` : ""}`);
}
