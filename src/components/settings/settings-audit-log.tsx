"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RotateCcw, UserCog } from "lucide-react";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { ActivityRow } from "@/types";
import { SettingsSection } from "./settings-shell";
import { useT } from "@/components/i18n-provider";
import { AvatarImg } from "@/components/ui/avatar-img";
import { Meta, MetaChip } from "@/components/ui/meta";
import { InlineArrow } from "@/components/ui/inline-arrow";

const ACTION_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  created: Plus,
  updated: Pencil,
  status_changed: Pencil,
  assigned: UserCog,
  role_changed: UserCog,
  deleted: Trash2,
  restored: RotateCcw,
};
const ACTION_COLOR: Record<string, string> = {
  created: "text-green-600 dark:text-green-500",
  deleted: "text-red-600 dark:text-red-500",
  restored: "text-indigo-600 dark:text-indigo-400",
};

/** Workspace activity log (append-only table `activity_logs`), newest first, paged by timestamp. */
export function SettingsAuditLog({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const loadMore = useCallback(
    async (before?: string) => {
      try {
        const page = await api.get<ActivityRow[]>(`/api/workspaces/${workspaceId}/activity?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`);
        setRows((prev) => (before ? [...prev, ...page] : page));
        setDone(page.length < 100);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("common.failed"));
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, t]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadMore();
  }, [loadMore]);

  return (
    <SettingsSection title={t("set.audit")} description={t("aud.desc")}>
      {loading ? (
        <p className="text-sm text-neutral-400">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400">{t("aud.none")}</p>
      ) : (
        <div className="max-w-3xl">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900">
            {rows.map((r) => {
              const Icon = ACTION_ICON[r.action] ?? Pencil;
              return (
                <div key={r.id} className="flex items-start gap-3 px-3 py-2">
                  <Icon size={13} className={`shrink-0 mt-1 ${ACTION_COLOR[r.action] ?? "text-indigo-600 dark:text-indigo-500"}`} />
                  <div className="flex-1 min-w-0 text-sm text-neutral-700 dark:text-neutral-300">
                    <div className="truncate">
                      <Meta className="text-neutral-400"><MetaChip>{r.entityType.replace("_", " ")}</MetaChip><span>{r.action.replace("_", " ")}</span></Meta>
                      {r.summary && <> — <span className="text-neutral-900 dark:text-neutral-100">{r.summary}</span></>}
                    </div>
                    {r.changes && (
                      <div className="text-xs text-neutral-500 truncate flex flex-wrap items-center gap-x-2">
                        {Object.entries(r.changes).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1">{k.replace(/^custom:/, "")}: {JSON.stringify(v.from)} <InlineArrow /> {JSON.stringify(v.to)}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.actor ? (
                      <>
                        <div className="relative overflow-hidden h-5 w-5 rounded-full flex items-center justify-center text-white text-[9px] font-medium" style={{ backgroundColor: r.actor.avatarColor }}>
                          {initials(r.actor.name)}
                          <AvatarImg id={r.actor.id} />
                        </div>
                        <span className="text-xs text-neutral-400">{r.actor.name}</span>
                      </>
                    ) : (
                      <span className="text-xs text-neutral-400">system / public form</span>
                    )}
                  </div>
                  <span className="text-[11px] text-neutral-400 shrink-0 w-32 text-right">{new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
              );
            })}
          </div>
          {!done && (
            <Button variant="secondary" className="mt-3" onClick={() => loadMore(rows[rows.length - 1]?.createdAt)}>
              Load older
            </Button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
