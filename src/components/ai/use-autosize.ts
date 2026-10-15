"use client";
import { useLayoutEffect, type RefObject } from "react";

/** Grows a textarea with its content (Shift+Enter lines included) up to maxPx, then scrolls. */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 160) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [ref, value, maxPx]);
}
