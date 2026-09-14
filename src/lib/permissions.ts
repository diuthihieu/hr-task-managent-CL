import { prisma } from "./prisma";

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  contributor: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: string | undefined, min: string): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[min] ?? 99);
}

export async function getMembership(userId: string, workspaceId: string) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

export async function getWorkspaceIdForBase(baseId: string) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { workspaceId: true } });
  return base?.workspaceId ?? null;
}

export async function getWorkspaceIdForTable(tableId: string) {
  const table = await prisma.tableDef.findUnique({
    where: { id: tableId },
    select: { base: { select: { workspaceId: true } } },
  });
  return table?.base.workspaceId ?? null;
}

export async function getWorkspaceIdForRecord(recordId: string) {
  const record = await prisma.record.findUnique({
    where: { id: recordId },
    select: { table: { select: { base: { select: { workspaceId: true } } } } },
  });
  return record?.table.base.workspaceId ?? null;
}

export async function getWorkspaceIdForDashboard(dashboardId: string) {
  const dashboard = await prisma.dashboard.findUnique({
    where: { id: dashboardId },
    select: { base: { select: { workspaceId: true } } },
  });
  return dashboard?.base.workspaceId ?? null;
}

export async function getWorkspaceIdForDashboardBlock(blockId: string) {
  const block = await prisma.dashboardBlock.findUnique({
    where: { id: blockId },
    select: { dashboard: { select: { base: { select: { workspaceId: true } } } } },
  });
  return block?.dashboard.base.workspaceId ?? null;
}

export async function getWorkspaceIdForObjective(objectiveId: string) {
  const objective = await prisma.objective.findUnique({ where: { id: objectiveId }, select: { workspaceId: true } });
  return objective?.workspaceId ?? null;
}

export async function getWorkspaceIdForKeyResult(keyResultId: string) {
  const kr = await prisma.keyResult.findUnique({
    where: { id: keyResultId },
    select: { objective: { select: { workspaceId: true } } },
  });
  return kr?.objective.workspaceId ?? null;
}

export async function getWorkspaceIdForTeam(teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { workspaceId: true } });
  return team?.workspaceId ?? null;
}

export async function getWorkspaceIdForThought(thoughtId: string) {
  const thought = await prisma.capturedThought.findUnique({ where: { id: thoughtId }, select: { workspaceId: true } });
  return thought?.workspaceId ?? null;
}
