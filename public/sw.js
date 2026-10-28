// woli service worker: makes the installed phone app start fast and show a friendly page offline.
// It never stores API responses or pages with data: pages always come from the network (so every
// deploy is picked up), only the hashed build files (/_next/static, immutable) are cached.
const CACHE = "woli-static-v2";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/pwa/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: always the network; the offline page only when there is no connection.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Build files have content hashes in their names: safe to keep, fast to reuse.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});

// Web Push: a notification while woli is closed or in the background (sent by src/lib/push.ts).
// When woli is open in front of the user the bell already shows it (pop-up + sound), so no second
// system notification - except on iPhone/iPad, where WebKit expects every push to show one.
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: event.data ? event.data.text() : "woli" };
  }
  const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      wins.forEach((w) => w.postMessage({ type: "woli:push", id: msg.id }));
      if (!ios && wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
      return self.registration.showNotification(msg.title || "woli", {
        body: msg.body || "",
        icon: "/pwa/icon-192.png",
        badge: "/pwa/icon-192.png",
        tag: msg.tag || msg.id,
        data: { url: msg.url || "/workspaces" },
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/workspaces", self.location.origin);
  if (target.origin !== self.location.origin) return; // only open woli's own pages
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.focus().then((w) => (w && "navigate" in w ? w.navigate(target.href) : undefined));
      return self.clients.openWindow(target.href);
    })
  );
});
