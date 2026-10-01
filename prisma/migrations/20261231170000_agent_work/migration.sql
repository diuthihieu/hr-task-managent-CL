-- Agent Work is additive: existing AI conversations, tasks, comments and files
-- remain the source of truth. New tables record agent-specific lifecycle data.

CREATE TYPE "agent_origin_type" AS ENUM ('task', 'wiki', 'dashboard', 'chat', 'workspace');
CREATE TYPE "agent_run_status" AS ENUM ('suggested', 'confirming', 'planning', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled');
CREATE TYPE "agent_suggestion_status" AS ENUM ('open', 'accepted', 'dismissed', 'expired');
CREATE TYPE "agent_skill_visibility" AS ENUM ('private', 'specific_people', 'organization');
CREATE TYPE "agent_output_type" AS ENUM ('markdown', 'text', 'json', 'file');
CREATE TYPE "agent_approval_kind" AS ENUM ('payroll', 'legal', 'termination', 'external_communication', 'delete_data', 'change_permission', 'database_write');
CREATE TYPE "agent_suggestion_mode" AS ENUM ('silent', 'smart', 'proactive');

ALTER TABLE "workspaces"
  ADD COLUMN "project_history_member_days" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "workspaces_project_history_member_days_range" CHECK ("project_history_member_days" BETWEEN 0 AND 365);

ALTER TABLE "views" ADD COLUMN "is_base" BOOLEAN NOT NULL DEFAULT false;
WITH ranked_views AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "project_id"
    ORDER BY "is_default" DESC, "sort_order", "created_at", "id"
  ) AS "position"
  FROM "views"
)
UPDATE "views" AS target
SET "is_base" = true
FROM ranked_views
WHERE target."id" = ranked_views."id" AND ranked_views."position" = 1;
CREATE UNIQUE INDEX "views_one_base_per_project_idx" ON "views"("project_id") WHERE "is_base" = true;

ALTER TYPE "AiConversationKind" ADD VALUE IF NOT EXISTS 'agent';

CREATE TABLE "agent_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "proactive_enabled" BOOLEAN NOT NULL DEFAULT false,
  "suggestion_mode" "agent_suggestion_mode" NOT NULL DEFAULT 'smart',
  "minimum_confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.9,
  "scan_scope" JSONB NOT NULL DEFAULT '{}',
  "require_confirmation" BOOLEAN NOT NULL DEFAULT true,
  "automatic_execution" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_settings_confidence_check" CHECK ("minimum_confidence" >= 0 AND "minimum_confidence" <= 1),
  CONSTRAINT "agent_settings_automatic_requires_no_confirmation" CHECK (NOT "automatic_execution" OR NOT "require_confirmation")
);

CREATE TABLE "agent_skills" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "owner_id" UUID,
  "system_key" VARCHAR(80),
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(1000),
  "instructions" TEXT NOT NULL,
  "triggers" JSONB NOT NULL DEFAULT '[]',
  "input_schema" JSONB NOT NULL DEFAULT '{}',
  "workflow" JSONB NOT NULL DEFAULT '[]',
  "tools_allowed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reference_files" JSONB NOT NULL DEFAULT '[]',
  "templates" JSONB NOT NULL DEFAULT '[]',
  "validation_rules" JSONB NOT NULL DEFAULT '[]',
  "output_definitions" JSONB NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 1,
  "visibility" "agent_skill_visibility" NOT NULL DEFAULT 'private',
  "source_conversation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_skills_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "agent_skills_instructions_not_blank" CHECK (length(btrim("instructions")) > 0),
  CONSTRAINT "agent_skills_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "agent_skill_activations" (
  "skill_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agent_skill_activations_pkey" PRIMARY KEY ("skill_id", "user_id")
);

CREATE TABLE "agent_skill_shares" (
  "skill_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_skill_shares_pkey" PRIMARY KEY ("skill_id", "user_id")
);

CREATE TABLE "agent_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "skill_version" INTEGER NOT NULL DEFAULT 1,
  "skill_snapshot" JSONB NOT NULL DEFAULT '{}',
  "origin_type" "agent_origin_type" NOT NULL,
  "origin_id" UUID,
  "project_id" UUID,
  "task_id" UUID,
  "goal" VARCHAR(4000) NOT NULL,
  "plan" JSONB NOT NULL DEFAULT '[]',
  "status" "agent_run_status" NOT NULL DEFAULT 'suggested',
  "tools_used" JSONB NOT NULL DEFAULT '[]',
  "inputs" JSONB NOT NULL DEFAULT '{}',
  "outputs_meta" JSONB NOT NULL DEFAULT '[]',
  "logs" JSONB NOT NULL DEFAULT '[]',
  "output_summary" TEXT,
  "failure_reason" VARCHAR(4000),
  "suggested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_runs_goal_not_blank" CHECK (length(btrim("goal")) > 0),
  CONSTRAINT "agent_runs_skill_version_positive" CHECK ("skill_version" > 0)
);

CREATE TABLE "agent_suggestions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "reason" VARCHAR(1200) NOT NULL,
  "proposed_goal" VARCHAR(4000) NOT NULL,
  "impact" VARCHAR(800) NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "status" "agent_suggestion_status" NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agent_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_suggestions_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "agent_run_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "actor_id" UUID,
  "from_status" "agent_run_status",
  "to_status" "agent_run_status",
  "level" VARCHAR(20) NOT NULL DEFAULT 'info',
  "message" VARCHAR(2000) NOT NULL,
  "data" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_tool_uses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "tool_name" VARCHAR(120) NOT NULL,
  "risk_level" VARCHAR(30) NOT NULL DEFAULT 'safe',
  "status" VARCHAR(30) NOT NULL DEFAULT 'running',
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB,
  "error" VARCHAR(4000),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "agent_tool_uses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "kind" "agent_approval_kind" NOT NULL,
  "requested_by" UUID,
  "approver_id" UUID NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
  "reason" VARCHAR(2000) NOT NULL,
  "decision_note" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  CONSTRAINT "agent_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_outputs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "conversation_id" UUID,
  "task_id" UUID,
  "project_id" UUID,
  "created_by" UUID NOT NULL,
  "filename" VARCHAR(255) NOT NULL,
  "type" "agent_output_type" NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "content_text" TEXT,
  "storage_provider" VARCHAR(40),
  "storage_key" TEXT,
  "url" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "agent_outputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_outputs_size_nonnegative" CHECK ("size_bytes" >= 0),
  CONSTRAINT "agent_outputs_body_check" CHECK ("content_text" IS NOT NULL OR "url" IS NOT NULL)
);

ALTER TABLE "ai_conversations"
  ADD COLUMN "origin_type" "agent_origin_type",
  ADD COLUMN "origin_id" UUID,
  ADD COLUMN "project_id" UUID,
  ADD COLUMN "task_id" UUID,
  ADD COLUMN "skill_id" UUID,
  ADD COLUMN "agent_run_id" UUID,
  ADD COLUMN "files" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "comments" ADD COLUMN "agent_run_id" UUID;

CREATE UNIQUE INDEX "agent_settings_workspace_id_user_id_key" ON "agent_settings"("workspace_id", "user_id");
CREATE INDEX "agent_settings_user_id_idx" ON "agent_settings"("user_id");
CREATE UNIQUE INDEX "agent_skills_workspace_id_system_key_key" ON "agent_skills"("workspace_id", "system_key");
CREATE INDEX "agent_skills_workspace_id_visibility_deleted_at_idx" ON "agent_skills"("workspace_id", "visibility", "deleted_at");
CREATE INDEX "agent_skills_owner_id_deleted_at_idx" ON "agent_skills"("owner_id", "deleted_at");
CREATE INDEX "agent_skills_source_conversation_id_idx" ON "agent_skills"("source_conversation_id");
CREATE INDEX "agent_skill_activations_user_id_active_idx" ON "agent_skill_activations"("user_id", "active");
CREATE INDEX "agent_skill_shares_user_id_idx" ON "agent_skill_shares"("user_id");
CREATE INDEX "agent_runs_user_id_workspace_id_status_updated_at_idx" ON "agent_runs"("user_id", "workspace_id", "status", "updated_at" DESC);
CREATE INDEX "agent_runs_task_id_created_at_idx" ON "agent_runs"("task_id", "created_at" DESC);
CREATE INDEX "agent_runs_skill_id_created_at_idx" ON "agent_runs"("skill_id", "created_at" DESC);
CREATE UNIQUE INDEX "agent_suggestions_run_id_key" ON "agent_suggestions"("run_id");
CREATE INDEX "agent_suggestions_user_id_workspace_id_status_confidence_idx" ON "agent_suggestions"("user_id", "workspace_id", "status", "confidence" DESC);
CREATE INDEX "agent_suggestions_task_id_created_at_idx" ON "agent_suggestions"("task_id", "created_at" DESC);
CREATE UNIQUE INDEX "agent_suggestions_one_open_per_task_skill" ON "agent_suggestions"("user_id", "task_id", "skill_id") WHERE "status" = 'open';
CREATE INDEX "agent_run_events_run_id_created_at_idx" ON "agent_run_events"("run_id", "created_at");
CREATE INDEX "agent_tool_uses_run_id_started_at_idx" ON "agent_tool_uses"("run_id", "started_at");
CREATE INDEX "agent_approvals_run_id_status_idx" ON "agent_approvals"("run_id", "status");
CREATE INDEX "agent_approvals_approver_id_status_idx" ON "agent_approvals"("approver_id", "status");
CREATE INDEX "agent_outputs_created_by_workspace_id_created_at_idx" ON "agent_outputs"("created_by", "workspace_id", "created_at" DESC);
CREATE INDEX "agent_outputs_run_id_idx" ON "agent_outputs"("run_id");
CREATE INDEX "agent_outputs_task_id_created_at_idx" ON "agent_outputs"("task_id", "created_at" DESC);
CREATE INDEX "agent_outputs_skill_id_created_at_idx" ON "agent_outputs"("skill_id", "created_at" DESC);
CREATE UNIQUE INDEX "ai_conversations_agent_run_id_key" ON "ai_conversations"("agent_run_id");
CREATE INDEX "ai_conversations_user_id_workspace_id_updated_at_idx" ON "ai_conversations"("user_id", "workspace_id", "updated_at" DESC);
CREATE INDEX "ai_conversations_origin_type_origin_id_idx" ON "ai_conversations"("origin_type", "origin_id");
CREATE UNIQUE INDEX "comments_agent_run_id_key" ON "comments"("agent_run_id");

ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_skill_activations" ADD CONSTRAINT "agent_skill_activations_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "agent_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skill_activations" ADD CONSTRAINT "agent_skill_activations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skill_shares" ADD CONSTRAINT "agent_skill_shares_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "agent_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skill_shares" ADD CONSTRAINT "agent_skill_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "agent_skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "agent_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_tool_uses" ADD CONSTRAINT "agent_tool_uses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "agent_skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "agent_skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce tenant boundaries for agent-owned records even for direct SQL writes.
CREATE OR REPLACE FUNCTION enforce_agent_run_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_skills s WHERE s.id = NEW.skill_id AND s.workspace_id = NEW.workspace_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'agent skill must belong to the run workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.workspace_id = NEW.workspace_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'agent run project must belong to the run workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.workspace_id = NEW.workspace_id AND t.deleted_at IS NULL
      AND (NEW.project_id IS NULL OR t.project_id = NEW.project_id)
  ) THEN
    RAISE EXCEPTION 'agent run task must belong to the run workspace/project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_runs_enforce_scope BEFORE INSERT OR UPDATE OF workspace_id, skill_id, project_id, task_id ON "agent_runs"
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_run_scope();

CREATE OR REPLACE FUNCTION enforce_agent_suggestion_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agent_runs r
    JOIN tasks t ON t.id = NEW.task_id
    JOIN agent_skills s ON s.id = NEW.skill_id
    WHERE r.id = NEW.run_id AND r.workspace_id = NEW.workspace_id AND r.user_id = NEW.user_id
      AND r.task_id = NEW.task_id AND r.skill_id = NEW.skill_id
      AND t.workspace_id = NEW.workspace_id AND s.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'agent suggestion scope does not match its run' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_suggestions_enforce_scope BEFORE INSERT OR UPDATE OF workspace_id, user_id, task_id, skill_id, run_id ON "agent_suggestions"
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_suggestion_scope();

CREATE OR REPLACE FUNCTION enforce_agent_output_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agent_runs r
    WHERE r.id = NEW.run_id AND r.workspace_id = NEW.workspace_id
      AND r.user_id = NEW.created_by AND r.skill_id = NEW.skill_id
      AND (NEW.task_id IS NULL OR r.task_id = NEW.task_id)
      AND (NEW.project_id IS NULL OR r.project_id = NEW.project_id)
  ) THEN
    RAISE EXCEPTION 'agent output scope does not match its run' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_outputs_enforce_scope BEFORE INSERT OR UPDATE OF workspace_id, run_id, skill_id, task_id, project_id, created_by ON "agent_outputs"
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_output_scope();
