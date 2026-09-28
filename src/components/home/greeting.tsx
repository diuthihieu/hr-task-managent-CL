"use client";
import { useT } from "@/components/i18n-provider";

/** "Good morning/afternoon/evening, {name}" in the viewer's own time zone. */
export function Greeting({ name }: { name: string }) {
  const { t } = useT();
  const h = new Date().getHours();
  const key = h < 12 ? "home.morning" : h < 18 ? "home.afternoon" : "home.evening";
  return <span suppressHydrationWarning>{t(key, { name })} 👋</span>;
}
