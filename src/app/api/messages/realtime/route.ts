import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { realtimeConfig, userTopic } from "@/lib/messaging/realtime";

/** Where my browser listens for live signals (or that realtime is off and it should poll). */
export const GET = route(async () => {
  const user = await requireUser();
  const cfg = realtimeConfig();
  const headers = { "Cache-Control": "private, no-store" };
  if (!cfg) return NextResponse.json({ enabled: false }, { headers });
  return NextResponse.json({ enabled: true, url: cfg.url, key: cfg.key, topic: userTopic(user.id) }, { headers });
});
