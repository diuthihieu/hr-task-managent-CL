"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Info, Lock, RotateCcw, Save } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
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
  locked: "project_owner" | "self" | null;
  custom: boolean;
  permissions: ProjectCap[];
  defaults: ProjectCap[];
  ceiling: ProjectCap[];
};
type Data = { members: Row[]; defaults: Record<string, ProjectCap[]> };
/** A member's unsaved state: permissions null = their role's defaults. */
type Draft = { permissions: ProjectCap[] | null; hidden: boolean };

const GROUPS: { key: string; caps: ProjectCap[] }[] = [
  { key: "tasks", caps: ["task.create", "task.edit_own", "task.edit_all", "task.delete", "task.comment"] },
  { key: "structure", caps: ["fields.manage", "views.create", "views.manage"] },
  { key: "goals", caps: ["okr.manage"] },
  { key: "settings", caps: ["settings.manage"] },
];

/** Templates: tick a ready-made set of boxes for one member in one click. */
const PRESETS = ["max", "editor", "contributor", "viewer"] as const;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Who can see the project and what they can do in it. Rows are workspace
 * members (workspace owners/admins too - the project owner ranks above them
 * here), columns the capabilities. Changes are drafted and apply only on Save.
 * Unticking "See project" hides the project from them and greys out the rest.
 */
export function ProjectPermissions({ projectId }: { projectId: string }) {
  const { t } = useT();
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<Data>(`/api/projects/${projectId}/permissions`);
      setData(d);
      setDraft(Object.fromEntries(d.members.map((m) => [m.id, { permissions: m.custom ? m.permissions : null, hidden: m.hidden }])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }, [projectId, t]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const effective = (m: Row): ProjectCap[] => {
    const d = draft[m.id];
    if (m.locked === "project_owner") return m.permissions;
    const wanted = d?.permissions ?? m.defaults;
    return PROJECT_CAPS.filter((c) => m.ceiling.includes(c) && wanted.includes(c));
  };

  const changes = useMemo(() => {
    if (!data) return [];
    return data.members.flatMap((m) => {
      const d = draft[m.id];
      if (!d || m.locked === "project_owner") return [];
      const out: { userId: string; permissions?: ProjectCap[] | null; hidden?: boolean } = { userId: m.id };
      const before = m.custom ? m.permissions : null;
      if (d.permissions === null ? before !== null : before === null || !sameSet(d.permissions, before)) out.permissions = d.permissions;
      if (d.hidden !== m.hidden) out.hidden = d.hidden;
      return Object.keys(out).length > 1 ? [out] : [];
    });
  }, [data, draft]);

  const setRow = (id: string, patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  function toggle(m: Row, cap: ProjectCap) {
    const cur = effective(m);
    const has = cur.includes(cap);
    let next = has ? cur.filter((c) => c !== cap) : [...cur, cap];
    // Editing all tasks implies editing your own.
    if (!has && cap === "task.edit_all" && !next.includes("task.edit_own")) next = [...next, "task.edit_own"];
    if (has && cap === "task.edit_own") next = next.filter((c) => c !== "task.edit_all");
    const ordered = PROJECT_CAPS.filter((c) => next.includes(c));
    setRow(m.id, { permissions: sameSet(ordered, m.defaults.filter((c) => m.ceiling.includes(c))) ? null : ordered });
  }

  function applyPreset(m: Row, preset: (typeof PRESETS)[number]) {
    if (!data) return;
    const wanted = (preset === "max" ? m.ceiling : data.defaults[preset] ?? []).filter((c) => m.ceiling.includes(c));
    setRow(m.id, { permissions: PROJECT_CAPS.filter((c) => wanted.includes(c)) });
  }

  async function save() {
    if (!changes.length) return;
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/permissions`, { changes });
      toast.success(t("pp.savedAll", { n: changes.length }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-sm text-neutral-400">{t("common.loading")}</p>;
  const capLabel = (c: ProjectCap) => t(`pp.cap.${c}` as MessageKey);
  const dirty = new Set(changes.map((c) => c.userId));
  return (
    <section data-testid="project-permissions">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{t("pp.title")}</h2>
          <p className="text-xs text-neutral-500 mt-1 max-w-3xl">{t("pp.lead")}</p>
        </div>
        <div className="flex items-center gap-2">
          {changes.length > 0 && (
            <>
              <span className="text-xs text-amber-600" data-testid="pp-unsaved">{t("pp.unsaved", { n: changes.length })}</span>
              <Button size="sm" variant="ghost" onClick={load} disabled={saving}>{t("common.cancel")}</Button>
            </>
          )}
          <Button size="sm" onClick={save} disabled={!changes.length || saving} data-testid="pp-save">
            <Save size={13} /> {t("common.save")}
          </Button>
        </div>
      </div>
      <button type="button" onClick={() => setShowHelp((v) => !v)} className="mt-2 mb-3 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline" data-testid="pp-help-toggle">
        <Info size={12} /> {t("pp.helpToggle")}
      </button>
      {showHelp && (
        <div className="mb-3 max-w-3xl rounded-md border border-indigo-100 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 text-xs text-neutral-700 dark:text-neutral-300 space-y-1" data-testid="pp-help">
          <p>{t("pp.help.see")}</p>
          <p>{t("pp.help.template")}</p>
          <ul className="list-disc pl-5">
            {PRESETS.map((p) => (
              <li key={p}>
                <b>{t(`pp.preset.${p}` as MessageKey)}</b>: {t(`pp.presetHint.${p}` as MessageKey)}
              </li>
            ))}
          </ul>
          <p>{t("pp.help.rank")}</p>
          <p>{t("pp.help.save")}</p>
        </div>
      )}
      <div className="overflow-x-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
              <th rowSpan={2} className="text-left font-medium text-neutral-500 px-3 py-2 min-w-[190px] sticky left-0 bg-neutral-50 dark:bg-neutral-900">{t("pp.member")}</th>
              <th rowSpan={2} className="font-medium text-neutral-500 px-2 py-2 min-w-[64px]">{t("pp.see")}</th>
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
            {data.members.map((m) => {
              const d = draft[m.id] ?? { permissions: null, hidden: m.hidden };
              const caps = effective(m);
              const owner = m.locked === "project_owner";
              return (
                <tr key={m.id} className={cn("border-b border-neutral-100 dark:border-neutral-900 last:border-0", dirty.has(m.id) && "bg-amber-50/60 dark:bg-amber-950/20")} data-testid="pp-row">
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
                          {owner && <> · {t("pp.lockedOwner")}</>}
                          {!owner && d.permissions !== null && <> · {t("pp.custom")}</>}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="text-center px-2">
                    {owner || m.locked === "self" ? (
                      <Lock size={12} className="inline text-neutral-300" />
                    ) : (
                      <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={!d.hidden} onChange={(e) => setRow(m.id, { hidden: !e.target.checked })} aria-label={`${m.name}: ${t("pp.see")}`} data-testid="pp-see" />
                    )}
                  </td>
                  {GROUPS.flatMap((g) =>
                    g.caps.map((c, i) => {
                      const allowed = m.ceiling.includes(c);
                      return (
                        <td key={c} className={cn("text-center px-2", i === 0 && "border-l border-neutral-100 dark:border-neutral-900")}>
                          {owner ? (
                            <Check size={13} className="inline text-green-600" />
                          ) : (
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-indigo-600 disabled:opacity-30"
                              checked={!d.hidden && caps.includes(c)}
                              disabled={!allowed || d.hidden}
                              title={d.hidden ? t("pp.hiddenHint") : allowed ? capLabel(c) : t("pp.beyondRole", { role: t(`role.${m.role}` as MessageKey) })}
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
                    {!owner && (
                      <div className="flex items-center gap-1">
                        <Select
                          className="w-36 h-7 text-xs"
                          value=""
                          disabled={d.hidden}
                          onValueChange={(v) => v && applyPreset(m, v as (typeof PRESETS)[number])}
                          options={[{ value: "", label: t("pp.applyPreset") }, ...PRESETS.map((p) => ({ value: p, label: t(`pp.preset.${p}` as MessageKey), description: t(`pp.presetHint.${p}` as MessageKey) }))]}
                        />
                        {d.permissions !== null && (
                          <button onClick={() => setRow(m.id, { permissions: null })} className="p-1 text-neutral-400 hover:text-indigo-600" title={t("pp.reset")} aria-label={t("pp.reset")} data-testid="pp-reset">
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-400 mt-2 max-w-3xl">{t("pp.note")}</p>
    </section>
  );
}
