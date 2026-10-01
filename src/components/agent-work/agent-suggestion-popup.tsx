"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Loader2, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { MetaChip, MetaStatus } from "@/components/ui/meta";
import { useT } from "@/components/i18n-provider";
import type { AgentRunDto, AgentSettingsDto, AgentSuggestionDto } from "@/lib/agent-work/types";

export function AgentSuggestionPopup({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const { t } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [suggestion, setSuggestion] = useState<AgentSuggestionDto | null>(null);
  const [custom, setCustom] = useState(false);
  const [customGoal, setCustomGoal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pathname.includes("/agent-work")) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const settings = await api.get<AgentSettingsDto>(`/api/workspaces/${workspaceId}/agent-work/settings`);
        if (!settings.proactiveEnabled || settings.suggestionMode === "silent") return;
        const key = `woli-agent-scan:${workspaceId}`;
        const last = Number(window.localStorage.getItem(key) || 0);
        const wait = settings.suggestionMode === "proactive" ? 4 * 3600_000 : 12 * 3600_000;
        let items = await api.get<AgentSuggestionDto[]>(`/api/workspaces/${workspaceId}/agent-work/suggestions`);
        if (!items.length && Date.now() - last >= wait) {
          window.localStorage.setItem(key, String(Date.now()));
          items = await api.post<AgentSuggestionDto[]>(`/api/workspaces/${workspaceId}/agent-work/suggestions`, { manual: false });
        }
        if (!cancelled) setSuggestion(items[0] ?? null);
      } catch {
        // Proactive help must never interrupt normal work when AI/network is unavailable.
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname, workspaceId]);

  async function decide(decision: "accept" | "dismiss") {
    if (!suggestion) return;
    setBusy(true);
    try {
      const run = await api.patch<AgentRunDto>(`/api/agent-work/suggestions/${suggestion.id}`, { decision, customGoal: customGoal.trim() || undefined });
      setSuggestion(null);
      if (decision === "accept") router.push(`/w/${workspaceSlug}/agent-work?run=${run.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!suggestion) return null;
  return (
    <aside className="fixed z-[80] bottom-5 right-5 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-neutral-900 shadow-2xl p-4" role="dialog" aria-label={t("agent.popup.title")} data-testid="agent-suggestion-popup">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-indigo-600 text-white flex items-center justify-center"><Bot size={17} /></div>
        <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><h2 className="font-semibold text-sm">{t("agent.popup.title")}</h2><MetaStatus className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{Math.round(suggestion.confidence * 100)}%</MetaStatus></div><p className="text-sm font-medium mt-2">{suggestion.task.title}</p><p className="text-xs text-neutral-500 mt-1">{suggestion.reason}</p><div className="flex gap-1 mt-2"><MetaChip>{suggestion.task.project.name}</MetaChip><MetaChip>{suggestion.skill.name}</MetaChip></div></div>
        <button onClick={() => setSuggestion(null)} className="text-neutral-400 hover:text-neutral-700" aria-label={t("common.close")}><X size={16} /></button>
      </div>
      {custom && <Textarea className="mt-3" rows={3} value={customGoal} onChange={(event) => setCustomGoal(event.target.value)} placeholder={t("agent.action.customPh")} />}
      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <Button size="sm" variant="ghost" onClick={() => decide("dismiss")} disabled={busy}>{t("agent.action.notNow")}</Button>
        <Button size="sm" variant="outline" onClick={() => setCustom((value) => !value)} disabled={busy}>{t("agent.action.custom")}</Button>
        <Button size="sm" onClick={() => decide("accept")} disabled={busy || (custom && customGoal.trim().length < 3)}>{busy && <Loader2 size={12} className="animate-spin" />}{t("agent.popup.review")}</Button>
      </div>
    </aside>
  );
}

