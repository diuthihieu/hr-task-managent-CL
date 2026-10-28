// Runs once before the browser suite: signs up a user through the real API, builds a
// small workspace with long Vietnamese titles (the text that used to overflow on
// phones) and saves the session for the specs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE, SEED_FILE, type Seed } from "./fixtures";

setup("sign up and build a workspace", async ({ request }) => {
  const email = `e2e.${Date.now()}@woli.test`;
  const password = "Woli2026pass";
  expect((await request.post("/api/register", { data: { email, password, name: "Hieu Diu-Thi", locale: "vi" } })).status()).toBe(201);
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  await request.post("/api/auth/callback/credentials", { form: { csrfToken, email, password, callbackUrl: "/" }, maxRedirects: 0 });
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const ws = await post("/api/workspaces", { name: "HR TASK MANAGEMENT" });
  const project = await post(`/api/workspaces/${ws.id}/projects`, { name: "Compensation & Benefits and Payroll operations" });
  const titles = [
    "Tạo file tính tổng thu nhập trong năm (gửi kèm payslip hoặc lưu trữ trên sharepoint dạng template)",
    "Soạn email hướng dẫn nhân viên đọc & kiểm tra báo cáo ezHR hằng tháng",
    "Làm & in Quyết định chấm dứt HĐLĐ các trường hợp nghỉ việc sắp tới",
  ];
  const tasks: { id: string }[] = [];
  for (const title of titles) tasks.push(await post(`/api/projects/${project.id}/tasks`, { data: { sys_title: title } }));
  const dash = await post(`/api/workspaces/${ws.id}/dashboards`, { name: "HRG" });
  for (const type of ["kpi", "bar", "pie"]) await post(`/api/dashboards/${dash.id}/blocks`, { type, title: "Tổng số giờ làm theo nhân viên trong tháng", w: 2, h: 8 });

  // A few notifications with long titles for the bell and the Action center.
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await prisma.notification.createMany({
      data: [
        { type: "task_overdue", title: "Cho nhân viên ký PLHĐ sau công nhận cấp bậc mới tháng 10" },
        { type: "mention", title: "Cập nhật hồ sơ nhân viên nghỉ việc trên ezHR", body: "@Hieu Em đã cập nhật trong description chị xem nhé" },
        { type: "task_assigned", title: "Khai báo chế độ BHXH anh Đức và thai sản chị Trinh" },
      ].map((n) => ({ ...n, userId: user.id, workspaceId: ws.id, projectId: project.id, taskId: tasks[0].id })),
    });
  } finally {
    await prisma.$disconnect();
  }

  const seed: Seed = { email, slug: ws.slug, wsId: ws.id, projectId: project.id, taskId: tasks[0].id, dashId: dash.id };
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(seed));
  await request.storageState({ path: AUTH_FILE });
});
