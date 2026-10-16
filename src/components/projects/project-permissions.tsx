"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Lock, RotateCcw } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Select } from "@/components/ui/misc";
import { useT } from "@/components/i18n-provider";
import { initials, cn } from "@/lib/utils";
import { AvatarImg } from "@/components/ui/avatar-img";
import { PROJECT_CAPS, type ProjectCap } from "@/lib/project-caps";
import type { MessageKey } from "@/lib/i18n/core";

type Row = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  isActive: boolean;
  role: string;
  hidden: boolean;
  locked: "admin" | "project_owner" | null;
  custom: boolean;
  permissions: ProjectCap[];
  ceiling: ProjectCap[];
};
type Data = { members: Row[]; defaults: Record<string, ProjectCap[]> };

const GROUPS: { key: string; caps: ProjectCap[] }[] = [
  { key: "tasks", caps: ["task.create", "task.edit_own", "task.edit_all", "task.delete", "task.comment"] },
  { key: "structure", caps: ["fields.manage", "views.create", "views.manage"] },
  { key: "goals", caps: ["okr.manage"] },
  { key: "settings", caps: ["settings.manage"] },
];

/** Presets: everything the role allows, or a role's defaults. */
const PRESETS = ["max", "editor", "contributor", "viewer"] as const;

/**
 * Who can do what in this project. Rows are workspace members, columns the
 * project's capabilities. A member never gets more than their workspace role
 * allows (greyed out); workspace owners/admins and the project owner always
 * have full rights. "See the project" uses the project's hidden-members list.
 */
export function ProjectPermissions({ projectId }: { projectId: string }) {
  const { t } = useT();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Data>(`/api/projects/${projectId}/permissions`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }, [projectId, t]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function setPerms(row: Row, permissions: ProjectCap[] | null) {
    setBusy(row.id);
    try {
      await api.put(`/api/projects/${projectId}/permissions`, { userId: row.id, permissions });
      await load();
      toast.success(t("pp.saved", { name: row.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function setHidden(row: Row, hidden: boolean) {
    if (!data) return;
    const ids = data.members.filter((m) => (m.id === row.id ? hidden : m.hidden)).map((m) => m.id);
    setBusy(row.id);
    try {
      await api.put(`/api/projects/${projectId}/visibility`, { hiddenUserIds: ids });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  function toggle(row: Row, cap: ProjectCap) {
    const has = row.permissions.includes(cap);
    let next = has ? row.permissions.filter((c) => c !== cap) : [...row.permissions, cap];
    // Editing all tasks implies editing your own.
    if (!has && cap === "task.edit_all" && !next.includes("task.edit_own")) next = [...next, "task.edit_own"];
    if (has && cap === "task.edit_own") next = next.filter((c) => c !== "task.edit_all");
    setPerms(row, PROJECT_CAPS.filter((c) => next.includes(c)));
  }

  function applyPreset(row: Row, preset: (typeof PRESETS)[number]) {
    if (!data) return;
    const wanted = preset === "max" ? row.ceiling : data.defaults[preset] ?? [];
    setPerms(row, wanted.filter((c) => row.ceiling.includes(c)));
  }

  if (!data) return <p className="text-sm text-neutral-400">{t("common.loading")}</p>;
  const capLabel = (c: ProjectCap) => t(`pp.cap.${c}` as MessageKey);
  return (
    <section data-testid="project-permissions">
      <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{t("pp.title")}</h2>
      <p className="text-xs text-neutral-500 mt-1 mb-3 max-w-3xl">{t("pp.lead")}</p>
      <div className="overflow-x-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
              <th rowSpan={2} className="text-left font-medium text-neutral-500 px-3 py-2 min-w-[180px] sticky left-0 bg-neutral-50 dark:bg-neutral-900">{t("pp.member")}</th>
              <th rowSpan={2} className="font-medium text-neutral-500 px-2 py-2">{t("pp.see")}</th>
              {GROUPS.map((g) => (
                <th key={g.key} colSpan={g.caps.length} className="font-semibold text-neutral-600 dark:text-neutral-300 px-2 pt-2 border-l border-neutral-200 dark:border-neutral-800">
                  {t(`pp.group.${g.key}` as MessageKey)}
                </th>
              ))}
              <th rowSpan={2} className="font-medium text-neutral-500 px-2 py-2 border-l border-neutral-200 dark:border-neutral-800">{t("pp.preset")}</th>
            </tr>
            <tr className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
              {GROUPS.flatMap((g) =>
                g.caps.map((c, i) => (
                  <th key={c} className={cn("font-normal text-neutral-500 px-2 pb-2 align-bottom min-w-[68px] max-w-[96px]", i === 0 && "border-l border-neutral-200 dark:border-neutral-800")} title={t(`pp.capHint.${c}` as MessageKey)}>
                    {capLabel(c)}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id} className={cn("border-b border-neutral-100 dark:border-neutral-900 last:border-0", m.hidden && "opacity-60")} data-testid="pp-row">
                <td className="px-3 py-2 sticky left-0 bg-white dark:bg-neutral-950">
                  <div className="flex items-center gap-2">
                    <span className="relative overflow-hidden h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0" style={{ backgroundColor: m.avatarColor }}>
                      {initials(m.name)}
                      <AvatarImg id={m.id} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-neutral-800 dark:text-neutral-100 truncate">{m.name}</span>
                      <span className="block text-[10px] text-neutral-400">
                        {t(`role.${m.role}` as MessageKey)}
                        {m.locked && <> · {t(m.locked === "admin" ? "pp.lockedAdmin" : "pp.lockedOwner")}</>}
                        {!m.locked && m.custom && <> · {t("pp.custom")}</>}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="text-center px-2">
                  {m.locked ? (
                    <Lock size={12} className="inline text-neutral-300" />
                  ) : (
                    <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={!m.hidden} disabled={busy === m.id} onChange={(e) => setHidden(m, !e.target.checked)} aria-label={t("pp.see")} data-testid="pp-see" />
                  )}
                </td>
                {GROUPS.flatMap((g) =>
                  g.caps.map((c, i) => {
                    const allowed = m.ceiling.includes(c);
                    const has = m.permissions.includes(c);
                    return (
                      <td key={c} className={cn("text-center px-2", i === 0 && "border-l border-neutral-100 dark:border-neutral-900")}>
                        {m.locked ? (
                          <Check size={13} className="inline text-green-600" />
                        ) : (
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-indigo-600 disabled:opacity-30"
                            checked={has}
                            disabled={!allowed || busy === m.id || m.hidden}
                            title={allowed ? capLabel(c) : t("pp.beyondRole", { role: t(`role.${m.role}` as MessageKey) })}
                            onChange={() => toggle(m, c)}
                            aria-label={`${m.name}: ${capLabel(c)}`}
                            data-testid={`pp-${c}`}
                          />
                        )}
                      </td>
                    );
                  })
                )}
                <td className="px-2 border-l border-neutral-100 dark:border-neutral-900">
                  {!m.locked && (
                    <div className="flex items-center gap-1">
                      <Select
                        className="w-32 h-7 text-xs"
                        value=""
                        onValueChange={(v) => v && applyPreset(m, v as (typeof PRESETS)[number])}
                        options={[{ value: "", label: t("pp.applyPreset") }, ...PRESETS.map((p) => ({ value: p, label: t(`pp.preset.${p}` as MessageKey) }))]}
                      />
                      {m.custom && (
                        <button onClick={() => setPerms(m, null)} className="p-1 text-neutral-400 hover:text-indigo-600" title={t("pp.reset")} aria-label={t("pp.reset")} data-testid="pp-reset">
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-400 mt-2 max-w-3xl">{t("pp.note")}</p>
    </section>
  );
}
