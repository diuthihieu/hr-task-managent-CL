"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Plus, Database } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface DashboardLite {
  id: string;
  name: string;
  blockCount: number;
}

interface BaseLite {
  id: string;
  name: string;
  dashboards: DashboardLite[];
}

export function DashboardsIndex({ workspaceSlug, bases }: { workspaceSlug: string; bases: BaseLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState(bases[0]?.id ?? "");
  const [creating, setCreating] = useState(false);

  const total = bases.reduce((n, b) => n + b.dashboards.length, 0);

  async function createDashboard() {
    if (!baseId) return;
    setCreating(true);
    try {
      const dashboard = await api.post<{ id: string }>(`/api/bases/${baseId}/dashboards`, { name: name.trim() || "New Dashboard" });
      setOpen(false);
      setName("");
      router.push(`/w/${workspaceSlug}/b/${baseId}/dash/${dashboard.id}`);
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
        <span className="text-xs text-neutral-400">{total}</span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)} disabled={!bases.length}>
          <Plus size={13} /> New dashboard
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-4">
        {bases.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-neutral-400">Create a base first to build a dashboard on top of it.</div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            {bases.map((base) => (
              <div key={base.id}>
                <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                  <Database size={12} /> {base.name}
                </div>
                {base.dashboards.length === 0 ? (
                  <p className="text-sm text-neutral-400 pl-1">No dashboards yet in this base.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {base.dashboards.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => router.push(`/w/${workspaceSlug}/b/${base.id}/dash/${d.id}`)}
                        className="text-left rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <LayoutDashboard size={14} className="text-indigo-500 shrink-0" />
                          <span className="font-medium text-sm text-neutral-800 dark:text-neutral-100 truncate">{d.name}</span>
                        </div>
                        <p className="text-xs text-neutral-400">{d.blockCount} widget{d.blockCount === 1 ? "" : "s"}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>New dashboard</DialogTitle>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Name</label>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR Overview" onKeyDown={(e) => e.key === "Enter" && createDashboard()} />
            </div>
            {bases.length > 1 && (
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">Base</label>
                <Select className="w-full" value={baseId} onValueChange={setBaseId} options={bases.map((b) => ({ value: b.id, label: b.name }))} />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createDashboard} disabled={creating}>Create dashboard</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
