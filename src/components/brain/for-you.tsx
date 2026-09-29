"use client";
import { useEffect, useState } from "react";
import { Briefcase, CalendarClock, Compass, Gavel, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { Card, EmptyNote, ItemRow } from "./brain-hub";

interface Item {
  id: string;
  title: string;
  href?: string;
  sub?: string;
  because: string[];
  stage?: number;
  nextReviewAt?: string;
}
interface ForYouData {
  relatedToWork: Item[];
  dueForReview: Item[];
  rediscover: Item[];
  recentDecisions: Item[];
  myTaskCount: number;
}

/** "For you today": knowledge that matters for the work in front of you. */
export function ForYou({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [data, setData] = useState<ForYouData | null>(null);
  const load = () => api.get<ForYouData>(`/api/workspaces/${workspaceId}/brain/for-you`).then(setData).catch(() => setData({ relatedToWork: [], dueForReview: [], rediscover: [], recentDecisions: [], myTaskCount: 0 }));
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

  if (!data)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="for-you">
      <Card title={t("brain.forYou.related")} icon={<Briefcase size={15} className="text-indigo-600" />} testId="for-you-related">
        <p className="text-[11px] text-neutral-500 px-2 mb-1">{t("brain.forYou.relatedHint", { n: data.myTaskCount })}</p>
        {data.relatedToWork.length ? (
          data.relatedToWork.map((i) => <ItemRow key={i.id} href={i.href} title={i.title} sub={i.sub} extra={i.because.length ? <span className="text-[10px] text-neutral-500">↔ {i.because.join(", ")}</span> : null} testId="for-you-item" />)
        ) : (
          <EmptyNote text={t("brain.forYou.relatedEmpty")} />
        )}
      </Card>
      <Card title={t("brain.forYou.review")} icon={<CalendarClock size={15} className="text-amber-600" />} testId="for-you-review">
        {data.dueForReview.length ? (
          data.dueForReview.map((i) => (
            <ItemRow
              key={i.id}
              href={i.href}
              title={i.title}
              sub={t("brain.review.stage", { n: (i.stage ?? 0) + 1 })}
              extra={
                <button onClick={() => reviewed(i.id)} className="text-[11px] px-2 h-6 rounded-md bg-indigo-600 text-white" data-testid="for-you-reviewed">
                  {t("brain.review.done")}
                </button>
              }
            />
          ))
        ) : (
          <EmptyNote text={t("brain.forYou.reviewEmpty")} />
        )}
      </Card>
      <Card title={t("brain.forYou.rediscover")} icon={<Compass size={15} className="text-emerald-600" />}>
        {data.rediscover.length ? data.rediscover.map((i) => <ItemRow key={i.id} href={i.href} title={i.title} sub={i.sub} extra={<span className="text-[10px] text-neutral-400">{t("brain.forYou.lastUpdated", { date: formatDate(i.because[0]) })}</span>} />) : <EmptyNote text={t("brain.forYou.rediscoverEmpty")} />}
      </Card>
      <Card title={t("brain.forYou.decisions")} icon={<Gavel size={15} className="text-purple-600" />}>
        {data.recentDecisions.length ? data.recentDecisions.map((i) => <ItemRow key={i.id} href={i.href} title={i.title} sub={i.sub} extra={<span className="text-[10px] text-neutral-400">{i.because[0]}</span>} />) : <EmptyNote text={t("brain.forYou.decisionsEmpty")} />}
      </Card>
    </div>
  );
}
