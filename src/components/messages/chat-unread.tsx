"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useChatSignals } from "./use-chat-live";

/** Unread messages badge for the sidebar "Messages" link. */
export function ChatUnread() {
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // Several signals in a burst (a busy group) cost one request.
    timer.current = setTimeout(() => {
      api.get<{ count: number }>("/api/messages/unread").then((r) => setCount(r.count)).catch(() => {});
    }, 400);
  }, []);
  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useChatSignals((s) => {
    if (s.event !== "typing") load();
  });
  if (!count) return null;
  return <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-semibold leading-5 text-center" data-testid="chat-unread">{count > 99 ? "99+" : count}</span>;
}
