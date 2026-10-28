import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { answerRoleChange } from "@/server/notifications/actions";

type P = { notificationId: string };
const schema = z.object({ decision: z.enum(["accept", "decline"]) });

/** Answer a "your role changed" notification (decline: promotions only - see answerRoleChange). */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { notificationId } = await params;
  const { decision } = schema.parse(await readJson(req));
  return NextResponse.json(await answerRoleChange(user, notificationId, decision));
});
