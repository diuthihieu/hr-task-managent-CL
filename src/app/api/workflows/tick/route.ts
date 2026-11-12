// Called every few minutes by Supabase pg_cron (pg_net) with "Authorization: Bearer <CRON_SECRET>".
// Answers at once and runs what is due after the response, within the function's time limit.
import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { runDueWorkflows } from "@/lib/agent-work/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const configured = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ?wait=1 (tests) runs in the request and returns what ran.
  if (new URL(req.url).searchParams.get("wait") === "1") return NextResponse.json(await runDueWorkflows(240_000));
  after(() => runDueWorkflows(240_000).then((r) => console.log("[workflows] tick", JSON.stringify({ due: r.due, ran: r.ran.length }))).catch((e) => console.error("[workflows] tick failed", e)));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
