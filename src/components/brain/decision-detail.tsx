"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gavel, Pencil, Trash2, ArrowRight, History, FileText, CheckSquare, Target, Waypoints, Loader2, CalendarClock } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DecisionDialog, type Decision } from "./decision-dialog";
import { DECISION_TONE } from "./decisions-list";
import type { MessageKey } from "@/lib/i18n/core";

/** One decision: what, why, alternatives, evidence, people, links and its supersede chain. */
export function DecisionDetail({ workspaceId, workspaceSlug, decisionId }: { workspaceId: string; workspaceSlug: string; decisionId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [d, setD] = useState<Decision | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    api.get<Decision>(`/api/decisions/${decisionId}`).then(setD).catch(() => setMissing(true));
  }, [decisionId]);
  const back = `/w/${workspaceSlug}/brain?tab=decisions`;

  async function remove() {
    if (!d || !confirm(t("common.confirmDelete", { name: d.title }))) return;
    try {
      await api.delete(`/api/decisions/${d.id}`);
      router.push(back);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  if (missing) return <div className="p-10 text-center text-sm text-neutral-500">{t("brain.decision.notFound")}</div>;
  if (!d)
    return (
      <div className="p-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2 border-b border-neutral-100 dark:border-neutral-800 text-sm">
      <span className="text-neutral-500 text-xs pt-0.5">{label}</span>
      <div>{value}</div>
    </div>
  );
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6" data-testid="decision-detail">
        <Link href={back} className="inline-flex items-center gap-1 text-xs text-neutral-500 mb-3">
          <ArrowLeft size={12} /> {t("brain.decisions")}
        </Link>
        <div className="flex items-start gap-3">
          <Gavel size={22} className="text-purple-600 mt-1 shrink-0" />
          <h1 className="text-2xl font-bold flex-1 text-neutral-900 dark:text-neutral-50">{d.title}</h1>
          <span className={cn("text-xs px-2 py-0.5 rounded-md", DECISION_TONE[d.status])} data-testid="decision-status-badge">{t(`brain.decisionStatus.${d.status}` as MessageKey)}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={12} /> {t("common.edit")}
          </Button>
          <Link href={`/w/${workspaceSlug}/wiki/graph?mode=local&focus=decision:${d.id}`} className="h-7 px-2 text-xs gap-1 inline-flex items-center rounded-lg border border-neutral-300 dark:border-neutral-700">
            <Waypoints size={12} /> {t("graph.localShort")}
          </Link>
          <Button size="sm" variant="ghost" onClick={remove} className="text-red-600">
            <Trash2 size={12} /> {t("common.delete")}
          </Button>
        </div>
        {d.supersededBy && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <History size={13} /> {t("brain.decision.supersededBy")}{" "}
            <Link href={`/w/${workspaceSlug}/brain/decisions/${d.supersededBy.id}`} className="font-semibold underline">
              {d.supersededBy.title}
            </Link>
          </div>
        )}
        {d.reviewDue && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" data-testid="decision-review-banner">
            <CalendarClock size={13} /> {t("brain.decision.reviewBanner", { date: d.reviewDate ?? "" })}
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setEditing(true)}>
              {t("brain.decision.reviewNow")}
            </Button>
          </div>
        )}
        <div className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4">
          {row(t("brain.decision.reason"), <p className="whitespace-pre-wrap">{d.reason || "—"}</p>)}
          {row(
            t("brain.decision.alternatives"),
            d.alternatives.length ? (
              <ul className="list-disc pl-4 space-y-0.5">
                {d.alternatives.map((a, i) => (
                  <li key={i}>
                    <span className="font-medium">{a.option}</span>
                    {a.whyNot && <span className="text-neutral-500"> — {a.whyNot}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              "—"
            )
          )}
          {row(t("brain.decision.evidence"), <p className="whitespace-pre-wrap">{d.evidence || "—"}</p>)}
          {d.sourceUrl && row(t("brain.decision.sourceUrl"), <a href={d.sourceUrl} target={d.sourceUrl.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="text-indigo-600 break-all">{d.sourceUrl}</a>)}
          {row(t("brain.decision.date"), d.decidedAt + (d.validTo ? ` → ${d.validTo}` : ""))}
          {row(t("brain.decision.owner"), d.owner?.name ?? "—")}
          {row(t("brain.decision.reviewDate"), d.reviewDate ? <span className={d.reviewDue ? "text-amber-600 font-medium" : ""}>{d.reviewDate}</span> : "—")}
          {row(t("brain.decision.people"), d.people.map((p) => p.name).join(", ") || "—")}
          {row(t("brain.decision.project"), d.project?.name ?? "—")}
          {row(
            t("brain.decision.links"),
            <div className="flex flex-col gap-1">
              {d.page && (
                <Link href={d.page.href!} className="inline-flex items-center gap-1 text-indigo-600">
                  <FileText size={12} /> {d.page.title}
                </Link>
              )}
              {d.task && (
                <Link href={d.task.href!} className="inline-flex items-center gap-1 text-indigo-600">
                  <CheckSquare size={12} /> {d.task.title}
                </Link>
              )}
              {d.objective && (
                <Link href={d.objective.href!} className="inline-flex items-center gap-1 text-indigo-600">
                  <Target size={12} /> {d.objective.title}
                </Link>
              )}
              {!d.page && !d.task && !d.objective && "—"}
            </div>
          )}
          {d.supersedes &&
            row(
              t("brain.decision.supersedes"),
              <Link href={`/w/${workspaceSlug}/brain/decisions/${d.supersedes.id}`} className="inline-flex items-center gap-1 text-indigo-600">
                <ArrowRight size={12} /> {d.supersedes.title}
              </Link>
            )}
          {row(t("brain.decision.recordedBy"), `${d.createdBy?.name ?? "—"} · ${t(`brain.source.${d.sourceType}` as MessageKey)}`)}
        </div>
      </div>
      {editing && (
        <DecisionDialog
          workspaceId={workspaceId}
          decision={d}
          onClose={() => setEditing(false)}
          onSaved={(x) => {
            setD(x);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
