import type { Dashboard, DashboardWidget } from "@prisma/client";

export function serializeWidget(w: DashboardWidget) {
  return { id: w.id, dashboardId: w.dashboardId, type: w.type, title: w.title, config: JSON.stringify(w.config ?? {}), x: w.x, y: w.y, w: w.w, h: w.h, order: w.sortOrder };
}

export function serializeDashboard(d: Dashboard & { widgets?: DashboardWidget[] }) {
  return {
    id: d.id,
    workspaceId: d.workspaceId,
    name: d.name,
    filters: JSON.stringify(d.filters ?? {}),
    createdAt: d.createdAt.toISOString(),
    blocks: (d.widgets ?? []).map(serializeWidget),
  };
}
