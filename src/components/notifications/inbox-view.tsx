"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Inbox } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInbox, fetchInbox, markRead, markAllRead, NotificationRow } from "./notification-bell";

/** Full-page inbox: the same notifications as the bell, with room to read them. */
export function InboxView() {
  const { t } = useT();
  const router = useRouter();
  const { items, unread, loaded } = useInbox();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    fetchInbox().catch(() => {});
  }, []);

  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 flex-1">{t("notif.title")}</h1>
          <div className="flex rounded-lg border border-neutral-200 dark:border-neutral-800 p-0.5 bg-white dark:bg-neutral-900">
            {(["all", "unread"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("text-xs rounded-md px-2.5 py-1", filter === f ? "bg-indigo-600 text-white" : "text-neutral-500 hover:text-neutral-800")}>
                {t(`notif.filter.${f}`)}
                {f === "unread" && unread > 0 && ` (${unread})`}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={markAllRead} disabled={!unread}>
            <CheckCheck size={14} /> {t("notif.markAll")}
          </Button>
        </div>
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 divide-y divide-neutral-100 dark:divide-neutral-800 overflow-hidden">
          {loaded && shown.length === 0 && (
            <div className="py-16 flex flex-col items-center gap-2 text-neutral-400">
              <Inbox size={28} />
              <span className="text-sm">{t("notif.empty")}</span>
            </div>
          )}
          {shown.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              large
              onOpen={() => {
                markRead(n);
                if (n.link) router.push(n.link);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
