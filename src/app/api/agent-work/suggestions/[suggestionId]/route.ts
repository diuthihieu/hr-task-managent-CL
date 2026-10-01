import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { decideSuggestion } from "@/lib/agent-work/engine";

type P = { suggestionId: string };
const schema = z.object({ decision: z.enum(["accept", "dismiss"]), customGoal: z.string().trim().min(3).max(4000).optional() });

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { suggestionId } = await params;
  const body = schema.parse(await readJson(req));
  return NextResponse.json(await decideSuggestion(user, suggestionId, body.decision, body.customGoal));
});

