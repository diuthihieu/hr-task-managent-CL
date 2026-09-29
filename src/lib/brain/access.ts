import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma } from "../prisma";
import { hiddenProjectIds, visibleProjectWhere, visibleWikiWhere, type Scope, type SessionUser } from "../authz";
import { visiblePageWhere } from "../wiki-sources";

// One place for "what may this user see" across the Second Brain features
// (backlinks, related content, health, resurfacing, journal, Ask My Brain).
// Same rules as the rest of the app: hidden projects, restricted wikis and
// pages that quote a hidden project.

export interface BrainAccess {
  workspaceId: string;
  userId: string;
  hidden: Set<string>;
  project: Prisma.ProjectWhereInput;
  page: Prisma.WikiPageWhereInput;
  task: Prisma.TaskWhereInput;
  objective: Prisma.ObjectiveWhereInput;
  decision: Prisma.DecisionWhereInput;
}

export async function brainAccess(user: SessionUser, workspaceId: string, role: WorkspaceRole): Promise<BrainAccess> {
  const hidden = await hiddenProjectIds(user);
  const liveProject: Prisma.ProjectWhereInput = { deletedAt: null, ...visibleProjectWhere(user) };
  const pageRule: Prisma.WikiPageWhereInput = { deletedAt: null, wiki: visibleWikiWhere(user, role), ...visiblePageWhere(hidden) };
  return {
    workspaceId,
    userId: user.id,
    hidden,
    project: { workspaceId, ...liveProject },
    page: { workspaceId, ...pageRule },
    task: { workspaceId, deletedAt: null, project: liveProject },
    objective: { workspaceId, deletedAt: null, OR: [{ projectId: null }, { project: liveProject }] },
    // A decision is visible when everything it points to is.
    decision: {
      workspaceId,
      deletedAt: null,
      AND: [
        { OR: [{ projectId: null }, { project: liveProject }] },
        { OR: [{ wikiPageId: null }, { wikiPage: pageRule }] },
        { OR: [{ taskId: null }, { task: { deletedAt: null, project: liveProject } }] },
        { OR: [{ objectiveId: null }, { objective: { deletedAt: null, OR: [{ projectId: null }, { project: liveProject }] } }] },
      ],
    },
  };
}

/** Scope of a decision for requireWorkspaceRole: hidden when its project, task's project or page is. */
export async function workspaceOfDecision(decisionId: string): Promise<Scope | null> {
  const d = await prisma.decision.findFirst({
    where: { id: decisionId, deletedAt: null },
    select: {
      workspaceId: true,
      projectId: true,
      task: { select: { projectId: true, deletedAt: true } },
      objective: { select: { projectId: true } },
      wikiPage: { select: { wikiId: true, sourceProjectIds: true, deletedAt: true } },
    },
  });
  if (!d) return null;
  const extra = [d.task?.projectId, d.objective?.projectId].filter((x): x is string => !!x);
  return {
    workspaceId: d.workspaceId,
    projectId: d.projectId ?? extra[0] ?? null,
    wikiId: d.wikiPage && !d.wikiPage.deletedAt ? d.wikiPage.wikiId : null,
    sourceProjectIds: [...(d.wikiPage?.sourceProjectIds ?? []), ...extra],
  };
}

export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
