import type { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { logActivity } from "./activity";

type Tx = Prisma.TransactionClient;

// Workflow states every new workspace starts with. These are configuration
// (editable/deletable in Settings), not business data - a task can't exist
// without a status, so an empty list would make the workspace unusable.
export const DEFAULT_STATUSES = [
  { name: "To Do", color: "#94a3b8", category: "todo", isDefault: true },
  { name: "In Progress", color: "#3b82f6", category: "in_progress", isDefault: false },
  { name: "Blocked", color: "#ef4444", category: "in_progress", isDefault: false },
  { name: "Done", color: "#22c55e", category: "done", isDefault: false },
  { name: "Cancelled", color: "#64748b", category: "cancelled", isDefault: false },
] as const;

export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "workspace"}-${randomBytes(3).toString("hex")}`;
}

export async function createWorkspace(tx: Tx, opts: { name: string; description?: string | null; ownerId: string }) {
  const workspace = await tx.workspace.create({
    data: {
      name: opts.name,
      slug: slugify(opts.name),
      description: opts.description ?? null,
      createdById: opts.ownerId,
      updatedById: opts.ownerId,
      members: { create: { userId: opts.ownerId, role: "owner", createdById: opts.ownerId } },
      statuses: {
        create: DEFAULT_STATUSES.map((s, i) => ({ ...s, sortOrder: i, createdById: opts.ownerId, updatedById: opts.ownerId })),
      },
    },
  });
  await logActivity(tx, { workspaceId: workspace.id, actorId: opts.ownerId, entityType: "workspace", entityId: workspace.id, action: "created", summary: `Created workspace "${workspace.name}"` });
  return workspace;
}
