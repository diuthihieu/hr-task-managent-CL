import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { brainContext } from "@/lib/brain/route-helpers";
import { knowledgeHealth } from "@/lib/brain/health";

type P = { workspaceId: string };

/** Knowledge health report (suggestions only; nothing is changed). */
export const GET = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { access, base } = await brainContext(workspaceId);
  return NextResponse.json(await knowledgeHealth(access, base));
});
