"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare, Target, KeySquare, Grid2x2, CalendarClock, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/misc";
import { ProgressBar, StatusBadge, DeadlineLabel, PctLabel } from "./okr-ui";
import { PutAllThingsOn } from "@/components/capture/put-all-things-on";
import type { ObjectiveRow, KeyResultRow } from "@/types";
import type { MyTaskRow } from "@/types";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";

interface MyWorkData {
  tasks: MyTaskRow[];
  objectives: ObjectiveRow[];
  keyResults: (KeyResultRow & { objectiveTitle: string })[];
}

const QUADRANTS: { key: string; importance: string; urgency: string; title: MessageKey; subtitle: MessageKey; accent: string }[] = [
  { key: "urgent_important", importance: "important", urgency: "urgent", title: "eh.s1", subtitle: "eh.q1", accent: "#ef4444" },
  { key: "not_urgent_important", importance: "important", urgency: "not_urgent", title: "eh.s2", subtitle: "eh.q2", accent: "#3b82f6" },
  { key: "urgent_not_important", importance: "not_important", urgency: "urgent", title: "eh.s3", subtitle: "eh.q3", accent: "#f97316" },
  { key: "not_urgent_not_important", importance: "not_important", urgency: "not_urgent", title: "eh.s4", subtitle: "eh.q4", accent: "#94a3b8" },
];

export function MyWork({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const { t } = useT();
  const [data, setData] = useState<MyWorkData | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    api.get<MyWorkData>(`/api/workspaces/${workspaceId}/my-work`).then(setData);
  }, [workspaceId]);

  const upcoming = useMemo(() => {
    if (!data) return [];
    const taskItems = data.tasks
      .filter((t) => t.dueDate && new Date(t.dueDate).getTime() >= now)
      .map((t) => ({ kind: "task" as const, id: t.taskId, title: t.title, date: t.dueDate!, href: `/w/${workspaceSlug}/p/${t.projectId}?record=${t.taskId}` }));
    const objectiveItems = data.objectives
      .filter((o) => o.endDate && new Date(o.endDate).getTime() >= now)
      .map((o) => ({ kind: "objective" as const, id: o.id, title: o.title, date: o.endDate!, href: `/w/${workspaceSlug}/okrs/${o.id}` }));
    return [...taskItems, ...objectiveItems].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 20);
  }, [data, workspaceSlug, now]);

  const quadrantTasks = useMemo(() => {
    const map = new Map<string, MyTaskRow[]>(QUADRANTS.map((q) => [q.key, []]));
    if (!data) return map;
    for (const t of data.tasks) {
      const importance = t.importance ?? "not_important";
      const urgency = t.urgency ?? "not_urgent";
      const q = QUADRANTS.find((q) => q.importance === importance && q.urgency === urgency) ?? QUADRANTS[3];
      map.get(q.key)!.push(t);
    }
    return map;
  }, [data]);

  if (!data) return <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">{t("common.loading")}</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{t("nav.myWork")}</h1>
      </div>
      <Tabs defaultValue="capture" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="px-4 h-10 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <TabsTrigger value="capture"><Sparkles size={13} /> {t("mw.capture")}</TabsTrigger>
          <TabsTrigger value="tasks"><CheckSquare size={13} /> {t("mw.tasks", { count: data.tasks.length })}</TabsTrigger>
          <TabsTrigger value="okrs"><Target size={13} /> {t("mw.okrs", { count: data.objectives.length })}</TabsTrigger>
          <TabsTrigger value="krs"><KeySquare size={13} /> {t("mw.krs", { count: data.keyResults.length })}</TabsTrigger>
          <TabsTrigger value="eisenhower"><Grid2x2 size={13} /> {t("mw.matrix")}</TabsTrigger>
          <TabsTrigger value="deadlines"><CalendarClock size={13} /> {t("mw.deadlines")}</TabsTrigger>
        </TabsList>

        <TabsContent value="capture" className="flex-1 flex overflow-hidden">
          <PutAllThingsOn workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
        </TabsContent>

        <TabsContent value="tasks" className="flex-1 overflow-y-auto thin-scroll p-4">
          <div className="space-y-1">
            {data.tasks.length === 0 && <p className="text-sm text-neutral-400">{t("mw.noTasks")}</p>}
            {data.tasks.map((task) => (
              <Link
                key={task.taskId}
                href={`/w/${workspaceSlug}/p/${task.projectId}/t/${task.taskId}`}
                className="flex items-center gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <span className="flex-1 min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">{task.title || t("common.untitled")}</span>
                <span className="text-[10px] text-neutral-400 shrink-0">{task.projectName}</span>
                {task.status && <span className="text-[11px] text-neutral-500 shrink-0">{task.status}</span>}
                <div className="w-20 shrink-0"><ProgressBar value={task.progress} height={4} /></div>
                {task.contributesToOkr && (
                  <span title={t("mw.contributes")} className="shrink-0">
                    <Target size={12} className="text-indigo-500" />
                  </span>
                )}
                {task.dueDate && <DeadlineLabel endDate={task.dueDate} />}
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="okrs" className="flex-1 overflow-y-auto thin-scroll p-4">
          <div className="space-y-1.5">
            {data.objectives.length === 0 && <p className="text-sm text-neutral-400">{t("mw.noOkrs")}</p>}
            {data.objectives.map((o) => (
              <Link key={o.id} href={`/w/${workspaceSlug}/okrs/${o.id}`} className="flex items-center gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 hover:border-neutral-300 dark:hover:border-neutral-700">
                <span className="flex-1 min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">{o.title}</span>
                <div className="w-24 shrink-0"><ProgressBar value={o.progress} /></div>
                <PctLabel label={t("okr.progressShort")} value={o.progress} className="text-xs" />
                <StatusBadge status={o.status} />
                <DeadlineLabel endDate={o.endDate} />
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="krs" className="flex-1 overflow-y-auto thin-scroll p-4">
          <div className="space-y-1.5">
            {data.keyResults.length === 0 && <p className="text-sm text-neutral-400">{t("mw.noKrs")}</p>}
            {data.keyResults.map((k) => (
              <Link key={k.id} href={`/w/${workspaceSlug}/okrs/${k.objectiveId}`} className="flex items-center gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 hover:border-neutral-300 dark:hover:border-neutral-700">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm text-neutral-800 dark:text-neutral-100">{k.title}</div>
                  <div className="truncate text-[11px] text-neutral-400">{k.objectiveTitle}</div>
                </div>
                <div className="w-24 shrink-0"><ProgressBar value={k.progress} /></div>
                <PctLabel label={t("okr.progressShort")} value={k.progress} className="text-xs" />
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="eisenhower" className="flex-1 overflow-hidden p-3">
          <div className="h-full grid grid-cols-2 grid-rows-2 gap-2.5">
            {QUADRANTS.map((q) => (
              <div key={q.key} className="flex flex-col rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden min-h-0" style={{ backgroundColor: `${q.accent}0a` }}>
                <div className="flex items-center gap-2 px-3 h-9 shrink-0 border-b" style={{ borderColor: `${q.accent}33` }}>
                  <span className="text-xs font-semibold" style={{ color: q.accent }}>{t(q.title)}</span>
                  <span className="text-[10px] text-neutral-400">{t(q.subtitle)}</span>
                  <span className="ml-auto text-xs text-neutral-400">{quadrantTasks.get(q.key)?.length ?? 0}</span>
                </div>
                <div className="flex-1 overflow-y-auto thin-scroll p-1.5 space-y-1.5">
                  {(quadrantTasks.get(q.key) ?? []).map((t) => (
                    <Link key={t.taskId} href={`/w/${workspaceSlug}/p/${t.projectId}?record=${t.taskId}`} className="block rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs hover:border-neutral-300 dark:hover:border-neutral-700 truncate">
                      {t.title || "(untitled)"}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-neutral-400 mt-2">{t("mw.matrixHint")}</p>
        </TabsContent>

        <TabsContent value="deadlines" className="flex-1 overflow-y-auto thin-scroll p-4">
          <div className="space-y-1">
            {upcoming.length === 0 && <p className="text-sm text-neutral-400">{t("mw.nothingDue")}</p>}
            {upcoming.map((item) => (
              <Link key={item.id} href={item.href} className="flex items-center gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 hover:border-neutral-300 dark:hover:border-neutral-700">
                {item.kind === "objective" ? <Target size={13} className="text-indigo-500 shrink-0" /> : <CheckSquare size={13} className="text-neutral-400 shrink-0" />}
                <span className="flex-1 min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">{item.title}</span>
                <DeadlineLabel endDate={item.date} />
              </Link>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
