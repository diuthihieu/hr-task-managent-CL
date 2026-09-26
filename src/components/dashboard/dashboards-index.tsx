"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface DashboardLite {
  id: string;
  name: string;
  widgetCount: number;
}

export function DashboardsIndex({ workspaceId, workspaceSlug, canEdit }: { workspaceId: string; workspaceSlug: string; canEdit: boolean }) {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<DashboardLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setDashboards(await api.get<DashboardLite[]>(`/api/workspaces/${workspaceId}/dashboards`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load dashboards");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function createDashboard() {
    setCreating(true);
    try {
      const dashboard = await api.post<{ id: string }>(`/api/workspaces/${workspaceId}/dashboards`, { name: name.trim() || "New Dashboard" });
      setOpen(false);
      setName("");
      router.push(`/w/${workspaceSlug}/dash/${dashboard.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create dashboard");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <LayoutDashboard size={15} className="text-indigo-500" />
        <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Dashboards</h1>
        <span className="text-xs text-neutral-400">{dashboards.length}</span>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
            <Plus size={13} /> New dashboard
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-4">
        {loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : dashboards.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-neutral-400">No dashboards yet. Widgets read live task data from any project in this workspace.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
            {dashboards.map((d) => (
              <button
                key={d.id}
                onClick={() => router.push(`/w/${workspaceSlug}/dash/${d.id}`)}
                className="text-left rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <LayoutDashboard size={14} className="text-indigo-500 shrink-0" />
                  <span className="font-medium text-sm text-neutral-800 dark:text-neutral-100 truncate">{d.name}</span>
                </div>
                <p className="text-xs text-neutral-400">{d.widgetCount} widget{d.widgetCount === 1 ? "" : "s"}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>New dashboard</DialogTitle>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">Name</label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR Overview" onKeyDown={(e) => e.key === "Enter" && createDashboard()} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createDashboard} disabled={creating}>Create dashboard</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
