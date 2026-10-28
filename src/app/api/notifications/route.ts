import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { listInbox, refreshInbox } from "@/server/notifications/inbox";
import { parseTypes } from "@/server/notifications/filters";

/**
 * The caller's notifications (reminders are generated on the fly).
 * ?view=todo (default: not acted on, not snoozed) | all | snoozed; ?unread=1; ?types=a,b (an Action center chip).
 * See listInbox for what is listed and counted.
 */
export const GET = route(async (req) => {
  const user = await requireUser();
  await refreshInbox(user);
  const url = new URL(req.url);
  return NextResponse.json(
    await listInbox(user, { view: url.searchParams.get("view") ?? "all", unreadOnly: url.searchParams.get("unread") === "1", types: parseTypes(url.searchParams.get("types")) }),
  );
});
