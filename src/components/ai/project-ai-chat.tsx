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
          "fixed z-40 bottom-4 right-4 flex items-center gap-2 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500 transition-all",
          minimized ? "h-11 pl-3 pr-4" : "h-12 w-12 justify-center"
        )}
        title={t("intake.launcher")}
        aria-label={t("intake.launcher")}
        data-testid={minimized ? "project-ai-bubble" : "project-ai-launcher"}
      >
        <Sparkles size={minimized ? 16 : 20} />
        {minimized && <span className="text-sm font-medium max-w-[180px] truncate">{t("intake.title")}</span>}
        {unread && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-neutral-950" data-testid="project-ai-unread" />}
      </button>
    );
  }

  const sidebar = mode === "sidebar";
  const iconBtn = "h-7 w-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col bg-neutral-50 dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800 overflow-hidden",
        sidebar ? "top-0 right-0 h-full w-full sm:w-[420px] border-l shadow-2xl" : "bottom-4 right-4 left-4 sm:left-auto sm:w-[380px] h-[min(560px,calc(100vh-2rem))] rounded-2xl border shadow-2xl"
      )}
      role="dialog"
      aria-label={t("intake.title")}
      data-testid="project-ai-chat"
      data-layout={mode}
    >
      <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <span className="h-7 w-7 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center shrink-0">
          <Sparkles size={14} />
        </span>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{t("intake.title")}</div>
          <div className="text-[11px] text-neutral-500 truncate">{projectName}</div>
        </div>
        {intake.messages.length > 0 && (
          <button onClick={intake.reset} className={iconBtn} title={t("intake.newChat")} aria-label={t("intake.newChat")} data-testid="project-ai-new">
            <RotateCcw size={14} />
          </button>
        )}
        <button onClick={() => open(sidebar ? "mini" : "sidebar")} className={cn(iconBtn, "hidden sm:flex")} title={sidebar ? t("intake.toMini") : t("intake.toSidebar")} aria-label={sidebar ? t("intake.toMini") : t("intake.toSidebar")} data-testid="project-ai-expand">
          {sidebar ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button onClick={() => setMode("minimized")} className={iconBtn} title={t("intake.minimize")} aria-label={t("intake.minimize")} data-testid="project-ai-minimize">
          <Minus size={15} />
        </button>
        <button onClick={close} className={iconBtn} title={t("intake.close")} aria-label={t("intake.close")} data-testid="project-ai-close">
          <X size={15} />
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
