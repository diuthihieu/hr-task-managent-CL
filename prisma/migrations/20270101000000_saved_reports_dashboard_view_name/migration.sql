-- CreateTable
CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID,
    "dashboard_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "file_name" VARCHAR(160) NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "charts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_reports_user_id_workspace_id_created_at_idx" ON "saved_reports"("user_id", "workspace_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Report views are now called "Dashboard": rename views that still carry the old default name.
UPDATE "views" SET "name" = 'Dashboard' WHERE "type" = 'report' AND "name" = 'Report (charts & pivot)';
UPDATE "views" SET "name" = 'Bảng điều khiển' WHERE "type" = 'report' AND "name" = 'Báo cáo (biểu đồ & pivot)';
