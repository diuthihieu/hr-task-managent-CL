// public/sw.js: a push shows a notification unless woli is already open in front (the bell
// shows it then), iPhones always get one, and a click only ever opens woli's own pages.
// Headless Chromium can't grant push permission, so the events are dispatched by hand.
import { expect, test } from "@playwright/test";

test("push and notification clicks in the service worker", async ({ page, context, baseURL }) => {
  await page.goto("/offline.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  type Win = { url: string; visibilityState: string; focused: boolean };
  const push = (wins: Win[], ua: string) =>
    sw.evaluate(
      async ([wins, ua]) => {
        const shown: { title: string; body?: string; data?: { url?: string } }[] = [];
        const g = self as unknown as {
          registration: { showNotification: (title: string, o: object) => Promise<void> };
          clients: { matchAll: () => Promise<unknown[]> };
          navigator: Navigator;
          dispatchEvent: (e: Event) => boolean;
        };
        g.registration.showNotification = async (title, o) => void shown.push({ title, ...o });
        g.clients.matchAll = async () => wins.map((w) => ({ ...w, postMessage() {} }));
        Object.defineProperty(g.navigator, "userAgent", { value: ua, configurable: true });
        const waits: Promise<unknown>[] = [];
        const ev = new Event("push") as Event & { data: unknown; waitUntil: (p: Promise<unknown>) => void };
        const payload = JSON.stringify({ id: "n1", title: "Close October payroll", body: "Linh mentioned you", url: "/w/x/inbox", tag: "n1" });
        ev.data = { json: () => JSON.parse(payload), text: () => payload };
        ev.waitUntil = (p) => void waits.push(p);
        g.dispatchEvent(ev);
        await Promise.all(waits);
        return shown;
      },
      [wins, ua] as const,
    );
  const desktop = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari";
  const front = [{ url: `${baseURL}/w/x`, visibilityState: "visible", focused: true }];

  const closed = await push([], desktop);
  expect(closed).toHaveLength(1);
  expect(closed[0]).toMatchObject({ title: "Close October payroll", body: "Linh mentioned you", data: { url: "/w/x/inbox" } });
  expect(await push([{ url: `${baseURL}/w/x`, visibilityState: "hidden", focused: false }], desktop)).toHaveLength(1);
  expect(await push(front, desktop), "open in front: the bell shows it, no duplicate").toHaveLength(0);
  expect(await push(front, iphone), "iPhone: always shown").toHaveLength(1);

  const opened = await sw.evaluate(async () => {
    const out: string[] = [];
    const g = self as unknown as { clients: { matchAll: () => Promise<unknown[]>; openWindow: (u: string) => Promise<void> }; dispatchEvent: (e: Event) => boolean };
    g.clients.matchAll = async () => [];
    g.clients.openWindow = async (u) => void out.push(u);
    for (const url of ["/w/x/inbox", "https://evil.example/phish"]) {
      const waits: Promise<unknown>[] = [];
      const ev = new Event("notificationclick") as Event & { notification: unknown; waitUntil: (p: Promise<unknown>) => void };
      ev.notification = { data: { url }, close() {} };
      ev.waitUntil = (p) => void waits.push(p);
      g.dispatchEvent(ev);
      await Promise.all(waits);
    }
    return out;
  });
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatch(/\/w\/x\/inbox$/);
});
