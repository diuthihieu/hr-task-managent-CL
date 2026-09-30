"use client";
// Weekly Brain Review: what the week added to the team's knowledge, which
// decisions were made, what got done, and what needs reviewing.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Sparkles, Gavel, CheckCircle2, Save, Trophy, Lightbulb, CircleDashed, Repeat, ArrowRightCircle } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { markdownToHtml } from "@/components/ai/markdown";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
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
  openLoops: { kind: "overdue" | "due" | "proposed_decision" | "draft"; id: string; title: string; sub?: string; href?: string }[];
  automation: { kind: "recurring"; title: string; n: number }[];
}
interface Reflection {
  headline: string;
  wins: string[];
  knowledge: string[];
  openLoops: string[];
  automation: string[];
  nextWeek: string[];
}
const LOOP_TONE: Record<string, string> = {
  overdue: "bg-red-50 text-red-600 dark:bg-red-950/50",
  due: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  proposed_decision: "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  draft: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
};
const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

export function WeeklyReview({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<Week | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [busy, setBusy] = useState(false);
  const [wikis, setWikis] = useState<{ id: string; name: string; myRole: string | null }[]>([]);
  const [wikiId, setWikiId] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while loading another week
    setData(null);
    setSummary(null);
    setReflection(null);
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
      const r = await api.post<{ markdown: string; reflection: Reflection }>(`/api/workspaces/${workspaceId}/brain/weekly/summary`, { week: data?.weekStart });
      setSummary(r.markdown);
      setReflection(r.reflection);
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
      </div>
      {!data ? (
        <div className="py-10 flex justify-center text-neutral-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <>
          {/* Hero: the AI's one-line reflection, or a prompt to write it */}
          <section className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-500 text-white p-5 flex flex-wrap items-center gap-4" data-testid="weekly-summary">
            <div className="flex-1 min-w-[16rem]">
              <p className="text-[11px] uppercase tracking-[0.16em] opacity-80">{t("brain.weekly.reflection")}</p>
              <h2 className="mt-1 text-lg font-semibold leading-snug">{reflection?.headline || t("brain.weekly.heroEmpty", { done: data.completed.length, decisions: data.decisions.length, pages: data.newKnowledge.length + data.updatedKnowledge.length })}</h2>
              {!reflection && <p className="text-sm opacity-85 mt-0.5">{t("brain.weekly.heroHint")}</p>}
            </div>
            <div className="flex items-center gap-2">
              {summary && wikis.length > 0 && (
                <>
                  <select value={wikiId} onChange={(e) => setWikiId(e.target.value)} className="h-8 rounded-md bg-white/15 text-white border border-white/30 px-1.5 text-xs [&>option]:text-neutral-900">
                    {wikis.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={saveToWiki} className="h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm inline-flex items-center gap-1.5">
                    <Save size={13} /> {t("brain.weekly.save")}
                  </button>
                </>
              )}
              <button onClick={write} disabled={busy} className="h-8 px-3 rounded-lg bg-white text-indigo-700 text-sm font-medium inline-flex items-center gap-1.5" data-testid="weekly-write">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {reflection ? t("brain.weekly.rewrite") : t("brain.weekly.write")}
              </button>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="weekly-sections">
            <Section title={t("brain.weekly.sec.wins")} icon={<Trophy size={15} className="text-amber-500" />} ai={reflection?.wins} emptyText={t("brain.weekly.needAi")} />
            <Card title={`${t("brain.weekly.sec.completed")} (${data.completed.length})`} icon={<CheckCircle2 size={15} className="text-emerald-600" />}>
              {data.completed.length ? data.completed.slice(0, 8).map((d) => <ItemRow key={d.id} href={d.href} title={d.title} sub={d.project} />) : <EmptyNote text={t("brain.weekly.noneCompleted")} />}
              {data.completed.length > 8 && <p className="text-[11px] text-neutral-400 px-2">+{data.completed.length - 8}</p>}
            </Card>
            <Card title={`${t("brain.weekly.sec.decisions")} (${data.decisions.length})`} icon={<Gavel size={15} className="text-purple-600" />}>
              {data.decisions.length ? data.decisions.map((d) => <ItemRow key={d.id} href={d.href} title={d.title} sub={d.project} />) : <EmptyNote text={t("brain.weekly.noneDecisions")} />}
            </Card>
            <Card title={`${t("brain.weekly.sec.knowledge")} (${data.newKnowledge.length + data.updatedKnowledge.length + data.meetings.length})`} icon={<Lightbulb size={15} className="text-indigo-600" />}>
              {reflection?.knowledge.length ? <Bullets items={reflection.knowledge} /> : null}
              {data.newKnowledge.map((p) => <ItemRow key={p.id} href={p.href} title={p.title} sub={t("brain.weekly.newBy", { name: p.by ?? "?" })} />)}
              {data.updatedKnowledge.slice(0, 5).map((p) => <ItemRow key={p.id} href={p.href} title={p.title} sub={t("brain.weekly.updatedBy", { name: p.by ?? "?" })} />)}
              {data.meetings.map((p) => <ItemRow key={p.id} href={p.href} title={p.title} sub={t("brain.journal.ev.meeting")} />)}
              {!data.newKnowledge.length && !data.updatedKnowledge.length && !data.meetings.length && !reflection?.knowledge.length && <EmptyNote text={t("brain.weekly.noneKnowledge")} />}
            </Card>
            <Card title={`${t("brain.weekly.sec.openLoops")} (${data.openLoops.length})`} icon={<CircleDashed size={15} className="text-red-500" />} testId="weekly-open-loops">
              {reflection?.openLoops.length ? <Bullets items={reflection.openLoops} /> : null}
              {data.openLoops.length ? (
                data.openLoops.map((l) => <ItemRow key={`${l.kind}${l.id}`} href={l.href} title={l.title} sub={l.sub} extra={<span className={cn("text-[10px] px-1.5 py-0.5 rounded", LOOP_TONE[l.kind])}>{t(`brain.weekly.loop.${l.kind}` as MessageKey)}</span>} />)
              ) : (
                <EmptyNote text={t("brain.weekly.noneLoops")} />
              )}
            </Card>
            <Card title={t("brain.weekly.sec.automation")} icon={<Repeat size={15} className="text-teal-600" />} testId="weekly-automation">
              {reflection?.automation.length ? <Bullets items={reflection.automation} /> : null}
              {data.automation.length ? (
                data.automation.map((a) => <ItemRow key={a.title} title={a.title} extra={<span className="text-[10px] text-teal-700 dark:text-teal-300">{t("brain.weekly.repeated", { n: a.n })}</span>} />)
              ) : (
                !reflection?.automation.length && <EmptyNote text={t("brain.weekly.noneAutomation")} />
              )}
              {!!data.automation.length && <p className="text-[11px] text-neutral-500 px-2 mt-1">{t("brain.weekly.automationHint")}</p>}
            </Card>
            <Section title={t("brain.weekly.sec.nextWeek")} icon={<ArrowRightCircle size={15} className="text-indigo-600" />} ai={reflection?.nextWeek} emptyText={t("brain.weekly.needAi")} extra={data.reviewsDue ? t("brain.weekly.reviewsDue", { n: data.reviewsDue }) : undefined} />
          </div>
        </>
      )}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mb-1.5 space-y-1 px-2">
      {items.map((x, i) => (
        <li key={i} className="text-sm flex gap-1.5">
          <Sparkles size={11} className="text-indigo-500 mt-1 shrink-0" />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, icon, ai, emptyText, extra }: { title: string; icon: React.ReactNode; ai?: string[]; emptyText: string; extra?: string }) {
  return (
    <Card title={title} icon={icon}>
      {ai?.length ? <Bullets items={ai} /> : <EmptyNote text={emptyText} />}
      {extra && <p className="text-[11px] text-amber-700 dark:text-amber-300 px-2">• {extra}</p>}
    </Card>
  );
}
