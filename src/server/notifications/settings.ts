// The caller's notification settings: which groups pop up in the app / on the device, and the ringtone.
import "server-only";
import { prisma } from "@/lib/prisma";
import type { NotifyGroup, Ringtone } from "@/lib/notification-prefs";

const SELECT = { notifyPopupOff: true, notifyNativeOff: true, notifySound: true, notifyVolume: true } as const;
type Stored = { notifyPopupOff: string[]; notifyNativeOff: string[]; notifySound: string; notifyVolume: number };
const out = (u: Stored) => ({ popupOff: u.notifyPopupOff, nativeOff: u.notifyNativeOff, sound: u.notifySound, volume: u.notifyVolume });

export interface NotifySettingsChange {
  popupOff?: NotifyGroup[];
  nativeOff?: NotifyGroup[];
  sound?: Ringtone;
  volume?: number;
}

export async function getNotifySettings(userId: string) {
  return out(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: SELECT }));
}

export async function updateNotifySettings(userId: string, b: NotifySettingsChange) {
  const u = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(b.popupOff ? { notifyPopupOff: [...new Set(b.popupOff)] } : {}),
      ...(b.nativeOff ? { notifyNativeOff: [...new Set(b.nativeOff)] } : {}),
      ...(b.sound ? { notifySound: b.sound } : {}),
      ...(b.volume !== undefined ? { notifyVolume: b.volume } : {}),
      updatedById: userId,
    },
    select: SELECT,
  });
  return out(u);
}
