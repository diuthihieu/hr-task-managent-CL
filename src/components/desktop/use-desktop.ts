"use client";
import { useSyncExternalStore } from "react";

const TOKEN = /BaseworkDesktop\/([0-9A-Za-z.+-]+)/;
const noop = () => () => {};

/** Version of the Windows desktop shell this page runs in, or null in a normal browser. */
export function useDesktopVersion(): string | null {
  return useSyncExternalStore(
    noop,
    () => navigator.userAgent.match(TOKEN)?.[1] ?? null,
    () => null
  );
}
