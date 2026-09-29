"use client";
// Weekly Brain Review: what the week added to the team's knowledge, which
// decisions were made, what got done, and what needs reviewing.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Sparkles, FilePlus2, FileEdit, CalendarDays, Gavel, CheckCircle2, Save } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Markdown, markdownToHtml } from "@/components/ai/markdown";
import { api } from "@/lib/api-client";
import { Card, EmptyNote, ItemRow } from "./brain-hub";

interface Week {
  weekStart: string;
  newKnowledge: { id: string; title: string; href?: string; by: string | null }[];
  updatedKnowledge: { id: string; title: string; href?: string; by: string | null }[];
  meetings: { id: string; title: string; href?: string }[];
  decisions: { id: string; title: string; href?: string; project: string | null }[];
  completed: { id: string; title: string; href?: string; project: string }[];
  reviewsDue: number;
  journalDays: { date: string; aiSummary: string | null }[];
}
const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

export function WeeklyReview({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<Week | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wikis, setWikis] = useState<{ id: string; name: string; myRole: string | null }[]>([]);
  const [wikiId, setWikiId] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while loading another week
    setData(null);
    setSummary(null);
    api.get<Week>(`/api/workspaces/${workspaceId}/brain/weekly${week ? `?week=${week}` : ""}`).then(setData).catch(() => {});
  }, [workspaceId, week]);
  useEffect(() => {
    api
      .get<{ id: string; name: string; myRole: string | null }[]>(`/api/workspaces/${workspaceId}/wikis`)
      .then((w) => {
        const editable = w.filter((x) => x.myRole === "editor" || x.myRole === "manager");
        setWikis(editable);
        setWikiId(editable[0]?.id ?? "");
      })
      .catch(() => {});
  }, [workspaceId]);

  async function write() {
    setBusy(true);
    try {
      setSummary((await api.post<{ markdown: string }>(`/api/workspaces/${workspaceId}/brain/weekly/summary`, { week: data?.weekStart })).markdown);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }
  async function saveToWiki() {
    if (!summary || !wikiId || !data) return;
    try {
      const p = await api.post<{ id: string }>(`/api/wikis/${wikiId}/pages`, { title: t("brain.weekly.pageTitle", { date: data.weekStart }), content: markdownToHtml(summary) });
      await api.patch(`/api/wiki/${p.id}`, { kind: "note", status: "draft", sourceType: "ai_generated", sourceLabel: t("brain.weekly.title"), tags: ["weekly-review"] });
      toast.success(t("brain.weekly.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <div className="space-y-4" data-testid="weekly">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => data && setWeek(shift(data.weekStart, -7))}>
          <ChevronLeft size={14} />
        </Button>
        <span className="text-sm font-medium">{data ? t("brain.weekly.weekOf", { date: data.weekStart }) : "…"}</span>
        <Button size="icon" variant="outline" onClick={() => data && setWeek(shift(data.weekStart, 7))}>
          <ChevronRight size={14} />
        </Button>
        {data && <span className="text-xs text-neutral-500 ml-2">{t("brain.weekly.reviewsDue", { n: data.reviewsDue })}</span>}
        <Button size="sm" className="ml-auto" onClick={write} disabled={busy || !data} data-testid="weekly-write">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("brain.weekly.write")}
        </Button>
      </div>
      {summary && (
        <Card
          title={t("brain.weekly.aiTitle")}
          icon={<Sparkles size={15} className="text-indigo-600" />}
          testId="weekly-summary"
          action={
            wikis.length ? (
              <span className="flex items-center gap-1.5">
                <select value={wikiId} onChange={(e) => setWikiId(e.target.value)} className="h-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 text-xs">
                  {wikis.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline" onClick={saveToWiki}>
                  <Save size={12} /> {t("brain.weekly.save")}
                </Button>
              </span>
            ) : null
          }
        >
          <Markdown text={summary} className="text-sm" />
        </Card>
      )}
      {!data ? (
        <div className="py-10 flex justify-center text-neutral-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={`${t("brain.weekly.new")} (${data.newKnowledge.length})`} icon={<FilePlus2 size={15} className="text-indigo-600" />}>
            {data.newKnowledge.length ? data.newKnowledge.map((p) => <ItemRow key={p.id} href={p.href} title={p.title} sub={p.by} />) : <EmptyNote text={t("brain.journal.none")} />}
          </Card>
          <Card title={`${t("brain.weekly.updated")} (${data.updatedKnowledge.length})`} icon={<FileEdit size={15} className="text-sky-600" />}>
            {data.updatedKnowledge.length ? data.updatedKnowledge.map((p) => <ItemRow key={p.id} href={p.href} title={p.title} sub={p.by} />) : <EmptyNote text={t("brain.journal.none")} />}
          </Card>
          <Card title={`${t("brain.journal.meetings")} (${data.meetings.length})`} icon={<CalendarDays size={15} className="text-orange-600" />}>
            {data.meetings.length ? data.meetings.map((p) => <ItemRow key={p.id} href={p.href} title={p.title} />) : <EmptyNote text={t("brain.journal.none")} />}
          </Card>
          <Card title={`${t("brain.journal.decisions")} (${data.decisions.length})`} icon={<Gavel size={15} className="text-purple-600" />}>
            {data.decisions.length ? data.decisions.map((d) => <ItemRow key={d.id} href={d.href} title={d.title} sub={d.project} />) : <EmptyNote text={t("brain.journal.none")} />}
          </Card>
          <Card title={`${t("brain.weekly.done")} (${data.completed.length})`} icon={<CheckCircle2 size={15} className="text-emerald-600" />}>
            {data.completed.length ? data.completed.map((d) => <ItemRow key={d.id} href={d.href} title={d.title} sub={d.project} />) : <EmptyNote text={t("brain.journal.none")} />}
          </Card>
        </div>
      )}
    </div>
  );
}
