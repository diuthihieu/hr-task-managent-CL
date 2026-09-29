"use client";
// Decision memory: every recorded decision with its reason, alternatives,
// evidence, people, date, project and supersede chain.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Gavel, ArrowRight } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DecisionDialog, type Decision } from "./decision-dialog";
import { EmptyNote } from "./brain-hub";
import type { MessageKey } from "@/lib/i18n/core";

export const DECISION_TONE: Record<string, string> = {
  proposed: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  superseded: "bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-800",
  revoked: "bg-red-50 text-red-600 dark:bg-red-950/60",
};

export function DecisionsList({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [rows, setRows] = useState<Decision[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      api
        .get<Decision[]>(`/api/workspaces/${workspaceId}/decisions?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`)
        .then(setRows)
        .catch(() => setRows([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [workspaceId, q, status, open]);

  return (
    <div className="space-y-3" data-testid="decisions">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("brain.decision.search")} className="pl-7 w-64" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm">
          <option value="">{t("brain.decision.allStatuses")}</option>
          {["proposed", "active", "superseded", "revoked"].map((s) => (
            <option key={s} value={s}>
              {t(`brain.decisionStatus.${s}` as MessageKey)}
            </option>
          ))}
        </select>
        <Button className="ml-auto" onClick={() => setOpen(true)} data-testid="decision-new">
          <Plus size={14} /> {t("brain.decision.new")}
        </Button>
      </div>
      {rows && !rows.length && <EmptyNote text={t("brain.decision.empty")} />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((d) => (
          <Link key={d.id} href={d.href!} className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:border-indigo-200 dark:hover:border-indigo-900" data-testid="decision-card">
            <div className="flex items-start gap-2">
              <Gavel size={15} className="text-purple-600 mt-0.5 shrink-0" />
              <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-50 flex-1">{d.title}</span>
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md shrink-0", DECISION_TONE[d.status])}>{t(`brain.decisionStatus.${d.status}` as MessageKey)}</span>
            </div>
            {d.reason && <p className="mt-1.5 text-xs text-neutral-500 line-clamp-2">{d.reason}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
              <span>{d.decidedAt}</span>
              {d.project && <span>· {d.project.name}</span>}
              {!!d.people.length && <span>· {d.people.map((p) => p.name).join(", ")}</span>}
              {!!d.alternatives.length && <span>· {t("brain.decision.altCount", { n: d.alternatives.length })}</span>}
              {d.supersededBy && (
                <span className="inline-flex items-center gap-0.5 text-amber-600">
                  <ArrowRight size={10} /> {d.supersededBy.title}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
      {open && <DecisionDialog workspaceId={workspaceId} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />}
    </div>
  );
}
