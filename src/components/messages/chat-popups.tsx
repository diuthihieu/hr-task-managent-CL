"use client";
// New chat messages and contact requests while woli is open: a pop-up in the corner with the ringtone,
// and a system notification when the tab is in the background on a device without Web Push (with Web
// Push the service worker raises it). Follows Settings -> Notifications -> Messages. Nothing pops up on
// the Messages page itself, where the list already shows it.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, UserPlus, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { DEFAULT_NOTIFY_SETTINGS, playRingtone } from "@/lib/notification-prefs";
import { useInbox } from "@/components/notifications/notification-bell";
import { pushActive } from "@/components/notifications/web-push";
import { useChatSignals } from "./use-chat-live";

interface Row {
  id: string;
  kind: "direct" | "group" | "bot";
  name: string | null;
  muted: boolean;
  unread: number;
  members: { name: string }[];
  last: { body: string | null; recalled: boolean; author: string | null; at: string } | null;
}
interface Popup {
  key: string;
  title: string;
  body: string;
  url: string;
  request?: boolean;
}
const POPUP_MS = 9_000;

/** Markdown marks out of a one-line preview (Woli AI writes Markdown). */
function preview(text: string): string {
  return text.replace(/[*_`#>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

export function ChatPopups() {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const onMessages = /\/messages$/.test(pathname ?? "");
  const [popups, setPopups] = useState<Popup[]>([]);
  // What this tab has already seen: the newest message time per conversation, and who asked to connect.
  const seenChats = useRef<Map<string, string> | null>(null);
  const seenRequests = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const here = useRef(onMessages);
  useEffect(() => {
    here.current = onMessages;
  }, [onMessages]);

  const show = useCallback(
    (fresh: Popup[]) => {
      if (!fresh.length) return;
      const prefs = useInbox.getState().settings ?? DEFAULT_NOTIFY_SETTINGS;
      const background = document.hidden;
      const popOn = !prefs.popupOff.includes("chat") && !here.current;
      const nativeOn = background && !prefs.nativeOff.includes("chat") && !pushActive() && "Notification" in window && Notification.permission === "granted";
      if (popOn) {
        setPopups((prev) => [...fresh.slice(0, 3), ...prev.filter((p) => !fresh.some((f) => f.key === p.key))].slice(0, 4));
        for (const f of fresh) setTimeout(() => setPopups((prev) => prev.filter((p) => p !== f)), POPUP_MS);
      }
      if ((popOn || nativeOn) && prefs.sound !== "none") playRingtone(prefs.sound, prefs.volume);
      if (nativeOn) {
        for (const f of fresh) {
          const native = new Notification(f.title, { body: f.body, tag: f.key });
          native.onclick = () => {
            window.focus();
            router.push(f.url);
          };
        }
      }
    },
    [router],
  );

  const check = useCallback(
    (what: { chats: boolean; requests: boolean }) => {
      if (what.chats)
        api
          .get<Row[]>("/api/messages")
          .then((rows) => {
            const before = seenChats.current;
            const fresh: Popup[] = [];
            for (const r of rows) {
              // Mine (author null), read, muted, or already seen: nothing to announce.
              if (!before || !r.last || !r.last.author || r.muted || !r.unread) continue;
              const known = before.get(r.id);
              if (known && known >= r.last.at) continue;
              const who = r.kind === "bot" ? t("chat.bot") : r.kind === "group" ? `${r.last.author} · ${r.name || r.members.map((m) => m.name).join(", ")}` : (r.name ?? r.last.author);
              const body = r.last.recalled ? t("chat.popup.recalled") : r.unread > 1 ? `${preview(r.last.body ?? "")} (${t("chat.popup.more", { count: r.unread })})` : preview(r.last.body ?? "");
              fresh.push({ key: `chat:${r.id}`, title: who, body, url: `/messages?c=${r.id}` });
            }
            seenChats.current = new Map(rows.filter((r) => r.last).map((r) => [r.id, r.last!.at]));
            show(fresh);
          })
          .catch(() => {});
      if (what.requests)
        api
          .get<{ incoming: { id: string; name: string }[] }>("/api/messages/contacts")
          .then((lists) => {
            const before = seenRequests.current;
            const fresh = before ? lists.incoming.filter((p) => !before.has(p.id)).map((p) => ({ key: `contact:${p.id}`, title: p.name, body: t("chat.pushRequest"), url: "/messages?tab=contacts", request: true })) : [];
            seenRequests.current = new Set(lists.incoming.map((p) => p.id));
            show(fresh);
          })
          .catch(() => {});
    },
    [show, t],
  );

  const want = useRef({ chats: false, requests: false });
  const schedule = useCallback(
    (what: { chats?: boolean; requests?: boolean }) => {
      want.current = { chats: want.current.chats || !!what.chats, requests: want.current.requests || !!what.requests };
      if (timer.current) clearTimeout(timer.current);
      // A burst of signals (a busy group) costs one request.
      timer.current = setTimeout(() => {
        const w = want.current;
        want.current = { chats: false, requests: false };
        check(w);
      }, 500);
    },
    [check],
  );
  useEffect(() => {
    schedule({ chats: true, requests: true }); // the baseline: what was already there pops nothing
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);
  useChatSignals((s) => {
    if (s.event === "message" || s.event === "conversation") schedule({ chats: true });
    else if (s.event === "contact") schedule({ requests: true });
    else if (s.event === "poll") schedule({ chats: true, requests: true });
  });

  if (!popups.length) return null;
  return (
    <div className="fixed z-[70] bottom-[calc(1rem+var(--app-bottom))] left-4 right-4 sm:right-auto sm:w-96 flex flex-col gap-2" role="status" aria-live="polite" data-testid="chat-popups">
      {popups.map((p) => (
        <div key={p.key} className="flex items-start gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl p-3 animate-in" data-testid="chat-popup">
          <button
            onClick={() => {
              setPopups((prev) => prev.filter((x) => x !== p));
              router.push(p.url);
            }}
            className="flex flex-1 min-w-0 items-start gap-3 text-left"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{p.request ? <UserPlus size={15} /> : <MessageCircle size={15} />}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{p.title}</span>
              <span className="block text-xs text-neutral-600 dark:text-neutral-300 line-clamp-2">{p.body}</span>
            </span>
          </button>
          <button onClick={() => setPopups((prev) => prev.filter((x) => x !== p))} className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("common.close")}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
