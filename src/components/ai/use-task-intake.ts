"use client";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { RecordRow } from "@/types";

export interface TaskDraft {
  projectId: string | null;
  projectName: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  priority: "low" | "medium" | "high" | "critical";
  assignees: { id: string; name: string }[];
  reportTo: { id: string; name: string }[];
  category: { id: string; name: string } | null;
  estimateHours: number | null;
  missing: string[];
}

export interface FieldChange {
  field: "category" | "priority" | "status" | "dueDate" | "startDate" | "assignees";
  from: string;
  to: string;
}
export interface TaskChange {
  taskId: string;
  title: string;
  reason: string | null;
  changes: FieldChange[];
  data: Record<string, unknown>;
}
/** Outcome of applying a change set: per task, saved or the reason it failed. */
export interface ApplyResult {
  saved: string[];
  failed: { taskId: string; title: string; error: string }[];
}

export interface IntakeMessage {
  id: string;
  role: "user" | "model";
  content: string;
  type?: "question" | "summary" | "answer" | "created" | "changes";
  /** Agent proposal: changes to existing tasks, applied only when the user presses Apply. */
  changes?: TaskChange[];
  applied?: ApplyResult;
  /** Snapshot of the draft a summary proposed. */
  draft?: TaskDraft | null;
  created?: { title: string; href: string; projectId: string; projectName: string | null; recordId: string };
  pending?: boolean;
}

interface TurnResponse {
  type: "question" | "summary" | "answer" | "changes";
  message: string;
  draft: TaskDraft | null;
  changes?: TaskChange[];
  canCreate: boolean;
}

const HISTORY = 20;
const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/**
 * AI task intake + project Q&A. The conversation stays in the browser (nothing
 * is written until the user confirms a draft); the server re-checks every
 * draft against the user's permissions, both per turn and on confirm.
 */
export function useTaskIntake(target: { workspaceId?: string; projectId?: string }, onCreated?: (record: RecordRow, projectId: string) => void, onUpdated?: (record: RecordRow) => void) {
  const [messages, setMessages] = useState<IntakeMessage[]>([]);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const { workspaceId, projectId } = target;

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setErrorStatus(null);
      setFailedText(null);
      setBusy(true);
      const userMsg: IntakeMessage = { id: `u-${Date.now()}`, role: "user", content: message };
      const botId = `m-${Date.now()}`;
      const history = [...messages.filter((m) => !m.pending && m.content), userMsg].slice(-HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      // The model must see a user turn first.
      while (history.length && history[0].role !== "user") history.shift();
      setMessages((prev) => [...prev, userMsg, { id: botId, role: "model", content: "", pending: true }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/ai/task-intake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            projectId,
            messages: history,
            timeZone: timeZone(),
            draft: draft
              ? {
                  projectId: draft.projectId,
                  title: draft.title,
                  description: draft.description,
                  dueDate: draft.dueDate,
                  dueTime: draft.dueTime,
                  startDate: draft.startDate,
                  priority: draft.priority,
                  assigneeIds: draft.assignees.map((a) => a.id),
                  reportToIds: draft.reportTo.map((a) => a.id),
                  categoryId: draft.category?.id ?? null,
                  estimateHours: draft.estimateHours,
                }
              : null,
          }),
          signal: ctrl.signal,
        });
        const body = (await res.json().catch(() => ({}))) as Partial<TurnResponse> & { error?: string };
        if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
        const r = body as TurnResponse;
        setCanCreate(r.canCreate);
        setDraft(r.draft);
        setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, content: r.message, type: r.type, draft: r.type === "summary" ? r.draft : undefined, changes: r.type === "changes" ? (r.changes ?? []) : undefined, pending: false } : m)));
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setMessages((prev) => prev.filter((m) => m.id !== botId));
          return;
        }
        setError(e instanceof Error ? e.message : "Failed");
        setErrorStatus((e as { status?: number }).status ?? null);
        setFailedText(message);
        setMessages((prev) => prev.filter((m) => m.id !== botId && m.id !== userMsg.id));
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, draft, workspaceId, projectId]
  );

  const confirm = useCallback(
    async (d: TaskDraft) => {
      if (creating || !d.projectId || d.missing.length) return;
      setCreating(true);
      setError(null);
      try {
        const r = await api.post<{ record: RecordRow; projectId: string; href: string }>("/api/ai/task-intake/confirm", {
          draft: {
            projectId: d.projectId,
            title: d.title,
            description: d.description,
            dueDate: d.dueDate,
            dueTime: d.dueTime,
            startDate: d.startDate,
            priority: d.priority,
            assigneeIds: d.assignees.map((a) => a.id),
            reportToIds: d.reportTo.map((a) => a.id),
            categoryId: d.category?.id ?? null,
            estimateHours: d.estimateHours,
          },
        });
        setDraft(null);
        setMessages((prev) => [
          ...prev,
          { id: `c-${Date.now()}`, role: "model", type: "created", content: `✓ ${d.title}`, created: { title: d.title, href: r.href, projectId: r.projectId, projectName: d.projectName, recordId: r.record.id } },
        ]);
        onCreated?.(r.record, r.projectId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setCreating(false);
      }
    },
    [creating, onCreated]
  );

  /**
   * Applies the selected proposed changes one task at a time through the normal
   * task API, so the user's own permissions, validation and activity log apply.
   */
  const applyChanges = useCallback(
    async (messageId: string, taskIds: string[]) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.changes || applying) return;
      setApplying(messageId);
      const result: ApplyResult = { saved: [], failed: [] };
      for (const change of msg.changes.filter((c) => taskIds.includes(c.taskId))) {
        try {
          const record = await api.patch<RecordRow>(`/api/tasks/${change.taskId}`, { data: change.data });
          result.saved.push(change.taskId);
          onUpdated?.(record);
        } catch (e) {
          result.failed.push({ taskId: change.taskId, title: change.title, error: e instanceof Error ? e.message : "Failed" });
        }
      }
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, applied: result } : m)));
      setApplying(null);
    },
    [messages, applying, onUpdated]
  );

  const dismissChanges = useCallback((messageId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, applied: { saved: [], failed: [] } } : m)));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setDraft(null);
    setError(null);
    setFailedText(null);
  }, []);
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const retry = useCallback(() => {
    if (failedText) send(failedText);
  }, [failedText, send]);

  return { messages, draft, busy, creating, applying, error, errorStatus, failedText, canCreate, send, confirm, applyChanges, dismissChanges, reset, stop, retry };
}

export type TaskIntake = ReturnType<typeof useTaskIntake>;
