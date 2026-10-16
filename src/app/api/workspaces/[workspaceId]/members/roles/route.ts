import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { applyRoleChange } from "@/lib/member-roles";

type P = { workspaceId: string };
const schema = z.object({ changes: z.array(z.object({ userId: uuid, role: z.enum(["admin", "editor", "contributor", "viewer"]) })).min(1).max(1000) });

/** Save staged role changes together (all or none). Admins only; the owner's role moves only with Transfer ownership. */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const { changes } = schema.parse(await readJson(req));
  if (new Set(changes.map((c) => c.userId)).size !== changes.length) throw badRequest("One change per member");
  await prisma.$transaction(async (tx) => {
    for (const c of changes) await applyRoleChange(tx, { workspaceId, actorId: user.id, userId: c.userId, role: c.role });
  });
  return NextResponse.json({ ok: true, changed: changes.length });
});
