"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { CategoryRow } from "@/types";
import { ProjectVisibility } from "./project-visibility";
import { ColorPicker } from "@/components/ui/color-picker";
import { ProjectIconPicker } from "./project-icon";

const COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#eab308", "#14b8a6", "#8b5cf6", "#ef4444", "#64748b"];

interface ProjectInfo {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  status: string;
  ownerId: string | null;
  startDate: string | null;
  endDate: string | null;
}

export function ProjectSettings({ project, workspaceId, workspaceSlug, canManage, canEditCategories }: { project: ProjectInfo; workspaceId: string; workspaceSlug: string; canManage: boolean; canEditCategories: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [info, setInfo] = useState(project);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newCategory, setNewCategory] = useState("");

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api.get<CategoryRow[]>(`/api/projects/${project.id}/categories`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }, [project.id, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadCategories();
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
  }, [loadCategories, workspaceId]);

  async function save(patch: Partial<ProjectInfo>) {
    setInfo((p) => ({ ...p, ...patch }));
    try {
      await api.patch(`/api/projects/${project.id}`, patch);
      toast.success(t("common.saved"));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setInfo(project);
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    try {
      await api.post(`/api/projects/${project.id}/categories`, { name, color: COLORS[categories.length % COLORS.length] });
      setNewCategory("");
      loadCategories();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function patchCategory(c: CategoryRow, body: Record<string, unknown>) {
    try {
      await api.patch(`/api/categories/${c.id}`, body);
      loadCategories();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      loadCategories();
    }
  }

  async function deleteCategory(c: CategoryRow) {
    if (!confirm(t("ps.deleteCategory", { name: c.name, count: c.taskCount ?? 0 }))) return;
    try {
      await api.delete(`/api/categories/${c.id}`);
      loadCategories();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteProject() {
    if (!confirm(t("project.deleteConfirm", { name: info.name }))) return;
    try {
      await api.delete(`/api/projects/${project.id}`);
      router.push(`/w/${workspaceSlug}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const label = "text-xs font-medium text-neutral-500 mb-1 block";
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <section>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50 mb-3">{t("ps.general")}</h2>
          {!canManage && <p className="text-xs text-neutral-400 mb-3">{t("ps.readOnly")}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>{t("project.new.name")}</label>
              <Input defaultValue={info.name} disabled={!canManage} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== info.name && save({ name: e.target.value.trim() })} data-testid="ps-name" />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>{t("ps.description")}</label>
              <Textarea rows={3} defaultValue={info.description ?? ""} disabled={!canManage} onBlur={(e) => e.target.value !== (info.description ?? "") && save({ description: e.target.value || null })} />
            </div>
            <div>
              <label className={label}>{t("ps.status")}</label>
              <Select
                className="w-full"
                value={info.status}
                onValueChange={(v) => canManage && save({ status: v })}
                options={(["active", "on_hold", "completed", "archived"] as const).map((v) => ({ value: v, label: t(`ps.status.${v}`) }))}
              />
            </div>
            <div>
              <label className={label}>{t("ps.owner")}</label>
              <Select className="w-full" value={info.ownerId ?? ""} onValueChange={(v) => canManage && save({ ownerId: v || null })} options={[{ value: "", label: t("okr.unassigned") }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
            </div>
            <div>
              <label className={label}>{t("ps.start")}</label>
              <Input type="date" defaultValue={info.startDate ?? ""} disabled={!canManage} onChange={(e) => save({ startDate: e.target.value || null })} />
            </div>
            <div>
              <label className={label}>{t("ps.end")}</label>
              <Input type="date" defaultValue={info.endDate ?? ""} disabled={!canManage} onChange={(e) => save({ endDate: e.target.value || null })} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>{t("pi.label")}</label>
              <ProjectIconPicker value={info.icon} disabled={!canManage} onChange={(icon) => save({ icon })} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>{t("ps.color")}</label>
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button key={c} disabled={!canManage} onClick={() => save({ color: c })} className={cn("h-6 w-6 rounded-full border-2", info.color === c ? "border-neutral-900 dark:border-white" : "border-transparent")} style={{ backgroundColor: c }} aria-label={c} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{t("ps.categories")}</h2>
          <p className="text-xs text-neutral-500 mb-3">{t("ps.categoriesHint")}</p>
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900">
            {categories.length === 0 && <div className="px-3 py-4 text-sm text-neutral-400">{t("ps.noCategories")}</div>}
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                <ColorPicker color={c.color} disabled={!canEditCategories} onPick={(col) => patchCategory(c, { color: col })} label={t("st.pickColor", { name: c.name })} testId="category-color" />
                <Input defaultValue={c.name} disabled={!canEditCategories} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && patchCategory(c, { name: e.target.value.trim() })} className="flex-1 h-7" aria-label={t("common.name")} />
                <span className="text-xs text-neutral-400 w-16 text-right shrink-0">{t("common.tasks", { count: c.taskCount ?? 0 })}</span>
                {canEditCategories && (
                  <button onClick={() => deleteCategory(c)} className="text-neutral-400 hover:text-red-600 shrink-0" aria-label={t("common.delete")}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canEditCategories ? (
            <div className="flex gap-2 mt-3">
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} placeholder={t("ps.newCategory")} className="flex-1" data-testid="ps-new-category" />
              <Button onClick={addCategory} disabled={!newCategory.trim()}>
                <Plus size={13} /> {t("common.add")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-neutral-400 mt-3">{t("ps.categoryReadOnly")}</p>
          )}
        </section>

        <ProjectVisibility projectId={project.id} />

        {canManage && (
          <section className="rounded-lg border border-red-200 dark:border-red-900 p-4">
            <h2 className="text-sm font-semibold text-red-600">{t("ps.danger")}</h2>
            <p className="text-xs text-neutral-500 mt-1 mb-3">{t("ps.deleteHint")}</p>
            <Button variant="destructive" onClick={deleteProject}>
              <Trash2 size={13} /> {t("ps.deleteProject")}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
