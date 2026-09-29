import { NextResponse } from "next/server";
import { route, badRequest, forbidden } from "@/lib/authz";
import { periodFromQuery, recoContext } from "@/lib/recognition/route-helpers";
import { leaderboard } from "@/lib/recognition/stats";
import { LEADERBOARD_METRICS, type LeaderboardMetric } from "@/lib/recognition/core";

type P = { workspaceId: string };

/** Top members: ?metric=points|tasks|hours|kudos&period=…&top=N. Points boards need "see others' points". */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, seePoints } = await recoContext(workspaceId);
  const url = new URL(req.url);
  const metric = (url.searchParams.get("metric") ?? "tasks") as LeaderboardMetric;
  if (!LEADERBOARD_METRICS.includes(metric)) throw badRequest("Unknown metric");
  if (metric === "points" && !seePoints) throw forbidden("Your workspace doesn't show other members' points to you");
  const p = periodFromQuery(url);
  const board = await leaderboard(user, workspaceId, metric, p.from, p.to, p.top);
  return NextResponse.json({ metric, from: p.from.toISOString().slice(0, 10), to: new Date(p.to.getTime() - 86400000).toISOString().slice(0, 10), ...board });
});
