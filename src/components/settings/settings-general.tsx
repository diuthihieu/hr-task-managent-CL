"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "./settings-shell";

interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  role: string;
}

export function SettingsGeneral({ workspaceId, workspaceSlug, currentUserRole }: { workspaceId: string; workspaceSlug: string; currentUserRole: string }) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = ["owner", "admin"].includes(currentUserRole);

  useEffect(() => {
    api.get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`).then((d) => {
      setDetail(d);
      setName(d.name);
    });
  }, [workspaceId]);

  async function save() {
    if (!name.trim() || name === detail?.name) return;
    setSaving(true);
    try {
      await api.patch(`/api/workspaces/${workspaceId}`, { name: name.trim() });
      setDetail((d) => (d ? { ...d, name: name.trim() } : d));
      toast.success("Workspace renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename workspace");
    } finally {
      setSaving(false);
    }
  }

  if (!detail) return <div className="p-6 text-sm text-neutral-400">Loading…</div>;

  return (
    <SettingsSection title="Workspace" description="Basic information about this workspace.">
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">Workspace name</label>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} onKeyDown={(e) => e.key === "Enter" && save()} />
            {canEdit && (
              <Button onClick={save} disabled={saving || !name.trim() || name === detail.name}>
                Save
              </Button>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">Workspace URL</label>
          <Input value={`/w/${workspaceSlug}`} disabled />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">Created</label>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{new Date(detail.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">Your role</label>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 capitalize">{detail.role}</p>
        </div>
        {!canEdit && <p className="text-xs text-neutral-400">Only workspace owners and admins can rename the workspace.</p>}
      </div>
    </SettingsSection>
  );
}
