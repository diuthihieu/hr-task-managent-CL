import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, notFound } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { workspaceLogoUrl } from "@/lib/workspace-logo";

type P = { reportId: string };

/** Saved reports are private: only their creator, still a member of the workspace, can open or delete them. */
async function ownReport(reportId: string) {
  const user = await requireUser();
  const id = uuid.safeParse(reportId);
  if (!id.success) throw notFound();
  const row = await prisma.savedReport.findUnique({ where: { id: id.data } });
  if (!row || row.userId !== user.id) throw notFound();
  await requireWorkspaceRole(user, row.workspaceId, "viewer");
  return row;
}

export const GET = route<P>(async (_req, { params }) => {
  const row = await ownReport((await params).reportId);
  const [ws, user] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: row.workspaceId }, select: { slug: true, name: true, logoUpdatedAt: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: row.userId }, select: { name: true } }),
  ]);
  return NextResponse.json({ ...row, header: { workspace: ws.name, logoUrl: workspaceLogoUrl(ws), author: user.name } });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const row = await ownReport((await params).reportId);
  await prisma.savedReport.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
});
