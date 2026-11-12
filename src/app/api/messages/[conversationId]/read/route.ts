import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { markRead } from "@/lib/messaging/service";

export const POST = route<{ conversationId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await markRead(user, uuid.parse((await params).conversationId));
  return NextResponse.json({ ok: true });
});
