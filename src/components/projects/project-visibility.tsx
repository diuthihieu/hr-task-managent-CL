"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff, Lock, Search } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { AvatarImg } from "@/components/ui/avatar-img";

interface Member {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  hidden: boolean;
  lockedReason: "admin" | "project_owner" | "self" | null;
}

/** "Visible to everyone in the workspace" by default; tick members to hide the project from them. */
export function ProjectVisibility({ projectId }: { projectId: string }) {
  const { t } = useT();
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ canManage: boolean; hiddenUserIds: string[]; members: Member[] }>(`/api/projects/${projectId}/visibility`);
      setMembers(r.members);
      setCanManage(r.canManage);
      setHidden(new Set(r.hiddenUserIds));
      setSaved(new Set(r.hiddenUserIds));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }, [projectId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? members.filter((m) => m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s)) : members;
  }, [members, q]);
  const dirty = hidden.size !== saved.size || [...hidden].some((id) => !saved.has(id));

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/visibility`, { hiddenUserIds: [...hidden] });
      setSaved(new Set(hidden));
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section data-testid="project-visibility">
      <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-1.5">
        <EyeOff size={15} /> {t("vis.title")}
      </h2>
      <p className="text-xs text-neutral-500 mb-3">{hidden.size ? t("vis.hiddenCount", { count: hidden.size }) : t("vis.default")}</p>
      {!canManage && <p className="text-xs text-neutral-400 mb-3">{t("vis.readOnly")}</p>}
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vis.search")} className="pl-8" />
      </div>
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-h-80 overflow-y-auto thin-scroll">
        {filtered.map((m) => {
          const locked = !!m.lockedReason;
          return (
            <label key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer has-[:disabled]:cursor-default" data-testid="vis-member">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={hidden.has(m.id)} disabled={!canManage || locked} onChange={() => toggle(m.id)} data-testid={`vis-toggle-${m.email}`} />
              <span className="relative overflow-hidden h-6 w-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: m.avatarColor }}>
                {m.name.slice(0, 1).toUpperCase()}
                <AvatarImg id={m.id} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-neutral-800 dark:text-neutral-200">{m.name}</span>
                <span className="block truncate text-xs text-neutral-400">{m.email}</span>
              </span>
              <span className="text-xs text-neutral-400 shrink-0">{t(`role.${m.role}` as MessageKey)}</span>
              {locked ? (
                <span className="text-[11px] text-neutral-400 flex items-center gap-1 shrink-0 w-36 justify-end">
                  <Lock size={11} /> {t(`vis.locked.${m.lockedReason}` as MessageKey)}
                </span>
              ) : (
                <span className={`text-[11px] shrink-0 w-36 text-right ${hidden.has(m.id) ? "text-red-600" : "text-emerald-600"}`}>{hidden.has(m.id) ? t("vis.hidden") : t("vis.visible")}</span>
              )}
            </label>
          );
        })}
      </div>
      {canManage && (
        <div className="flex justify-end gap-2 mt-3">
          {dirty && (
            <Button variant="ghost" onClick={() => setHidden(new Set(saved))}>
              {t("common.cancel")}
            </Button>
          )}
          <Button onClick={save} disabled={!dirty || saving} data-testid="vis-save">
            {t("common.save")}
          </Button>
        </div>
      )}
    </section>
  );
}
