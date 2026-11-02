import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, admin, s } from "./context";

// BUG-11: lists that grow with time are paged (default 100, max 500). The cursor is a row id and
// is compared in the database (created_at keeps microseconds; a JavaScript Date only milliseconds),
// so rows sharing a millisecond are neither repeated nor skipped.
type Page<T> = { items: T[]; nextCursor: string | null };
type C = { id: string; parentCommentId: string | null; replyCount?: number };

// Fixed base, rows 100 microseconds apart: ten rows share each millisecond.
const at = (n: number) => `TIMESTAMPTZ '2026-01-01 00:00:00+00' + ${n * 100} * INTERVAL '1 microsecond'`;

test("task comments: 120 top-level comments come in pages of 100 + 20, newest page first, nothing lost", async () => {
  const task = (await admin.post<{ id: string }>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Paged comments" } })).body.id;
  for (let n = 0; n < 120; n++) {
    await prisma.$executeRawUnsafe(`INSERT INTO comments (task_id, author_id, body, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3, ${at(n)}, ${at(n)})`, task, s.contributorId, `c${n}`);
  }
  const first = await admin.get<Page<C>>(`/api/tasks/${task}/comments`);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 100);
  assert.ok(first.body.nextCursor, "more to load");
  const second = await admin.get<Page<C>>(`/api/tasks/${task}/comments?cursor=${first.body.nextCursor}`);
  assert.equal(second.body.items.length, 20);
  assert.equal(second.body.nextCursor, null);
  const ids = [...first.body.items, ...second.body.items].map((c) => c.id);
  assert.equal(new Set(ids).size, 120, "no repeats, none missing");
  const bodies = await prisma.comment.findMany({ where: { id: { in: second.body.items.map((c) => c.id) } }, select: { body: true } });
  assert.deepEqual(bodies.map((b) => Number(b.body.slice(1))).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i), "the older page holds the 20 oldest");

  // Replies travel with their top-level comment (at most 100 each, with the total).
  const root = first.body.items[first.body.items.length - 1];
  for (let n = 0; n < 102; n++) {
    await prisma.$executeRawUnsafe(`INSERT INTO comments (task_id, author_id, body, parent_comment_id, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, ${at(1000 + n)}, ${at(1000 + n)})`, task, s.contributorId, `r${n}`, root.id);
  }
  const again = await admin.get<Page<C>>(`/api/tasks/${task}/comments?limit=5`);
  assert.equal(again.body.items.filter((c) => !c.parentCommentId).length, 5);
  assert.equal(again.body.items.filter((c) => c.parentCommentId === root.id).length, 100, "100 replies on the same page");
  assert.equal(again.body.items.find((c) => c.id === root.id)?.replyCount, 102);

  assert.equal((await admin.get(`/api/tasks/${task}/comments?limit=501`)).status, 400, "max 500");
  assert.equal((await admin.get(`/api/tasks/${task}/comments?cursor=not-an-id`)).status, 400);
  assert.equal((await admin.get(`/api/tasks/${task}/comments?cursor=${root.id.replace(/.$/, root.id.endsWith("0") ? "1" : "0")}`)).status, 400, "a cursor that isn't a comment of this task");
});

test("task history and attachments: newest first, paged by id, tie on created_at broken by id", async () => {
  const task = (await admin.post<{ id: string }>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Paged history" } })).body.id;
  for (let n = 0; n < 130; n++) {
    await prisma.$executeRawUnsafe(`INSERT INTO activity_logs (workspace_id, actor_id, entity_type, entity_id, action, summary, created_at) VALUES ($1::uuid, $2::uuid, 'task', $3::uuid, 'updated', $4, ${at(Math.floor(n / 3))})`, s.ws, s.contributorId, task, `h${n}`);
  }
  const first = await admin.get<Page<{ id: string }>>(`/api/tasks/${task}/activity`);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 100);
  const rest = await admin.get<Page<{ id: string }>>(`/api/tasks/${task}/activity?cursor=${first.body.nextCursor}`);
  assert.equal(rest.body.nextCursor, null);
  const all = [...first.body.items, ...rest.body.items].map((r) => r.id);
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, await prisma.activityLog.count({ where: { entityType: "task", entityId: task } }), "every history row, incl. 'created'");

  // Rows written directly (no Blob store here), seconds apart, as uploads would be.
  for (let n = 0; n < 3; n++) {
    await prisma.attachment.create({ data: { workspaceId: s.ws, taskId: task, fileName: `f${n}.png`, contentType: "image/png", sizeBytes: 16, storageKey: `it/${task}/f${n}.png`, url: `https://blob.invalid/f${n}.png`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)) } });
  }
  const p1 = await admin.get<Page<{ id: string; fileName: string }>>(`/api/tasks/${task}/attachments?limit=2`);
  assert.deepEqual(p1.body.items.map((a) => a.fileName), ["f2.png", "f1.png"], "newest first: the upload flow finds the new file on page one");
  const p2 = await admin.get<Page<{ id: string; fileName: string }>>(`/api/tasks/${task}/attachments?limit=2&cursor=${p1.body.nextCursor}`);
  assert.deepEqual(p2.body.items.map((a) => a.fileName), ["f0.png"]);
  assert.equal(p2.body.nextCursor, null);
});

test("wiki comments: paged by top-level comment; replies of a deleted comment stay visible (product decision)", async () => {
  const page = (await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Paged discussion" })).body.id;
  const ws = (await prisma.wikiPage.findUniqueOrThrow({ where: { id: page }, select: { workspaceId: true } })).workspaceId;
  for (let n = 0; n < 105; n++) {
    await prisma.$executeRawUnsafe(`INSERT INTO wiki_comments (workspace_id, wiki_page_id, author_id, body, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, ${at(n)}, ${at(n)})`, ws, page, s.contributorId, `w${n}`);
  }
  const root = await admin.post<{ id: string }>(`/api/wiki/${page}/comments`, { body: "Root to delete" });
  const reply = await admin.post<{ id: string }>(`/api/wiki/${page}/comments`, { body: "Reply that stays", parentCommentId: root.body.id });
  assert.equal(reply.status, 201);
  assert.equal((await admin.del(`/api/wiki-comments/${root.body.id}`)).status, 204);

  const first = await admin.get<Page<C>>(`/api/wiki/${page}/comments`);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 100);
  assert.ok(first.body.items.some((c) => c.id === reply.body.id), "the orphaned reply is listed as a top-level comment");
  const second = await admin.get<Page<C>>(`/api/wiki/${page}/comments?cursor=${first.body.nextCursor}`);
  assert.equal(second.body.nextCursor, null);
  const ids = [...first.body.items, ...second.body.items].map((c) => c.id);
  assert.equal(new Set(ids).size, 106, "105 + the orphaned reply, the deleted root gone");
  assert.ok(!ids.includes(root.body.id));
});
