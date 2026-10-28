// Web Push: notifications reach the user's phone / computer while woli is closed.
// Every notification row the app writes is queued here (src/lib/prisma.ts hooks notification.create /
// createMany) and sent after the response, so no route needs to know about push.
// Needs VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (and optionally VAPID_SUBJECT); without them push is off.
import webpush from "web-push";
import { after } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { makeT, normalizeLocale, type MessageKey } from "./i18n/core";
import { notifyGroupOf, type NotifyGroup } from "./notification-prefs";

export interface QueuedNotification {
  id?: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  data?: unknown;
  link?: string | null;
  actorId?: string | null;
}

/**
 * The server sends to the endpoint a browser gives us, so only the browsers' own push services are
 * accepted (no requests to arbitrary hosts): Chrome / Edge / Android (FCM), Firefox, Safari / iOS, Windows.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/];
export function isPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidSet = false;
function setVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@woli.vn", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  vapidSet = true;
}

/** The line under the title, in the reader's language (same wording as the bell for the common types). */
function describe(n: QueuedNotification, actor: string, locale: string): string {
  const t = makeT(normalizeLocale(locale));
  const d = (n.data ?? {}) as Record<string, unknown>;
  const simple: Record<string, MessageKey> = {
    task_assigned: "notif.task_assigned",
    task_report_added: "notif.task_report_added",
    task_comment: "notif.task_comment",
    mention: "notif.mention",
    approval_request: "notif.approval_request",
    kudos: "notif.kudos",
    reward_request: "notif.reward_request",
    template_shared: "notif.template_shared",
  };
  if (simple[n.type]) return t(simple[n.type], { actor });
  if (n.type === "task_status") return t("notif.task_status", { actor, status: String(d.status ?? "") });
  if (n.type === "task_due_soon") return t("notif.task_due_soon", { date: String(d.dueDate ?? "") });
  if (n.type === "task_overdue") return t("notif.task_overdue", { date: String(d.dueDate ?? "") });
  return n.body ?? "";
}

/**
 * Queue notifications for push once the current request has finished (`after`), or right away
 * outside a request (scripts, tests). `since` lets the sender skip rows a rolled-back transaction never kept.
 */
export function queuePush(db: PrismaClient, rows: QueuedNotification[]) {
  if (!rows.length || !pushConfigured()) return;
  const since = new Date(Date.now() - 2_000);
  const job = () => sendPush(db, rows, since).catch((e) => console.error("[push] send failed", e));
  try {
    after(job);
  } catch {
    void job();
  }
}

export async function sendPush(db: PrismaClient, rows: QueuedNotification[], since: Date) {
  setVapid();
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [users, subs, actors] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds }, isActive: true, deletedAt: null }, select: { id: true, locale: true, notifyNativeOff: true } }),
    db.pushSubscription.findMany({ where: { userId: { in: userIds } } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  if (!subs.length) return;
  const userById = new Map(users.map((u) => [u.id, u]));
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const gone: string[] = [];
  const used: string[] = [];
  for (const n of rows) {
    const u = userById.get(n.userId);
    if (!u) continue;
    const group = notifyGroupOf(n);
    if (group && (u.notifyNativeOff as NotifyGroup[]).includes(group)) continue; // "Desktop / Mobile" switched off for this group
    // Only rows that really exist (a rolled-back transaction or a skipped duplicate sends nothing).
    const kept = n.id
      ? await db.notification.findUnique({ where: { id: n.id }, select: { id: true } })
      : await db.notification.findFirst({ where: { userId: n.userId, type: n.type, title: n.title, createdAt: { gte: since } }, select: { id: true } });
    if (!kept) continue;
    const t = makeT(normalizeLocale(u.locale));
    const actor = (n.actorId && actorName.get(n.actorId)) || t("notif.someone");
    const payload = JSON.stringify({ id: kept.id, title: n.title, body: describe(n, actor, u.locale ?? "vi"), url: n.link || "/workspaces", tag: kept.id });
    for (const s of subs.filter((x) => x.userId === n.userId)) {
      if (!isPushEndpoint(s.endpoint)) {
        gone.push(s.id); // never send to anything but a browser push service
        continue;
      }
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: "high" });
        used.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id); // unsubscribed / expired on the device
        else console.error("[push] delivery failed", code ?? e);
      }
    }
  }
  if (gone.length) await db.pushSubscription.deleteMany({ where: { id: { in: [...new Set(gone)] } } });
  if (used.length) await db.pushSubscription.updateMany({ where: { id: { in: [...new Set(used)] } }, data: { lastUsedAt: new Date() } });
}
