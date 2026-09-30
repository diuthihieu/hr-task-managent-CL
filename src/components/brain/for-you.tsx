"use client";
// Daily Intelligence: one hero insight, then what needs you (with why + an
// action), then knowledge for today's work, then what changed around you.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowRight, BookOpen, Briefcase, CalendarClock, CheckCircle2, Compass, FilePenLine, Gavel, Lightbulb, Loader2, NotebookPen, Sparkles, Wand2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { Card, EmptyNote, ItemRow } from "./brain-hub";
import type { MessageKey } from "@/lib/i18n/core";

interface Item {
  id: string;
  title: string;
  href?: string;
  sub?: string;
  because: string[];
  stage?: number;
  nextReviewAt?: string;
}
interface Attention {
  kind: "stale_linked" | "decision_review" | "review_due" | "draft_to_confirm";
  id: string;
  title: string;
  href?: string;
  detail: string;
  extra?: { title: string; href?: string };
}
interface Insight {
  kind: string;
  n: number;
  total?: number;
  title?: string;
  href?: string;
  detail?: string;
}
export interface ForYouData {
  hero: Insight | null;
  needsAttention: Attention[];
  insights: Insight[];
  activity: { id: string; title: string; href: string; kind: string; by: string | null; at: string; created: boolean }[];
  myTasks: { id: string; title: string }[];
  relatedToWork: Item[];
  dueForReview: Item[];
  rediscover: Item[];
  recentDecisions: Item[];
  myTaskCount: number;
}
const EMPTY: ForYouData = { hero: null, needsAttention: [], insights: [], activity: [], myTasks: [], relatedToWork: [], dueForReview: [], rediscover: [], recentDecisions: [], myTaskCount: 0 };

const ATTENTION_META: Record<Attention["kind"], { icon: typeof Gavel; tone: string }> = {
  stale_linked: { icon: AlertTriangle, tone: "text-red-600 bg-red-50 dark:bg-red-950/40" },
  decision_review: { icon: Gavel, tone: "text-purple-600 bg-purple-50 dark:bg-purple-950/40" },
  review_due: { icon: CalendarClock, tone: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
  draft_to_confirm: { icon: FilePenLine, tone: "text-sky-600 bg-sky-50 dark:bg-sky-950/40" },
};

export function ForYou({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const [data, setData] = useState<ForYouData | null>(null);
  const [ai, setAi] = useState<{ title: string; detail: string; action: string }[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const load = () => api.get<ForYouData>(`/api/workspaces/${workspaceId}/brain/for-you`).then((d) => setData({ ...EMPTY, ...d })).catch(() => setData(EMPTY));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per workspace
  }, [workspaceId]);

  async function reviewed(pageId: string) {
    try {
      await api.post(`/api/wiki/${pageId}/review`, { action: "done" });
      toast.success(t("brain.review.toast.done"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function askAi() {
    setAiBusy(true);
    try {
      const r = await api.post<{ insights: { title: string; detail: string; action: string }[] }>(`/api/workspaces/${workspaceId}/brain/insights`, {});
      setAi(r.insights);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setAiBusy(false);
    }
  }

  if (!data)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  const base = `/w/${workspaceSlug}`;
  const hero = data.hero;
  const insightText = (i: Insight) => t(`brain.di.insight.${i.kind}` as MessageKey, { n: i.n, total: i.total ?? 0, title: i.title ?? "", detail: i.detail ?? "" });
  return (
    <div className="space-y-4" data-testid="for-you">
      {/* 1. Hero insight */}
      <section className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-500 text-white p-5 relative overflow-hidden" data-testid="di-hero">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden />
        <p className="text-[11px] uppercase tracking-[0.16em] opacity-80 inline-flex items-center gap-1.5">
          <Lightbulb size={12} /> {t("brain.di.heroLabel")}
        </p>
        <h2 className="mt-1 text-lg sm:text-xl font-semibold leading-snug max-w-3xl">{hero ? insightText(hero) : t("brain.di.heroEmpty")}</h2>
        <p className="mt-1 text-sm opacity-85 max-w-3xl">{hero ? t(`brain.di.heroWhy.${hero.kind}` as MessageKey) : t("brain.di.heroEmptyWhy")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {hero?.href && (
            <Link href={hero.href} className="h-8 px-3 rounded-lg bg-white text-indigo-700 text-sm font-medium inline-flex items-center gap-1.5 hover:bg-indigo-50" data-testid="di-hero-open">
              {t(`brain.di.heroCta.${hero.kind}` as MessageKey)} <ArrowRight size={13} />
            </Link>
          )}
          {!hero && (
            <Link href={`${base}/wiki`} className="h-8 px-3 rounded-lg bg-white text-indigo-700 text-sm font-medium inline-flex items-center gap-1.5">
              <BookOpen size={13} /> {t("brain.di.openWiki")}
            </Link>
          )}
          <button onClick={askAi} disabled={aiBusy} className="h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium inline-flex items-center gap-1.5" data-testid="di-ai">
            {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t("brain.di.aiInsights")}
          </button>
        </div>
      </section>

      {ai && (
        <section className="grid gap-2 md:grid-cols-3" data-testid="di-ai-insights">
          {ai.map((x, i) => (
            <div key={i} className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-3">
              <p className="text-sm font-semibold inline-flex items-start gap-1.5">
                <Sparkles size={13} className="text-indigo-600 mt-0.5 shrink-0" /> {x.title}
              </p>
              {x.detail && <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{x.detail}</p>}
              {x.action && <p className="mt-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">→ {x.action}</p>}
            </div>
          ))}
        </section>
      )}

      {/* 2. Needs attention: action cards */}
      <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900" data-testid="di-attention">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <h2 className="text-sm font-semibold">{t("brain.di.attention")}</h2>
          {!!data.needsAttention.length && <span className="h-5 min-w-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold leading-5 text-center">{data.needsAttention.length}</span>}
        </div>
        {data.needsAttention.length ? (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.needsAttention.map((a) => {
              const M = ATTENTION_META[a.kind];
              return (
                <li key={`${a.kind}${a.id}`} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 py-2.5" data-testid="di-attention-item" data-kind={a.kind}>
                  <span className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", M.tone)}>
                    <M.icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {a.href ? <Link href={a.href} className="hover:text-indigo-600">{a.title}</Link> : a.title}
                    </p>
                    <p className="text-xs text-neutral-500">{t(`brain.di.why.${a.kind}` as MessageKey, { detail: a.detail, extra: a.extra ? t("brain.di.newVersion", { title: a.extra.title }) : "" })}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {a.kind === "review_due" && (
                      <Button size="sm" onClick={() => reviewed(a.id)} data-testid="for-you-reviewed">
                        <CheckCircle2 size={12} /> {t("brain.review.done")}
                      </Button>
                    )}
                    {a.kind === "stale_linked" && a.extra?.href && (
                      <Link href={a.extra.href} className="h-7 px-2.5 rounded-md bg-indigo-600 text-white text-xs font-medium inline-flex items-center">
                        {t("brain.di.act.replacement")}
                      </Link>
                    )}
                    {a.href && (
                      <Link href={a.href} className="h-7 px-2.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-xs font-medium inline-flex items-center hover:bg-neutral-50 dark:hover:bg-neutral-800">
                        {t(`brain.di.act.${a.kind}` as MessageKey)}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 pb-4 flex items-start gap-3">
            <CheckCircle2 size={18} className="text-emerald-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">{t("brain.di.allClear")}</p>
              <p className="text-xs text-neutral-500">{t("brain.di.allClearHint")}</p>
            </div>
          </div>
        )}
      </section>

      {/* 3. Information: knowledge for today's work */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={t("brain.forYou.related")} icon={<Briefcase size={15} className="text-indigo-600" />} testId="for-you-related">
            <p className="text-[11px] text-neutral-500 px-2 mb-1">{t("brain.forYou.relatedHint", { n: data.myTaskCount })}</p>
            {data.relatedToWork.length ? (
              data.relatedToWork.map((i) => <ItemRow key={i.id} href={i.href} title={i.title} sub={i.sub} extra={i.because.length ? <span className="text-[10px] text-neutral-500">↔ {i.because.slice(0, 2).join(", ")}</span> : null} testId="for-you-item" />)
            ) : (
              <div className="px-2 py-2 text-xs text-neutral-500 space-y-2">
                <p>{data.myTaskCount ? t("brain.di.relatedEmptyTasks", { n: data.myTaskCount }) : t("brain.di.relatedEmptyNoTasks")}</p>
                {!!data.myTasks.length && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.myTasks.slice(0, 4).map((x) => (
                      <span key={x.id} className="px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[11px] truncate max-w-[14rem]">
                        {x.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t("brain.forYou.decisions")} icon={<Gavel size={15} className="text-purple-600" />}>
            {data.recentDecisions.length ? data.recentDecisions.map((i) => <ItemRow key={i.id} href={i.href} title={i.title} sub={i.sub} extra={<span className="text-[10px] text-neutral-400">{i.because[0]}</span>} />) : <EmptyNote text={t("brain.forYou.decisionsEmpty")} />}
          </Card>
          <Card title={t("brain.forYou.rediscover")} icon={<Compass size={15} className="text-emerald-600" />}>
            {data.rediscover.length ? data.rediscover.map((i) => <ItemRow key={i.id} href={i.href} title={i.title} sub={i.sub} extra={<span className="text-[10px] text-neutral-400">{t("brain.forYou.lastUpdated", { date: formatDate(i.because[0]) })}</span>} />) : <EmptyNote text={t("brain.forYou.rediscoverEmpty")} />}
          </Card>
        </div>
      </div>

      {/* Rule-based signals, compact */}
      {!!data.insights.length && (
        <div className="flex flex-wrap gap-2" data-testid="di-insights">
          {data.insights.map((i) => (
            <span key={i.kind} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200">
              <Wand2 size={12} className="text-indigo-500" /> {insightText(i)}
            </span>
          ))}
        </div>
      )}

      {/* 4. Activity around you */}
      <Card title={t("brain.di.activity")} icon={<NotebookPen size={15} className="text-neutral-500" />} testId="di-activity">
        {data.activity.length ? (
          <ol className="relative ml-2 border-l border-neutral-200 dark:border-neutral-800">
            {data.activity.map((a) => (
              <li key={a.id} className="pl-3 py-1 relative">
                <span className={cn("absolute -left-[5px] top-2.5 h-2 w-2 rounded-full", a.created ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600")} />
                <Link href={a.href} className="text-sm hover:text-indigo-600">
                  {a.title}
                </Link>
                <span className="text-[11px] text-neutral-400">
                  {" "}
                  · {t(a.created ? "brain.di.createdBy" : "brain.di.updatedBy", { name: a.by ?? "?" })} · {formatDate(a.at)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyNote text={t("brain.di.activityEmpty")} />
        )}
      </Card>
    </div>
  );
}
