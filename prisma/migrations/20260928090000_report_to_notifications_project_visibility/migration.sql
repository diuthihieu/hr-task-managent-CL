-- "Report to" recipients on tasks, in-app notifications and per-member
-- project visibility (a project is hidden only from the listed members).

-- CreateTable
CREATE TABLE "task_report_recipients" (
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,

    CONSTRAINT "task_report_recipients_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "thought_id" UUID,
    "actor_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "link" VARCHAR(500),
    "dedupe_key" VARCHAR(200),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_hidden_members" (
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "project_hidden_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateIndex
CREATE INDEX "task_report_recipients_user_id_idx" ON "task_report_recipients"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_task_id_idx" ON "notifications"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "project_hidden_members_user_id_idx" ON "project_hidden_members"("user_id");

-- AddForeignKey
ALTER TABLE "task_report_recipients" ADD CONSTRAINT "task_report_recipients_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_report_recipients" ADD CONSTRAINT "task_report_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "captured_thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_hidden_members" ADD CONSTRAINT "project_hidden_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_hidden_members" ADD CONSTRAINT "project_hidden_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A notification must have a title.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_title_not_blank" CHECK (length(btrim("title")) > 0);

-- Report recipients must be members of the task's workspace.
CREATE OR REPLACE FUNCTION enforce_report_recipient_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tasks t JOIN workspace_members m ON m.workspace_id = t.workspace_id
    WHERE t.id = NEW.task_id AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'report recipient must be a member of the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_report_recipients_enforce_membership"
  BEFORE INSERT OR UPDATE ON "task_report_recipients"
  FOR EACH ROW EXECUTE FUNCTION enforce_report_recipient_membership();

-- A project can only be hidden from members of its own workspace.
CREATE OR REPLACE FUNCTION enforce_hidden_member_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id
    WHERE p.id = NEW.project_id AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'hidden member must be a member of the project workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "project_hidden_members_enforce_membership"
  BEFORE INSERT OR UPDATE ON "project_hidden_members"
  FOR EACH ROW EXECUTE FUNCTION enforce_hidden_member_membership();
