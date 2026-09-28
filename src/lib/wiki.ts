import type { WikiPage } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { badRequest } from "./http-errors";
import type { WikiRoleName } from "./authz";

export const WIKI_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  icon: true,
  color: true,
  access: true,
  defaultRole: true,
  createdById: true,
  updatedAt: true,
  _count: { select: { pages: { where: { deletedAt: null } }, members: true } },
} as const;

export interface WikiRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  access: "workspace" | "restricted";
  defaultRole: "viewer" | "editor";
  pageCount: number;
  memberCount: number;
  updatedAt: string;
  myRole: WikiRoleName | null;
}

export function serializeWiki(
  w: { id: string; workspaceId: string; name: string; description: string | null; icon: string | null; color: string; access: string; defaultRole: string; updatedAt: Date; _count: { pages: number; members: number } },
  myRole: WikiRoleName | null | undefined
): WikiRow {
  return {
    id: w.id,
    workspaceId: w.workspaceId,
    name: w.name,
    description: w.description,
    icon: w.icon,
    color: w.color,
    access: w.access as WikiRow["access"],
    defaultRole: w.defaultRole as WikiRow["defaultRole"],
    pageCount: w._count.pages,
    memberCount: w._count.members,
    updatedAt: w.updatedAt.toISOString(),
    myRole: myRole ?? null,
  };
}

export interface WikiPageSummary {
  id: string;
  wikiId: string;
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
    wikiId: p.wikiId,
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
