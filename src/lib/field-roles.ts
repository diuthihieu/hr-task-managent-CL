// Resolves a table's *conceptual* fields (Status, Priority, Due Date, Owner,
// ...) to real Field rows. Every workspace's task table has its own field ids
// and names, so the OKR engine, My Work, OKR resolver and Put All Things On
// all need the same lookup. Resolution order:
//   1. an explicit `config.role` set from the field editor (always wins),
//   2. a bilingual (English + Vietnamese, accent-insensitive) name match,
//   3. a type-only fallback where the caller allows one.
// So renaming "Status" to "Trạng thái" keeps working, and an admin can pin a
// role explicitly when a name is ambiguous.

import { parseFieldConfig, SELECT_SINGLE_TYPES } from "./field-types";
import type { FieldRow } from "@/types";

export type FieldRole =
  | "status"
  | "priority"
  | "category"
  | "start_date"
  | "due_date"
  | "owner"
  | "duration"
  | "output"
  | "process";

const DATE_TYPES = ["date", "datetime"];

interface RoleSpec {
  label: string;
  types: string[];
  nameRe: RegExp;
}

// Name patterns run against `normalizeName(field.name)` (lowercase, no diacritics).
export const FIELD_ROLE_SPECS: Record<FieldRole, RoleSpec> = {
  status: { label: "Status", types: SELECT_SINGLE_TYPES, nameRe: /status|trang thai|tinh trang/ },
  priority: { label: "Priority", types: SELECT_SINGLE_TYPES, nameRe: /priorit|uu tien|muc do/ },
  category: { label: "Category", types: SELECT_SINGLE_TYPES, nameRe: /categor|danh muc|phan loai|nhom/ },
  start_date: { label: "Start date", types: DATE_TYPES, nameRe: /start|bat dau/ },
  due_date: { label: "Due date", types: DATE_TYPES, nameRe: /due|deadline|\bhan\b|ket thuc/ },
  owner: { label: "Owner / Assignee", types: ["person"], nameRe: /owner|assignee|phu trach|nguoi thuc hien|chu tri/ },
  duration: { label: "Duration (hours)", types: ["number", "integer", "duration"], nameRe: /estimat|duration|thoi luong|uoc tinh|so gio/ },
  output: { label: "Output / Deliverable", types: ["long_text"], nameRe: /output|deliverable|completion|ket qua|dau ra/ },
  process: { label: "Execution plan", types: ["long_text"], nameRe: /process|execution|step|quy trinh|ke hoach|cac buoc/ },
};

export const FIELD_ROLES = Object.keys(FIELD_ROLE_SPECS) as FieldRole[];

/** Roles a field of this type can be pinned to (drives the field editor's Role picker). */
export function rolesForType(type: string): FieldRole[] {
  return FIELD_ROLES.filter((r) => FIELD_ROLE_SPECS[r].types.includes(type));
}

/** Lowercase and strip Vietnamese diacritics so "Trạng thái" matches /trang thai/. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function explicitRole(f: FieldRow): string | undefined {
  return parseFieldConfig(f.config).role;
}

export interface FindRoleOptions {
  exclude?: (FieldRow | null | undefined)[];
  /** Fall back to the first field of a compatible type when nothing matches by role or name. */
  fallbackToType?: boolean;
}

export function findFieldByRole(fields: FieldRow[], role: FieldRole, opts: FindRoleOptions = {}): FieldRow | null {
  const spec = FIELD_ROLE_SPECS[role];
  const excluded = new Set(opts.exclude?.filter(Boolean).map((f) => f!.id));
  const candidates = fields.filter((f) => spec.types.includes(f.type) && !excluded.has(f.id));

  const pinned = candidates.find((f) => explicitRole(f) === role);
  if (pinned) return pinned;

  // A field explicitly pinned to a *different* role never matches by name.
  const unpinned = candidates.filter((f) => !explicitRole(f));
  const named = unpinned.find((f) => spec.nameRe.test(normalizeName(f.name)));
  if (named) return named;

  return opts.fallbackToType ? unpinned[0] ?? null : null;
}

// Labels treated as "finished" when a task's progress is derived from its Status.
const DONE_LABELS = new Set(["done", "completed", "complete", "closed", "resolved", "hoan thanh", "da hoan thanh", "xong", "da xong", "dong", "da dong"]);

export function isDoneLabel(label: string): boolean {
  return DONE_LABELS.has(normalizeName(label));
}
