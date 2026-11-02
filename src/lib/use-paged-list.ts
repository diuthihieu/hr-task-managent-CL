"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api-client";
import type { Page } from "./pagination";
import { LoadGeneration } from "./load-generation";

type State<T> = { url: string | null; items: T[]; nextCursor: string | null };

/**
 * A list served page by page (`{ items, nextCursor }`, BUG-11). `older: "before"` puts later pages
 * in front (comments: the newest page comes first, older comments go above); `"after"` appends
 * (newest-first lists such as history and files). `setItems` stays available for optimistic edits.
 */
export function usePagedList<T extends { id: string }>(url: string | null, older: "before" | "after") {
  const [state, setState] = useState<State<T>>({ url: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  // Responses for a previous url (another task opened meanwhile) are dropped.
  const live = useRef(url);
  useEffect(() => {
    live.current = url;
  }, [url]);
  // A reload (e.g. the record changed) makes pages requested before it stale: page three arriving
  // after the reload must not be appended to the fresh page one (page two would go missing).
  const generation = useRef(new LoadGeneration());

  const reload = useCallback(async () => {
    if (!url) return;
    const token = generation.current.restart();
    const page = await api.get<Page<T>>(url);
    if (live.current !== url || !generation.current.isCurrent(token)) return;
    setState({ url, items: page.items, nextCursor: page.nextCursor });
  }, [url]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const fresh = state.url === url;
  const nextCursor = fresh ? state.nextCursor : null;

  const setItems = useCallback(
    (update: T[] | ((prev: T[]) => T[])) =>
      setState((s) => {
        const base = s.url === url ? s : { url, items: [], nextCursor: null };
        return { ...base, items: typeof update === "function" ? update(base.items) : update };
      }),
    [url],
  );

  const loadMore = useCallback(async () => {
    if (!url || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    const token = generation.current.peek();
    try {
      const page = await api.get<Page<T>>(`${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(nextCursor)}`);
      if (live.current !== url || !generation.current.isCurrent(token)) return;
      setState((s) => {
        if (s.url !== url) return s;
        const seen = new Set(s.items.map((i) => i.id));
        const added = page.items.filter((i) => !seen.has(i.id));
        return { url, items: older === "before" ? [...added, ...s.items] : [...s.items, ...added], nextCursor: page.nextCursor };
      });
    } catch {
      // The cursor row is gone (deleted or archived): start over (unless a reload already did).
      if (generation.current.isCurrent(token)) await reload().catch(() => {});
    } finally {
      setLoadingMore(false);
    }
  }, [url, nextCursor, loadingMore, older, reload]);

  return { items: fresh ? state.items : (EMPTY as T[]), setItems, hasMore: nextCursor !== null, loadMore, loadingMore, reload };
}

const EMPTY: never[] = [];
