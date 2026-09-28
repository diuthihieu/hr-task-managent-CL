"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, BellRing } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useT } from "@/components/i18n-provider";
import { create } from "zustand";
import { api } from "@/lib/api-client";
import { cn, initials } from "@/lib/utils";
import type { MessageKey, TFunction } from "@/lib/i18n/core";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarColor: string } | null;
  workspaceName: string | null;
  projectName: string | null;
}

const POLL_MS = 60_000;

/** Shared inbox state: the bell polls, the sidebar badge and the Inbox page read the same data. */
interface InboxState {
  items: NotificationItem[];
  unread: number;
  loaded: boolean;
  set: (p: Partial<InboxState>) => void;
}
export const useInbox = create<InboxState>((set) => ({ items: [], unread: 0, loaded: false, set: (p) => set(p) }));

export async function fetchInbox() {
  const r = await api.get<{ unread: number; items: NotificationItem[] }>("/api/notifications");
  useInbox.getState().set({ items: r.items, unread: r.unread, loaded: true });
  return r;
}

export async function markRead(n: NotificationItem) {
  if (n.read) return;
  const st = useInbox.getState();
  st.set({ items: st.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, st.unread - 1) });
  await api.patch(`/api/notifications/${n.id}`, { read: true }).catch(() => {});
}

export async function markAllRead() {
  const st = useInbox.getState();
  st.set({ items: st.items.map((x) => ({ ...x, read: true })), unread: 0 });
  await api.post("/api/notifications/read-all").catch(() => {});
}

export function UnreadCount() {
  const unread = useInbox((s) => s.unread);
  if (!unread) return null;
  return <span className="min-w-5 h-5 px-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold leading-5 text-center" data-testid="nav-unread">{unread > 99 ? "99+" : unread}</span>;
}

/** One sentence per notification type, in the viewer's language. */
export function describeNotification(n: NotificationItem, t: TFunction): string {
  const actor = n.actor?.name ?? t("notif.someone");
  const d = n.data ?? {};
  switch (n.type) {
    case "task_assigned":
      return t("notif.task_assigned", { actor });
    case "task_report_added":
      return t("notif.task_report_added", { actor });
    case "task_status":
      return t("notif.task_status", { actor, status: String(d.status ?? "") });
    case "task_updated": {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]).map((f) => (f.startsWith("cf_") || f.includes("-") ? t("notif.field.custom") : t(`notif.field.${f}` as MessageKey))).join(", ") : "";
      return t("notif.task_updated", { actor, fields });
    }
    case "task_comment":
      return t("notif.task_comment", { actor });
    case "task_due_soon":
      return t("notif.task_due_soon", { date: String(d.dueDate ?? "") });
    case "task_overdue":
      return t("notif.task_overdue", { date: String(d.dueDate ?? "") });
    case "capture_due":
      return t("notif.capture_due");
    default:
      return n.type;
  }
}

export function timeAgo(iso: string, t: TFunction) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("notif.justNow");
  if (s < 3600) return t("notif.minutes", { count: Math.floor(s / 60) });
  if (s < 86400) return t("notif.hours", { count: Math.floor(s / 3600) });
  return t("notif.days", { count: Math.floor(s / 86400) });
}

/**
 * Bell with unread badge. Polls the server (which also generates due /
 * overdue / quick-capture reminders) and, if the user allowed it, raises a
 * native browser notification for anything new since the previous poll.
 */
export function NotificationBell({ className, align = "start" }: { className?: string; align?: "start" | "end" }) {
  const { t } = useT();
  const router = useRouter();
  const items = useInbox((st) => st.items);
  const unread = useInbox((st) => st.unread);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchInbox();
      // Native notifications only for items that arrived after the first load.
      if (seen.current && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        for (const n of r.items) {
          if (!n.read && !seen.current.has(n.id)) {
            const native = new Notification(n.title, { body: describeNotification(n, t), tag: n.id });
            native.onclick = () => {
              window.focus();
              if (n.link) router.push(n.link);
            };
          }
        }
      }
      seen.current = new Set(r.items.map((n) => n.id));
    } catch {
      // Offline or signed out: keep the last state, try again on the next tick.
    }
  }, [router, t]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value, unknown during SSR
    if (typeof window !== "undefined" && "Notification" in window) setPermission(Notification.permission);
    const id = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function openItem(n: NotificationItem) {
    markRead(n);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  const markAll = markAllRead;

  async function enableNative() {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  }

  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) load(); }}>
      <PopoverTrigger asChild>
        <button className={cn("relative rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800", className)} aria-label={t("notif.title")} data-testid="notif-bell">
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold leading-4 text-center" data-testid="notif-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align={align}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
          <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-50 flex-1">{t("notif.title")}</span>
          {(["all", "unread"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("text-xs rounded px-1.5 py-0.5", filter === f ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")}>
              {t(`notif.filter.${f}`)}
            </button>
          ))}
          <button onClick={markAll} disabled={!unread} className="text-neutral-400 hover:text-indigo-600 disabled:opacity-40" title={t("notif.markAll")} data-testid="notif-mark-all">
            <CheckCheck size={15} />
          </button>
        </div>
        {permission === "default" && (
          <button onClick={enableNative} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/40 hover:bg-indigo-50">
            <BellRing size={13} /> {t("notif.enableNative")}
          </button>
        )}
        <div className="max-h-[420px] overflow-y-auto thin-scroll divide-y divide-neutral-100 dark:divide-neutral-800">
          {shown.length === 0 && <div className="px-3 py-8 text-center text-xs text-neutral-400">{t("notif.empty")}</div>}
          {shown.map((n) => (
            <NotificationRow key={n.id} n={n} onOpen={() => openItem(n)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationRow({ n, onOpen, large }: { n: NotificationItem; onOpen: () => void; large?: boolean }) {
  const { t } = useT();
  return (
    <button onClick={onOpen} className={cn("w-full text-left flex gap-2.5 px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60", large && "px-4 py-3.5", !n.read && "bg-indigo-50/40 dark:bg-indigo-950/20")} data-testid="notif-item">
      {n.actor ? (
        <span className={cn("rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0", large ? "h-9 w-9" : "h-7 w-7")} style={{ backgroundColor: n.actor.avatarColor }}>
          {initials(n.actor.name)}
        </span>
      ) : (
        <span className={cn("rounded-full flex items-center justify-center shrink-0", large ? "h-9 w-9" : "h-7 w-7", n.type === "task_overdue" ? "bg-red-100 text-red-600 dark:bg-red-950" : "bg-amber-100 text-amber-600 dark:bg-amber-950")}>
          <Bell size={13} />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-neutral-500">{describeNotification(n, t)}</span>
        <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{n.title}</span>
        {n.body && <span className="block text-xs text-neutral-500 line-clamp-2">{n.body}</span>}
        <span className="block text-[11px] text-neutral-400 mt-0.5 truncate">
          {[n.projectName, n.workspaceName].filter(Boolean).join(" · ")} · {timeAgo(n.createdAt, t)}
        </span>
      </span>
      {!n.read && <span className="h-2 w-2 rounded-full bg-indigo-600 mt-1.5 shrink-0" />}
    </button>
  );
}
