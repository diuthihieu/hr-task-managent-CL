import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";

// Lightweight (no progress computation) list of every Objective/Key Result
// in the workspace, for the "okr_objective"/"okr_key_result" cell pickers -
// those need live titles, not the full detail payload the OKR pages use.
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const objectives = await prisma.objective.findMany({
    where: { workspaceId },
    select: { id: true, title: true, teamId: true },
    orderBy: { title: "asc" },
  });
  const keyResults = await prisma.keyResult.findMany({
    where: { objective: { workspaceId } },
    select: { id: true, title: true, objectiveId: true },
    orderBy: { title: "asc" },
  });

  return NextResponse.json({ objectives, keyResults });
}
