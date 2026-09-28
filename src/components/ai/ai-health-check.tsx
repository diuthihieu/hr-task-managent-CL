"use client";
import { useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";

interface Health {
  ok: boolean;
  configured: boolean;
  model?: string;
  models: string[];
  ms?: number;
  message?: string;
}

/** "Test AI connection": shows which model answered, or Google's exact error. */
export function AiHealthCheck() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Health | null>(null);
  return (
    <div className="text-xs">
      <button
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await api.post<Health>("/api/ai/health"));
          } catch (e) {
            setResult({ ok: false, configured: true, models: [], message: e instanceof Error ? e.message : String(e) });
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 font-medium text-neutral-700 dark:text-neutral-200 hover:border-indigo-400"
        data-testid="ai-health"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />} {t("ai.health")}
      </button>
      {result && (
        <div className={`mt-2 rounded-md px-2.5 py-2 whitespace-pre-wrap break-words ${result.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"}`} data-testid="ai-health-result">
          {result.ok ? t("ai.healthOk", { model: result.model ?? "", ms: result.ms ?? 0 }) : `${t("ai.healthFail")} ${result.message ?? ""}`}
          {!result.ok && result.models.length > 0 && <div className="mt-1 opacity-70">{t("ai.healthModels", { models: result.models.join(", ") })}</div>}
        </div>
      )}
    </div>
  );
}
