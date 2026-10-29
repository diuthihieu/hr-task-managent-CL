import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { ADMIN_EMAIL, BASE, prisma, admin, contributor, viewer, outsider, s, lastModelRequest } from "./context";

test("recognition: points from real activity, leaderboards, supporters, visibility and delegation", async () => {
  type Board = { rows: { rank: number; user: { id: string }; value: number; detail?: Record<string, number> }[]; me: { rank: number } | null; total: number };
  // Settings exist with defaults; points are materialized from what already happened.
  const o = await contributor.get<{ points: { earned: number; balance: number }; canManage: boolean; canSeeOthersPoints: boolean }>(`/api/workspaces/${s.ws}/recognition`);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.ok(o.body.points.earned > 0, "earlier completed tasks / comments earned points");
  assert.equal(o.body.canManage, false);
  const ev = await prisma.pointEvent.findMany({ where: { workspaceId: s.ws, userId: s.contributorId, action: "task_completed" } });
  assert.ok(ev.some((e) => e.sourceId === s.brainTask && e.points === 10), "task completed = 10 pts (default rule)");
  const before = await prisma.pointEvent.count({ where: { workspaceId: s.ws } });
  await contributor.get(`/api/workspaces/${s.ws}/recognition`);
  assert.equal(await prisma.pointEvent.count({ where: { workspaceId: s.ws } }), before, "syncing again adds nothing (idempotent)");

  // Leaderboards: metric x period x top N.
  const year = await contributor.get<Board>(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=tasks&period=year&top=1`);
  assert.equal(year.status, 200);
  assert.ok(year.body.rows.length <= 1);
  const today = new Date().toISOString().slice(0, 10);
  const custom = await contributor.get<Board>(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=points&period=custom&from=2020-01-01&to=${today}&top=50`);
  assert.ok(custom.body.rows.some((r) => r.user.id === s.contributorId && r.value > 0));
  assert.ok(custom.body.me);
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=bogus`)).status, 400);
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/leaderboard?period=custom&from=2026-05-01&to=2026-01-01`)).status, 400);
  assert.equal((await outsider.get(`/api/workspaces/${s.ws}/recognition/leaderboard`)).status, 404);

  // Supporters: someone commenting on my task shows up as supporting me.
  assert.equal((await viewer.post(`/api/tasks/${s.task1}/comments`, { body: "Here's the vendor contact for the laptop" })).status, 201);
  const sup = await contributor.get<Board>(`/api/workspaces/${s.ws}/recognition/supporters?period=month&top=5`);
  const v = sup.body.rows.find((r) => r.user.id === s.viewerId);
  assert.ok(v && (v.detail?.comments ?? 0) >= 1, JSON.stringify(sup.body));

  // Only admins / delegated managers change the rules; only admins delegate.
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/settings`)).status, 403);
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/recognition/managers`, { userIds: [s.contributorId] })).status, 403);
  assert.equal((await admin.put(`/api/workspaces/${s.ws}/recognition/managers`, { userIds: [s.contributorId] })).status, 200);
  const st = await contributor.get<{ rules: { action: string; points: number }[]; canDelegate: boolean }>(`/api/workspaces/${s.ws}/recognition/settings`);
  assert.equal(st.status, 200);
  assert.equal(st.body.canDelegate, false, "delegated managers can't delegate further");
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/recognition/settings`, { rules: [{ action: "comment_posted", points: 2, enabled: true }], membersSeePoints: false })).status, 200);

  // Visibility: points boards hidden from members by default now; per-person override.
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=points`)).status, 403);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=tasks`)).status, 200, "task boards stay visible");
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/history?userId=${s.contributorId}`)).status, 403);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/history`)).status, 200, "own points always visible");
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/recognition/members/${s.viewerId}`, { canViewOthersPoints: true })).status, 200);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=points`)).status, 200);
});

test("recognition: thank-you letters notify, open, stay private when asked, and can't be farmed", async () => {
  type K = { id: string; href: string; read: boolean; isPublic: boolean };
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.viewerId, title: "Me", message: "Thanks to myself for everything" })).status, 400, "not to yourself");
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.outsiderId, title: "Hi", message: "Thanks for all your help!" })).status, 400, "only members");
  const k = await viewer.post<K>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, style: "gratitude", title: "Thank you for the laptop", message: "You set everything up before day one. It made the new hire feel welcome.", reason: "preparing the laptop", taskId: s.task1, values: ["teamwork"] });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const n = await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "kudos" }, orderBy: { createdAt: "desc" } });
  assert.ok(n && n.link?.endsWith(`/recognition/kudos/${k.body.id}`) && n.actorId === s.viewerId, "the receiver is notified (pop-up)");
  const opened = await contributor.get<K>(`/api/kudos/${k.body.id}`);
  assert.equal(opened.status, 200);
  assert.ok((await prisma.kudos.findUniqueOrThrow({ where: { id: k.body.id } })).readAt, "opening marks it read");
  assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: n!.id } })).readAt);
  // Points: the receiver earns once per sender per day.
  const pts = () => prisma.pointEvent.count({ where: { workspaceId: s.ws, userId: s.contributorId, action: "kudos_received" } });
  const once = await pts();
  assert.ok(once >= 1);
  await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, title: "Again", message: "And thanks again for the follow-up!" });
  await contributor.get(`/api/workspaces/${s.ws}/recognition`);
  assert.equal(await pts(), once, "a second letter the same day earns no extra points");

  // Private letters: only sender and receiver; lists per scope.
  const priv = await admin.post<K>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, title: "Just between us", message: "Thank you for covering for me this week.", isPublic: false });
  assert.equal((await viewer.get(`/api/kudos/${priv.body.id}`)).status, 404);
  const wall = await viewer.get<{ items: { id: string }[] }>(`/api/workspaces/${s.ws}/kudos?scope=wall`);
  assert.ok(wall.body.items.some((x) => x.id === k.body.id) && !wall.body.items.some((x) => x.id === priv.body.id));
  const mine = await contributor.get<{ items: { id: string }[] }>(`/api/workspaces/${s.ws}/kudos?scope=received`);
  assert.ok(mine.body.items.some((x) => x.id === priv.body.id), "the receiver keeps every letter");
  // BUG-01: ?userId= must never widen "received" to someone else's letters (it used to override toId).
  type KD = { id: string; from: { id: string }; to: { id: string } };
  const snoop = await viewer.get<{ items: KD[] }>(`/api/workspaces/${s.ws}/kudos?scope=received&userId=${s.contributorId}`);
  assert.equal(snoop.status, 200);
  assert.ok(!snoop.body.items.some((x) => x.id === priv.body.id), "another member's private letter stays private");
  assert.ok(snoop.body.items.every((x) => x.to.id === s.viewerId), "received means letters to the caller");
  // The wall narrowed to one person shows public letters from others, never private ones (regression guard).
  const k2 = await admin.post<K>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, title: "Great onboarding week", message: "Thanks for the smooth onboarding of the new hires!", isPublic: true });
  assert.equal(k2.status, 201, JSON.stringify(k2.body));
  const wallOf = await viewer.get<{ items: KD[] }>(`/api/workspaces/${s.ws}/kudos?scope=wall&userId=${s.contributorId}`);
  assert.ok(wallOf.body.items.some((x) => x.id === k2.body.id) && !wallOf.body.items.some((x) => x.id === priv.body.id));
  // "sent" narrowed to one person: only my letters to them (regression guard).
  const sentTo = await viewer.get<{ items: KD[] }>(`/api/workspaces/${s.ws}/kudos?scope=sent&userId=${s.contributorId}`);
  assert.ok(sentTo.body.items.length > 0 && sentTo.body.items.every((x) => x.from.id === s.viewerId && x.to.id === s.contributorId));
  // A malformed id is a 400, not a 500.
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/kudos?userId=abc`)).status, 400);
  assert.equal((await contributor.del(`/api/kudos/${k.body.id}`)).status, 403, "only the sender can withdraw");

  // AI helps write the letter (draft only).
  const draft = await viewer.post<{ title: string; message: string }>(`/api/workspaces/${s.ws}/kudos/draft`, { toId: s.contributorId, reason: "fixed the payroll export", style: "appreciation" });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.ok(draft.body.title && draft.body.message.length > 20, "a draft letter comes back");
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /fixed the payroll export/);

  // Card designs, an editable greeting/closing, and Vietnamese typed with decomposed accents is stored as NFC.
  const nfd = "Cảm ơn bạn rất nhiều vì đã hỗ trợ".normalize("NFD");
  const card = await viewer.post<{ id: string; template: string; greeting: string; closing: string; message: string }>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, template: "botanical", greeting: "Chào Linh thân mến,", closing: "Thương mến,\n— Team HR", title: "Cảm ơn", message: nfd });
  assert.equal(card.status, 201, JSON.stringify(card.body));
  assert.equal(card.body.template, "botanical");
  assert.equal(card.body.greeting, "Chào Linh thân mến,");
  assert.equal(card.body.message, nfd.normalize("NFC"), "accents are composed (NFC) so fonts render them");
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, template: "nope", title: "x", message: "Thanks for everything!" })).status, 400);
  // AI suggestions grounded in shared history; the reason is optional.
  const ctx = await viewer.get<{ facts: { kind: string; n: number }[] }>(`/api/workspaces/${s.ws}/kudos/context?toId=${s.contributorId}`);
  assert.equal(ctx.status, 200);
  assert.ok(Array.isArray(ctx.body.facts));
  const noReason = await viewer.post<{ message: string; reasons: string[] }>(`/api/workspaces/${s.ws}/kudos/draft`, { toId: s.contributorId, style: "teamwork" });
  assert.equal(noReason.status, 200, JSON.stringify(noReason.body));
  assert.ok(noReason.body.reasons.length >= 1, "AI proposes reasons to thank them");
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /OUR WORK TOGETHER/);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/kudos/context?toId=${s.outsiderId}`)).status, 400, "only members");
});

test("thank-you letters take emoji reactions; the other party hears about it once", async () => {
  const k = await prisma.kudos.findFirstOrThrow({ where: { fromId: s.viewerId, toId: s.contributorId, deletedAt: null } });
  const r = await contributor.post<{ emoji: string; count: number; mine: boolean }[]>(`/api/kudos/${k.id}/reactions`, { emoji: "❤️" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.map((x) => [x.emoji, x.count, x.mine]), [["❤️", 1, true]]);
  assert.equal((await contributor.post(`/api/kudos/${k.id}/reactions`, { emoji: "💩" })).status, 400, "only the offered reactions");
  const n = () => prisma.notification.count({ where: { userId: s.viewerId, type: "kudos_reaction", actorId: s.contributorId } });
  assert.equal(await n(), 1, "the sender is told");
  await contributor.post(`/api/kudos/${k.id}/reactions`, { emoji: "❤️" }); // un-react
  await contributor.post(`/api/kudos/${k.id}/reactions`, { emoji: "❤️" }); // react again
  assert.equal(await n(), 1, "no duplicate notices");
  const open = await viewer.get<{ reactions: { emoji: string; names: string[] }[] }>(`/api/kudos/${k.id}`);
  assert.equal(open.body.reactions[0].names.length, 1);
  assert.equal((await outsider.post(`/api/kudos/${k.id}/reactions`, { emoji: "🎉" })).status, 404);
});

test("recognition: reward catalog, redemption with reserved points, approval and stock limits, reachable-reward alerts", async () => {
  type R = { id: string; remaining: number; soldOut: boolean };
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/rewards`, { name: "Nope", pointsCost: 1, quantity: 1 })).status, 403);
  const bal = async (c: Client) => (await c.get<{ points: { balance: number } }>(`/api/workspaces/${s.ws}/recognition`)).body.points.balance;
  const cBal = await bal(contributor);
  const aBal = await bal(admin);
  const cheapCost = Math.max(1, Math.min(cBal, aBal));
  // Delegated manager adds several rewards at once.
  const created = await contributor.post<R[]>(`/api/workspaces/${s.ws}/rewards`, { items: [{ name: "Coffee voucher", pointsCost: cheapCost, price: 50000, currency: "VND", quantity: 1 }, { name: "Extra day off", pointsCost: 1_000_000, quantity: 5 }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const [coffee, dayOff] = created.body;
  // Anyone whose balance covers it gets a reachable-reward notice (once).
  const alert = await prisma.notification.findFirst({ where: { userId: s.contributorId, dedupeKey: `reward-reachable:${coffee.id}` } });
  assert.ok(alert && (alert.data as { kind: string }).kind === "reward_reachable");
  assert.ok(!(await prisma.notification.findFirst({ where: { dedupeKey: `reward-reachable:${dayOff.id}` } })), "not for rewards nobody can afford");
  // Picture upload (PNG magic bytes).
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "c.png");
  const up = await fetch(`${BASE}/api/rewards/${coffee.id}/image`, { method: "PUT", headers: { cookie: contributor.cookieHeader() }, body: form });
  assert.equal(up.status, 200);
  assert.ok((await viewer.get<R[]>(`/api/workspaces/${s.ws}/rewards`)).body.find((x) => x.id === dayOff.id), "members see the catalog");
  const form2 = new FormData();
  form2.append("file", new Blob([png], { type: "image/png" }), "d.png");
  await fetch(`${BASE}/api/rewards/${dayOff.id}/image`, { method: "PUT", headers: { cookie: contributor.cookieHeader() }, body: form2 });
  assert.equal((await viewer.del(`/api/rewards/${dayOff.id}/image`)).status, 403, "members can't remove pictures");
  assert.equal((await contributor.del(`/api/rewards/${dayOff.id}/image`)).status, 204);
  assert.equal((await viewer.get<{ id: string; imageUrl: string | null }[]>(`/api/workspaces/${s.ws}/rewards`)).body.find((x) => x.id === dayOff.id)?.imageUrl, null);
  // Editing only sends what changed: a disabled reward stays off and keeps its currency.
  const usd = await contributor.post<{ id: string }>(`/api/workspaces/${s.ws}/rewards`, { name: "Conference ticket", pointsCost: 9_000_000, price: 300, currency: "USD", quantity: 1 });
  assert.equal(usd.status, 201, JSON.stringify(usd.body));
  const off = await contributor.patch<{ active: boolean; currency: string }>(`/api/rewards/${usd.body.id}`, { active: false });
  assert.deepEqual([off.status, off.body.active, off.body.currency], [200, false, "USD"], "switching it off keeps USD");
  const renamed = await contributor.patch<{ active: boolean; currency: string }>(`/api/rewards/${usd.body.id}`, { name: "Conference ticket (2027)" });
  assert.deepEqual([renamed.body.active, renamed.body.currency], [false, "USD"], "renaming doesn't switch it back on");
  assert.equal((await contributor.del(`/api/rewards/${usd.body.id}`)).status, 204);
  // Edit in place.
  const edited = await contributor.patch<{ name: string; description: string; price: number }>(`/api/rewards/${dayOff.id}`, { name: "Extra day off (1 day)", description: "Book it with your manager", price: 1500000 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.price, 1500000);

  assert.equal((await contributor.post(`/api/rewards/${dayOff.id}/redeem`, {})).status, 400, "not enough points");
  const r1 = await contributor.post<{ id: string; status: string }>(`/api/rewards/${coffee.id}/redeem`, { note: "Thanks!" });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.ok((await contributor.get<{ pendingRequests: number }>(`/api/workspaces/${s.ws}/recognition`)).body.pendingRequests >= 1, "managers see how many requests wait");
  assert.equal((await viewer.get<{ pendingRequests: number }>(`/api/workspaces/${s.ws}/recognition`)).body.pendingRequests, 0);
  assert.equal(await bal(contributor), cBal - cheapCost, "points are reserved while pending");
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.ok(await prisma.notification.findFirst({ where: { userId: adminUser.id, type: "reward_request", actorId: s.contributorId } }), "approvers are told about the request");
  const r2 = await admin.post<{ id: string }>(`/api/rewards/${coffee.id}/redeem`, {});
  assert.equal(r2.status, 201);
  assert.equal((await viewer.patch(`/api/redemptions/${r1.body.id}`, { action: "approve" })).status, 403, "members can't approve");
  const notice = await prisma.notification.findFirstOrThrow({ where: { userId: adminUser.id, type: "reward_request", actorId: s.contributorId }, orderBy: { createdAt: "desc" } });
  assert.equal((notice.data as { redemptionId: string }).redemptionId, r1.body.id, "the notice points at the request");
  assert.match(notice.link ?? "", new RegExp(`tab=manage&request=${r1.body.id}$`));
  // BUG-32: a recognition manager can't decide their own request (cancel is how they withdraw it).
  const self = await contributor.patch<{ error: string }>(`/api/redemptions/${r1.body.id}`, { action: "approve" });
  assert.equal(self.status, 403, "no self-approval");
  assert.equal((await contributor.patch(`/api/redemptions/${r1.body.id}`, { action: "reject" })).status, 403, "no self-rejection either");
  assert.equal((await admin.patch(`/api/redemptions/${r1.body.id}`, { action: "approve" })).status, 200, "another manager decides");
  assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } })).actionedAt, "every approver's notice is answered once decided");
  const out = await contributor.patch<{ error: string }>(`/api/redemptions/${r2.body.id}`, { action: "approve" });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /out of stock/i, "stock is never exceeded");
  assert.equal((await contributor.patch(`/api/redemptions/${r2.body.id}`, { action: "reject", note: "Sold out" })).status, 200);
  assert.equal(await bal(admin), aBal, "rejected points are released");
  const list = await viewer.get<R[]>(`/api/workspaces/${s.ws}/rewards`);
  assert.ok(list.body.find((x) => x.id === coffee.id)?.soldOut);
  assert.equal((await admin.post(`/api/rewards/${coffee.id}/redeem`, {})).status, 400, "sold out");
  const res = await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "reward_result" } });
  assert.equal((res?.data as { decision: string }).decision, "approved");
  assert.equal((await contributor.patch(`/api/rewards/${coffee.id}`, { quantity: 0 })).status, 400, "stock can't drop below what was given");
  assert.equal(await prisma.$queryRaw<{ n: number }[]>`SELECT approved_count AS n FROM rewards WHERE id = ${coffee.id}::uuid`.then((x) => Number(x[0].n)), 1);

  // Recalculate with the current rules keeps reservations intact.
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/recognition/recalculate`, {})).status, 200);
  assert.equal(await bal(contributor) <= cBal, true);
  await admin.put(`/api/workspaces/${s.ws}/recognition/managers`, { userIds: [] });
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/settings`)).status, 403, "delegation revoked");
});

test("notification settings: per-group pop-up / device switches and a ringtone, validated", async () => {
  const def = await viewer.get<{ popupOff: string[]; nativeOff: string[]; sound: string; volume: number }>("/api/account/notification-settings");
  assert.equal(def.status, 200);
  assert.deepEqual(def.body, { popupOff: [], nativeOff: [], sound: "chime", volume: 70 });
  const put = await viewer.put<{ popupOff: string[]; nativeOff: string[]; sound: string; volume: number }>("/api/account/notification-settings", { popupOff: ["updates", "updates", "ai"], nativeOff: ["comment"], sound: "marimba", volume: 40 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.popupOff.sort(), ["ai", "updates"], "de-duplicated");
  assert.equal(put.body.sound, "marimba");
  assert.equal((await viewer.put("/api/account/notification-settings", { popupOff: ["nope"] })).status, 400);
  assert.equal((await viewer.put("/api/account/notification-settings", { sound: "siren" })).status, 400);
  assert.equal((await viewer.put("/api/account/notification-settings", { volume: 101 })).status, 400);
  assert.equal((await contributor.get<{ sound: string }>("/api/account/notification-settings")).body.sound, "chime", "settings are personal");
  // Notifications carry the actor, so the Action center can show their profile picture.
  const n = await contributor.get<{ items: { actor: { id: string } | null; workspaceId: string | null }[] }>("/api/notifications");
  assert.ok(n.body.items.some((x) => x.actor?.id && x.workspaceId));

  // A group switched off for the app is left out of the bell's unread count (and flagged), but kept.
  const userId = s.viewerId;
  const before = await viewer.get<{ unread: number; unreadAll: number }>("/api/notifications");
  await prisma.notification.createMany({
    data: [
      { userId, type: "task_updated", title: "Updated: description", workspaceId: s.ws },
      { userId, type: "task_status", title: "Status changed", workspaceId: s.ws },
      { userId, type: "task_comment", title: "New comment", workspaceId: s.ws },
    ],
  });
  type Inbox = { unread: number; unreadAll: number; items: { type: string; muted: boolean }[] };
  const after = await viewer.get<Inbox>("/api/notifications");
  assert.equal(after.body.unreadAll, before.body.unreadAll + 3, "all three are kept");
  assert.equal(after.body.unread, before.body.unread + 1, "only the comment counts: updates are switched off");
  assert.ok(!after.body.items.some((x) => x.type === "task_updated" || x.type === "task_status"), "switched-off groups are not listed");
  assert.ok(after.body.items.some((x) => x.type === "task_comment"));
  // ...but an Action center chip still shows them on request.
  const chip = await viewer.get<Inbox>("/api/notifications?types=task_status,task_updated");
  assert.ok(chip.body.items.length >= 2 && chip.body.items.every((x) => x.type === "task_status" || x.type === "task_updated"));
  assert.ok(chip.body.items.every((x) => x.muted), "flagged as switched off");

  // A busy day of switched-off updates never pushes a mention out of the 100-item list (production bug:
  // replies with @mentions popped up but were missing from the bell and the Action center).
  const mention = await prisma.notification.create({ data: { userId, type: "mention", title: "Tam mentioned you", workspaceId: s.ws, createdAt: new Date(Date.now() - 60_000) } });
  await prisma.notification.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ userId, type: "task_updated", title: `Update ${i}`, workspaceId: s.ws })) });
  type Full = { unread: number; items: { id: string; type: string; muted: boolean }[]; typeCounts: Record<string, number>; mutedGroups: string[] };
  const busy = await viewer.get<Full>("/api/notifications");
  assert.ok(busy.body.items.some((x) => x.id === mention.id), "the mention is still in the bell");
  assert.equal(busy.body.typeCounts.task_updated >= 121, true, "counts are not capped at 100");
  assert.deepEqual(busy.body.mutedGroups.sort(), ["ai", "updates"]);
  const todo = await viewer.get<Full>("/api/notifications?view=todo");
  assert.ok(todo.body.items.some((x) => x.id === mention.id), "and in the Action center");
  const mentions = await viewer.get<Full>("/api/notifications?view=todo&types=mention");
  assert.ok(mentions.body.items.length >= 1 && mentions.body.items.every((x) => x.type === "mention"));
  assert.equal((await viewer.get("/api/notifications?types=nope;drop")).status, 200, "odd type filters are ignored, not errors");
  // Switched off in the app but still allowed on the device: the poll still carries them for system notifications.
  type Dev = { items: { id: string; type: string }[]; deviceItems: { id: string; type: string }[]; rewardReachable: number };
  const dev = await viewer.get<Dev>("/api/notifications");
  assert.ok(dev.body.deviceItems.some((x) => x.type === "task_updated") && dev.body.deviceItems.every((x) => ["task_updated", "task_status", "ai_suggestion"].includes(x.type)), "device-only items for system notifications");
  assert.ok(!dev.body.items.some((x) => x.type === "task_updated"), "but not listed in the bell");
  await viewer.put("/api/account/notification-settings", { popupOff: ["updates", "ai"], nativeOff: ["updates"] });
  assert.equal((await viewer.get<Dev>("/api/notifications")).body.deviceItems.length, 0, "off on the device too: nothing to raise");
  // "You can redeem a reward" AI notices belong to Recognition: listed and counted there, not under AI.
  const rr = await prisma.notification.create({ data: { userId, type: "ai_suggestion", title: "You can redeem a reward", workspaceId: s.ws, data: { kind: "reward_reachable", points: 120, cost: 100 } } });
  const recChip = await viewer.get<Dev>("/api/notifications?types=kudos,kudos_reaction,reward_request,reward_result");
  assert.ok(recChip.body.items.some((x) => x.id === rr.id), "in the Recognition chip");
  assert.ok(!(await viewer.get<Dev>("/api/notifications?types=ai_suggestion")).body.items.some((x) => x.id === rr.id), "not in the AI chip");
  assert.ok((await viewer.get<Dev>("/api/notifications")).body.items.some((x) => x.id === rr.id), "AI muted, Recognition on: still in the bell");
  assert.ok((await viewer.get<Dev>("/api/notifications")).body.rewardReachable >= 1);
  await prisma.notification.delete({ where: { id: rr.id } });
  // Switching updates back on counts them again.
  await viewer.put("/api/account/notification-settings", { popupOff: [] });
  assert.equal((await viewer.get<Inbox>("/api/notifications")).body.unread, before.body.unreadAll + 3 + 121);
  await prisma.notification.deleteMany({ where: { userId, title: { startsWith: "Update " } } });
  await prisma.notification.delete({ where: { id: mention.id } });
});

test("web push: devices register with the browsers' push services only; notifications still work with push on", async () => {
  const cfg = await viewer.get<{ enabled: boolean; publicKey: string | null; devices: number }>("/api/account/push");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.enabled, true);
  assert.match(cfg.body.publicKey ?? "", /^[A-Za-z0-9_-]{80,}$/, "the VAPID public key browsers subscribe with");
  const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
  // Only browser push services: never an arbitrary host the server would then POST to.
  for (const endpoint of ["https://evil.example.com/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/x", "https://localhost/x", "not a url"])
    assert.equal((await viewer.post("/api/account/push", { endpoint, keys })).status, 400, endpoint);
  const endpoint = "https://fcm.googleapis.com/fcm/send/integration-device-1";
  assert.equal((await viewer.post("/api/account/push", { endpoint, keys })).status, 201);
  assert.equal((await viewer.post("/api/account/push", { endpoint, keys })).status, 201, "re-registering is idempotent");
  assert.equal(await prisma.pushSubscription.count({ where: { endpoint } }), 1);
  // The same browser signing in as someone else moves the device to them.
  assert.equal((await contributor.post("/api/account/push", { endpoint, keys })).status, 201);
  assert.equal((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } })).userId, s.contributorId);
  // A mention through the app (queued for push; delivery to the push service fails offline) still works.
  const before = await prisma.notification.count({ where: { userId: s.contributorId, type: "mention" } });
  const c = await admin.post(`/api/tasks/${s.task1}/comments`, { body: `Push test @[Contributor](${s.contributorId})` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(await prisma.notification.count({ where: { userId: s.contributorId, type: "mention" } }), before + 1);
  await new Promise((r) => setTimeout(r, 1500)); // let the after-response push attempt run
  assert.equal((await contributor.get("/api/notifications")).status, 200, "the server keeps serving after a failed delivery");
  // Only the owner removes a device.
  await viewer.req("DELETE", "/api/account/push", { endpoint });
  assert.equal(await prisma.pushSubscription.count({ where: { endpoint } }), 1, "someone else's device stays");
  await contributor.req("DELETE", "/api/account/push", { endpoint });
  assert.equal(await prisma.pushSubscription.count({ where: { endpoint } }), 0);
  assert.equal((await new Client().get("/api/account/push")).status, 401);
});
