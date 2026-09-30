import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { brainContext } from "@/lib/brain/route-helpers";
import { weeklyReview, weekStartOf } from "@/lib/brain/resurface";

type P = { workspaceId: string };

/** Weekly Brain Review (?week=YYYY-MM-DD, any day of the week). */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { access, base } = await brainContext(workspaceId);
  return NextResponse.json(await weeklyReview(access, base, weekStartOf(new URL(req.url).searchParams.get("week"))));
});
