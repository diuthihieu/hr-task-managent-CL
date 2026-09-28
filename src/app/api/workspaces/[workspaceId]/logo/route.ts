import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { assertLogo, workspaceLogoUrl } from "@/lib/workspace-logo";

type P = { workspaceId: string };

/** Upload or replace the workspace logo: multipart form field `file` (an uploaded image or one generated in the browser). */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the image as multipart form field `file`");
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = assertLogo(buf);
  const w = await prisma.$transaction(async (tx) => {
    const w = await tx.workspace.update({
      where: { id: workspaceId },
      data: { logoData: Buffer.from(buf), logoMimeType: type, logoUpdatedAt: new Date(), updatedById: user.id },
      select: { slug: true, logoUpdatedAt: true },
    });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: "Changed the workspace logo" });
    return w;
  });
  return NextResponse.json({ logoUrl: workspaceLogoUrl(w) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: workspaceId }, data: { logoData: null, logoMimeType: null, logoUpdatedAt: null, updatedById: user.id } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: "Removed the workspace logo" });
  });
  return new NextResponse(null, { status: 204 });
});
