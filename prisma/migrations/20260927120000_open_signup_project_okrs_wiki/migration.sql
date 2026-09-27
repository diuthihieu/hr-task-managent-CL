-- Open sign-up, per-user preferences, per-project categories, project-level
-- OKRs with cascading (KR -> child objective), task -> objective link, rich
-- record pages, project wiki and the "report" view type.

-- AlterEnum
ALTER TYPE "view_type" ADD VALUE 'report';

-- ---------------------------------------------------------------------------
-- Users: UI preferences
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "accent_color" VARCHAR(20) NOT NULL DEFAULT 'indigo',
ADD COLUMN "locale" VARCHAR(5) NOT NULL DEFAULT 'vi';

ALTER TABLE "users"
  ADD CONSTRAINT "users_locale_supported" CHECK ("locale" IN ('vi', 'en')),
  ADD CONSTRAINT "users_accent_color_format" CHECK ("accent_color" ~ '^[a-z]+$');

-- ---------------------------------------------------------------------------
-- Categories move from workspace scope to project scope.
-- Existing workspace categories are copied into every project of their
-- workspace and tasks / captured thoughts are re-pointed to their project's
-- copy, so no task loses its category.
-- ---------------------------------------------------------------------------
DROP INDEX "categories_workspace_id_name_key";
DROP INDEX "categories_workspace_id_sort_order_idx";

ALTER TABLE "categories" ADD COLUMN "project_id" UUID;

CREATE TEMP TABLE "_category_map" AS
SELECT c."id" AS "old_id", p."id" AS "project_id", gen_random_uuid() AS "new_id"
FROM "categories" c
JOIN "projects" p ON p."workspace_id" = c."workspace_id"
WHERE c."project_id" IS NULL;

INSERT INTO "categories" ("id", "workspace_id", "project_id", "name", "color", "sort_order", "created_at", "updated_at", "created_by", "updated_by")
SELECT m."new_id", c."workspace_id", m."project_id", c."name", c."color", c."sort_order", c."created_at", now(), c."created_by", c."updated_by"
FROM "_category_map" m JOIN "categories" c ON c."id" = m."old_id";

-- The tenant trigger on tasks still checks the old rule at this point
-- (category in the task's workspace), which the copies satisfy.
UPDATE "tasks" t SET "category_id" = m."new_id"
FROM "_category_map" m
WHERE t."category_id" = m."old_id" AND t."project_id" = m."project_id";

UPDATE "captured_thoughts" ct SET "category_id" = m."new_id"
FROM "_category_map" m
WHERE ct."category_id" = m."old_id" AND ct."project_id" = m."project_id";

DELETE FROM "categories" WHERE "project_id" IS NULL;
DROP TABLE "_category_map";

ALTER TABLE "categories" ALTER COLUMN "project_id" SET NOT NULL;

CREATE INDEX "categories_project_id_sort_order_idx" ON "categories"("project_id", "sort_order");
CREATE INDEX "categories_workspace_id_idx" ON "categories"("workspace_id");
CREATE UNIQUE INDEX "categories_project_id_name_key" ON "categories"("project_id", "name");
ALTER TABLE "categories" ADD CONSTRAINT "categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Objectives: project scope + cascading from a parent key result
-- ---------------------------------------------------------------------------
ALTER TABLE "objectives" ADD COLUMN "parent_key_result_id" UUID,
ADD COLUMN "project_id" UUID;

CREATE INDEX "objectives_project_id_idx" ON "objectives"("project_id");
CREATE INDEX "objectives_parent_key_result_id_idx" ON "objectives"("parent_key_result_id");
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parent_key_result_id_fkey" FOREIGN KEY ("parent_key_result_id") REFERENCES "key_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tasks: objective link + rich page content
-- ---------------------------------------------------------------------------
ALTER TABLE "tasks" ADD COLUMN "content" TEXT,
ADD COLUMN "objective_id" UUID;

-- Tasks already linked to a key result belong to that key result's objective.
UPDATE "tasks" t SET "objective_id" = kr."objective_id"
FROM "key_results" kr
WHERE t."key_result_id" = kr."id";

CREATE INDEX "tasks_objective_id_idx" ON "tasks"("objective_id");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A key result without its objective is not allowed (the objective is derived from it).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_key_result_needs_objective" CHECK ("key_result_id" IS NULL OR "objective_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Wiki pages
-- ---------------------------------------------------------------------------
CREATE TABLE "wiki_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_page_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "icon" VARCHAR(16),
    "content" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "wiki_pages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wiki_pages_title_not_blank" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "wiki_pages_not_own_parent" CHECK ("parent_page_id" IS NULL OR "parent_page_id" <> "id")
);

CREATE INDEX "wiki_pages_project_id_deleted_at_sort_order_idx" ON "wiki_pages"("project_id", "deleted_at", "sort_order");
CREATE INDEX "wiki_pages_parent_page_id_idx" ON "wiki_pages"("parent_page_id");
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_parent_page_id_fkey" FOREIGN KEY ("parent_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Attachments can belong to a wiki page instead of a task (inline images).
ALTER TABLE "attachments" ALTER COLUMN "task_id" DROP NOT NULL,
ADD COLUMN "wiki_page_id" UUID;
CREATE INDEX "attachments_wiki_page_id_idx" ON "attachments"("wiki_page_id");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_one_owner" CHECK (num_nonnulls("task_id", "wiki_page_id") = 1);

-- ---------------------------------------------------------------------------
-- Tenant integrity (replaces the task trigger function; adds objective and
-- wiki rules)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_task_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'task project must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM statuses WHERE id = NEW.status_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'task status must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'task category must belong to the task project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.parent_task_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'parent task must belong to the same project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.objective_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objectives WHERE id = NEW.objective_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'task objective must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.key_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM key_results kr JOIN objectives o ON o.id = kr.objective_id
    WHERE kr.id = NEW.key_result_id AND o.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'task key result must belong to the task workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.key_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM key_results WHERE id = NEW.key_result_id AND objective_id = NEW.objective_id
  ) THEN
    RAISE EXCEPTION 'task key result must belong to the task objective' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "tasks_enforce_tenant" ON "tasks";
CREATE TRIGGER "tasks_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, project_id, status_id, category_id, parent_task_id, key_result_id, objective_id ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION enforce_task_tenant();

-- Categories: the project must be in the category's workspace.
CREATE OR REPLACE FUNCTION enforce_category_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'category project must belong to the category workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "categories_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, project_id ON "categories"
  FOR EACH ROW EXECUTE FUNCTION enforce_category_tenant();

-- Objectives: project, parent objective and parent key result in the same workspace.
CREATE OR REPLACE FUNCTION enforce_objective_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'objective project must belong to the objective workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_objective_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objectives WHERE id = NEW.parent_objective_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'parent objective must belong to the objective workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_key_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM key_results kr JOIN objectives o ON o.id = kr.objective_id
    WHERE kr.id = NEW.parent_key_result_id AND o.workspace_id = NEW.workspace_id AND o.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'parent key result must belong to another objective in the workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "objectives_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, project_id, parent_objective_id, parent_key_result_id ON "objectives"
  FOR EACH ROW EXECUTE FUNCTION enforce_objective_tenant();

-- Wiki pages: project in the page's workspace, parent page in the same project.
CREATE OR REPLACE FUNCTION enforce_wiki_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'wiki page project must belong to the page workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_pages WHERE id = NEW.parent_page_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'parent page must belong to the same project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wiki_pages_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, project_id, parent_page_id ON "wiki_pages"
  FOR EACH ROW EXECUTE FUNCTION enforce_wiki_tenant();

-- Attachments: owner (task or wiki page) must be in the attachment's workspace.
CREATE OR REPLACE FUNCTION enforce_attachment_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'attachment task must belong to the attachment workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.wiki_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_pages WHERE id = NEW.wiki_page_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'attachment wiki page must belong to the attachment workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attachments_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, task_id, wiki_page_id ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION enforce_attachment_tenant();
