import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { pendingRequests, unreadTotal } from "@/lib/messaging/service";

export const GET = route(async () => {
  const user = await requireUser();
  // count: unread messages; requests: contact requests waiting for my answer.
  const [count, requests] = await Promise.all([unreadTotal(user), pendingRequests(user)]);
  return NextResponse.json({ count, requests }, { headers: { "Cache-Control": "private, no-store" } });
});
