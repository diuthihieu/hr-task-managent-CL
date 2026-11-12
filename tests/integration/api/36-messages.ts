import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, viewer, s, prisma } from "./context";
import { Client } from "../client";

// Messages: contacts only among people sharing a workspace; 1-1 chat needs an accepted contact and no
// block; members read only while they belong; tagged tasks are shown per reader's permissions; edits
// and recalls only by the author within an hour.
test("messages: contacts, direct chat, task tags, recall window, blocks, groups, bot inbox", async () => {
  const adminId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@integration.test" } })).id;
  // A stranger: an account sharing no workspace with anyone here.
  const outsider = new Client();
  const reg = await outsider.post<{ id: string }>("/api/register", { email: "stranger-chat@integration.test", password: "Stranger123", name: "Sam Stranger" });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const strangerId = reg.body.id;
  await prisma.user.update({ where: { id: strangerId }, data: { emailVerifiedAt: new Date() } });
  assert.ok(await outsider.login("stranger-chat@integration.test", "Stranger123"));

  // --- contacts
  assert.equal((await outsider.post("/api/messages/contacts", { userId: adminId })).status, 404, "no shared workspace: can't even be found");
  const search = await viewer.get<{ id: string; status: string }[]>("/api/messages/people?q=");
  assert.equal(search.status, 200);
  assert.ok(search.body.some((p) => p.id === adminId) && !search.body.some((p) => p.id === strangerId), "search lists only people sharing a workspace");

  const req = await admin.post<{ status: string }>("/api/messages/contacts", { userId: s.viewerId });
  assert.equal(req.body.status, "outgoing");
  assert.equal((await admin.post("/api/messages", { kind: "direct", userId: s.viewerId })).status, 403, "no chat before the request is accepted");
  type Lists = { friends: { id: string }[]; incoming: { id: string }[] };
  assert.ok((await viewer.get<Lists>("/api/messages/contacts")).body.incoming.some((p) => p.id === adminId));
  assert.equal((await admin.patch(`/api/messages/contacts/${s.viewerId}`, { action: "accept" })).status, 400, "the requester can't accept their own request");
  assert.equal((await viewer.patch(`/api/messages/contacts/${adminId}`, { action: "accept" })).status, 200);
  assert.ok((await admin.get<Lists>("/api/messages/contacts")).body.friends.some((p) => p.id === s.viewerId));

  // --- direct chat with task tags
  const open = await admin.post<{ id: string }>("/api/messages", { kind: "direct", userId: s.viewerId });
  assert.equal(open.status, 201);
  const conv = open.body.id;
  assert.equal((await viewer.post<{ id: string }>("/api/messages", { kind: "direct", userId: adminId })).body.id, conv, "one 1-1 conversation per pair");
  assert.equal((await outsider.get(`/api/messages/${conv}`)).status, 404, "not a member: not found");

  const visibleP = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Chat visible" })).body.id;
  const hiddenP = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Chat hidden" })).body.id;
  await prisma.projectHiddenMember.create({ data: { projectId: hiddenP, userId: s.viewerId } });
  const tv = (await admin.post<{ id: string }>(`/api/projects/${visibleP}/tasks`, { data: { sys_title: "Chat open task" } })).body.id;
  const th = (await admin.post<{ id: string }>(`/api/projects/${hiddenP}/tasks`, { data: { sys_title: "Chat secret task" } })).body.id;

  const sent = await admin.post<{ id: string }>(`/api/messages/${conv}`, { body: "Please look at these", taskIds: [tv, th] });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal((await viewer.post(`/api/messages/${conv}`, { body: "tagging what I can't see", taskIds: [th] })).status, 400, "only tasks the sender can see can be tagged");

  type Msg = { id: string; body: string; recalled: boolean; edited: boolean; tasks: ({ id: string; title: string } | { id: string; hidden: true })[] };
  type Page = { messages: Msg[] };
  const unread = await viewer.get<{ count: number }>("/api/messages/unread");
  assert.equal(unread.body.count, 1);
  const seen = (await viewer.get<Page>(`/api/messages/${conv}`)).body.messages.find((m) => m.id === sent.body.id)!;
  assert.equal(seen.body, "Please look at these");
  const tags = Object.fromEntries(seen.tasks.map((x) => [x.id, x]));
  assert.equal((tags[tv] as { title: string }).title, "Chat open task");
  assert.deepEqual(tags[th], { id: th, hidden: true }, "a task hidden from the reader shows no title");
  assert.ok(!JSON.stringify(seen).includes("Chat secret task"));
  const adminView = (await admin.get<Page>(`/api/messages/${conv}`)).body.messages.find((m) => m.id === sent.body.id)!;
  assert.ok(JSON.stringify(adminView).includes("Chat secret task"), "the same message shows the title to someone who can see it");
  const viewerTasks = await viewer.get<{ id: string }[]>("/api/messages/tasks?q=Chat");
  assert.ok(viewerTasks.body.some((x) => x.id === tv) && !viewerTasks.body.some((x) => x.id === th), "the # picker never offers hidden tasks");
  assert.equal((await viewer.post(`/api/messages/${conv}/read`)).status, 200);
  assert.equal((await viewer.get<{ count: number }>("/api/messages/unread")).body.count, 0);
  // Reading again with nothing new changes nothing (so two open tabs never ping-pong read receipts).
  const readAt = (await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: conv, userId: s.viewerId } } })).lastReadAt;
  await viewer.post(`/api/messages/${conv}/read`);
  assert.equal((await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: conv, userId: s.viewerId } } })).lastReadAt.getTime(), readAt.getTime());
  // ?ids= re-reads given messages (an edit of one older than the latest page); others' conversations stay out.
  const one = await viewer.get<Page>(`/api/messages/${conv}?ids=${sent.body.id}`);
  assert.deepEqual(one.body.messages.map((x) => x.id), [sent.body.id]);
  assert.equal((await viewer.get(`/api/messages/${conv}?ids=not-a-uuid`)).status, 400);

  // --- edit / recall: author only, within an hour
  assert.equal((await viewer.patch(`/api/messages/items/${sent.body.id}`, { body: "hijack" })).status, 403);
  assert.equal((await viewer.del(`/api/messages/items/${sent.body.id}`)).status, 403);
  assert.equal((await admin.patch(`/api/messages/items/${sent.body.id}`, { body: "Please look at this one", taskIds: [tv] })).status, 200);
  let m = (await viewer.get<Page>(`/api/messages/${conv}`)).body.messages.find((x) => x.id === sent.body.id)!;
  assert.equal(m.body, "Please look at this one");
  assert.ok(m.edited);
  assert.equal(m.tasks.length, 1);
  assert.equal((await admin.del(`/api/messages/items/${sent.body.id}`)).status, 200);
  m = (await viewer.get<Page>(`/api/messages/${conv}`)).body.messages.find((x) => x.id === sent.body.id)!;
  assert.deepEqual([m.recalled, m.body, m.tasks.length], [true, "", 0], "recalled: text and tags gone for everyone");
  assert.equal((await prisma.chatMessage.findUniqueOrThrow({ where: { id: sent.body.id } })).body, "", "wiped in the database too");
  const old = await admin.post<{ id: string }>(`/api/messages/${conv}`, { body: "old one" });
  await prisma.chatMessage.update({ where: { id: old.body.id }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } });
  assert.equal((await admin.del(`/api/messages/items/${old.body.id}`)).status, 400, "no recall after an hour");
  assert.equal((await admin.patch(`/api/messages/items/${old.body.id}`, { body: "late edit" })).status, 400);

  // --- blocks
  assert.equal((await viewer.patch(`/api/messages/contacts/${adminId}`, { action: "block" })).status, 200);
  assert.equal((await admin.post(`/api/messages/${conv}`, { body: "hello?" })).status, 403, "blocked: can't write");
  assert.equal((await admin.post("/api/messages/contacts", { userId: s.viewerId })).status, 400, "blocked: can't send a request");
  const blockedSearch = await admin.get<{ id: string; status: string }[]>("/api/messages/people?q=");
  assert.equal(blockedSearch.body.find((p) => p.id === s.viewerId)?.status, "none", "being blocked is not revealed");
  assert.equal((await admin.patch(`/api/messages/contacts/${s.viewerId}`, { action: "unblock" })).status, 404, "only the blocker unblocks");
  assert.equal((await viewer.patch(`/api/messages/contacts/${adminId}`, { action: "unblock" })).status, 200);
  assert.equal((await admin.post(`/api/messages/${conv}`, { body: "hello?" })).status, 403, "unblocked is not friends again");

  // --- groups
  assert.equal((await admin.post("/api/messages", { kind: "group", name: "Team", memberIds: [s.viewerId, strangerId] })).status, 400, "group members must share a workspace with the creator");
  const g = await admin.post<{ id: string }>("/api/messages", { kind: "group", name: "C&B team", memberIds: [s.viewerId] });
  assert.equal(g.status, 201);
  assert.equal((await viewer.post(`/api/messages/${g.body.id}`, { body: "hi team" })).status, 201, "group members write without being contacts");
  assert.equal((await viewer.patch(`/api/messages/${g.body.id}`, { name: "Mine now" })).status, 403, "only admins change the group");
  assert.equal((await viewer.patch(`/api/messages/${g.body.id}`, { muted: true })).status, 200, "anyone mutes for themselves");
  assert.equal((await admin.patch(`/api/messages/${g.body.id}`, { remove: [s.viewerId] })).status, 200);
  await admin.post(`/api/messages/${g.body.id}`, { body: "after you left" });
  const afterLeft = await viewer.get<Page>(`/api/messages/${g.body.id}`);
  assert.equal(afterLeft.status, 200);
  assert.ok(afterLeft.body.messages.some((x) => x.body === "hi team") && !afterLeft.body.messages.some((x) => x.body === "after you left"), "a removed member keeps the past, sees nothing new");
  assert.equal((await viewer.post(`/api/messages/${g.body.id}`, { body: "still here?" })).status, 403);
  assert.ok(!(await viewer.get<{ id: string }[]>("/api/messages")).body.some((c) => c.id === g.body.id), "a group I left is no longer listed");

  // --- the Woli AI inbox
  const list = await admin.get<{ id: string; kind: string }[]>("/api/messages");
  const bot = list.body.find((c) => c.kind === "bot");
  assert.ok(bot, "every user has a Woli AI inbox");
  assert.equal((await admin.post(`/api/messages/${bot!.id}`, { body: "hi bot" })).status, 400, "people can't write in the bot inbox");
  assert.equal((await viewer.get(`/api/messages/${bot!.id}`)).status, 404, "another user's inbox is not found");

  // Realtime is off in tests (no Supabase URL): the page polls instead.
  assert.deepEqual((await viewer.get("/api/messages/realtime")).body, { enabled: false });
});
