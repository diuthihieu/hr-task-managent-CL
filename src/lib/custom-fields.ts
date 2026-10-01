import { z } from "zod";
import { Prisma, type CustomFieldType } from "@prisma/client";
import { colorSchema } from "./validation";
import { isUuid } from "./task-grid";
import { badRequest } from "./http-errors";

type Tx = Prisma.TransactionClient;

export const CUSTOM_FIELD_TYPES = [
  "text", "long_text", "number", "currency", "percent", "rating", "checkbox", "date", "datetime",
  "single_select", "multi_select", "person", "url", "email", "phone", "formula",
  "team", "location", "signature", "link", "lookup", "rollup", "button", "barcode", "ai_field", "json", "api_result",
] as const satisfies readonly CustomFieldType[];

export const viewTypeSchema = z.enum(["grid", "kanban", "calendar", "gantt", "gallery", "form", "eisenhower", "report"]);

const optionSchema = z.object({ id: z.string().optional(), label: z.string().trim().min(1).max(120), color: colorSchema.catch("#94a3b8") });

export const customFieldConfigSchema = z
  .object({
    options: z.array(optionSchema).max(200).optional(),
    precision: z.number().int().min(0).max(6).optional(),
    currencySymbol: z.string().max(5).optional(),
    maxRating: z.number().int().min(1).max(10).optional(),
    expression: z.string().max(2000).optional(),
    linkProjectId: z.string().uuid().optional(),
    maxLinks: z.number().int().min(1).max(100).optional(),
    lookupLinkFieldId: z.string().max(80).optional(),
    lookupFieldId: z.string().max(80).optional(),
    rollupFn: z.enum(["sum", "avg", "min", "max", "count"]).optional(),
    buttonLabel: z.string().trim().max(80).optional(),
    buttonUrlTemplate: z.string().trim().max(2000).refine((v) => !v || /^https?:\/\//i.test(v), "Button URL must start with http:// or https://").optional(),
    aiPrompt: z.string().trim().max(4000).optional(),
    apiUrl: z.string().trim().max(2000).refine((v) => !v || /^https:\/\//i.test(v), "API URL must start with https://").optional(),
    apiJsonPath: z.string().trim().max(300).optional(),
  })
  .passthrough();

export const customFieldCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES),
  description: z.string().max(2000).nullable().optional(),
  isRequired: z.boolean().optional(),
  config: customFieldConfigSchema.optional(),
});

export const customFieldPatchSchema = customFieldCreateSchema.partial();

const SYSTEM_LOOKUP_FIELDS = new Set([
  "sys_title", "sys_status", "sys_assignees", "sys_report_to", "sys_priority", "sys_category",
  "sys_start_date", "sys_due_date", "sys_progress", "sys_estimate", "sys_actual", "sys_objective",
  "sys_importance", "sys_urgency", "sys_description", "sys_created_at", "sys_updated_at", "sys_created_by", "sys_updated_by",
]);

/** Validate references stored in relational/integration field settings. */
export async function validateFieldConfig(
  tx: Tx,
  projectId: string,
  type: CustomFieldType,
  config: z.infer<typeof customFieldConfigSchema>,
  selfId?: string
) {
  if (type === "link" && config.linkProjectId && config.linkProjectId !== projectId) {
    throw badRequest("Linked-record fields currently target tasks in the same project");
  }
  if (type !== "lookup" && type !== "rollup") return;

  if (config.lookupLinkFieldId) {
    const systemLink = config.lookupLinkFieldId === "sys_depends_on" || config.lookupLinkFieldId === "sys_parent";
    const customLink = systemLink
      ? null
      : await tx.customField.findFirst({ where: { id: config.lookupLinkFieldId, projectId, type: "link", deletedAt: null }, select: { id: true } });
    if (!systemLink && !customLink) throw badRequest("Lookup source must be a Link to Record field in this project");
  }

  if (config.lookupFieldId) {
    if (config.lookupFieldId === selfId) throw badRequest("A computed field cannot reference itself");
    if (!SYSTEM_LOOKUP_FIELDS.has(config.lookupFieldId)) {
      const source = await tx.customField.findFirst({ where: { id: config.lookupFieldId, projectId, deletedAt: null }, select: { id: true } });
      if (!source) throw badRequest("Lookup target field must belong to this project");
    }
  }
}

/** Only presentation settings go into `settings`; options live in their own table. */
export function settingsFor(type: CustomFieldType, config: z.infer<typeof customFieldConfigSchema>): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  if (["number", "currency", "percent"].includes(type) && config.precision !== undefined) out.precision = config.precision;
  if (type === "currency") out.currencySymbol = config.currencySymbol ?? "$";
  if (type === "rating") out.maxRating = config.maxRating ?? 5;
  if (type === "formula") out.expression = config.expression ?? "";
  if (type === "link") {
    if (config.linkProjectId) out.linkProjectId = config.linkProjectId;
    out.maxLinks = config.maxLinks ?? 20;
  }
  if (type === "lookup" || type === "rollup") {
    out.lookupLinkFieldId = config.lookupLinkFieldId ?? "";
    out.lookupFieldId = config.lookupFieldId ?? "";
    if (type === "rollup") out.rollupFn = config.rollupFn ?? "count";
  }
  if (type === "button") {
    out.buttonLabel = config.buttonLabel ?? "Open";
    out.buttonUrlTemplate = config.buttonUrlTemplate ?? "";
  }
  if (type === "ai_field") out.aiPrompt = config.aiPrompt ?? "";
  if (type === "api_result") {
    out.apiUrl = config.apiUrl ?? "";
    out.apiJsonPath = config.apiJsonPath ?? "";
  }
  return out as Prisma.InputJsonValue;
}

/**
 * Makes the field's option rows match `options` (by id): updates kept ones,
 * creates new ones, deletes removed ones (values pointing at them are
 * cleared by ON DELETE SET NULL / array cleanup below).
 */
export async function syncOptions(tx: Tx, customFieldId: string, options: { id?: string; label: string; color: string }[]) {
  const existing = await tx.customFieldOption.findMany({ where: { customFieldId }, select: { id: true } });
  const existingIds = new Set(existing.map((o) => o.id));
  const keep = new Set<string>();
  for (const [i, o] of options.entries()) {
    if (o.id && existingIds.has(o.id)) {
      keep.add(o.id);
      await tx.customFieldOption.update({ where: { id: o.id }, data: { label: o.label, color: o.color, sortOrder: i } });
    } else {
      const created = await tx.customFieldOption.create({
        data: { ...(o.id && isUuid(o.id) ? { id: o.id } : {}), customFieldId, label: o.label, color: o.color, sortOrder: i },
      });
      keep.add(created.id);
    }
  }
  const removed = [...existingIds].filter((id) => !keep.has(id));
  if (removed.length) {
    await tx.customFieldOption.deleteMany({ where: { id: { in: removed } } });
    // multi_select stores option ids in an array column: strip removed ids.
    await tx.$executeRaw`
      UPDATE task_custom_field_values
      SET value_option_ids = ARRAY(SELECT unnest(value_option_ids) EXCEPT SELECT unnest(${removed}::uuid[]))
      WHERE custom_field_id = ${customFieldId}::uuid AND value_option_ids && ${removed}::uuid[]`;
  }
}
