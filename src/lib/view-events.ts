"use client";

// The sidebar (server-rendered project/view list) and the project page's view
// tabs (client state) show the same views. Whoever changes a view tells the
// other: the project page listens for this event, the sidebar re-renders on
// router.refresh().
const EVENT = "woli:views-changed";

export function emitViewsChanged(projectId: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { projectId } }));
}

export function onViewsChanged(projectId: string, handler: () => void) {
  const listener = (e: Event) => {
    if ((e as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) handler();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
