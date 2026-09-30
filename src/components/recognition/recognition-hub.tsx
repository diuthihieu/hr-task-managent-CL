"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Award, Gift, Inbox, Send, Settings2, Sparkles, Trophy } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { isRecognitionNotification, markRead, useInbox, type NotificationItem } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";
import { Leaderboards } from "./leaderboard";
import { KudosList } from "./kudos-list";
import { KudosComposer } from "./kudos-composer";
import { Rewards } from "./rewards";
import { RecognitionAdmin } from "./recognition-admin";
import { fmtNumber, type PersonLite } from "./shared";
import type { MessageKey } from "@/lib/i18n/core";

export type RecoTab = "leaderboard" | "mine" | "rewards" | "manage";

interface Overview {
  enabled: boolean;
  canManage: boolean;
  canSeeOthersPoints: boolean;
  points: { earned: number; pending: number; spent: number; balance: number };
  nextReward: { id: string; name: string; pointsCost: number; missing: number } | null;
  affordable: number;
  unreadKudos: number;
  kudosReceived: number;
  pendingRequests: number;
}

export function RecognitionHub({ workspaceId, workspaceSlug, tab, me }: { workspaceId: string; workspaceSlug: string; tab: RecoTab; me: { id: string; name: string } }) {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [o, setO] = useState<Overview | null>(null);
  const [compose, setCompose] = useState<{ to: PersonLite | null } | null>(params.get("send") ? { to: null } : null);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => api.get<Overview>(`/api/workspaces/${workspaceId}/recognition`).then(setO).catch(() => {}), [workspaceId]);
  useEffect(() => {
    load();
  }, [load, tick]);
  // Opening a tab clears the sidebar badge for the notifications it answers.
  useEffect(() => {
    const kinds: Record<RecoTab, (n: NotificationItem) => boolean> = {
      leaderboard: () => false,
      mine: () => false, // letters are marked read when opened
      rewards: (n) => n.type === "reward_result" || n.type === "ai_suggestion",
      manage: (n) => n.type === "reward_request",
    };
    const inbox = useInbox.getState().items;
    inbox.filter((n) => !n.read && isRecognitionNotification(n) && kinds[tab](n) && (!n.workspaceId || n.workspaceId === workspaceId)).forEach((n) => markRead(n));
  }, [tab, workspaceId]);
  const go = (k: RecoTab) => router.replace(`/w/${workspaceSlug}/recognition?tab=${k}`);
  const tabs: { key: RecoTab; icon: typeof Trophy; badge?: number }[] = [
    { key: "leaderboard", icon: Trophy },
    { key: "mine", icon: Inbox, badge: o?.unreadKudos },
    { key: "rewards", icon: Gift, badge: o?.affordable },
    ...(o?.canManage ? [{ key: "manage" as const, icon: Settings2, badge: o?.pendingRequests }] : []),
  ];
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-[72rem] mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight inline-flex items-center gap-2">
              <Award size={22} className="text-indigo-500" /> {t("reco.title")}
            </h1>
            <p className="text-sm text-neutral-500 mt-0.5">{t("reco.subtitle")}</p>
          </div>
          <Button onClick={() => setCompose({ to: null })} data-testid="reco-send">
            <Send size={14} /> {t("reco.send")}
          </Button>
        </div>
        {o && !o.enabled && <p className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-3 py-2 text-sm">{t("reco.disabled")}</p>}
        {o && (
          <div className="grid gap-3 sm:grid-cols-3 mb-5" data-testid="reco-overview">
            <div className="rounded-2xl p-4 bg-gradient-to-br from-indigo-600 to-indigo-400 text-white">
              <p className="text-xs opacity-80">{t("reco.me.balance")}</p>
              <p className="text-3xl font-bold tabular-nums" data-testid="reco-balance">{fmtNumber(o.points.balance)}</p>
              <p className="text-[11px] opacity-80">{t("reco.me.detail", { earned: fmtNumber(o.points.earned), pending: fmtNumber(o.points.pending), spent: fmtNumber(o.points.spent) })}</p>
            </div>
            <div className="rounded-2xl p-4 border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <p className="text-xs text-neutral-500 inline-flex items-center gap-1"><Sparkles size={12} className="text-indigo-500" /> {t("reco.me.next")}</p>
              {o.nextReward ? (
                <>
                  <p className="font-semibold mt-1">{o.nextReward.name}</p>
                  <p className="text-xs text-neutral-500">{t("reco.rewards.missing", { n: fmtNumber(o.nextReward.missing) })}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, Math.round((o.points.balance / o.nextReward.pointsCost) * 100))}%` }} />
                  </div>
                </>
              ) : (
                <p className="text-sm mt-1">{o.affordable ? t("reco.me.canRedeem", { n: o.affordable }) : t("reco.me.noRewards")}</p>
              )}
            </div>
            <div className="rounded-2xl p-4 border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <p className="text-xs text-neutral-500">{t("reco.me.kudos")}</p>
              <p className="text-3xl font-bold tabular-nums">{o.kudosReceived}</p>
              {!!o.unreadKudos && <p className="text-xs text-rose-600 font-medium">{t("reco.me.unread", { n: o.unreadKudos })}</p>}
            </div>
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto thin-scroll border-b border-neutral-200 dark:border-neutral-800 mb-5" role="tablist">
          {tabs.map(({ key, icon: Icon, badge }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => go(key)} className={cn("h-9 px-3 text-sm font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap", tab === key ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")} data-testid={`reco-tab-${key}`}>
              <Icon size={14} /> {t(`reco.tab.${key}` as MessageKey)}
              {!!badge && <span className="min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-4">{badge}</span>}
            </button>
          ))}
        </div>
        {tab === "leaderboard" && <Leaderboards workspaceId={workspaceId} canSeePoints={!!o?.canSeeOthersPoints} onThank={(p) => setCompose({ to: p })} />}
        {tab === "mine" && (
          <div className="space-y-6">
            <KudosList workspaceId={workspaceId} scope="received" refreshKey={tick} />
            <div>
              <h3 className="text-sm font-semibold mb-2">{t("reco.list.sent")}</h3>
              <KudosList workspaceId={workspaceId} scope="sent" refreshKey={tick} />
            </div>
          </div>
        )}
        {tab === "rewards" && <Rewards workspaceId={workspaceId} balance={o?.points.balance ?? 0} onChanged={() => setTick((n) => n + 1)} />}
        {tab === "manage" && o?.canManage && <RecognitionAdmin workspaceId={workspaceId} />}
      </div>
      {compose && <KudosComposer workspaceId={workspaceId} me={me} to={compose.to} onClose={() => setCompose(null)} onSent={() => { setCompose(null); setTick((n) => n + 1); }} />}
    </div>
  );
}
