"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TIME_BUCKETS, TIME_BUCKET_DISTANCE, TIME_BUCKET_LABELS, bucketForPlannedAt, dotRadiusForDuration, type TimeBucket } from "@/lib/capture-engine";
import type { CaptureTargetRow, CapturedThoughtRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const CANVAS_SIZE = 460;
const CENTER = CANVAS_SIZE / 2;
const MAX_RADIUS = CENTER - 60; // leaves room for the outer "Unplanned" band beyond the Later ring

interface OkrOption {
  objectives: { id: string; title: string }[];
  keyResults: { id: string; title: string; objectiveId: string }[];
}

interface MemberLite {
  id: string;
  name: string;
  email: string;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dotPosition(thought: CapturedThoughtRow): { x: number; y: number; bucket: TimeBucket } {
  const bucket = bucketForPlannedAt(thought.plannedAt);
  const angle = (hashCode(thought.id) % 360) * (Math.PI / 180);
  const base = TIME_BUCKET_DISTANCE[bucket];
  const jitter = ((hashCode(thought.id + "r") % 14) - 7) / 100; // +-7% so same-bucket dots don't sit on an exact ring
  const radius = Math.max(10, (base + jitter) * MAX_RADIUS);
  return { x: CENTER + Math.cos(angle) * radius, y: CENTER + Math.sin(angle) * radius, bucket };
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PutAllThingsOn({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const { t } = useT();
  const [targets, setTargets] = useState<CaptureTargetRow[]>([]);
  const [thoughts, setThoughts] = useState<CapturedThoughtRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [projectId, setProjectId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [duration, setDuration] = useState<number | "">(30);
  const [categoryId, setCategoryId] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [clarifying, setClarifying] = useState<CapturedThoughtRow | null>(null);

  async function load() {
    try {
      const [t, th] = await Promise.all([
        api.get<CaptureTargetRow[]>(`/api/workspaces/${workspaceId}/capture-targets`),
        api.get<CapturedThoughtRow[]>(`/api/workspaces/${workspaceId}/thoughts`),
      ]);
      setTargets(t);
      setThoughts(th);
      setProjectId((prev) => prev || t[0]?.projectId || "");
      setCategoryId((prev) => prev || t[0]?.categoryOptions[0]?.id || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching capture targets/thoughts on mount is exactly what this effect is for
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const activeTarget = targets.find((t) => t.projectId === projectId) ?? targets[0];

  useEffect(() => {
    if (activeTarget && categoryId && !activeTarget.categoryOptions.some((o) => o.id === categoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the category selector valid when the target table changes
      setCategoryId(activeTarget.categoryOptions[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTarget?.projectId]);

  async function submitCapture() {
    if (!taskName.trim() || !projectId) return;
    setSubmitting(true);
    try {
      await api.post(`/api/workspaces/${workspaceId}/thoughts`, {
        taskName: taskName.trim(),
        projectId,
        categoryId: categoryId || null,
        estimatedDurationMinutes: duration === "" ? null : duration,
        // datetime-local has no zone: convert in the browser so the server stores the user's intended instant.
        plannedAt: plannedAt ? new Date(plannedAt).toISOString() : null,
      });
      setThoughts(await api.get<CapturedThoughtRow[]>(`/api/workspaces/${workspaceId}/thoughts`));
      setTaskName("");
      setPlannedAt("");
      nameInputRef.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleConverted(thoughtId: string) {
    setThoughts((prev) => prev.filter((t) => t.id !== thoughtId));
    setClarifying(null);
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">{t("common.loading")}</div>;

  if (!targets.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-neutral-400 text-center px-8">
        No Task Base with a Category field yet - add one from a table&apos;s + Add field menu to start capturing thoughts here.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Quick Capture bar */}
      <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-indigo-500 shrink-0" />
          <Input
            ref={nameInputRef}
            autoFocus
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !submitting && submitCapture()}
            placeholder={t("cap.placeholder")}
            className="flex-1"
          />
          <Button size="sm" onClick={submitCapture} disabled={!taskName.trim() || submitting}>
            <Plus size={13} /> {t("cap.capture")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {targets.length > 1 && (
            <Select className="w-40" value={projectId} onValueChange={setProjectId} options={targets.map((t) => ({ value: t.projectId, label: t.projectName }))} />
          )}
          <Select
            className="w-40"
            value={categoryId}
            onValueChange={setCategoryId}
            options={(activeTarget?.categoryOptions ?? []).map((o) => ({ value: o.id, label: o.label }))}
            placeholder={t("cap.category")}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">{t("cap.duration")}</span>
            <Input
              type="number"
              min={0}
              step={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="45"
              className="w-20 h-7 text-xs"
            />
            <span className="text-[11px] text-neutral-400">min</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">{t("cap.planned")}</span>
            <Input type="datetime-local" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} className="h-7 text-xs w-[190px]" />
          </div>
        </div>
      </div>

      {/* Dot visualization */}
      <div className="flex-1 overflow-auto flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 relative">
        <DotCanvas thoughts={thoughts} hoverId={hoverId} onHover={setHoverId} onClickDot={setClarifying} />
      </div>

      {clarifying && (
        <ClarificationPanel
          thought={clarifying}
          targets={targets}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          onClose={() => setClarifying(null)}
          onConverted={handleConverted}
        />
      )}
    </div>
  );
}

function DotCanvas({
  thoughts,
  hoverId,
  onHover,
  onClickDot,
}: {
  thoughts: CapturedThoughtRow[];
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onClickDot: (t: CapturedThoughtRow) => void;
}) {
  const { t } = useT();
  const hovered = thoughts.find((t) => t.id === hoverId);
  const hoveredPos = hovered ? dotPosition(hovered) : null;
  const innerBuckets = TIME_BUCKETS.filter((b) => b !== "unscheduled");

  return (
    <div className="relative">
      <style>{`
        @keyframes ptao-drift-a { 0%,100% { transform: translate(0px,0px); } 50% { transform: translate(3px,-4px); } }
        @keyframes ptao-drift-b { 0%,100% { transform: translate(0px,0px); } 50% { transform: translate(-4px,3px); } }
        @keyframes ptao-drift-c { 0%,100% { transform: translate(0px,0px); } 50% { transform: translate(3px,3px); } }
        .ptao-dot { transition: filter 0.2s ease; }
        .ptao-dot:hover { filter: brightness(1.15); }
      `}</style>
      <svg width={CANVAS_SIZE} height={CANVAS_SIZE} viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}>
        {/* Unplanned band - a dashed ring beyond Later, visually separated from the scheduled rings */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={TIME_BUCKET_DISTANCE.unscheduled * MAX_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 5"
          className="text-neutral-300 dark:text-neutral-700"
        />
        <text
          x={CENTER}
          y={CENTER - TIME_BUCKET_DISTANCE.unscheduled * MAX_RADIUS - 4}
          textAnchor="middle"
          className="fill-neutral-300 dark:fill-neutral-700"
          style={{ fontSize: 9, letterSpacing: 1 }}
        >
          {TIME_BUCKET_LABELS.unscheduled.toUpperCase()}
        </text>

        {innerBuckets.map((b) => (
          <circle
            key={b}
            cx={CENTER}
            cy={CENTER}
            r={TIME_BUCKET_DISTANCE[b] * MAX_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            className="text-neutral-200 dark:text-neutral-800"
          />
        ))}
        {innerBuckets.map((b) => (
          <text
            key={b}
            x={CENTER}
            y={CENTER - TIME_BUCKET_DISTANCE[b] * MAX_RADIUS - 4}
            textAnchor="middle"
            className="fill-neutral-400 dark:fill-neutral-600"
            style={{ fontSize: 9, letterSpacing: 1 }}
          >
            {TIME_BUCKET_LABELS[b].toUpperCase()}
          </text>
        ))}

        {/* center = now */}
        <circle cx={CENTER} cy={CENTER} r={5} className="fill-indigo-500" />
        <circle cx={CENTER} cy={CENTER} r={10} fill="none" className="stroke-indigo-400" strokeWidth={1} opacity={0.5} />
        <text x={CENTER} y={CENTER + 24} textAnchor="middle" className="fill-indigo-500 dark:fill-indigo-400 font-medium" style={{ fontSize: 10, letterSpacing: 1 }}>
          NOW
        </text>

        {thoughts.map((t) => {
          const { x, y } = dotPosition(t);
          const r = dotRadiusForDuration(t.estimatedDurationMinutes);
          const anim = ["ptao-drift-a", "ptao-drift-b", "ptao-drift-c"][hashCode(t.id) % 3];
          const duration = 7 + (hashCode(t.id + "d") % 5);
          return (
            // Positioning lives on this outer group's `transform` ATTRIBUTE; the drift
            // animation lives on the inner group's CSS `transform` PROPERTY. Putting
            // both on the same element doesn't work - an animated CSS transform always
            // wins over the SVG attribute, so every dot would collapse to the origin.
            <g key={t.id} transform={`translate(${x},${y})`} onMouseEnter={() => onHover(t.id)} onMouseLeave={() => onHover(null)} onClick={() => onClickDot(t)}>
              <g style={{ animation: `${anim} ${duration}s ease-in-out infinite`, cursor: "pointer" }}>
                <circle r={r} fill={t.categoryColor ?? "#6366f1"} opacity={0.88} className="ptao-dot" stroke="white" strokeWidth={1.5} />
              </g>
            </g>
          );
        })}
      </svg>

      {thoughts.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-neutral-400 max-w-[220px] text-center">{t("cap.empty")}</p>
        </div>
      )}

      {hovered && hoveredPos && (
        <div
          className="absolute pointer-events-none bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs rounded-md px-2.5 py-1.5 shadow-lg z-10 max-w-[200px]"
          style={{ left: hoveredPos.x + 16, top: hoveredPos.y - 10 }}
        >
          <div className="font-medium truncate">{hovered.taskName}</div>
          <div className="text-[10px] opacity-80 flex items-center gap-1.5 mt-0.5">
            {hovered.categoryLabel && <span>{hovered.categoryLabel}</span>}
            {hovered.estimatedDurationMinutes != null && <span>· {hovered.estimatedDurationMinutes}m</span>}
            <span>· {TIME_BUCKET_LABELS[hoveredPos.bucket]}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ClarificationPanel({
  thought,
  targets,
  workspaceId,
  workspaceSlug,
  onClose,
  onConverted,
}: {
  thought: CapturedThoughtRow;
  targets: CaptureTargetRow[];
  workspaceId: string;
  workspaceSlug: string;
  onClose: () => void;
  onConverted: (id: string) => void;
}) {
  const { t } = useT();
  const router = useRouter();
  // The thought was captured against a project, but it can be converted into any visible project.
  const [projectId, setProjectId] = useState(targets.some((x) => x.projectId === thought.projectId) ? thought.projectId : (targets[0]?.projectId ?? ""));
  const target = targets.find((x) => x.projectId === projectId) ?? targets[0];
  const [categoryId, setCategoryId] = useState(thought.categoryId ?? "");
  const categoryOptions = target?.categoryOptions ?? [];
  const validCategory = categoryOptions.some((o) => o.id === categoryId) ? categoryId : "";
  const [okr, setOkr] = useState<OkrOption>({ objectives: [], keyResults: [] });
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [objectiveId, setObjectiveId] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [keyResultId, setKeyResultId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [startAt, setStartAt] = useState(toDatetimeLocal(thought.plannedAt));
  const [dueAt, setDueAt] = useState("");
  const [status, setStatus] = useState(target?.statusOptions[0]?.id ?? "");
  const [priority, setPriority] = useState(target?.priorityOptions[0]?.id ?? "");
  const [output, setOutput] = useState("");
  const [process, setProcess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<OkrOption>(`/api/workspaces/${workspaceId}/okr-options`).then(setOkr).catch(() => {});
    api
      .get<MemberLite[]>(`/api/workspaces/${workspaceId}/members`)
      .then((m) => {
        setMembers(m);
        setOwnerId((prev) => prev);
      })
      .catch(() => {});
  }, [workspaceId]);

  const availableKeyResults = okr.keyResults.filter((k) => k.objectiveId === objectiveId);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await api.post<{ taskId: string; projectId: string }>(`/api/thoughts/${thought.id}/convert`, {
        projectId,
        categoryId: validCategory || null,
        objectiveId: objectiveId || undefined,
        newObjectiveTitle: !objectiveId ? newGoal.trim() || undefined : undefined,
        keyResultId: keyResultId || undefined,
        ownerId: ownerId || undefined,
        startAt: startAt || undefined,
        dueAt: dueAt || undefined,
        status: status || undefined,
        priority: priority || undefined,
        output: output.trim() || undefined,
        process: process.trim() || undefined,
      });
      toast.success(t("cap.converted"));
      onConverted(thought.id);
      router.push(`/w/${workspaceSlug}/p/${res.projectId}/t/${res.taskId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("cap.clarify", { name: thought.taskName })}</DialogTitle>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto thin-scroll pr-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.project")}</label>
              <Select
                className="w-full"
                value={projectId}
                onValueChange={(v) => {
                  setProjectId(v);
                  setCategoryId("");
                }}
                options={targets.map((x) => ({ value: x.projectId, label: x.projectName }))}
                data-testid="clarify-project"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.category")}</label>
              <Select
                className="w-full"
                value={validCategory}
                onValueChange={setCategoryId}
                options={[{ value: "", label: t("common.none") }, ...categoryOptions.map((o) => ({ value: o.id, label: o.label }))]}
              />
            </div>
          </div>
          <p className="text-[11px] text-neutral-400 -mt-1">{t("cap.projectHint")}</p>
          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.objective")}</label>
            <Select
              className="w-full"
              value={objectiveId}
              onValueChange={(v) => {
                setObjectiveId(v);
                setKeyResultId("");
                if (v) setNewGoal("");
              }}
              options={[{ value: "", label: t("common.none") }, ...okr.objectives.map((o) => ({ value: o.id, label: o.title }))]}
              placeholder={t("cap.selectGoal")}
            />
            {!objectiveId && (
              <Input className="mt-1.5" value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder={t("cap.newGoal")} />
            )}
          </div>

          {objectiveId && availableKeyResults.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.kr")}</label>
              <Select
                className="w-full"
                value={keyResultId}
                onValueChange={setKeyResultId}
                options={[{ value: "", label: t("common.none") }, ...availableKeyResults.map((k) => ({ value: k.id, label: k.title }))]}
                placeholder={t("cap.selectKr")}
              />
            </div>
          )}

          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.owner")}</label>
            <Select
              className="w-full"
              value={ownerId}
              onValueChange={setOwnerId}
              options={[{ value: "", label: t("cap.me") }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
              placeholder={t("cap.assign")}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.start")}</label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.due")}</label>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {target && target.statusOptions.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("okr.f.status")}</label>
                <Select className="w-full" value={status} onValueChange={setStatus} options={target.statusOptions.map((o) => ({ value: o.id, label: o.label }))} />
              </div>
            )}
            {target && target.priorityOptions.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("okr.f.priority")}</label>
                <Select className="w-full" value={priority} onValueChange={setPriority} options={target.priorityOptions.map((o) => ({ value: o.id, label: o.label }))} />
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.output")}</label>
            <Textarea rows={2} value={output} onChange={(e) => setOutput(e.target.value)} placeholder={t("cap.outputPh")} />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1 block">{t("cap.plan")}</label>
            <Textarea rows={3} value={process} onChange={(e) => setProcess(e.target.value)} placeholder={t("cap.planPh")} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={submitting || !projectId} data-testid="clarify-convert">
            <Target size={13} /> {t("cap.convert")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
