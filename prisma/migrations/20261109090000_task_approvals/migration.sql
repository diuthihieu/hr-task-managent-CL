-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "task_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "requested_by" UUID,
    "approver_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "note" VARCHAR(2000),
    "decision_note" VARCHAR(2000),
    "complete_on_approve" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "task_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_approvals_task_id_created_at_idx" ON "task_approvals"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_approvals_approver_id_status_idx" ON "task_approvals"("approver_id", "status");

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An approval stays in its task's workspace.
CREATE OR REPLACE FUNCTION enforce_task_approval_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'approval task must belong to the approval workspace' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.approver_id) THEN
    RAISE EXCEPTION 'approver must be a member of the task workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER task_approvals_enforce_tenant BEFORE INSERT OR UPDATE OF task_id, workspace_id, approver_id ON "task_approvals"
  FOR EACH ROW EXECUTE FUNCTION enforce_task_approval_tenant();
-- One open request per task and approver.
CREATE UNIQUE INDEX "task_approvals_one_pending" ON "task_approvals" ("task_id", "approver_id") WHERE "status" = 'pending';
