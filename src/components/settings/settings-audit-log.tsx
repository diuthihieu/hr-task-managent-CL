"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/utils";
import { SettingsSection } from "./settings-shell";

interface AuditRow {
  id: string;
  action: string;
  objectType: string;
  objectId: string;
  label: string | null;
  user: { id: string; name: string; avatarColor: string } | null;
  createdAt: string;
}

const ACTION_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
};
const ACTION_COLOR: Record<string, string> = {
  create: "text-green-600 dark:text-green-500",
  update: "text-amber-600 dark:text-amber-500",
  delete: "text-red-600 dark:text-red-500",
};

export function SettingsAuditLog({ workspaceId }: { workspaceId: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AuditRow[]>(`/api/workspaces/${workspaceId}/audit-log`)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <SettingsSection title="Audit Log" description="A trail of record activity across this workspace, most recent first.">
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No audit events recorded yet - creating, editing or deleting a record will appear here.</p>
      ) : (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-w-2xl">
          {rows.map((r) => {
            const Icon = ACTION_ICON[r.action] ?? Pencil;
            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                <Icon size={13} className={`shrink-0 ${ACTION_COLOR[r.action] ?? "text-neutral-400"}`} />
                <span className="text-sm text-neutral-700 dark:text-neutral-300 flex-1 min-w-0 truncate">
                  <span className="capitalize">{r.action}d</span> {r.objectType} <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.label ?? r.objectId.slice(0, 8)}</span>
                </span>
                {r.user && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[9px] font-medium" style={{ backgroundColor: r.user.avatarColor }}>
                      {initials(r.user.name)}
                    </div>
                    <span className="text-xs text-neutral-400">{r.user.name}</span>
                  </div>
                )}
                <span className="text-[11px] text-neutral-400 shrink-0 w-32 text-right">{new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
