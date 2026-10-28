// Query filters for the notification inbox (bell + Action center). Pure: no
// database access, so the rules can be unit-tested on their own.
import { Prisma } from "@prisma/client";
import { NOTIFY_GROUPS, type NotifyGroup } from "@/lib/notification-prefs";

/** "You can redeem a reward" AI notices: stored as ai_suggestion, shown under Recognition. */
export const REWARD_REACHABLE: Prisma.NotificationWhereInput = { type: "ai_suggestion", data: { path: ["kind"], equals: "reward_reachable" } };

/** AI suggestions other than the "you can redeem a reward" ones. */
const PLAIN_AI: Prisma.NotificationWhereInput = { type: "ai_suggestion", OR: [{ data: { equals: Prisma.AnyNull } }, { NOT: REWARD_REACHABLE }] };

/** Notifications that belong to any of these groups ("you can redeem a reward" AI notices count as recognition). */
export function inGroups(groups: NotifyGroup[]): Prisma.NotificationWhereInput {
  const types = NOTIFY_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.types as readonly string[]).filter((t) => t !== "ai_suggestion");
  return {
    OR: [{ type: { in: types } }, ...(groups.includes("ai") ? [PLAIN_AI] : []), ...(groups.includes("recognition") ? [REWARD_REACHABLE] : [])],
  };
}

/** An Action center chip's types, with "you can redeem a reward" AI notices listed under Recognition (kudos) rather than AI. */
export function ofTypes(types: string[]): Prisma.NotificationWhereInput {
  return {
    OR: [{ type: { in: types.filter((t) => t !== "ai_suggestion") } }, ...(types.includes("ai_suggestion") ? [PLAIN_AI] : []), ...(types.includes("kudos") ? [REWARD_REACHABLE] : [])],
  };
}

/** `?types=a,b`: known-looking type names only, at most 20. */
export function parseTypes(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[a-z_]{1,40}$/.test(t))
    .slice(0, 20);
}

/** Groups switched off in the app but still allowed on the device (they raise system notifications only). */
export function deviceOnlyGroups(popupOff: NotifyGroup[], nativeOff: NotifyGroup[]): NotifyGroup[] {
  return popupOff.filter((g) => !nativeOff.includes(g));
}
