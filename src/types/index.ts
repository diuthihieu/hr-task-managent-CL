export interface FieldRow {
  id: string;
  tableId: string;
  name: string;
  type: string;
  config: string | null;
  order: number;
  isPrimary: boolean;
  visible: boolean;
  description: string | null;
  defaultValue: string | null;
}

export interface RecordRow {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  order: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ViewRow {
  id: string;
  tableId: string;
  name: string;
  type: string;
  config: string;
  order: number;
  isDefault: boolean;
  isPublic?: boolean;
}

export interface TableRow {
  id: string;
  baseId: string;
  name: string;
  icon: string;
  description: string | null;
  order: number;
}

export interface BaseRow {
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  color: string;
  description: string | null;
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
  role: string;
  user: { id: string; name: string; email: string; avatarColor: string };
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
  tableId: string;
  tableName: string;
  baseId: string;
  recordId: string;
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

/** A table capable of receiving converted thoughts - has at least a Category-like field. */
export interface CaptureTargetRow {
  tableId: string;
  tableName: string;
  baseId: string;
  baseName: string;
  categoryFieldId: string;
  categoryOptions: CaptureCategoryOption[];
  statusOptions: CaptureCategoryOption[];
  priorityOptions: CaptureCategoryOption[];
}

export interface CapturedThoughtRow {
  id: string;
  taskName: string;
  tableId: string;
  tableName: string;
  baseId: string;
  categoryOptionId: string | null;
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
