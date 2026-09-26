// Registry of every field type the product spec calls for. Types with
// `comingSoon: true` appear (greyed out) in the "add field" picker so the
// full information architecture is visible, but cell rendering/editing for
// them ships in a later phase (Phase 6 relational fields, Phase 7 exotic
// types) rather than being faked here.

export type FieldCategory =
  | "basic"
  | "selection"
  | "people"
  | "contact"
  | "files"
  | "calculated"
  | "relational"
  | "system"
  | "action";

export interface FieldTypeDef {
  type: string;
  label: string;
  category: FieldCategory;
  icon: string; // lucide-react icon name
  comingSoon?: boolean;
  /** Can the user edit this cell directly in the grid? */
  editable: boolean;
}

export const FIELD_TYPES: FieldTypeDef[] = [
  // Basic
  { type: "text", label: "Short Text", category: "basic", icon: "Type", editable: true },
  { type: "long_text", label: "Long Text", category: "basic", icon: "AlignLeft", editable: true },
  { type: "number", label: "Number", category: "basic", icon: "Hash", editable: true },
  { type: "integer", label: "Integer", category: "basic", icon: "Hash", editable: true },
  { type: "percent", label: "Percentage", category: "basic", icon: "Percent", editable: true },
  { type: "currency", label: "Currency", category: "basic", icon: "DollarSign", editable: true },
  { type: "checkbox", label: "Checkbox", category: "basic", icon: "CheckSquare", editable: true },
  { type: "date", label: "Date", category: "basic", icon: "Calendar", editable: true },
  { type: "datetime", label: "Date Time", category: "basic", icon: "CalendarClock", editable: true },
  { type: "duration", label: "Duration", category: "basic", icon: "Timer", editable: true },

  // Selection
  { type: "single_select", label: "Single Select", category: "selection", icon: "CircleDot", editable: true },
  { type: "multi_select", label: "Multi Select", category: "selection", icon: "ListChecks", editable: true },
  { type: "status", label: "Status", category: "selection", icon: "Flag", editable: true },
  { type: "rating", label: "Rating", category: "selection", icon: "Star", editable: true },
  { type: "importance", label: "Importance", category: "selection", icon: "Gem", editable: true },
  { type: "urgency", label: "Urgency", category: "selection", icon: "Flame", editable: true },

  // People
  { type: "person", label: "Person", category: "people", icon: "User", editable: true },
  { type: "people", label: "Multiple People", category: "people", icon: "Users", editable: true },
  { type: "team", label: "Team / Group", category: "people", icon: "UsersRound", editable: true, comingSoon: true },

  // Contact
  { type: "email", label: "Email", category: "contact", icon: "Mail", editable: true },
  { type: "phone", label: "Phone", category: "contact", icon: "Phone", editable: true },
  { type: "url", label: "URL", category: "contact", icon: "Link", editable: true },
  { type: "location", label: "Location", category: "contact", icon: "MapPin", editable: true, comingSoon: true },

  // Files
  { type: "attachment", label: "Attachment", category: "files", icon: "Paperclip", editable: true },
  { type: "signature", label: "Signature", category: "files", icon: "PenTool", editable: true, comingSoon: true },

  // Calculated
  { type: "formula", label: "Formula", category: "calculated", icon: "Sigma", editable: false },
  { type: "auto_number", label: "Auto Number", category: "calculated", icon: "ListOrdered", editable: false },
  { type: "progress", label: "Progress", category: "calculated", icon: "GaugeCircle", editable: true },

  // Relational
  { type: "link", label: "Link to Record", category: "relational", icon: "Link2", editable: true },
  { type: "lookup", label: "Lookup", category: "relational", icon: "SearchCode", editable: false, comingSoon: true },
  { type: "rollup", label: "Rollup", category: "relational", icon: "Sigma", editable: false, comingSoon: true },
  { type: "okr_objective", label: "Objective", category: "relational", icon: "Target", editable: true },
  { type: "okr_key_result", label: "Key Result", category: "relational", icon: "KeySquare", editable: true },

  // System
  { type: "created_time", label: "Created Time", category: "system", icon: "Clock", editable: false },
  { type: "created_by", label: "Created By", category: "system", icon: "UserCircle", editable: false },
  { type: "modified_time", label: "Last Modified Time", category: "system", icon: "History", editable: false },
  { type: "modified_by", label: "Last Modified By", category: "system", icon: "UserCircle", editable: false, comingSoon: true },

  // Action / future-ready
  { type: "button", label: "Button", category: "action", icon: "MousePointerClick", editable: false, comingSoon: true },
  { type: "barcode", label: "Barcode", category: "basic", icon: "ScanLine", editable: true, comingSoon: true },
  { type: "ai_field", label: "AI Field", category: "calculated", icon: "Sparkles", editable: false, comingSoon: true },
  { type: "json", label: "JSON", category: "basic", icon: "Braces", editable: true, comingSoon: true },
  { type: "api_result", label: "API Result", category: "calculated", icon: "Cloud", editable: false, comingSoon: true },
];

export const FIELD_TYPE_MAP = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f]));

export const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  basic: "Basic",
  selection: "Selection",
  people: "People",
  contact: "Contact",
  files: "Files",
  calculated: "Calculated",
  relational: "Relational",
  system: "System",
  action: "Action",
};

export function getFieldType(type: string): FieldTypeDef {
  return FIELD_TYPE_MAP[type] ?? FIELD_TYPES[0];
}

export const STATUS_OPTIONS_DEFAULT = [
  { id: "not_started", label: "Not Started", color: "#94a3b8" },
  { id: "in_progress", label: "In Progress", color: "#3b82f6" },
  { id: "pending", label: "Pending", color: "#eab308" },
  { id: "blocked", label: "Blocked", color: "#ef4444" },
  { id: "done", label: "Done", color: "#22c55e" },
  { id: "cancelled", label: "Cancelled", color: "#64748b" },
];

export const PRIORITY_OPTIONS_DEFAULT = [
  { id: "low", label: "Low", color: "#94a3b8" },
  { id: "medium", label: "Medium", color: "#3b82f6" },
  { id: "high", label: "High", color: "#f97316" },
  { id: "critical", label: "Critical", color: "#ef4444" },
];

// Fixed vocabularies for the Eisenhower Matrix's two reusable fields. Unlike
// single_select, the option ids are load-bearing (the matrix quadrant logic
// switches on them), so the field editor doesn't expose an options UI for
// these two types - the options are seeded once when the field is created
// and never change.
export const IMPORTANCE_OPTIONS = [
  { id: "important", label: "Important", color: "#ef4444" },
  { id: "not_important", label: "Not Important", color: "#94a3b8" },
];
export const URGENCY_OPTIONS = [
  { id: "urgent", label: "Urgent", color: "#f97316" },
  { id: "not_urgent", label: "Not Urgent", color: "#94a3b8" },
];

// `SELECT_SINGLE_TYPES` below (single_select/status/importance/urgency) is
// the type list to use anywhere a field renders/filters/sorts as "pick one
// option from field.config.options" - importance/urgency just have a fixed,
// pre-seeded vocabulary instead of user-defined ones.

export interface SelectOption {
  id: string;
  label: string;
  color: string;
}

export interface FieldConfig {
  options?: SelectOption[]; // single_select, multi_select, status
  precision?: number; // number, currency, percent
  currencySymbol?: string;
  expression?: string; // formula
  linkTableId?: string; // link
  lookupFieldId?: string; // lookup / rollup source field
  lookupLinkFieldId?: string; // which link field to traverse
  rollupFn?: "sum" | "avg" | "min" | "max" | "count";
  maxRating?: number;
  startNumber?: number;
  role?: string; // explicit conceptual role (see field-roles.ts), set from the field editor
}

export function parseFieldConfig(raw: string | null | undefined): FieldConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FieldConfig;
  } catch {
    return {};
  }
}

export interface AttachmentValue {
  id: string;
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Safe field-type migration
//
// Changing a field's type must never destroy the underlying cell data. The
// groups below drive two things: (1) which parts of a field's `config` are
// worth carrying over when the user switches type in the editor dialog
// (e.g. keep colored options when going single_select -> multi_select), and
// (2) how an existing record's raw value is *coerced* when a conversion is
// well-understood (number <-> text, select <-> text, single <-> multi...).
// Any pair not covered below is left completely untouched - the value stays
// in `Record.data` exactly as it was, even if the new type can't render it
// meaningfully yet, so nothing is ever silently deleted.
// ---------------------------------------------------------------------------

export const TEXT_LIKE_TYPES = ["text", "long_text", "email", "phone", "url"];
export const NUMERIC_LIKE_TYPES = ["number", "integer", "percent", "currency", "progress", "rating", "duration"];
export const SELECT_SINGLE_TYPES = ["single_select", "status", "importance", "urgency"];
export const SELECT_MULTI_TYPES = ["multi_select"];
export const DATE_LIKE_TYPES = ["date", "datetime"];

export function carryOverConfig(oldType: string, newType: string, oldConfig: FieldConfig): FieldConfig {
  // Importance/Urgency have a fixed, load-bearing vocabulary - never let an
  // arbitrary options list from the old type overwrite it.
  if (newType === "importance") return { options: IMPORTANCE_OPTIONS };
  if (newType === "urgency") return { options: URGENCY_OPTIONS };

  const bothSelectLike = [...SELECT_SINGLE_TYPES, ...SELECT_MULTI_TYPES];
  if (bothSelectLike.includes(oldType) && bothSelectLike.includes(newType)) {
    return { options: oldConfig.options };
  }
  if (NUMERIC_LIKE_TYPES.includes(oldType) && NUMERIC_LIKE_TYPES.includes(newType)) {
    return {
      currencySymbol: oldConfig.currencySymbol,
      precision: oldConfig.precision,
      maxRating: oldConfig.maxRating,
    };
  }
  return {};
}

export function migrateFieldValue(oldType: string, newType: string, value: unknown, oldConfig: FieldConfig): unknown {
  if (oldType === newType || value === null || value === undefined) return value;

  const isOldText = TEXT_LIKE_TYPES.includes(oldType);
  const isNewText = TEXT_LIKE_TYPES.includes(newType);
  const isOldNum = NUMERIC_LIKE_TYPES.includes(oldType);
  const isNewNum = NUMERIC_LIKE_TYPES.includes(newType);
  const isOldSingle = SELECT_SINGLE_TYPES.includes(oldType);
  const isOldMulti = SELECT_MULTI_TYPES.includes(oldType);
  const isNewSingle = SELECT_SINGLE_TYPES.includes(newType);
  const isNewMulti = SELECT_MULTI_TYPES.includes(newType);
  const isOldDate = DATE_LIKE_TYPES.includes(oldType);
  const isNewDate = DATE_LIKE_TYPES.includes(newType);

  if (isOldDate && isNewDate) return value;
  if (isOldDate && isNewText) return String(value);

  if (isOldNum && isNewNum) {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    if (Number.isNaN(n)) return null;
    if (newType === "progress") return Math.max(0, Math.min(100, Math.round(n)));
    if (newType === "rating") return Math.max(0, Math.min(10, Math.round(n)));
    return n;
  }
  if (isOldNum && isNewText) return String(value);
  if (isOldText && isNewNum) {
    const n = parseFloat(String(value));
    return Number.isNaN(n) ? null : n;
  }

  if (oldType === "checkbox" && isNewText) return value ? "Yes" : "No";
  if (isOldText && newType === "checkbox") return ["yes", "true", "1"].includes(String(value).trim().toLowerCase());
  if (oldType === "checkbox" && isNewNum) return value ? 1 : 0;
  if (isOldNum && newType === "checkbox") return Number(value) > 0;

  if ((isOldSingle || isOldMulti) && (isNewSingle || isNewMulti)) {
    const ids = Array.isArray(value) ? value : [value];
    if (isNewMulti) return ids;
    return ids[0] ?? null;
  }
  if ((isOldSingle || isOldMulti) && isNewText) {
    const ids = Array.isArray(value) ? value : [value];
    const labels = ids.map((id) => oldConfig.options?.find((o) => o.id === id)?.label ?? String(id));
    return labels.join(", ");
  }

  if (oldType === "person" && newType === "people") return value ? [value] : [];
  if (oldType === "people" && newType === "person") return Array.isArray(value) ? value[0] ?? null : value;

  if (oldType !== "attachment" && newType === "attachment" && !Array.isArray(value)) {
    const str = String(value);
    return str ? [{ id: `${Date.now()}`, name: str, url: str }] : [];
  }
  if (oldType === "attachment" && isNewText && Array.isArray(value)) {
    return (value as AttachmentValue[]).map((a) => a.name).join(", ");
  }

  // No well-understood conversion: preserve the raw value untouched.
  return value;
}
