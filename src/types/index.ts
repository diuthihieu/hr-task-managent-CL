/**
 * A column as the view components see it. Built server-side by
 * `src/lib/task-grid.ts` from either a task's own typed column ("system"
 * fields, ids prefixed `sys_`) or a project custom field (uuid id).
 */
export interface FieldRow {
  id: string;
  projectId: string;
  name: string;
  type: string;
  config: string | null; // JSON: select options, precision, formula expression...
  order: number;
  isPrimary: boolean;
  visible: boolean;
  description: string | null;
  defaultValue: string | null;
  /** True for task columns (title, status, dates...): cannot be deleted or retyped. */
  system?: boolean;
  /** True when the value is computed/managed by the server (created time...). */
  readOnly?: boolean;
  isRequired?: boolean;
}

/** One task as the view components see it: `data` is keyed by FieldRow.id. */
export interface RecordRow {
  id: string;
  projectId: string;
  data: Record<string, unknown>;
  order: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ViewRow {
  id: string;
  projectId: string;
  name: string;
  type: string;
  config: string;
  order: number;
  isDefault: boolean;
  isPublic?: boolean;
}

export type WorkspaceRoleName = "owner" | "admin" | "editor" | "contributor" | "viewer";

export interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  ownerId: string | null;
  startDate: string | null;
  endDate: string | null;
  order: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceMemberRow {
  id: string;
  userId: string;
  role: WorkspaceRoleName;
  user: { id: string; name: string; email: string; avatarColor: string; isActive?: boolean };
}

export interface StatusRow {
  id: string;
  name: string;
  color: string;
  category: "todo" | "in_progress" | "done" | "cancelled";
  order: number;
  isDefault: boolean;
  taskCount?: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  order: number;
  taskCount?: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  systemRole: "ADMIN" | "MEMBER";
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  workspaces: { id: string; name: string; role: WorkspaceRoleName }[];
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
  downloadUrl: string;
}

export interface ActivityRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  actor: { id: string; name: string; avatarColor: string } | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// OKRs
// ---------------------------------------------------------------------------

export type OkrCycleType = "quarter" | "year" | "custom";
export type ObjectiveStatus = "not_started" | "on_track" | "at_risk" | "off_track" | "completed";
export type OkrPriority = "low" | "medium" | "high" | "critical";
export type KeyResultType = "task_based" | "numeric" | "percentage" | "manual";

export interface TeamRow {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
}

export interface OkrUserLite {
  id: string;
  name: string;
  avatarColor: string;
}

/** A task record contributing to a Key Result, with its own resolved progress already computed server-side. */
export interface KeyResultTaskRow {
  id: string;
  keyResultId: string;
  projectId: string;
  projectName: string;
  taskId: string;
  weight: number;
  title: string;
  status: string | null;
  progress: number; // 0-100, resolved from the record's own Progress/Status field
  dueDate: string | null;
  assignee: OkrUserLite | null;
}

export interface KeyResultRow {
  id: string;
  objectiveId: string;
  title: string;
  owner: OkrUserLite | null;
  type: KeyResultType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  weight: number;
  manualProgress: number | null;
  status: string;
  order: number;
  progress: number; // 0-100, always derived
  tasks: KeyResultTaskRow[];
}

// ---------------------------------------------------------------------------
// Put All Things On
// ---------------------------------------------------------------------------

export interface CaptureCategoryOption {
  id: string;
  label: string;
  color: string;
}

/** A project that captured thoughts can be converted into tasks of. */
export interface CaptureTargetRow {
  projectId: string;
  projectName: string;
  categoryOptions: CaptureCategoryOption[];
  statusOptions: CaptureCategoryOption[];
  priorityOptions: CaptureCategoryOption[];
}

export interface CapturedThoughtRow {
  id: string;
  taskName: string;
  projectId: string;
  projectName: string;
  categoryId: string | null;
  categoryLabel: string | null;
  categoryColor: string | null;
  estimatedDurationMinutes: number | null;
  plannedAt: string | null;
  status: string;
  createdAt: string;
}

export interface ObjectiveRow {
  id: string;
  workspaceId: string;
  teamId: string | null;
  team: TeamRow | null;
  title: string;
  description: string | null;
  owner: OkrUserLite | null;
  cycleType: OkrCycleType;
  cycleLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ObjectiveStatus;
  confidence: number;
  priority: OkrPriority;
  contributors: OkrUserLite[];
  createdAt: string;
  updatedAt: string;
  keyResults: KeyResultRow[];
  progress: number; // 0-100, weighted average of key results
}

export interface MyTaskRow {
  projectId: string;
  projectName: string;
  taskId: string;
  title: string;
  status: string | null;
  statusCategory: string;
  priority: string | null;
  progress: number;
  dueDate: string | null;
  importance: "important" | "not_important" | null;
  urgency: "urgent" | "not_urgent" | null;
  objectiveId: string | null;
  keyResultId: string | null;
  contributesToOkr: boolean;
}
