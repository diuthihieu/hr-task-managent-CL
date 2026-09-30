import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson } from "@/lib/authz";
import { NOTIFY_GROUP_KEYS, RINGTONES } from "@/lib/notification-prefs";

const group = z.enum(NOTIFY_GROUP_KEYS as [string, ...string[]]);
const schema = z.object({
  popupOff: z.array(group).max(20).optional(),
  nativeOff: z.array(group).max(20).optional(),
  sound: z.enum(RINGTONES).optional(),
  volume: z.number().int().min(0).max(100).optional(),
});
const SELECT = { notifyPopupOff: true, notifyNativeOff: true, notifySound: true, notifyVolume: true } as const;
const out = (u: { notifyPopupOff: string[]; notifyNativeOff: string[]; notifySound: string; notifyVolume: number }) => ({ popupOff: u.notifyPopupOff, nativeOff: u.notifyNativeOff, sound: u.notifySound, volume: u.notifyVolume });

/** The caller's notification settings: which groups pop up in the app / on the device, and the ringtone. */
export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json(out(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: SELECT })));
});

export const PUT = route(async (req) => {
  const user = await requireUser();
  const b = schema.parse(await readJson(req));
  const u = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(b.popupOff ? { notifyPopupOff: [...new Set(b.popupOff)] } : {}),
      ...(b.nativeOff ? { notifyNativeOff: [...new Set(b.nativeOff)] } : {}),
      ...(b.sound ? { notifySound: b.sound } : {}),
      ...(b.volume !== undefined ? { notifyVolume: b.volume } : {}),
      updatedById: user.id,
    },
    select: SELECT,
  });
  return NextResponse.json(out(u));
});
