"use client";
// Knowledge properties of a wiki page: kind, status, tags, validity (temporal
// knowledge), version chain, source provenance, confidence, last checked and
// the reader's spaced review. Editors change them; everyone sees them.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, CalendarClock, ChevronDown, ChevronRight, GitBranch, Hash, History, Link2, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { KnowledgeMeta } from "@/lib/wiki";
import type { MessageKey } from "@/lib/i18n/core";

const KINDS = ["page", "meeting", "retrospective", "process", "note"] as const;
const STATUSES = ["draft", "current", "outdated", "superseded", "archived"] as const;
const CONFIDENCE = ["", "low", "medium", "high"] as const;
const SOURCES = ["manual", "imported", "ai_generated", "converted"] as const;

export const STATUS_TONE: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  current: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  outdated: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  superseded: "bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-800",
  archived: "bg-neutral-100 text-neutral-400 dark:bg-neutral-800",
};

type Review = { stage: number; nextReviewAt: string; lastReviewedAt: string | null } | null;

export function PageProperties({
  pageId,
  meta,
  canEdit,
  base,
  onSaved,
}: {
  pageId: string;
  meta: KnowledgeMeta;
  canEdit: boolean;
  /** /w/<slug>/wiki/<wikiId> */
  base: string;
  onSaved: (meta: KnowledgeMeta) => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [review, setReview] = useState<Review>(null);

  useEffect(() => {
    api.get<Review>(`/api/wiki/${pageId}/review`).then(setReview).catch(() => {});
  }, [pageId]);

  async function save(patch: Record<string, unknown>) {
    try {
      const r = await api.patch<{ meta: KnowledgeMeta }>(`/api/wiki/${pageId}`, patch);
      onSaved(r.meta);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function reviewAction(action: "add" | "done" | "remove") {
    try {
      setReview(await api.post<Review>(`/api/wiki/${pageId}/review`, { action }));
      toast.success(t(`brain.review.toast.${action}` as MessageKey));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function newVersion() {
    if (!confirm(t("brain.version.confirm"))) return;
    try {
      const p = await api.post<{ id: string }>(`/api/wiki/${pageId}/new-version`);
      toast.success(t("brain.version.created"));
      router.push(`${base}/${p.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  function addTag() {
    const v = tagInput.trim();
    if (!v) return;
    setTagInput("");
    save({ tags: [...meta.tags, v] });
  }

  const today = new Date().toISOString().slice(0, 10);
  const expired = meta.status === "current" && meta.validTo && meta.validTo < today;
  const sel = "h-7 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-1.5 text-xs disabled:opacity-70";
  const dueReview = review && review.nextReviewAt <= new Date().toISOString();

  return (
    <div className="mb-4 space-y-2" data-testid="page-properties">
      {meta.supersededBy && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" data-testid="superseded-banner">
          <History size={13} className="shrink-0" />
          <span>
            {t("brain.version.supersededBy")}{" "}
            <Link href={`${base}/${meta.supersededBy.id}`} className="font-semibold underline">
              {meta.supersededBy.title} (v{meta.supersededBy.version})
            </Link>
          </span>
        </div>
      )}
      {expired && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle size={13} className="shrink-0" /> {t("brain.validity.expired", { date: meta.validTo! })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" data-testid="page-properties-toggle">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {t("brain.props.title")}
        </button>
        <span className={cn("px-1.5 py-0.5 rounded-md font-medium", STATUS_TONE[meta.status])} data-testid="page-status">{t(`brain.status.${meta.status}` as MessageKey)}</span>
        {meta.kind !== "page" && <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">{t(`brain.kind.${meta.kind}` as MessageKey)}</span>}
        <span className="px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">v{meta.version}</span>
        {meta.sourceType !== "manual" && <span className="px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">{t(`brain.source.${meta.sourceType}` as MessageKey)}</span>}
        {meta.confidence && <span className="px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">{t(`brain.confidence.${meta.confidence}` as MessageKey)}</span>}
        {meta.tags.map((tag) => (
          <Link key={tag} href={`${base.replace(/\/wiki\/[^/]+$/, "")}/wiki/graph?mode=local&focus=${encodeURIComponent(`tag:#${tag}`)}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300" data-testid="page-tag">
            <Hash size={10} />
            {tag}
          </Link>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {review ? (
            <>
              <span className={cn("inline-flex items-center gap-1", dueReview ? "text-amber-600" : "text-neutral-400")} title={t("brain.review.stage", { n: review.stage + 1 })}>
                <CalendarClock size={12} /> {dueReview ? t("brain.review.dueNow") : t("brain.review.next", { date: formatDate(review.nextReviewAt) })}
              </span>
              {dueReview && (
                <button onClick={() => reviewAction("done")} className="px-1.5 py-0.5 rounded-md bg-indigo-600 text-white" data-testid="review-done">
                  {t("brain.review.done")}
                </button>
              )}
              <button onClick={() => reviewAction("remove")} className="text-neutral-400 hover:text-neutral-700" title={t("brain.review.stop")}>
                <X size={12} />
              </button>
            </>
          ) : (
            <button onClick={() => reviewAction("add")} className="inline-flex items-center gap-1 text-neutral-500 hover:text-indigo-600" data-testid="review-add">
              <RefreshCcw size={12} /> {t("brain.review.add")}
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/60 p-3 text-xs" data-testid="page-properties-panel">
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-500">{t("brain.props.kind")}</span>
            <select className={sel} disabled={!canEdit} value={meta.kind} onChange={(e) => save({ kind: e.target.value })} data-testid="prop-kind">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`brain.kind.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-500">{t("brain.props.status")}</span>
            <select className={sel} disabled={!canEdit} value={meta.status} onChange={(e) => save({ status: e.target.value })} data-testid="prop-status">
              {STATUSES.map((k) => (
                <option key={k} value={k}>
                  {t(`brain.status.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          {meta.kind === "meeting" && (
            <label className="flex items-center gap-2">
              <span className="w-24 text-neutral-500">{t("brain.props.eventDate")}</span>
              <input type="date" className={sel} disabled={!canEdit} value={meta.eventDate ?? ""} onChange={(e) => save({ eventDate: e.target.value || null })} />
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-500">{t("brain.props.validFrom")}</span>
            <input type="date" className={sel} disabled={!canEdit} value={meta.validFrom ?? ""} onChange={(e) => save({ validFrom: e.target.value || null })} data-testid="prop-valid-from" />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-500">{t("brain.props.validTo")}</span>
            <input type="date" className={sel} disabled={!canEdit} value={meta.validTo ?? ""} onChange={(e) => save({ validTo: e.target.value || null })} data-testid="prop-valid-to" />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <span className="w-24 text-neutral-500 shrink-0">{t("brain.props.tags")}</span>
            <div className="flex flex-wrap items-center gap-1">
              {meta.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
                  #{tag}
                  {canEdit && (
                    <button onClick={() => save({ tags: meta.tags.filter((x) => x !== tag) })} aria-label={t("common.delete")}>
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {canEdit && (
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder={t("brain.props.addTag")}
                  className="h-6 w-28 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 outline-none"
                  data-testid="prop-tag-input"
                />
              )}
            </div>
          </div>
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-500">{t("brain.props.sourceType")}</span>
            <select className={sel} disabled={!canEdit} value={meta.sourceType} onChange={(e) => save({ sourceType: e.target.value })}>
              {SOURCES.map((k) => (
                <option key={k} value={k}>
                  {t(`brain.source.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-500">{t("brain.props.confidence")}</span>
            <select className={sel} disabled={!canEdit} value={meta.confidence ?? ""} onChange={(e) => save({ confidence: e.target.value || null })}>
              {CONFIDENCE.map((k) => (
                <option key={k} value={k}>
                  {k ? t(`brain.confidence.${k}` as MessageKey) : "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <span className="w-24 text-neutral-500 shrink-0">{t("brain.props.source")}</span>
            <input
              defaultValue={meta.sourceLabel ?? ""}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (meta.sourceLabel ?? "") && save({ sourceLabel: e.target.value.trim() || null })}
              placeholder={t("brain.props.sourceLabel")}
              className="h-7 flex-1 min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2"
              data-testid="prop-source-label"
            />
            <input
              defaultValue={meta.sourceUrl ?? ""}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (meta.sourceUrl ?? "") && save({ sourceUrl: e.target.value.trim() || null })}
              placeholder="https://…"
              className="h-7 flex-1 min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2"
            />
            {meta.sourceUrl && (
              <a href={meta.sourceUrl} target={meta.sourceUrl.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="text-indigo-600" title={meta.sourceUrl}>
                <Link2 size={13} />
              </a>
            )}
          </label>
          <div className="flex items-center gap-2 sm:col-span-2 flex-wrap">
            <span className="w-24 text-neutral-500 shrink-0">{t("brain.props.checked")}</span>
            <span className="text-neutral-600 dark:text-neutral-300" data-testid="prop-checked">
              {meta.lastCheckedAt ? t("brain.props.checkedBy", { date: formatDate(meta.lastCheckedAt), name: meta.lastCheckedBy ?? "?" }) : t("brain.props.neverChecked")}
            </span>
            {canEdit && (
              <button onClick={() => save({ markChecked: true })} className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-800" data-testid="prop-mark-checked">
                <BadgeCheck size={12} /> {t("brain.props.markChecked")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 flex-wrap">
            <span className="w-24 text-neutral-500 shrink-0">{t("brain.props.version")}</span>
            <span className="inline-flex items-center gap-1 text-neutral-600 dark:text-neutral-300">
              <GitBranch size={12} /> v{meta.version}
              {meta.supersedes && (
                <>
                  <span className="ml-2" />
                  {t("brain.version.replaces")}{" "}
                  <Link href={`${base}/${meta.supersedes.id}`} className="underline">
                    v{meta.supersedes.version}
                  </Link>
                </>
              )}
            </span>
            {canEdit && !meta.supersededBy && (
              <button onClick={newVersion} className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-800" data-testid="prop-new-version">
                <ShieldCheck size={12} /> {t("brain.version.new")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
