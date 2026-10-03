export interface ProjectVisibilityMember {
  id: string;
  lockedReason: string | null;
}

/** Select or clear every member that the API permits hiding. */
export function setAllHideableMembers(
  current: ReadonlySet<string>,
  members: ProjectVisibilityMember[],
  hide: boolean
) {
  const next = new Set(current);
  for (const member of members) {
    if (member.lockedReason) {
      next.delete(member.id);
    } else if (hide) {
      next.add(member.id);
    } else {
      next.delete(member.id);
    }
  }
  return next;
}
