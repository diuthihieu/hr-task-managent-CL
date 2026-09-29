"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Lock, MailOpen, Mail } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { KudosDto } from "@/lib/recognition/kudos";
import { Avatar, STYLE_META } from "./shared";
import type { MessageKey } from "@/lib/i18n/core";

/** Kudos wall (public letters) or the caller's own letters ("received" / "sent"). */
export function KudosList({ workspaceId, scope, refreshKey }: { workspaceId: string; scope: "wall" | "received" | "sent"; refreshKey: number }) {
  const { t } = useT();
  const [data, setData] = useState<{ items: KudosDto[]; byStyle: Record<string, number> } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loader while switching lists
    setData(null);
    api.get<{ items: KudosDto[]; byStyle: Record<string, number> }>(`/api/workspaces/${workspaceId}/kudos?scope=${scope}`).then(setData).catch(() => setData({ items: [], byStyle: {} }));
  }, [workspaceId, scope, refreshKey]);
  if (!data)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  return (
    <div className="space-y-3" data-testid={`kudos-${scope}`}>
      {!!data.items.length && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 font-medium">{t("reco.list.total", { n: data.items.length })}</span>
          {Object.entries(data.byStyle).map(([s, n]) => (
            <span key={s} className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
              {STYLE_META[s]?.emoji} {t(`reco.style.${s}` as MessageKey)} · {n}
            </span>
          ))}
        </div>
      )}
      {!data.items.length && <p className="text-sm text-neutral-500 py-6 text-center">{t(`reco.list.empty.${scope}` as MessageKey)}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((k) => (
          <Link key={k.id} href={k.href} className={cn("rounded-2xl border bg-gradient-to-br p-4 hover:shadow-md transition-shadow", STYLE_META[k.style]?.tone, STYLE_META[k.style]?.ring)} data-testid="kudos-card">
            <div className="flex items-center gap-2 text-xs">
              <Avatar p={k.from} size={24} />
              <span className="font-medium truncate">{k.from.name}</span>
              <span className="text-neutral-400">→</span>
              <Avatar p={k.to} size={24} />
              <span className="font-medium truncate">{k.to.name}</span>
              <span className="ml-auto text-lg">{STYLE_META[k.style]?.emoji}</span>
            </div>
            <p className="mt-2 font-serif text-[15px] font-semibold text-neutral-900 dark:text-neutral-50 line-clamp-2">{k.title}</p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 line-clamp-3 whitespace-pre-line">{k.message}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
              <span>{formatDate(k.createdAt)}</span>
              {!k.isPublic && <Lock size={10} />}
              {k.mine && (k.read ? <MailOpen size={11} /> : <span className="inline-flex items-center gap-0.5 text-rose-600 font-medium"><Mail size={11} /> {t("reco.list.new")}</span>)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
