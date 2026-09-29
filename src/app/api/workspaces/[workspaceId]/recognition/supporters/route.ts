import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { periodFromQuery, recoContext } from "@/lib/recognition/route-helpers";
import { supporters } from "@/lib/recognition/stats";

type P = { workspaceId: string };

/** The colleagues who supported the caller most in the period (comments, work done for them, approvals, kudos, co-work). */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user } = await recoContext(workspaceId, { sync: false });
  const p = periodFromQuery(new URL(req.url));
  return NextResponse.json(await supporters(user, workspaceId, p.from, p.to, p.top));
});
