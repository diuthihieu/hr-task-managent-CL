import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { unreadTotal } from "@/lib/messaging/service";

export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json({ count: await unreadTotal(user) }, { headers: { "Cache-Control": "private, no-store" } });
});
