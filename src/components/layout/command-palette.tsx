"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FolderKanban, FileText, Search } from "lucide-react";
import { api } from "@/lib/api-client";

interface SearchResult {
  projects: { id: string; name: string; color: string }[];
  tasks: { id: string; label: string; projectId: string; projectName: string }[];
}

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
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult>({ projects: [], tasks: [] });
  const router = useRouter();

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
    if (!q.trim()) return;
    const t = setTimeout(() => {
      api
        .get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}&workspaceId=${workspaceId}`)
        .then(setResults)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, workspaceId]);

  function handleQueryChange(value: string) {
    setQ(value);
    if (!value.trim()) setResults({ projects: [], tasks: [] });
  }

  function go(path: string) {
    onOpenChange(false);
    setQ("");
    router.push(path);
  }

  const hasResults = results.projects.length + results.tasks.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg top-[20%] translate-y-0 p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-neutral-200 dark:border-neutral-800">
          <Search size={15} className="text-neutral-400" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search projects and tasks…"
            className="border-0 focus:ring-0 shadow-none px-1"
          />
        </div>
        <div className="max-h-80 overflow-y-auto thin-scroll p-2">
          {!q && <p className="text-xs text-neutral-400 px-2 py-4 text-center">Type to search this workspace</p>}
          {q && !hasResults && <p className="text-xs text-neutral-400 px-2 py-4 text-center">No results</p>}

          {results.projects.length > 0 && (
            <Group label="Projects">
              {results.projects.map((p) => (
                <Row key={p.id} icon={<FolderKanban size={14} style={{ color: p.color }} />} label={p.name} onClick={() => go(`/w/${workspaceSlug}/p/${p.id}`)} />
              ))}
            </Group>
          )}
          {results.tasks.length > 0 && (
            <Group label="Tasks">
              {results.tasks.map((t) => (
                <Row key={t.id} icon={<FileText size={14} />} label={t.label || "(untitled)"} sub={t.projectName} onClick={() => go(`/w/${workspaceSlug}/p/${t.projectId}?record=${t.id}`)} />
              ))}
            </Group>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold text-neutral-400 uppercase px-2 py-1">{label}</div>
      {children}
    </div>
  );
}

function Row({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left">
      <span className="text-neutral-400 shrink-0">{icon}</span>
      <span className="truncate text-neutral-800 dark:text-neutral-100 flex-1">{label}</span>
      {sub && <span className="text-xs text-neutral-400 shrink-0">{sub}</span>}
    </button>
  );
}
