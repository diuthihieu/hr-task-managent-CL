import type { Project, View, Status, Category } from "@prisma/client";
import { fromDateOnly } from "./task-grid";
import type { ProjectRow, ViewRow, StatusRow, CategoryRow } from "@/types";

export function serializeProject(p: Project): ProjectRow {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    description: p.description,
    color: p.color,
    icon: p.icon,
    status: p.status,
    ownerId: p.ownerId,
    startDate: fromDateOnly(p.startDate),
    endDate: fromDateOnly(p.endDate),
    order: p.sortOrder,
  };
}

export function serializeView(v: View, permissions?: { canDelete?: boolean; canEdit?: boolean }): ViewRow {
  return {
    id: v.id,
    projectId: v.projectId,
    name: v.name,
    type: v.type,
    config: JSON.stringify(v.config ?? {}),
    order: v.sortOrder,
    isDefault: v.isDefault,
    isBase: v.isBase,
    isPublic: v.isPublic,
    ...permissions,
  };
}

export function serializeStatus(s: Status & { _count?: { tasks: number } }): StatusRow {
  return { id: s.id, name: s.name, color: s.color, category: s.category, order: s.sortOrder, isDefault: s.isDefault, taskCount: s._count?.tasks };
}

export function serializeCategory(c: Category & { _count?: { tasks: number } }): CategoryRow {
  return { id: c.id, name: c.name, color: c.color, order: c.sortOrder, taskCount: c._count?.tasks };
}
