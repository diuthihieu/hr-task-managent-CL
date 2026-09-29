"use client";
// Daily note / work journal: assembled automatically (work done, tasks
// created, meetings, decisions, learning) plus the user's own notes.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, PlusCircle, CalendarDays, Gavel, Lightbulb, Loader2, Sparkles, Timer } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RichEditor, type SaveState } from "@/components/editor/rich-editor";
import { Markdown } from "@/components/ai/markdown";
import { api } from "@/lib/api-client";
import { Card, EmptyNote, ItemRow } from "./brain-hub";

interface Item {
  id: string;
  label: string;
  sub?: string;
  href?: string;
}
interface Day {
  date: string;
  completed: Item[];
  created: Item[];
  meetings: Item[];
  decisions: Item[];
  learning: Item[];
  focusMinutes: number;
  notes: string | null;
  aiSummary: string | null;
}

const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

export function Journal({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [date, setDate] = useState(localDate());
  const [day, setDay] = useState<Day | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState(false);
  const tz = new Date().getTimezoneOffset();

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loader while switching days
    setDay(null);
    api
      .get<Day>(`/api/workspaces/${workspaceId}/journal?date=${date}&tz=${tz}`)
      .then((d) => !cancelled && setDay(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, date, tz]);

  async function summarize() {
    setBusy(true);
    try {
      const r = await api.post<{ aiSummary: string }>(`/api/workspaces/${workspaceId}/journal/summary`, { date, tz });
      setDay((d) => (d ? { ...d, aiSummary: r.aiSummary } : d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const section = (title: string, icon: React.ReactNode, items: Item[], empty: string, testId: string) => (
    <Card title={`${title} (${items.length})`} icon={icon} testId={testId}>
      {items.length ? items.map((i) => <ItemRow key={i.id} href={i.href} title={i.label} sub={i.sub} />) : <EmptyNote text={empty} />}
    </Card>
  );

  return (
    <div className="space-y-4" data-testid="journal">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => setDate(shift(date, -1))} aria-label={t("brain.journal.prev")}>
          <ChevronLeft size={14} />
        </Button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" data-testid="journal-date" />
        <Button size="icon" variant="outline" onClick={() => setDate(shift(date, 1))} aria-label={t("brain.journal.next")}>
          <ChevronRight size={14} />
        </Button>
        {date !== localDate() && (
          <Button size="sm" variant="ghost" onClick={() => setDate(localDate())}>
            {t("brain.journal.today")}
          </Button>
        )}
        {day && (
          <span className="text-xs text-neutral-500 inline-flex items-center gap-1 ml-2">
            <Timer size={12} /> {t("brain.journal.focus", { n: day.focusMinutes })}
          </span>
        )}
        <Button size="sm" variant="outline" className="ml-auto" onClick={summarize} disabled={busy || !day} data-testid="journal-summarize">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("brain.journal.summarize")}
        </Button>
      </div>
      {!day ? (
        <div className="py-10 flex justify-center text-neutral-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <>
          {day.aiSummary && (
            <Card title={t("brain.journal.aiSummary")} icon={<Sparkles size={15} className="text-indigo-600" />} testId="journal-ai">
              <Markdown text={day.aiSummary} className="text-sm" />
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {section(t("brain.journal.completed"), <CheckCircle2 size={15} className="text-emerald-600" />, day.completed, t("brain.journal.none"), "journal-completed")}
            {section(t("brain.journal.created"), <PlusCircle size={15} className="text-sky-600" />, day.created, t("brain.journal.none"), "journal-created")}
            {section(t("brain.journal.meetings"), <CalendarDays size={15} className="text-orange-600" />, day.meetings, t("brain.journal.none"), "journal-meetings")}
            {section(t("brain.journal.decisions"), <Gavel size={15} className="text-purple-600" />, day.decisions, t("brain.journal.none"), "journal-decisions")}
          </div>
          {section(t("brain.journal.learning"), <Lightbulb size={15} className="text-amber-500" />, day.learning, t("brain.journal.none"), "journal-learning")}
          <Card title={t("brain.journal.notes")} icon={<Lightbulb size={15} className="text-neutral-500" />} testId="journal-notes" action={<span className="text-[11px] text-neutral-400">{saveState === "saving" ? t("editor.saving") : saveState === "saved" ? t("editor.saved") : ""}</span>}>
            <RichEditor
              key={date}
              content={day.notes}
              editable
              minHeight={160}
              workspaceId={workspaceId}
              placeholder={t("brain.journal.notesPh")}
              onSaveStateChange={setSaveState}
              onSave={async (html) => {
                await api.put(`/api/workspaces/${workspaceId}/journal`, { date, notes: html || null });
              }}
            />
          </Card>
        </>
      )}
    </div>
  );
}
