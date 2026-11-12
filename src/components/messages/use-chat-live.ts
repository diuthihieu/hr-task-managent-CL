"use client";
// Live signals for Messages: one Supabase Realtime connection per tab, on the topic only this user is
// told (see src/lib/messaging/realtime.ts). Signals carry no message text; listeners re-read through the
// API. Without realtime (not configured, blocked network, connection lost) a "poll" signal fires every
// 30 seconds instead, and whenever the tab comes back into view.
import { useEffect, useRef, useSyncExternalStore } from "react";

export interface ChatSignal {
  event: "message" | "typing" | "read" | "conversation" | "contact" | "poll";
  payload: Record<string, unknown>;
}
type Listener = (s: ChatSignal) => void;

const listeners = new Set<Listener>();
const liveListeners = new Set<() => void>();
let started = false;
let live = false;

function emit(s: ChatSignal) {
  for (const l of listeners) l(s);
}
function setLive(v: boolean) {
  if (live === v) return;
  live = v;
  for (const l of liveListeners) l();
}

async function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  setInterval(() => {
    if (!live && document.visibilityState === "visible") emit({ event: "poll", payload: {} });
  }, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") emit({ event: "poll", payload: {} });
  });
  try {
    const res = await fetch("/api/messages/realtime", { credentials: "same-origin" });
    if (!res.ok) return;
    const cfg = (await res.json()) as { enabled: boolean; url?: string; key?: string; topic?: string };
    if (!cfg.enabled || !cfg.url || !cfg.key || !cfg.topic) return;
    const { RealtimeClient } = await import("@supabase/realtime-js");
    const client = new RealtimeClient(`${cfg.url.replace(/^https:/, "wss:")}/realtime/v1`, { params: { apikey: cfg.key } });
    client
      .channel(cfg.topic, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "*" }, (m: { event: string; payload?: Record<string, unknown> }) => emit({ event: m.event as ChatSignal["event"], payload: m.payload ?? {} }))
      .subscribe((status: string) => {
        setLive(status === "SUBSCRIBED");
        // Back online after a gap: catch up on anything missed.
        if (status === "SUBSCRIBED") emit({ event: "poll", payload: {} });
      });
  } catch (e) {
    console.warn("[chat] live updates unavailable", e);
  }
}

/** Calls `onSignal` for every live signal (and the polling fallback) while mounted. */
export function useChatSignals(onSignal: Listener) {
  const ref = useRef(onSignal);
  useEffect(() => {
    ref.current = onSignal;
  });
  useEffect(() => {
    void start();
    const l: Listener = (s) => ref.current(s);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

/** True while the realtime connection is up (false: polling every 30 s). */
export function useChatLive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      liveListeners.add(cb);
      return () => liveListeners.delete(cb);
    },
    () => live,
    () => false,
  );
}

/** Tell the unread badge to re-count now (after I read a conversation). */
export function chatChanged() {
  emit({ event: "read", payload: {} });
}
