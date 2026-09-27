import type { WikiPage } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { badRequest } from "./http-errors";

export interface WikiPageSummary {
  id: string;
  projectId: string;
  parentPageId: string | null;
  title: string;
  icon: string | null;
  order: number;
  updatedAt: string;
  updatedBy: string | null;
}

export function serializeWikiSummary(p: WikiPage & { updatedBy?: { name: string } | null }): WikiPageSummary {
  return {
    id: p.id,
    projectId: p.projectId,
    parentPageId: p.parentPageId,
    title: p.title,
    icon: p.icon,
    order: p.sortOrder,
    updatedAt: p.updatedAt.toISOString(),
    updatedBy: p.updatedBy?.name ?? null,
  };
}

/** A page cannot be moved under itself or one of its descendants. */
export async function assertNoWikiCycle(tx: Prisma.TransactionClient, pageId: string, newParentId: string) {
  let cursor: string | null = newParentId;
  for (let depth = 0; cursor && depth < 100; depth++) {
    if (cursor === pageId) throw badRequest("A page cannot be moved inside itself");
    const row: { parentPageId: string | null } | null = await tx.wikiPage.findUnique({ where: { id: cursor }, select: { parentPageId: true } });
    cursor = row?.parentPageId ?? null;
  }
}

/** Ids of the page and all its descendants (for soft-deleting a subtree). */
export async function wikiSubtreeIds(tx: Prisma.TransactionClient, rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await tx.wikiPage.findMany({ where: { parentPageId: { in: frontier }, deletedAt: null }, select: { id: true } });
    frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}
