-- Wikis move from "one per project" to workspace-level knowledge spaces with
-- their own access rules. Existing project wikis become wikis named after the
-- project (reusing the project's id as the wiki id), keeping pages, AI
-- settings, documents and conversations. Nothing is deleted.

CREATE TYPE "WikiAccess" AS ENUM ('workspace', 'restricted');
CREATE TYPE "WikiRole" AS ENUM ('viewer', 'editor', 'manager');

CREATE TABLE "wikis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(16),
    "color" VARCHAR(9) NOT NULL DEFAULT '#f97316',
    "access" "WikiAccess" NOT NULL DEFAULT 'workspace',
    "default_role" "WikiRole" NOT NULL DEFAULT 'editor',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "wikis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wikis_name_not_blank" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "wikis_default_role" CHECK ("default_role" IN ('viewer', 'editor'))
);
CREATE INDEX "wikis_workspace_id_deleted_at_sort_order_idx" ON "wikis"("workspace_id", "deleted_at", "sort_order");
ALTER TABLE "wikis" ADD CONSTRAINT "wikis_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wikis" ADD CONSTRAINT "wikis_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "wiki_members" (
    "wiki_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WikiRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wiki_members_pkey" PRIMARY KEY ("wiki_id", "user_id")
);
CREATE INDEX "wiki_members_user_id_idx" ON "wiki_members"("user_id");
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1) One wiki per project that has any wiki content.
INSERT INTO "wikis" ("id", "workspace_id", "name", "color", "access", "default_role", "sort_order", "created_at", "updated_at", "created_by", "deleted_at")
SELECT p.id, p.workspace_id, left('Wiki · ' || p.name, 160), '#f97316',
       CASE WHEN EXISTS (SELECT 1 FROM project_hidden_members h WHERE h.project_id = p.id) THEN 'restricted'::"WikiAccess" ELSE 'workspace'::"WikiAccess" END,
       'editor', p.sort_order, p.created_at, now(), COALESCE(p.created_by, p.owner_id), p.deleted_at
FROM projects p
WHERE EXISTS (SELECT 1 FROM wiki_pages w WHERE w.project_id = p.id)
   OR EXISTS (SELECT 1 FROM knowledge_docs d WHERE d.project_id = p.id)
   OR EXISTS (SELECT 1 FROM project_ai_settings s WHERE s.project_id = p.id)
   OR EXISTS (SELECT 1 FROM ai_conversations c WHERE c.project_id = p.id);

-- 2) The project owner/creator keep managing it.
INSERT INTO "wiki_members" ("wiki_id", "user_id", "role")
SELECT DISTINCT w.id, u.user_id, 'manager'::"WikiRole"
FROM wikis w JOIN projects p ON p.id = w.id
CROSS JOIN LATERAL (VALUES (p.owner_id), (p.created_by)) AS u(user_id)
WHERE u.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.workspace_id AND m.user_id = u.user_id)
ON CONFLICT DO NOTHING;

-- 3) Projects hidden from some members: their wiki becomes restricted to everyone else.
INSERT INTO "wiki_members" ("wiki_id", "user_id", "role")
SELECT w.id, m.user_id, CASE WHEN m.role = 'viewer' THEN 'viewer'::"WikiRole" ELSE 'editor'::"WikiRole" END
FROM wikis w JOIN workspace_members m ON m.workspace_id = w.workspace_id
WHERE w.access = 'restricted'
  AND NOT EXISTS (SELECT 1 FROM project_hidden_members h WHERE h.project_id = w.id AND h.user_id = m.user_id)
ON CONFLICT DO NOTHING;

-- 4) Pages move to the wiki.
DROP TRIGGER IF EXISTS "wiki_pages_enforce_tenant" ON "wiki_pages";
DROP FUNCTION IF EXISTS enforce_wiki_tenant();
ALTER TABLE "wiki_pages" ADD COLUMN "wiki_id" UUID;
UPDATE "wiki_pages" SET "wiki_id" = "project_id";
ALTER TABLE "wiki_pages" ALTER COLUMN "wiki_id" SET NOT NULL;
ALTER TABLE "wiki_pages" DROP CONSTRAINT "wiki_pages_project_id_fkey";
DROP INDEX "wiki_pages_project_id_deleted_at_sort_order_idx";
ALTER TABLE "wiki_pages" DROP COLUMN "project_id";
CREATE INDEX "wiki_pages_wiki_id_deleted_at_sort_order_idx" ON "wiki_pages"("wiki_id", "deleted_at", "sort_order");
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_wiki_page_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wikis WHERE id = NEW.wiki_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'wiki page must belong to a wiki of its workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_pages WHERE id = NEW.parent_page_id AND wiki_id = NEW.wiki_id) THEN
    RAISE EXCEPTION 'parent page must belong to the same wiki' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "wiki_pages_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, wiki_id, parent_page_id ON "wiki_pages"
  FOR EACH ROW EXECUTE FUNCTION enforce_wiki_page_tenant();

-- 5) AI settings, documents and conversations follow.
ALTER TABLE "project_ai_settings" RENAME TO "wiki_ai_settings";
ALTER TABLE "wiki_ai_settings" RENAME COLUMN "project_id" TO "wiki_id";
ALTER TABLE "wiki_ai_settings" RENAME CONSTRAINT "project_ai_settings_pkey" TO "wiki_ai_settings_pkey";
ALTER TABLE "wiki_ai_settings" DROP CONSTRAINT "project_ai_settings_project_id_fkey";
ALTER TABLE "wiki_ai_settings" RENAME CONSTRAINT "project_ai_settings_updated_by_fkey" TO "wiki_ai_settings_updated_by_fkey";
ALTER TABLE "wiki_ai_settings" ADD CONSTRAINT "wiki_ai_settings_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS "knowledge_docs_enforce_project" ON "knowledge_docs";
DROP TRIGGER IF EXISTS "ai_conversations_enforce_project" ON "ai_conversations";
DROP FUNCTION IF EXISTS enforce_project_in_workspace();

ALTER TABLE "knowledge_docs" RENAME COLUMN "project_id" TO "wiki_id";
ALTER TABLE "knowledge_docs" DROP CONSTRAINT "knowledge_docs_project_id_fkey";
ALTER INDEX "knowledge_docs_project_id_deleted_at_idx" RENAME TO "knowledge_docs_wiki_id_deleted_at_idx";
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_conversations" RENAME COLUMN "project_id" TO "wiki_id";
ALTER TABLE "ai_conversations" DROP CONSTRAINT "ai_conversations_project_id_fkey";
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant integrity: a wiki member belongs to the workspace; docs/conversations use a wiki of their workspace.
CREATE OR REPLACE FUNCTION enforce_wiki_in_workspace() RETURNS trigger AS $$
BEGIN
  IF NEW.wiki_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wikis w WHERE w.id = NEW.wiki_id AND w.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'wiki must belong to the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER knowledge_docs_enforce_wiki BEFORE INSERT OR UPDATE OF wiki_id, workspace_id ON "knowledge_docs"
  FOR EACH ROW EXECUTE FUNCTION enforce_wiki_in_workspace();
CREATE TRIGGER ai_conversations_enforce_wiki BEFORE INSERT OR UPDATE OF wiki_id, workspace_id ON "ai_conversations"
  FOR EACH ROW EXECUTE FUNCTION enforce_wiki_in_workspace();

CREATE OR REPLACE FUNCTION enforce_wiki_member_in_workspace() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wikis w JOIN workspace_members m ON m.workspace_id = w.workspace_id WHERE w.id = NEW.wiki_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'wiki member must be a member of the wiki workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wiki_members_enforce_membership BEFORE INSERT OR UPDATE OF wiki_id, user_id ON "wiki_members"
  FOR EACH ROW EXECUTE FUNCTION enforce_wiki_member_in_workspace();
