import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { markAllRead } from "@/server/notifications/actions";

export const POST = route(async () => {
  const user = await requireUser();
  return NextResponse.json({ updated: await markAllRead(user.id) });
});
