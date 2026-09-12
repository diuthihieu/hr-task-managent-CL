import type { FilterOperator } from "@/lib/query-engine";

const TEXT_OPS: { value: FilterOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const NUMBER_OPS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "between", label: "between" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const DATE_OPS: { value: FilterOperator; label: string }[] = [
  { value: "before", label: "before" },
  { value: "after", label: "after" },
  { value: "between", label: "between" },
  { value: "today", label: "is today" },
  { value: "yesterday", label: "is yesterday" },
  { value: "this_week", label: "is this week" },
  { value: "this_month", label: "is this month" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const SELECT_OPS: { value: FilterOperator; label: string }[] = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const MULTI_SELECT_OPS: { value: FilterOperator; label: string }[] = [
  { value: "contains_any", label: "contains any of" },
  { value: "contains_all", label: "contains all of" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const PERSON_OPS: { value: FilterOperator; label: string }[] = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "is_current_user", label: "is current user" },
  { value: "is_empty", label: "is empty" },
];

export function operatorsForType(type: string) {
  if (["number", "integer", "percent", "currency", "duration", "progress", "rating"].includes(type)) return NUMBER_OPS;
  if (["date", "datetime", "created_time", "modified_time"].includes(type)) return DATE_OPS;
  if (["single_select", "status"].includes(type)) return SELECT_OPS;
  if (["multi_select", "link"].includes(type)) return MULTI_SELECT_OPS;
  if (["person", "people", "created_by"].includes(type)) return PERSON_OPS;
  if (type === "checkbox") return [{ value: "equals" as FilterOperator, label: "is" }];
  return TEXT_OPS;
}
