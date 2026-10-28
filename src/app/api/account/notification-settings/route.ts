import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { NOTIFY_GROUP_KEYS, RINGTONES, type NotifyGroup } from "@/lib/notification-prefs";
import { getNotifySettings, updateNotifySettings } from "@/server/notifications/settings";

const group = z.enum(NOTIFY_GROUP_KEYS as [NotifyGroup, ...NotifyGroup[]]);
const schema = z.object({
  popupOff: z.array(group).max(20).optional(),
  nativeOff: z.array(group).max(20).optional(),
  sound: z.enum(RINGTONES).optional(),
  volume: z.number().int().min(0).max(100).optional(),
});

/** The caller's notification settings: which groups pop up in the app / on the device, and the ringtone. */
export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json(await getNotifySettings(user.id));
});

export const PUT = route(async (req) => {
  const user = await requireUser();
  return NextResponse.json(await updateNotifySettings(user.id, schema.parse(await readJson(req))));
});
