"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { FolderKanban, Search, BookOpen, Target, Paperclip, Plus, Briefcase, Sparkles, CalendarClock, CornerDownLeft, Loader2, ArrowLeft, Gavel } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { AttachmentViewer } from "@/components/attachments/attachment-viewer";
import { cn, initials } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

interface SearchResult {
  projects: { id: string; name: string; color: string }[];
  tasks: { id: string; label: string; projectId: string; projectName: string; status: string; statusColor: string }[];
  pages: { id: string; label: string; wikiId: string; wikiName: string }[];
  objectives: { id: string; label: string; projectName: string | null }[];
  people: { id: string; name: string; email: string; avatarColor: string; role: string }[];
  files: { id: string; fileName: string; contentType: string; sizeBytes: number; parent: { kind: "task" | "wiki"; id: string; label: string; projectId?: string; wikiId?: string } | null }[];
  decisions?: { id: string; label: string; status: string; decidedAt: string; projectName: string | null }[];
}
const EMPTY: SearchResult = { projects: [], tasks: [], pages: [], objectives: [], people: [], files: [], decisions: [] };

interface Item {
  key: string;
  group: string;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  run: () => void;
}

/**
 * Ctrl/Cmd+K: universal search (tasks, projects, wiki, objectives, people,
 * files) plus commands. Arrow keys + Enter work everywhere.
 */
export function CommandPalette({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
}) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"search" | "createTask">("search");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewFile, setViewFile] = useState<SearchResult["files"][number] | null>(null);
  const router = useRouter();
  const base = `/w/${workspaceSlug}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  useEffect(() => {
    if (!q.trim() || mode !== "search") return;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}&workspaceId=${workspaceId}`)
        .then((r) => {
          setResults(r);
          setActive(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [q, workspaceId, mode]);

  function reset() {
    setQ("");
    setResults(EMPTY);
    setMode("search");
    setActive(0);
  }
  function close() {
    onOpenChange(false);
    reset();
  }
  function go(path: string) {
    close();
    router.push(path);
  }

  async function startCreateTask() {
    setMode("createTask");
    if (!projects.length) {
      const list = await api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).catch(() => []);
      setProjects(list);
      setProjectId((p) => p || list[0]?.id || "");
    }
  }
  async function createTask() {
    if (!q.trim() || !projectId) return;
    setCreating(true);
    try {
      const me = await api.get<{ user?: { id: string } }>("/api/auth/session");
      const rec = await api.post<{ id: string }>(`/api/projects/${projectId}/tasks`, { data: { sys_title: q.trim(), ...(me.user?.id ? { sys_assignees: [me.user.id] } : {}) } });
      toast.success(t("cp.taskCreated"));
      go(`${base}/p/${projectId}/t/${rec.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setCreating(false);
    }
  }

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const cmd = (key: string, label: MessageKey, icon: React.ReactNode, run: () => void, sub?: string): Item => ({ key, group: t("cp.commands"), icon, label: t(label), sub, run });
    const commands: Item[] = [
      cmd("c-task", "cp.cmd.createTask", <Plus size={14} />, () => startCreateTask(), query || undefined),
      cmd("c-obj", "cp.cmd.createObjective", <Target size={14} />, () => go(`${base}/okrs?new=1`)),
      cmd("c-mywork", "cp.cmd.myWork", <Briefcase size={14} />, () => go(`${base}/my-work`)),
      cmd("c-ai", "cp.cmd.askAi", <Sparkles size={14} />, () => go(`${base}/ai${query ? `?q=${encodeURIComponent(query)}` : ""}`), query || undefined),
      cmd("c-plan", "cp.cmd.planDay", <CalendarClock size={14} />, () => go(`${base}?ai=home_plan`)),
    ];
    const filteredCommands = query ? commands.filter((c) => c.key === "c-task" || c.key === "c-ai" || c.label.toLowerCase().includes(query.toLowerCase())) : commands;
    if (!query) return filteredCommands;
    const r = results;
    return [
      ...r.tasks.map((x) => ({ key: `t-${x.id}`, group: t("cp.tasks"), icon: <span className="block h-2 w-2 rounded-full" style={{ backgroundColor: x.statusColor }} />, label: x.label || t("common.untitled"), sub: `${x.projectName} · ${x.status}`, run: () => go(`${base}/p/${x.projectId}/t/${x.id}`) })),
      ...r.projects.map((x) => ({ key: `p-${x.id}`, group: t("nav.projects"), icon: <FolderKanban size={14} style={{ color: x.color }} />, label: x.name, run: () => go(`${base}/p/${x.id}`) })),
      ...r.objectives.map((x) => ({ key: `o-${x.id}`, group: t("cp.objectives"), icon: <Target size={14} className="text-indigo-500" />, label: x.label, sub: x.projectName ?? undefined, run: () => go(`${base}/okrs/${x.id}`) })),
      ...r.pages.map((x) => ({ key: `w-${x.id}`, group: t("nav.wiki"), icon: <BookOpen size={14} />, label: x.label || t("common.untitled"), sub: x.wikiName, run: () => go(`${base}/wiki/${x.wikiId}/${x.id}`) })),
      ...(r.decisions ?? []).map((x) => ({ key: `d-${x.id}`, group: t("brain.decisions"), icon: <Gavel size={14} className="text-purple-500" />, label: x.label, sub: [x.decidedAt, x.projectName].filter(Boolean).join(" · "), run: () => go(`${base}/brain/decisions/${x.id}`) })),
      ...r.people.map((x) => ({
        key: `u-${x.id}`,
        group: t("cp.people"),
        icon: (
          <span className="h-4 w-4 rounded-full text-[8px] text-white flex items-center justify-center" style={{ backgroundColor: x.avatarColor }}>
            {initials(x.name)}
          </span>
        ),
        label: x.name,
        sub: `${x.email} · ${t(`role.${x.role}` as MessageKey)}`,
        run: () => go(`${base}/settings?section=members`),
      })),
      ...r.files.map((x) => ({ key: `f-${x.id}`, group: t("cp.files"), icon: <Paperclip size={14} />, label: x.fileName, sub: x.parent?.label, run: () => setViewFile(x) })),
      ...filteredCommands,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable enough; recompute on data
  }, [q, results, t, base]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (mode === "createTask") {
      if (e.key === "Enter") createTask();
      if (e.key === "Escape") {
        e.preventDefault();
        setMode("search");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
        <DialogContent className="max-w-xl top-[12%] sm:top-[18%] translate-y-0 p-0 overflow-hidden" data-testid="command-palette">
          <DialogTitle className="sr-only">{t("cp.placeholder")}</DialogTitle>
          <div className="flex items-center gap-2 px-3 border-b border-neutral-200 dark:border-neutral-800">
            {mode === "createTask" ? (
              <button onClick={() => setMode("search")} className="text-neutral-400 hover:text-neutral-700" aria-label={t("common.back")}>
                <ArrowLeft size={15} />
              </button>
            ) : loading ? (
              <Loader2 size={15} className="text-neutral-400 animate-spin" />
            ) : (
              <Search size={15} className="text-neutral-400" />
            )}
            <Input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (!e.target.value.trim()) setResults(EMPTY);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={mode === "createTask" ? t("cp.taskTitle") : t("cp.placeholder")}
              className="border-0 focus:ring-0 shadow-none px-1 h-11"
              data-testid="cp-input"
            />
          </div>
          {mode === "createTask" ? (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500 shrink-0">{t("cp.inProject")}</span>
                <Select className="flex-1" value={projectId} onValueChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              </div>
              <button onClick={createTask} disabled={!q.trim() || !projectId || creating} className="w-full flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white h-9 text-sm disabled:opacity-50" data-testid="cp-create-task">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t("cp.cmd.createTask")}
                <CornerDownLeft size={12} className="opacity-70" />
              </button>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto thin-scroll p-2" data-testid="cp-results">
              {q && !loading && items.length === 0 && <p className="text-xs text-neutral-400 px-2 py-4 text-center">{t("cp.none")}</p>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <div key={it.key}>
                    {header && <div className="text-[11px] font-semibold text-neutral-400 uppercase px-2 pt-2 pb-1">{header}</div>}
                    <button
                      onClick={it.run}
                      onMouseMove={() => setActive(i)}
                      className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left", i === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-neutral-100 dark:hover:bg-neutral-800")}
                      data-testid={`cp-item-${it.key}`}
                    >
                      <span className="text-neutral-400 shrink-0 w-4 flex justify-center">{it.icon}</span>
                      <span className="truncate text-neutral-800 dark:text-neutral-100 flex-1">{it.label}</span>
                      {it.sub && <span className="text-xs text-neutral-400 truncate max-w-[45%]">{it.sub}</span>}
                    </button>
                  </div>
                );
              })}
              {!q && <p className="text-[11px] text-neutral-400 px-2 pt-3 pb-1">{t("cp.hint")}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {viewFile && (
        <AttachmentViewer
          files={[{ id: viewFile.id, fileName: viewFile.fileName, contentType: viewFile.contentType, sizeBytes: viewFile.sizeBytes }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setViewFile(null)}
        />
      )}
    </>
  );
}

