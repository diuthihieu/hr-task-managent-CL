// Cursor paging for lists that grow with time (BUG-11). The cursor is the id of the last row
// returned; Prisma's native cursor compares against that row's own columns in the database, so
// timestamps keep their microseconds (a JavaScript Date has only milliseconds, and a cursor built
// from it repeats or skips rows that share a millisecond).

import { z } from "zod";
import { badRequest } from "./http-errors";
import { uuid } from "./validation";

export const DEFAULT_PAGE = 100;
export const MAX_PAGE = 500;

const pageSchema = z.object({
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
});

export type PageRequest = { cursor?: string; limit: number };
export type Page<T> = { items: T[]; nextCursor: string | null };

/** `?cursor=<id>&limit=<1..500>` (default 100); 400 when malformed. */
export function readPage(req: Request): PageRequest {
  const q = new URL(req.url).searchParams;
  const parsed = pageSchema.safeParse({ cursor: q.get("cursor") ?? undefined, limit: q.get("limit") ?? undefined });
  if (!parsed.success) throw badRequest(`Invalid paging: ${parsed.error.issues[0]?.message ?? "bad cursor or limit"}`);
  return parsed.data;
}

/** Prisma args: one extra row tells whether another page follows. Use with an orderBy ending in `id`. */
export function pageArgs(p: PageRequest): { cursor?: { id: string }; skip?: number; take: number } {
  return p.cursor ? { cursor: { id: p.cursor }, skip: 1, take: p.limit + 1 } : { take: p.limit + 1 };
}

/** The cursor row must still be in this list, or the client has to start over. */
export function assertCursor(found: unknown) {
  if (!found) throw badRequest("This list changed; reload it from the start (cursor not found)");
}

export function toPage<T extends { id: string }>(rows: T[], p: PageRequest): Page<T> {
  const items = rows.slice(0, p.limit);
  return { items, nextCursor: rows.length > p.limit ? items[items.length - 1].id : null };
}
