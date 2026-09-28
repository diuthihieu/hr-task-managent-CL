-- CreateEnum
CREATE TYPE "FocusStatus" AS ENUM ('running', 'paused', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "key_results" ADD COLUMN     "confidence" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "due_date" DATE;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actioned_at" TIMESTAMPTZ(6),
ADD COLUMN     "snoozed_until" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "actual_minutes" INTEGER;

-- CreateTable
CREATE TABLE "comment_mentions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateTable
CREATE TABLE "focus_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "FocusStatus" NOT NULL DEFAULT 'running',
    "planned_minutes" INTEGER,
    "elapsed_seconds" INTEGER NOT NULL DEFAULT 0,
    "resumed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "checklist" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comment_mentions_user_id_idx" ON "comment_mentions"("user_id");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_status_idx" ON "focus_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "focus_sessions_task_id_idx" ON "focus_sessions"("task_id");

-- CreateIndex
CREATE INDEX "focus_sessions_workspace_id_started_at_idx" ON "focus_sessions"("workspace_id", "started_at");

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "tasks" ADD CONSTRAINT "tasks_actual_minutes_nonneg" CHECK ("actual_minutes" IS NULL OR "actual_minutes" >= 0);
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_confidence_range" CHECK ("confidence" BETWEEN 0 AND 100);
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_elapsed_nonneg" CHECK ("elapsed_seconds" >= 0);

-- A task's focus session belongs to the task's workspace.
CREATE OR REPLACE FUNCTION enforce_focus_session_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'focus session task must belong to the session workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER focus_sessions_enforce_tenant BEFORE INSERT OR UPDATE OF task_id, workspace_id ON "focus_sessions"
  FOR EACH ROW EXECUTE FUNCTION enforce_focus_session_tenant();
