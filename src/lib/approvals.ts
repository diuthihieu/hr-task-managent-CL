/** Fields returned for a task approval request. */
export const APPROVAL_SELECT = {
  id: true,
  status: true,
  note: true,
  decisionNote: true,
  completeOnApprove: true,
  createdAt: true,
  decidedAt: true,
  requestedBy: { select: { id: true, name: true, avatarColor: true } },
  approver: { select: { id: true, name: true, avatarColor: true } },
} as const;
