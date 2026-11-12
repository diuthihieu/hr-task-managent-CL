// Messages: add a contact, chat 1-1 with a tagged task, recall a message, create a group, and the
// sidebar badge counts what arrived while away.
import { PrismaClient } from "@prisma/client";
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("messages: contact request, 1-1 chat with a task tag, recall, group, unread badge", async ({ page, seed }) => {
  const prisma = new PrismaClient();
  const tag = Date.now().toString(36);
  const me = await prisma.user.findUniqueOrThrow({ where: { email: seed.email } });
  const lan = await prisma.user.create({ data: { email: `lan.${tag}@chat.test`, name: `Lan ${tag}`, systemRole: "MEMBER", passwordHash: "x", mustChangePassword: false, emailVerifiedAt: new Date() } });
  await prisma.workspaceMember.create({ data: { workspaceId: seed.wsId, userId: lan.id, role: "editor" } });
  const task = await prisma.task.findUniqueOrThrow({ where: { id: seed.taskId }, select: { title: true } });

  try {
    await page.goto(`/w/${seed.slug}/messages`);
    await expect(page.getByTestId("messages-app")).toBeVisible();
    await expect(page.getByTestId("chat-row-bot")).toBeVisible();

    // Contact request from the Contacts tab; Lan accepts (she has no browser here).
    await page.getByTestId("chat-tab-contacts").click();
    await page.getByTestId("chat-people-search").fill(`Lan ${tag}`);
    await page.getByTestId("chat-person").filter({ hasText: `Lan ${tag}` }).getByTestId("chat-add-contact").click();
    await expect(page.getByTestId("chat-person").filter({ hasText: `Lan ${tag}` })).not.toContainText(/Kết bạn|Add contact/);
    const [a, b] = me.id < lan.id ? [me.id, lan.id] : [lan.id, me.id];
    await prisma.contact.update({ where: { userAId_userBId: { userAId: a, userBId: b } }, data: { status: "accepted" } });

    await page.getByTestId("chat-people-search").fill("");
    await page.reload();
    await page.getByTestId("chat-tab-contacts").click();
    await page.getByTestId("chat-friend").filter({ hasText: `Lan ${tag}` }).getByTestId("chat-message-friend").click();
    await expect(page.getByTestId("chat-thread-title")).toHaveText(`Lan ${tag}`);

    // A message with a tagged task: "#" opens the picker.
    const input = page.getByTestId("chat-input");
    await input.fill(`Chị xem giúp em #${task.title.split(/\s+/)[0]}`);
    await expect(page.getByTestId("chat-task-picker")).toBeVisible();
    await page.getByTestId("chat-task-option").first().click();
    await expect(page.getByTestId("chat-tag-chip")).toHaveCount(1);
    await page.getByTestId("chat-send").click();
    const bubble = page.getByTestId("chat-message").filter({ hasText: "Chị xem giúp em" });
    await expect(bubble).toBeVisible();
    await expect(bubble.getByTestId("chat-task")).toBeVisible();

    // Recall within the hour.
    page.once("dialog", (d) => void d.accept());
    await bubble.hover();
    await bubble.getByTestId("chat-message-menu").click();
    await page.getByTestId("chat-recall").click();
    await expect(page.getByTestId("chat-message").last()).toContainText(/Tin nhắn đã thu hồi|Message recalled/);

    // A group with Lan.
    await page.getByTestId("chat-new-group").click();
    const dialog = page.getByTestId("chat-new-group-dialog");
    await dialog.getByTestId("chat-group-name").fill(`C&B ${tag}`);
    await dialog.getByTestId("chat-picker-search").fill(`Lan ${tag}`);
    await dialog.getByTestId("chat-picker-person").first().click();
    await dialog.getByTestId("chat-group-create").click();
    await expect(page.getByTestId("chat-thread-title")).toHaveText(`C&B ${tag}`);
    await input.fill("Chào cả nhóm");
    await input.press("Enter");
    await expect(page.getByTestId("chat-message").filter({ hasText: "Chào cả nhóm" })).toBeVisible();

    // Lan answers in the 1-1 chat while I'm on Home: the sidebar badge shows it.
    const direct = await prisma.conversation.findFirstOrThrow({ where: { kind: "direct", members: { some: { userId: lan.id } } } });
    await prisma.chatMessage.create({ data: { conversationId: direct.id, authorId: lan.id, body: "Dạ em xem rồi" } });
    await page.goto(`/w/${seed.slug}`);
    await expect(page.getByTestId("nav-messages").getByTestId("chat-unread")).toHaveText("1");
  } finally {
    await prisma.conversation.deleteMany({ where: { members: { some: { userId: lan.id } } } });
    await prisma.contact.deleteMany({ where: { OR: [{ userAId: lan.id }, { userBId: lan.id }] } });
    await prisma.workspaceMember.deleteMany({ where: { userId: lan.id } });
    await prisma.user.delete({ where: { id: lan.id } });
    await prisma.$disconnect();
  }
});
