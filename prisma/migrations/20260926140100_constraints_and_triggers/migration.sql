-- Integrity rules Prisma's schema language cannot express. Kept in the
-- migration history (never applied by hand) so every environment matches.

-- ---------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_format" CHECK ("email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD CONSTRAINT "users_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "projects_date_range" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");

ALTER TABLE "statuses"
  ADD CONSTRAINT "statuses_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "tasks_progress_range" CHECK ("progress" BETWEEN 0 AND 100),
  ADD CONSTRAINT "tasks_estimate_non_negative" CHECK ("estimate_minutes" IS NULL OR "estimate_minutes" >= 0),
  ADD CONSTRAINT "tasks_okr_weight_positive" CHECK ("okr_weight" > 0),
  ADD CONSTRAINT "tasks_date_range" CHECK ("due_date" IS NULL OR "start_date" IS NULL OR "due_date" >= "start_date"),
  ADD CONSTRAINT "tasks_not_own_parent" CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id");

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_no_self" CHECK ("task_id" <> "depends_on_task_id"),
  ADD CONSTRAINT "task_dependencies_lag_range" CHECK ("lag_days" BETWEEN -365 AND 365);

ALTER TABLE "custom_fields"
  ADD CONSTRAINT "custom_fields_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_size_non_negative" CHECK ("size_bytes" >= 0);

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_body_not_blank" CHECK (length(btrim("body")) > 0);

ALTER TABLE "objectives"
  ADD CONSTRAINT "objectives_confidence_range" CHECK ("confidence" BETWEEN 0 AND 100),
  ADD CONSTRAINT "objectives_date_range" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "objectives_not_own_parent" CHECK ("parent_objective_id" IS NULL OR "parent_objective_id" <> "id");

ALTER TABLE "key_results"
  ADD CONSTRAINT "key_results_weight_positive" CHECK ("weight" > 0),
  ADD CONSTRAINT "key_results_manual_progress_range" CHECK ("manual_progress" IS NULL OR "manual_progress" BETWEEN 0 AND 100);

ALTER TABLE "captured_thoughts"
  ADD CONSTRAINT "captured_thoughts_duration_non_negative" CHECK ("estimated_duration_minutes" IS NULL OR "estimated_duration_minutes" >= 0);

-- At most one default status per workspace.
CREATE UNIQUE INDEX "statuses_one_default_per_workspace" ON "statuses" ("workspace_id") WHERE "is_default";

-- ---------------------------------------------------------------------------
-- Tenant integrity: a task's project, status, category, parent task and key
-- result must all live in the task's own workspace. Enforced in the
-- database so no API bug can link data across workspaces.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_task_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'task project must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM statuses WHERE id = NEW.status_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'task status must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'task category must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.parent_task_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'parent task must belong to the same project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.key_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM key_results kr JOIN objectives o ON o.id = kr.objective_id
    WHERE kr.id = NEW.key_result_id AND o.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'task key result must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tasks_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, project_id, status_id, category_id, parent_task_id, key_result_id ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION enforce_task_tenant();

-- Dependencies only between tasks of the same workspace.
CREATE OR REPLACE FUNCTION enforce_dependency_tenant() RETURNS trigger AS $$
BEGIN
  IF (SELECT workspace_id FROM tasks WHERE id = NEW.task_id) IS DISTINCT FROM (SELECT workspace_id FROM tasks WHERE id = NEW.depends_on_task_id) THEN
    RAISE EXCEPTION 'dependent tasks must belong to the same workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_dependencies_enforce_tenant"
  BEFORE INSERT OR UPDATE ON "task_dependencies"
  FOR EACH ROW EXECUTE FUNCTION enforce_dependency_tenant();

-- Assignees must be members of the task's workspace.
CREATE OR REPLACE FUNCTION enforce_assignee_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tasks t JOIN workspace_members m ON m.workspace_id = t.workspace_id
    WHERE t.id = NEW.task_id AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'assignee must be a member of the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_assignees_enforce_membership"
  BEFORE INSERT OR UPDATE ON "task_assignees"
  FOR EACH ROW EXECUTE FUNCTION enforce_assignee_membership();

-- Custom field values: the field must be defined on the task's project, and
-- a chosen option must belong to that field.
CREATE OR REPLACE FUNCTION enforce_custom_value_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tasks t JOIN custom_fields f ON f.project_id = t.project_id
    WHERE t.id = NEW.task_id AND f.id = NEW.custom_field_id
  ) THEN
    RAISE EXCEPTION 'custom field must be defined on the task project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.value_option_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM custom_field_options WHERE id = NEW.value_option_id AND custom_field_id = NEW.custom_field_id
  ) THEN
    RAISE EXCEPTION 'option does not belong to this custom field' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_custom_field_values_enforce_scope"
  BEFORE INSERT OR UPDATE ON "task_custom_field_values"
  FOR EACH ROW EXECUTE FUNCTION enforce_custom_value_scope();

-- ---------------------------------------------------------------------------
-- Activity log is append-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_activity_log_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "activity_logs_append_only"
  BEFORE UPDATE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_activity_log_update();
