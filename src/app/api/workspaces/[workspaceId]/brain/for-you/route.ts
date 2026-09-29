import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { brainContext } from "@/lib/brain/route-helpers";
import { forYou } from "@/lib/brain/resurface";

type P = { workspaceId: string };

/** "For you today": knowledge related to current work, spaced reviews due, rediscoveries, recent decisions. */
export const GET = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { access, base } = await brainContext(workspaceId);
  return NextResponse.json(await forYou(access, base));
});
