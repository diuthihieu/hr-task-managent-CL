export interface ViewDeletePolicyInput {
  workspaceRole: string;
  userId: string;
  projectCreatedById: string | null;
  viewCreatedById: string | null;
  isBase: boolean;
}

/**
 * The base/default view is deliberately stricter: only the workspace owner or
 * project creator may delete it. Other views may also be deleted by workspace
 * admins or their own creator.
 */
export function canDeleteView(input: ViewDeletePolicyInput) {
  const ownsWorkspace = input.workspaceRole === "owner";
  const createdProject = input.projectCreatedById === input.userId;
  if (input.isBase) return ownsWorkspace || createdProject;
  return ownsWorkspace || input.workspaceRole === "admin" || createdProject || input.viewCreatedById === input.userId;
}
