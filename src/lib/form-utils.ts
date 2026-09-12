// Shared logic between the in-app Form builder/preview and the public
// /form/[viewId] page - both render the exact same field list from the
// exact same FormConfig, so what a form's owner previews is what an
// anonymous visitor actually sees.

import { getFieldType } from "./field-types";
import type { FormConfig, FormFieldConfig, FilterOperator } from "./query-engine";
import type { FieldRow } from "@/types";

// Computed/system/relational fields can't be filled in by a human on a form.
const NOT_FORMABLE_TYPES = [
  "formula",
  "auto_number",
  "created_time",
  "created_by",
  "modified_time",
  "modified_by",
  "link",
  "lookup",
  "rollup",
  "button",
  "team",
  "location",
  "signature",
  "barcode",
  "ai_field",
  "json",
  "api_result",
];

export function isFieldFormable(field: FieldRow): boolean {
  const typeDef = getFieldType(field.type);
  return !NOT_FORMABLE_TYPES.includes(field.type) && !typeDef.comingSoon;
}

export interface OrderedFormField {
  field: FieldRow;
  formField: FormFieldConfig;
}

/** Every formable field, in the form's configured order, defaulting to visible+not-required for fields the builder hasn't touched yet. */
export function getOrderedFormFields(fields: FieldRow[], config: FormConfig | undefined): OrderedFormField[] {
  const formable = fields.filter(isFieldFormable);
  const configured = config?.fields ?? [];
  const byId = new Map(configured.map((f) => [f.fieldId, f]));
  const ordered = [...formable].sort((a, b) => {
    const ai = configured.findIndex((f) => f.fieldId === a.id);
    const bi = configured.findIndex((f) => f.fieldId === b.id);
    if (ai === -1 && bi === -1) return a.order - b.order;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return ordered.map((field) => ({
    field,
    formField: byId.get(field.id) ?? { fieldId: field.id, visible: true, required: false },
  }));
}

function matchesRuleValue(value: unknown, operator: FilterOperator, target: unknown): boolean {
  if (operator === "is_empty") return value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);
  if (operator === "is_not_empty") return !matchesRuleValue(value, "is_empty", target);
  if (Array.isArray(value)) return value.map(String).includes(String(target));
  return String(value ?? "") === String(target ?? "");
}

/** Is `targetFieldId` visible right now given the visitor's in-progress answers? */
export function isFieldVisible(targetFieldId: string, config: FormConfig | undefined, values: Record<string, unknown>): boolean {
  const rule = config?.conditionalRules?.find((r) => r.targetFieldId === targetFieldId);
  if (!rule) return true;
  return matchesRuleValue(values[rule.whenFieldId], rule.operator, rule.value);
}
