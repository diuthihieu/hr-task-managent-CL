"use client";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { setPreferenceCookie } from "@/lib/client-dom";
import type { Locale } from "@/lib/i18n/core";

/** VI / EN toggle. Signed-in users save it to their profile; visitors get a cookie. */
export function LocaleSwitch({ signedIn = false, className }: { signedIn?: boolean; className?: string }) {
  const { locale } = useT();
  const router = useRouter();

  async function choose(next: Locale) {
    if (next === locale) return;
    setPreferenceCookie("bw_locale", next);
    if (signedIn) await api.patch("/api/account/preferences", { locale: next }).catch(() => {});
    router.refresh();
  }

  return (
    <div className={cn("inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-800 p-0.5 text-xs", className)} role="group" aria-label="Language">
      <Languages size={13} className="mx-1 text-neutral-400" />
      {(["vi", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => choose(l)}
          aria-pressed={locale === l}
          className={cn("rounded px-1.5 py-0.5 font-medium uppercase", locale === l ? "bg-indigo-600 text-white" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
