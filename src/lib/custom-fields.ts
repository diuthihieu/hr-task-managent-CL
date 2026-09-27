import { z } from "zod";
import { Prisma, type CustomFieldType } from "@prisma/client";
import { colorSchema } from "./validation";
import { isUuid } from "./task-grid";

type Tx = Prisma.TransactionClient;

export const CUSTOM_FIELD_TYPES = [
  "text", "long_text", "number", "currency", "percent", "rating", "checkbox", "date", "datetime",
  "single_select", "multi_select", "person", "url", "email", "phone", "formula",
] as const satisfies readonly CustomFieldType[];

export const viewTypeSchema = z.enum(["grid", "kanban", "calendar", "gantt", "gallery", "form", "eisenhower", "report"]);

const optionSchema = z.object({ id: z.string().optional(), label: z.string().trim().min(1).max(120), color: colorSchema.catch("#94a3b8") });

const configSchema = z
  .object({
    options: z.array(optionSchema).max(200).optional(),
    precision: z.number().int().min(0).max(6).optional(),
    currencySymbol: z.string().max(5).optional(),
    maxRating: z.number().int().min(1).max(10).optional(),
    expression: z.string().max(2000).optional(),
  })
  .passthrough();

export const customFieldCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES),
  description: z.string().max(2000).nullable().optional(),
  isRequired: z.boolean().optional(),
  config: configSchema.optional(),
});

export const customFieldPatchSchema = customFieldCreateSchema.partial();

/** Only presentation settings go into `settings`; options live in their own table. */
export function settingsFor(type: CustomFieldType, config: z.infer<typeof configSchema>): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  if (["number", "currency", "percent"].includes(type) && config.precision !== undefined) out.precision = config.precision;
  if (type === "currency") out.currencySymbol = config.currencySymbol ?? "$";
  if (type === "rating") out.maxRating = config.maxRating ?? 5;
  if (type === "formula") out.expression = config.expression ?? "";
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
