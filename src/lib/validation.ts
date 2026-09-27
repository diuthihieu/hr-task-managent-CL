import { z } from "zod";

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid id");
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "must be a valid email address");
export const nameSchema = z.string().trim().min(1, "is required").max(120);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #6366f1");
export const workspaceRoleSchema = z.enum(["owner", "admin", "editor", "contributor", "viewer"]);
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .nullable()
  .optional();

export function dateOnlyToDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export const projectInputSchema = z.object({
  name: nameSchema,
  description: z.string().max(5000).nullable().optional(),
  color: colorSchema.optional(),
  status: z.enum(["active", "on_hold", "completed", "archived"]).optional(),
  ownerId: uuid.nullable().optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});

export const statusSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: colorSchema.optional(),
  category: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
  isDefault: z.boolean().optional(),
});

export const categorySchema = z.object({ name: z.string().trim().min(1).max(80), color: colorSchema.optional() });

export const objectiveSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  teamId: uuid.nullable().optional(),
  parentObjectiveId: uuid.nullable().optional(),
  ownerId: uuid.nullable().optional(),
  cycleType: z.enum(["quarter", "year", "custom"]).optional(),
  cycleLabel: z.string().max(40).nullable().optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  status: z.enum(["not_started", "on_track", "at_risk", "off_track", "completed"]).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  contributorIds: z.array(uuid).max(200).optional(),
});

export const keyResultSchema = z.object({
  title: z.string().trim().min(1).max(300),
  ownerId: uuid.nullable().optional(),
  type: z.enum(["task_based", "numeric", "percentage", "manual"]).optional(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  unit: z.string().max(20).nullable().optional(),
  weight: z.number().positive().max(1000).optional(),
  manualProgress: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(["not_started", "on_track", "at_risk", "off_track", "completed"]).optional(),
  order: z.number().int().optional(),
});

/** Accepts a date-only string or a full ISO timestamp (older clients) and keeps the date part. */
export function lenientDateOnly(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return typeof v === "string" ? v.slice(0, 10) : undefined;
}
