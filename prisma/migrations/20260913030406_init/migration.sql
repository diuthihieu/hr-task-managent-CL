-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Base" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Database',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableDef" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Sheet',
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Field" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "defaultValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'grid',
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL DEFAULT '[]',
    "filters" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardBlock" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "config" TEXT NOT NULL DEFAULT '{}',
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "w" INTEGER NOT NULL DEFAULT 4,
    "h" INTEGER NOT NULL DEFAULT 4,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DashboardBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowNode" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,

    CONSTRAINT "WorkflowNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    "log" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "recordId" TEXT,
    "fieldId" TEXT,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Base_workspaceId_idx" ON "Base"("workspaceId");

-- CreateIndex
CREATE INDEX "TableDef_baseId_idx" ON "TableDef"("baseId");

-- CreateIndex
CREATE INDEX "Field_tableId_idx" ON "Field"("tableId");

-- CreateIndex
CREATE INDEX "Record_tableId_idx" ON "Record"("tableId");

-- CreateIndex
CREATE INDEX "View_tableId_idx" ON "View"("tableId");

-- CreateIndex
CREATE INDEX "Comment_recordId_idx" ON "Comment"("recordId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_objectType_objectId_idx" ON "AuditLog"("workspaceId", "objectType", "objectId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Base" ADD CONSTRAINT "Base_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableDef" ADD CONSTRAINT "TableDef_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "TableDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "TableDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "TableDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardBlock" ADD CONSTRAINT "DashboardBlock_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowNode" ADD CONSTRAINT "WorkflowNode_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
