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
