import { NextResponse } from "next/server";
import { route, badRequest } from "@/lib/authz";
import { brainContext } from "@/lib/brain/route-helpers";
import { weeklyReview, periodRange, type ReviewPeriod } from "@/lib/brain/resurface";

type P = { workspaceId: string };

const PERIODS: ReviewPeriod[] = ["week", "month", "year"];

/** Brain review for a week / month / year (?period=week|month|year&week=YYYY-MM-DD, any day in the period). */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { access, base } = await brainContext(workspaceId);
  const q = new URL(req.url).searchParams;
  const period = (q.get("period") ?? "week") as ReviewPeriod;
  if (!PERIODS.includes(period)) throw badRequest("period must be week, month or year");
  const { start, end } = periodRange(period, q.get("week") ?? q.get("date"));
  return NextResponse.json({ period, ...(await weeklyReview(access, base, start, end)) });
});
