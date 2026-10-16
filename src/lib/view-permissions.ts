export interface ViewDeletePolicyInput {
  /** The project owner (or the stand-in admin of an owner-less project). */
  isProjectManager: boolean;
  /** The caller's "Edit shared views" right in the project. */
  canManageViews: boolean;
  /** The caller's "Add views" right in the project. */
  canCreateViews: boolean;
  userId: string;
  viewCreatedById: string | null;
  isBase: boolean;
}

/**
 * Follows the project's permissions: the base view only by whoever runs the
 * project; other views by anyone allowed to edit shared views, or by their own
 * creator while they may still add views. Workspace roles alone don't decide
 * (a project owner can narrow workspace owners/admins too).
 */
export function canDeleteView(input: ViewDeletePolicyInput) {
  if (input.isBase) return input.isProjectManager;
  return input.isProjectManager || input.canManageViews || (input.viewCreatedById === input.userId && input.canCreateViews);
}
