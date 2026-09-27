"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Select } from "@/components/ui/misc";
import type { ProjectRow } from "@/types";
import { useT } from "@/components/i18n-provider";

/** Loads the workspace's projects and keeps one selected (settings pages act on a single project). */
export function useProjectPicker(workspaceId: string) {
  const { t } = useT();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [projectId, setProjectId] = useState("");
  useEffect(() => {
    api
      .get<ProjectRow[]>(`/api/workspaces/${workspaceId}/projects`)
      .then((p) => {
        setProjects(p);
        setProjectId((prev) => prev || p[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [workspaceId]);
  const picker =
    projects && projects.length > 1 ? (
      <div className="mb-4 max-w-xs">
        <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.project")}</label>
        <Select className="w-full" value={projectId} onValueChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </div>
    ) : null;
  return { projects, projectId, project: projects?.find((p) => p.id === projectId) ?? null, picker };
}
