"use client";
import { signOut } from "next-auth/react";
import { api } from "@/lib/api-client";

const FLAG = "woli.pushOn";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Push works here: a service worker, the Push API and notifications allowed. */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** This device is registered for Web Push, so the service worker raises system notifications itself. */
export function pushActive(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Registers this browser / installed app for Web Push once notifications are allowed, so they arrive while
 * woli is closed. Safe to call often: it reuses the existing subscription and re-registers it with the server
 * (which also moves it to whoever is signed in now). Returns whether push is on for this device.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const cfg = await api.get<{ enabled: boolean; publicKey: string | null }>("/api/account/push");
    if (!cfg.enabled || !cfg.publicKey) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false; // the service worker is registered in production builds only
    const key = keyBytes(cfg.publicKey);
    let sub = await reg.pushManager.getSubscription();
    const sameKey = sub?.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
    if (sub && !sameKey) {
      await sub.unsubscribe(); // the server's key changed: subscribe again with the new one
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await api.post("/api/account/push", { endpoint: json.endpoint, keys: json.keys });
    localStorage.setItem(FLAG, "1");
    return true;
  } catch {
    try {
      localStorage.removeItem(FLAG);
    } catch {}
    return false;
  }
}

/** Stops push on this device (so the next person signing in here does not get your notifications). */
export async function stopPush(): Promise<void> {
  try {
    localStorage.removeItem(FLAG);
    const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : undefined;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api.delete("/api/account/push", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } catch {}
}

/** Sign out, first removing this device's push registration. */
export async function signOutAndUnsubscribe(opts: Parameters<typeof signOut>[0]) {
  await stopPush();
  await signOut(opts);
}
