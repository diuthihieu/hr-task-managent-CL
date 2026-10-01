-- Structured and relational values for advanced custom fields.
ALTER TABLE "task_custom_field_values"
  ADD COLUMN "value_team_id" UUID,
  ADD COLUMN "value_task_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "value_json" JSONB;

ALTER TABLE "task_custom_field_values"
  ADD CONSTRAINT "task_custom_field_values_value_team_id_fkey"
  FOREIGN KEY ("value_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "task_custom_field_values_custom_field_id_value_team_id_idx"
  ON "task_custom_field_values"("custom_field_id", "value_team_id");

-- Blob completion callbacks are at-least-once; the storage key makes their
-- metadata insert idempotent even when two callbacks race.
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- The existing scope trigger is extended so direct SQL writes cannot create
-- a cross-workspace team or linked-task reference.
CREATE OR REPLACE FUNCTION enforce_custom_value_scope() RETURNS trigger AS $$
DECLARE
  source_workspace UUID;
  source_project UUID;
BEGIN
  SELECT t.workspace_id, t.project_id
    INTO source_workspace, source_project
  FROM tasks t
  WHERE t.id = NEW.task_id;

  IF NOT EXISTS (
    SELECT 1 FROM custom_fields f
    WHERE f.project_id = source_project AND f.id = NEW.custom_field_id
  ) THEN
    RAISE EXCEPTION 'custom field must be defined on the task project' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.value_option_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM custom_field_options WHERE id = NEW.value_option_id AND custom_field_id = NEW.custom_field_id
  ) THEN
    RAISE EXCEPTION 'option does not belong to this custom field' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.value_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM teams WHERE id = NEW.value_team_id AND workspace_id = source_workspace
  ) THEN
    RAISE EXCEPTION 'team must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;

  IF cardinality(NEW.value_task_ids) > 0 AND EXISTS (
    SELECT 1
    FROM unnest(NEW.value_task_ids) AS linked_id
    LEFT JOIN tasks linked ON linked.id = linked_id
    WHERE linked.id IS NULL
       OR linked.workspace_id <> source_workspace
       OR linked.project_id <> source_project
       OR linked.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'linked tasks must belong to the same project' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Database-backed, multi-instance rate limiting.
CREATE TABLE "rate_limit_buckets" (
  "key_hash" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "reset_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key_hash"),
  CONSTRAINT "rate_limit_buckets_count_nonnegative" CHECK ("count" >= 0)
);
CREATE INDEX "rate_limit_buckets_reset_at_idx" ON "rate_limit_buckets"("reset_at");

-- Cold audit storage. No foreign keys by design: audit history must survive
-- deletion of the referenced workspace/user/entity.
CREATE TABLE "activity_log_archives" (
  "id" UUID NOT NULL,
  "workspace_id" UUID,
  "actor_id" UUID,
  "entity_type" VARCHAR(40) NOT NULL,
  "entity_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "summary" TEXT,
  "changes" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "archived_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_log_archives_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "activity_log_archives_workspace_id_created_at_idx"
  ON "activity_log_archives"("workspace_id", "created_at" DESC);
CREATE INDEX "activity_log_archives_entity_type_entity_id_created_at_idx"
  ON "activity_log_archives"("entity_type", "entity_id", "created_at" DESC);

-- Cursor pagination for active task grids.
CREATE INDEX "tasks_project_active_sort_cursor_idx"
  ON "tasks"("project_id", "sort_order", "created_at", "id")
  WHERE "deleted_at" IS NULL;
