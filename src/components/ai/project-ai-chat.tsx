"use client";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Minus, X, PanelRightOpen, PanelRightClose, RotateCcw } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { RecordRow } from "@/types";
import { TaskIntakeChat } from "./task-intake-chat";
import { useTaskIntake } from "./use-task-intake";

type Layout = "mini" | "sidebar";
type Mode = "closed" | "minimized" | Layout;
const LAYOUT_KEY = "woli.projectAi.layout";

/**
 * The AI chat in the bottom-right corner of a project: create tasks by
 * describing them, or ask anything about the project (within the user's
 * access). Two layouts - a small messenger-style window or a right side
 * panel - each with a button to switch to the other; "-" hides it for now
 * (the conversation is kept), "x" closes it and ends the conversation.
 */
export function ProjectAiChat({
  projectId,
  projectName,
  onTaskCreated,
  onOpenTask,
  onSidebarChange,
}: {
  projectId: string;
  projectName: string;
  onTaskCreated?: (record: RecordRow, projectId: string) => void;
  onOpenTask?: (recordId: string) => void;
  /** The side panel is open: the page makes room for it instead of being covered. */
  onSidebarChange?: (open: boolean) => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("closed");
  const [layout, setLayout] = useState<Layout>("mini");
  const [unread, setUnread] = useState(false);
  const intake = useTaskIntake({ projectId }, onTaskCreated);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a per-viewer preference after hydration
      if (saved === "mini" || saved === "sidebar") setLayout(saved);
    } catch {
      // storage unavailable: keep the default
    }
  }, []);

  useEffect(() => {
    onSidebarChange?.(mode === "sidebar");
  }, [mode, onSidebarChange]);

  // A new project starts a new conversation.
  const { reset } = intake;
  useEffect(() => {
    reset();
  }, [projectId, reset]);

  // An answer that arrives while hidden lights the bubble.
  const lastId = intake.messages[intake.messages.length - 1]?.id;
  const lastPending = intake.messages[intake.messages.length - 1]?.pending;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- unread marker follows new answers
    if (mode === "minimized" && lastId && !lastPending) setUnread(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a message lands
  }, [lastId, lastPending]);

  function open(next: Layout = layout) {
    setLayout(next);
    setMode(next);
    setUnread(false);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // not persisted - fine
    }
  }
  function close() {
    intake.reset();
    setMode("closed");
  }

  const suggestions = useMemo(() => [t("intake.s.create"), t("intake.s.overdue"), t("intake.s.workload"), t("intake.s.status")], [t]);

  if (mode === "closed" || mode === "minimized") {
    const minimized = mode === "minimized";
    return (
      <button
        onClick={() => open()}
        className={cn(
          "fixed z-40 bottom-4 right-4 flex items-center justify-center gap-2 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all ring-4 ring-white dark:ring-neutral-950",
          minimized ? "h-14 w-14" : "h-12 pl-4 pr-5"
        )}
        title={t("intake.launcher")}
        aria-label={t("intake.launcher")}
        data-testid={minimized ? "project-ai-bubble" : "project-ai-launcher"}
      >
        <Sparkles size={minimized ? 22 : 18} />
        {!minimized && <span className="text-sm font-semibold">{t("intake.ask")}</span>}
        {unread && <span className="absolute top-0 right-0 h-3.5 w-3.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-neutral-950" data-testid="project-ai-unread" />}
      </button>
    );
  }

  const sidebar = mode === "sidebar";
  const iconBtn = "h-8 w-8 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/15";
  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 overflow-hidden",
        sidebar ? "top-0 right-0 h-full w-full sm:w-[420px] border-l shadow-2xl" : "bottom-4 right-4 left-4 sm:left-auto sm:w-[360px] h-[min(540px,calc(100vh-2rem))] rounded-t-2xl rounded-b-xl border shadow-2xl"
      )}
      role="dialog"
      aria-label={t("intake.title")}
      data-testid="project-ai-chat"
      data-layout={mode}
    >
      <div className="h-14 shrink-0 pl-3 pr-1.5 flex items-center gap-2.5 bg-indigo-600 text-white">
        <span className="relative h-9 w-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Sparkles size={17} />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-indigo-600" />
        </span>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-[15px] font-semibold truncate">{t("intake.title")}</div>
          <div className="text-[11px] text-white/80 truncate">{projectName}</div>
        </div>
        {intake.messages.length > 0 && (
          <button onClick={intake.reset} className={iconBtn} title={t("intake.newChat")} aria-label={t("intake.newChat")} data-testid="project-ai-new">
            <RotateCcw size={15} />
          </button>
        )}
        <button onClick={() => open(sidebar ? "mini" : "sidebar")} className={cn(iconBtn, "hidden sm:flex")} title={sidebar ? t("intake.toMini") : t("intake.toSidebar")} aria-label={sidebar ? t("intake.toMini") : t("intake.toSidebar")} data-testid="project-ai-expand">
          {sidebar ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
        <button onClick={() => setMode("minimized")} className={iconBtn} title={t("intake.minimize")} aria-label={t("intake.minimize")} data-testid="project-ai-minimize">
          <Minus size={20} strokeWidth={2.5} />
        </button>
        <button onClick={close} className={iconBtn} title={t("intake.close")} aria-label={t("intake.close")} data-testid="project-ai-close">
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>
      <TaskIntakeChat
        intake={intake}
        compact
        emptyTitle={t("intake.emptyTitle", { project: projectName })}
        suggestions={suggestions}
        onOpenTask={(c) => {
          if (c.projectId !== projectId || !onOpenTask) return false;
          onOpenTask(c.recordId);
          if (!sidebar) setMode("minimized");
          return true;
        }}
      />
    </div>
  );
}
