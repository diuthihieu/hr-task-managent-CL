import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function id() {
  return Math.random().toString(36).slice(2, 10);
}

const STATUS_OPTIONS = [
  { id: "not_started", label: "Not Started", color: "#94a3b8" },
  { id: "in_progress", label: "In Progress", color: "#3b82f6" },
  { id: "pending", label: "Pending", color: "#eab308" },
  { id: "blocked", label: "Blocked", color: "#ef4444" },
  { id: "done", label: "Done", color: "#22c55e" },
  { id: "cancelled", label: "Cancelled", color: "#64748b" },
];
const PRIORITY_OPTIONS = [
  { id: "low", label: "Low", color: "#94a3b8" },
  { id: "medium", label: "Medium", color: "#3b82f6" },
  { id: "high", label: "High", color: "#f97316" },
  { id: "critical", label: "Critical", color: "#ef4444" },
];
const CATEGORY_OPTIONS = [
  "Employee Records", "Payroll", "Social Insurance", "Training", "Contract",
  "Employee Evaluation", "HR Reporting", "Audit", "Policy", "Offboarding", "Onboarding",
].map((label, i) => ({ id: `cat_${i}`, label, color: ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#8b5cf6", "#eab308", "#ef4444", "#14b8a6", "#a855f7", "#64748b"][i] }));

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash("password123", 10);
  const demoUser = await prisma.user.upsert({
    where: { email: "diuthihieu@gmail.com" },
    update: {},
    create: { email: "diuthihieu@gmail.com", name: "Hieu Diu", passwordHash, avatarColor: "#6366f1" },
  });

  const teammates = await Promise.all(
    [
      { email: "an.tran@bestarion.com", name: "An Tran", color: "#0ea5e9" },
      { email: "linh.pham@bestarion.com", name: "Linh Pham", color: "#22c55e" },
      { email: "minh.nguyen@bestarion.com", name: "Minh Nguyen", color: "#f97316" },
    ].map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { email: u.email, name: u.name, passwordHash, avatarColor: u.color },
      })
    )
  );

  let workspace = await prisma.workspace.findUnique({ where: { slug: "bestarion" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({ data: { name: "BESTARION", slug: "bestarion" } });
  }

  for (const user of [demoUser, ...teammates]) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      update: {},
      create: { workspaceId: workspace.id, userId: user.id, role: user.id === demoUser.id ? "owner" : "editor" },
    });
  }

  const existingBase = await prisma.base.findFirst({ where: { workspaceId: workspace.id, name: "HR Operations" } });
  if (existingBase) {
    console.log("HR Operations base already exists, skipping table seed.");
    await prisma.$disconnect();
    return;
  }

  const base = await prisma.base.create({
    data: { workspaceId: workspace.id, name: "HR Operations", icon: "Database", color: "#6366f1", description: "Core HR tables: tasks, employees, insurance, training and audit trail.", order: 0 },
  });

  const [an, linh, minh] = teammates;
  const memberIds = [demoUser.id, an.id, linh.id, minh.id];
  const pick = (i: number) => memberIds[i % memberIds.length];

  // ---------------- All Tasks ----------------
  const tasksTable = await prisma.tableDef.create({ data: { baseId: base.id, name: "All Tasks", icon: "ListTodo", order: 0 } });
  const taskFieldDefs = [
    { name: "Task Name", type: "text", isPrimary: true },
    { name: "Category", type: "single_select", config: { options: CATEGORY_OPTIONS } },
    { name: "Owner", type: "person" },
    { name: "Priority", type: "single_select", config: { options: PRIORITY_OPTIONS } },
    { name: "Status", type: "status", config: { options: STATUS_OPTIONS } },
    { name: "Start Date", type: "date" },
    { name: "Due Date", type: "date" },
    { name: "Progress", type: "progress" },
    { name: "Estimated Hours", type: "number" },
    { name: "Actual Hours", type: "number" },
    { name: "Objective / Completion Criteria", type: "long_text" },
    { name: "Execution Detail", type: "long_text" },
    { name: "Created Time", type: "created_time" },
  ];
  const taskFields: Record<string, string> = {};
  for (const [i, f] of [...taskFieldDefs, { name: "Depends On", type: "link", config: { linkTableId: tasksTable.id } }].entries()) {
    const field = await prisma.field.create({
      data: { tableId: tasksTable.id, name: f.name, type: f.type, order: i, isPrimary: !!("isPrimary" in f && f.isPrimary), config: f.config ? JSON.stringify(f.config) : null },
    });
    taskFields[f.name] = field.id;
  }

  const TASKS: Array<{ name: string; category: number; owner: number; priority: string; status: string; start: number; due: number; progress: number; est: number; act: number; objective: string; exec: string }> = [
    { name: "Update employee handbook for 2026 policy changes", category: 8, owner: 0, priority: "high", status: "in_progress", start: -10, due: 5, progress: 60, est: 20, act: 14, objective: "Handbook reflects new leave & remote-work policy", exec: "Draft sections, legal review, publish to intranet" },
    { name: "Process October payroll for Da Nang office", category: 1, owner: 1, priority: "critical", status: "done", start: -20, due: -15, progress: 100, est: 16, act: 15, objective: "All salaries paid accurately by the 5th", exec: "Reconcile timesheets, run payroll batch, confirm bank transfer" },
    { name: "Renew social insurance registration - Q4 batch", category: 2, owner: 2, priority: "high", status: "in_progress", start: -5, due: 2, progress: 40, est: 12, act: 5, objective: "All new hires enrolled in SI within statutory window", exec: "Compile new-hire list, submit to SI authority portal" },
    { name: "Onboard 3 new software engineers", category: 10, owner: 0, priority: "medium", status: "in_progress", start: -3, due: 4, progress: 55, est: 10, act: 6, objective: "Engineers productive by end of first week", exec: "Equipment setup, account provisioning, orientation session" },
    { name: "Conduct annual compliance audit - finance dept", category: 7, owner: 3, priority: "critical", status: "pending", start: 1, due: 10, progress: 0, est: 30, act: 0, objective: "Zero critical findings on statutory compliance", exec: "Sample transactions, interview staff, draft findings report" },
    { name: "Schedule Q4 performance evaluations", category: 5, owner: 1, priority: "medium", status: "not_started", start: 3, due: 20, progress: 0, est: 8, act: 0, objective: "100% of staff reviewed before year end", exec: "Send calendar invites, prepare review templates" },
    { name: "Draft offboarding checklist for resigned staff", category: 9, owner: 2, priority: "low", status: "done", start: -30, due: -25, progress: 100, est: 6, act: 5, objective: "Consistent, compliant exit process", exec: "Asset return, final pay calc, exit interview" },
    { name: "Update employment contract template", category: 4, owner: 0, priority: "medium", status: "in_progress", start: -8, due: 6, progress: 30, est: 10, act: 3, objective: "Template matches latest labor law amendment", exec: "Legal review, HR sign-off, distribute to hiring managers" },
    { name: "Compile monthly HR headcount report", category: 6, owner: 3, priority: "low", status: "done", start: -15, due: -10, progress: 100, est: 4, act: 4, objective: "Accurate headcount by department delivered to leadership", exec: "Pull data from HRIS, validate, format report" },
    { name: "Investigate workplace grievance - dept 12", category: 7, owner: 1, priority: "critical", status: "blocked", start: -6, due: 1, progress: 20, est: 15, act: 4, objective: "Fair resolution documented within policy timeline", exec: "Interview parties, review evidence, escalate to legal" },
    { name: "Set up new hire training track - Customer Support", category: 3, owner: 2, priority: "medium", status: "not_started", start: 5, due: 25, progress: 0, est: 12, act: 0, objective: "Standardized ramp-up path for support hires", exec: "Curriculum design, LMS upload, pilot with next cohort" },
    { name: "Enroll 5 employees in social insurance", category: 2, owner: 0, priority: "high", status: "done", start: -12, due: -7, progress: 100, est: 6, act: 6, objective: "SI coverage active before probation ends", exec: "Collect documents, submit registration, confirm activation" },
    { name: "Review and renew vendor NDA agreements", category: 4, owner: 3, priority: "low", status: "pending", start: 0, due: 15, progress: 0, est: 5, act: 0, objective: "All active vendor NDAs current", exec: "Audit expiry dates, send renewal requests" },
    { name: "Prepare year-end tax documents for staff", category: 1, owner: 1, priority: "high", status: "not_started", start: 10, due: 45, progress: 0, est: 18, act: 0, objective: "PIT finalization docs ready before deadline", exec: "Gather income data, generate forms, distribute" },
    { name: "Audit attendance records - manufacturing floor", category: 7, owner: 2, priority: "medium", status: "in_progress", start: -4, due: 3, progress: 70, est: 10, act: 7, objective: "Attendance data matches biometric logs", exec: "Cross-check system logs, flag discrepancies" },
    { name: "Publish updated remote-work policy", category: 8, owner: 0, priority: "medium", status: "in_progress", start: -2, due: 8, progress: 45, est: 8, act: 3, objective: "Policy approved and communicated company-wide", exec: "Draft, leadership review, all-hands announcement" },
    { name: "Coordinate exit interview - resignation batch Nov", category: 9, owner: 3, priority: "low", status: "not_started", start: 2, due: 12, progress: 0, est: 6, act: 0, objective: "Exit feedback captured for all leavers", exec: "Schedule interviews, compile feedback themes" },
    { name: "Benchmark salary bands against market data", category: 5, owner: 1, priority: "high", status: "pending", start: -1, due: 18, progress: 10, est: 20, act: 2, objective: "Salary bands competitive within 3 months", exec: "Collect market survey data, model new bands" },
    { name: "Digitize employee personnel files", category: 0, owner: 2, priority: "low", status: "in_progress", start: -25, due: -2, progress: 85, est: 40, act: 34, objective: "All active files scanned and indexed", exec: "Scan, tag metadata, upload to document system" },
    { name: "Finalize social insurance annual settlement", category: 2, owner: 0, priority: "critical", status: "pending", start: -3, due: 4, progress: 25, est: 14, act: 3, objective: "Annual SI settlement filed accurately and on time", exec: "Reconcile contributions, prepare settlement report" },
    { name: "Design onboarding survey for new hires", category: 10, owner: 3, priority: "low", status: "done", start: -18, due: -14, progress: 100, est: 5, act: 4, objective: "Survey captures first-30-day sentiment", exec: "Draft questions, build in form tool, pilot test" },
    { name: "Review training completion rates - Q3", category: 3, owner: 1, priority: "medium", status: "done", start: -22, due: -18, progress: 100, est: 6, act: 6, objective: "Completion report shared with department heads", exec: "Pull LMS data, analyze gaps, present summary" },
    { name: "Update org chart after Q4 restructuring", category: 0, owner: 2, priority: "high", status: "in_progress", start: -2, due: 6, progress: 50, est: 8, act: 4, objective: "Org chart reflects new reporting lines", exec: "Confirm new structure with leadership, redraw chart" },
    { name: "HR policy training for new managers", category: 3, owner: 0, priority: "medium", status: "not_started", start: 7, due: 21, progress: 0, est: 10, act: 0, objective: "New managers certified on core HR policy", exec: "Book training room, prepare slides, run session" },
    { name: "Archive terminated employee records per retention policy", category: 9, owner: 3, priority: "low", status: "cancelled", start: -40, due: -30, progress: 0, est: 8, act: 0, objective: "Records archived per legal retention schedule", exec: "Identify eligible records, move to cold storage" },
  ];

  const taskRecordIds: string[] = [];
  for (const [i, t] of TASKS.entries()) {
    const record = await prisma.record.create({
      data: {
        tableId: tasksTable.id,
        order: i,
        createdById: pick(t.owner),
        data: JSON.stringify({
          [taskFields["Task Name"]]: t.name,
          [taskFields["Category"]]: CATEGORY_OPTIONS[t.category].id,
          [taskFields["Owner"]]: pick(t.owner),
          [taskFields["Priority"]]: t.priority,
          [taskFields["Status"]]: t.status,
          [taskFields["Start Date"]]: daysFromNow(t.start),
          [taskFields["Due Date"]]: daysFromNow(t.due),
          [taskFields["Progress"]]: t.progress,
          [taskFields["Estimated Hours"]]: t.est,
          [taskFields["Actual Hours"]]: t.act,
          [taskFields["Objective / Completion Criteria"]]: t.objective,
          [taskFields["Execution Detail"]]: t.exec,
        }),
      },
    });
    taskRecordIds.push(record.id);
  }

  // A handful of dependency links so the Gantt view has arrows to show out of the box.
  const DEPENDENCIES: Array<[number, number[]]> = [
    [3, [0]],
    [4, [2]],
    [10, [3]],
    [14, [1]],
    [19, [2]],
  ];
  for (const [taskIdx, dependsOnIdx] of DEPENDENCIES) {
    const record = await prisma.record.findUnique({ where: { id: taskRecordIds[taskIdx] } });
    if (!record) continue;
    const data = JSON.parse(record.data || "{}");
    data[taskFields["Depends On"]] = dependsOnIdx.map((i) => taskRecordIds[i]);
    await prisma.record.update({ where: { id: record.id }, data: { data: JSON.stringify(data) } });
  }

  await prisma.view.create({ data: { tableId: tasksTable.id, name: "All Tasks", type: "grid", isDefault: true, order: 0, config: JSON.stringify({ frozenCount: 1, rowHeight: "medium" }) } });
  await prisma.view.create({
    data: {
      tableId: tasksTable.id,
      name: "My Tasks",
      type: "grid",
      order: 1,
      config: JSON.stringify({ filters: { conjunction: "AND", conditions: [{ id: id(), fieldId: taskFields["Owner"], operator: "is_current_user" }] }, frozenCount: 1 }),
    },
  });
  await prisma.view.create({
    data: {
      tableId: tasksTable.id,
      name: "Overdue Tasks",
      type: "grid",
      order: 2,
      config: JSON.stringify({
        filters: { conjunction: "AND", conditions: [{ id: id(), fieldId: taskFields["Due Date"], operator: "before", value: new Date().toISOString().slice(0, 10) }, { id: id(), fieldId: taskFields["Status"], operator: "not_equals", value: "done" }] },
        conditionalFormats: [{ id: id(), fieldId: taskFields["Due Date"], operator: "before", value: new Date().toISOString().slice(0, 10), target: "row", color: "#ef4444" }],
        frozenCount: 1,
      }),
    },
  });
  await prisma.view.create({
    data: {
      tableId: tasksTable.id,
      name: "Completed Tasks",
      type: "grid",
      order: 3,
      config: JSON.stringify({ filters: { conjunction: "AND", conditions: [{ id: id(), fieldId: taskFields["Status"], operator: "equals", value: "done" }] }, frozenCount: 1 }),
    },
  });
  await prisma.view.create({
    data: {
      tableId: tasksTable.id,
      name: "By Category",
      type: "grid",
      order: 4,
      config: JSON.stringify({ group: { fieldId: taskFields["Category"], aggFn: "count" }, frozenCount: 1 }),
    },
  });
  await prisma.view.create({
    data: {
      tableId: tasksTable.id,
      name: "Gantt",
      type: "gantt",
      order: 5,
      config: JSON.stringify({
        ganttConfig: {
          taskFieldId: taskFields["Task Name"],
          startFieldId: taskFields["Start Date"],
          endFieldId: taskFields["Due Date"],
          progressFieldId: taskFields["Progress"],
          ownerFieldId: taskFields["Owner"],
          statusFieldId: taskFields["Status"],
          dependencyFieldId: taskFields["Depends On"],
          zoom: "day",
        },
      }),
    },
  });

  // ---------------- Employee ----------------
  const empTable = await prisma.tableDef.create({ data: { baseId: base.id, name: "Employee", icon: "Users", order: 1 } });
  const empStatus = [
    { id: "active", label: "Active", color: "#22c55e" },
    { id: "on_leave", label: "On Leave", color: "#eab308" },
    { id: "resigned", label: "Resigned", color: "#94a3b8" },
  ];
  const departments = ["Engineering", "HR", "Finance", "Sales", "Customer Support", "Operations"].map((label, i) => ({ id: `dept_${i}`, label, color: ["#6366f1", "#ec4899", "#0ea5e9", "#22c55e", "#f97316", "#8b5cf6"][i] }));
  const empFieldDefs = [
    { name: "Full Name", type: "text", isPrimary: true },
    { name: "Employee ID", type: "text" },
    { name: "Department", type: "single_select", config: { options: departments } },
    { name: "Position", type: "text" },
    { name: "Email", type: "email" },
    { name: "Phone", type: "phone" },
    { name: "Start Date", type: "date" },
    { name: "Status", type: "status", config: { options: empStatus } },
    { name: "Base Salary", type: "currency", config: { currencySymbol: "$" } },
  ];
  const empFields: Record<string, string> = {};
  for (const [i, f] of empFieldDefs.entries()) {
    const field = await prisma.field.create({ data: { tableId: empTable.id, name: f.name, type: f.type, order: i, isPrimary: !!f.isPrimary, config: f.config ? JSON.stringify(f.config) : null } });
    empFields[f.name] = field.id;
  }
  const EMPLOYEES = [
    ["Hieu Diu", 0, "HR Business Partner", "diuthihieu@gmail.com", -400, "active", 1800],
    ["An Tran", 0, "HR Generalist", "an.tran@bestarion.com", -300, "active", 1200],
    ["Linh Pham", 4, "Support Team Lead", "linh.pham@bestarion.com", -600, "active", 1500],
    ["Minh Nguyen", 5, "Operations Manager", "minh.nguyen@bestarion.com", -900, "active", 2200],
    ["Trang Le", 0, "Software Engineer", "trang.le@bestarion.com", -200, "active", 1900],
    ["Duc Vo", 0, "Software Engineer", "duc.vo@bestarion.com", -50, "active", 1700],
    ["Mai Huynh", 2, "Accountant", "mai.huynh@bestarion.com", -700, "active", 1400],
    ["Khoa Bui", 3, "Sales Executive", "khoa.bui@bestarion.com", -150, "on_leave", 1300],
    ["Yen Do", 4, "Customer Support Agent", "yen.do@bestarion.com", -30, "active", 1000],
    ["Phong Ha", 1, "Recruiter", "phong.ha@bestarion.com", -500, "resigned", 1250],
  ] as const;
  for (const [i, [name, dept, pos, email, start, status, salary]] of EMPLOYEES.entries()) {
    await prisma.record.create({
      data: {
        tableId: empTable.id,
        order: i,
        data: JSON.stringify({
          [empFields["Full Name"]]: name,
          [empFields["Employee ID"]]: `BES-${1000 + i}`,
          [empFields["Department"]]: departments[dept].id,
          [empFields["Position"]]: pos,
          [empFields["Email"]]: email,
          [empFields["Phone"]]: `090${1000000 + i * 37}`,
          [empFields["Start Date"]]: daysFromNow(start),
          [empFields["Status"]]: status,
          [empFields["Base Salary"]]: salary,
        }),
      },
    });
  }
  await prisma.view.create({ data: { tableId: empTable.id, name: "All Employees", type: "grid", isDefault: true, order: 0, config: JSON.stringify({ frozenCount: 1 }) } });
  await prisma.view.create({ data: { tableId: empTable.id, name: "By Department", type: "grid", order: 1, config: JSON.stringify({ group: { fieldId: empFields["Department"] }, frozenCount: 1 }) } });

  // ---------------- Social Insurance ----------------
  const siTable = await prisma.tableDef.create({ data: { baseId: base.id, name: "Social Insurance", icon: "ShieldCheck", order: 2 } });
  const siStatus = [
    { id: "active", label: "Active", color: "#22c55e" },
    { id: "pending", label: "Pending", color: "#eab308" },
    { id: "terminated", label: "Terminated", color: "#ef4444" },
  ];
  const siFieldDefs = [
    { name: "Employee Name", type: "text", isPrimary: true },
    { name: "SI Number", type: "text" },
    { name: "Enrollment Date", type: "date" },
    { name: "Monthly Contribution", type: "currency" },
    { name: "Status", type: "status", config: { options: siStatus } },
    { name: "Notes", type: "long_text" },
  ];
  const siFields: Record<string, string> = {};
  for (const [i, f] of siFieldDefs.entries()) {
    const field = await prisma.field.create({ data: { tableId: siTable.id, name: f.name, type: f.type, order: i, isPrimary: !!f.isPrimary, config: f.config ? JSON.stringify(f.config) : null } });
    siFields[f.name] = field.id;
  }
  for (const [i, [name]] of EMPLOYEES.entries()) {
    await prisma.record.create({
      data: {
        tableId: siTable.id,
        order: i,
        data: JSON.stringify({
          [siFields["Employee Name"]]: name,
          [siFields["SI Number"]]: `SI-VN-${88000 + i}`,
          [siFields["Enrollment Date"]]: daysFromNow(-400 + i * 10),
          [siFields["Monthly Contribution"]]: 120 + i * 5,
          [siFields["Status"]]: i === 7 ? "pending" : i === 9 ? "terminated" : "active",
          [siFields["Notes"]]: "",
        }),
      },
    });
  }
  await prisma.view.create({ data: { tableId: siTable.id, name: "Grid", type: "grid", isDefault: true, order: 0, config: "{}" } });

  // ---------------- Training ----------------
  const trainTable = await prisma.tableDef.create({ data: { baseId: base.id, name: "Training", icon: "GraduationCap", order: 3 } });
  const trainCategory = [
    { id: "compliance", label: "Compliance", color: "#ef4444" },
    { id: "technical", label: "Technical", color: "#3b82f6" },
    { id: "soft_skills", label: "Soft Skills", color: "#22c55e" },
    { id: "onboarding", label: "Onboarding", color: "#8b5cf6" },
  ];
  const trainStatus = [
    { id: "not_started", label: "Not Started", color: "#94a3b8" },
    { id: "in_progress", label: "In Progress", color: "#3b82f6" },
    { id: "completed", label: "Completed", color: "#22c55e" },
  ];
  const trainFieldDefs = [
    { name: "Course Name", type: "text", isPrimary: true },
    { name: "Employee", type: "text" },
    { name: "Category", type: "single_select", config: { options: trainCategory } },
    { name: "Start Date", type: "date" },
    { name: "End Date", type: "date" },
    { name: "Status", type: "status", config: { options: trainStatus } },
    { name: "Score", type: "number" },
    { name: "Certificate", type: "checkbox" },
  ];
  const trainFields: Record<string, string> = {};
  for (const [i, f] of trainFieldDefs.entries()) {
    const field = await prisma.field.create({ data: { tableId: trainTable.id, name: f.name, type: f.type, order: i, isPrimary: !!f.isPrimary, config: f.config ? JSON.stringify(f.config) : null } });
    trainFields[f.name] = field.id;
  }
  const TRAININGS = [
    ["Workplace Safety Compliance", "Trang Le", 0, -20, -18, "completed", 92, true],
    ["Data Privacy & PDPA Basics", "Duc Vo", 0, -15, -14, "completed", 88, true],
    ["Advanced React Patterns", "Trang Le", 1, -10, 5, "in_progress", null, false],
    ["Leadership Fundamentals", "Minh Nguyen", 2, -30, -25, "completed", 95, true],
    ["New Hire Orientation", "Yen Do", 3, -5, -3, "completed", 100, true],
    ["Conflict Resolution Skills", "Linh Pham", 2, 2, 10, "not_started", null, false],
    ["Cloud Infrastructure Basics", "Duc Vo", 1, 3, 20, "not_started", null, false],
    ["Anti-Harassment Policy Training", "Khoa Bui", 0, -8, -7, "completed", 90, true],
    ["Customer Service Excellence", "Yen Do", 2, -12, -10, "completed", 85, true],
    ["Financial Reporting Standards", "Mai Huynh", 1, -6, 8, "in_progress", null, false],
  ] as const;
  for (const [i, [course, emp, cat, start, end, status, score, cert]] of TRAININGS.entries()) {
    await prisma.record.create({
      data: {
        tableId: trainTable.id,
        order: i,
        data: JSON.stringify({
          [trainFields["Course Name"]]: course,
          [trainFields["Employee"]]: emp,
          [trainFields["Category"]]: trainCategory[cat].id,
          [trainFields["Start Date"]]: daysFromNow(start),
          [trainFields["End Date"]]: daysFromNow(end),
          [trainFields["Status"]]: status,
          [trainFields["Score"]]: score,
          [trainFields["Certificate"]]: cert,
        }),
      },
    });
  }
  await prisma.view.create({ data: { tableId: trainTable.id, name: "Grid", type: "grid", isDefault: true, order: 0, config: "{}" } });

  // ---------------- Audit Log (demo table) ----------------
  const auditTable = await prisma.tableDef.create({ data: { baseId: base.id, name: "Audit Log", icon: "FileSearch", order: 4 } });
  const auditObjectType = ["Payroll", "Employee Record", "Contract", "Attendance", "Policy"].map((label, i) => ({ id: `obj_${i}`, label, color: ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#8b5cf6"][i] }));
  const auditResult = [
    { id: "pass", label: "Pass", color: "#22c55e" },
    { id: "fail", label: "Fail", color: "#ef4444" },
    { id: "warning", label: "Warning", color: "#eab308" },
  ];
  const auditFieldDefs = [
    { name: "Action", type: "text", isPrimary: true },
    { name: "Object Type", type: "single_select", config: { options: auditObjectType } },
    { name: "Performed By", type: "person" },
    { name: "Date", type: "datetime" },
    { name: "Result", type: "single_select", config: { options: auditResult } },
    { name: "Notes", type: "long_text" },
  ];
  const auditFields: Record<string, string> = {};
  for (const [i, f] of auditFieldDefs.entries()) {
    const field = await prisma.field.create({ data: { tableId: auditTable.id, name: f.name, type: f.type, order: i, isPrimary: !!f.isPrimary, config: f.config ? JSON.stringify(f.config) : null } });
    auditFields[f.name] = field.id;
  }
  const AUDITS = [
    ["Reviewed October payroll batch", 0, 1, -14, "pass", "No discrepancies found"],
    ["Verified new hire SI enrollment", 2, 0, -12, "pass", "All within statutory deadline"],
    ["Checked contract renewal compliance", 2, 3, -9, "warning", "2 contracts expiring within 30 days"],
    ["Audited attendance records - floor B", 3, 2, -6, "fail", "Discrepancy in 5 records, escalated"],
    ["Reviewed remote-work policy draft", 4, 0, -3, "pass", "Approved for publication"],
    ["Verified employee record digitization", 1, 2, -20, "pass", "98% of files migrated successfully"],
    ["Checked termination settlement accuracy", 1, 1, -25, "pass", "Final pay matched calculation"],
    ["Reviewed vendor NDA compliance", 2, 3, -18, "warning", "1 NDA missing signature"],
    ["Audited social insurance settlement filing", 0, 0, -2, "pass", "Filed within deadline"],
    ["Reviewed performance evaluation records", 1, 1, -30, "pass", "All evaluations documented"],
  ] as const;
  for (const [i, [action, objType, by, date, result, notes]] of AUDITS.entries()) {
    await prisma.record.create({
      data: {
        tableId: auditTable.id,
        order: i,
        data: JSON.stringify({
          [auditFields["Action"]]: action,
          [auditFields["Object Type"]]: auditObjectType[objType].id,
          [auditFields["Performed By"]]: pick(by),
          [auditFields["Date"]]: new Date(Date.now() + date * 86400000).toISOString(),
          [auditFields["Result"]]: result,
          [auditFields["Notes"]]: notes,
        }),
      },
    });
  }
  await prisma.view.create({ data: { tableId: auditTable.id, name: "Grid", type: "grid", isDefault: true, order: 0, config: "{}" } });

  console.log("Seed complete. Demo login: diuthihieu@gmail.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
