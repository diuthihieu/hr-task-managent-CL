-- Work Second Brain: knowledge metadata on wiki pages (kind, tags, temporal
-- validity, provenance), decisions, daily journal, progressive-summary layers,
-- spaced reviews, recurring tasks, and sources on Ask My Brain answers.

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('page', 'meeting', 'retrospective', 'process', 'note');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('draft', 'current', 'outdated', 'superseded', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeSource" AS ENUM ('manual', 'imported', 'ai_generated', 'converted');

-- CreateEnum
CREATE TYPE "KnowledgeConfidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('proposed', 'active', 'superseded', 'revoked');

-- AlterEnum
ALTER TYPE "AiConversationKind" ADD VALUE 'brain';

-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "sources" JSONB;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "recurrence_freq" "RecurrenceFreq",
ADD COLUMN     "recurrence_interval" INTEGER,
ADD COLUMN     "recurrence_parent_id" UUID;

-- AlterTable
ALTER TABLE "wiki_pages" ADD COLUMN     "confidence" "KnowledgeConfidence",
ADD COLUMN     "event_date" DATE,
ADD COLUMN     "kind" "KnowledgeKind" NOT NULL DEFAULT 'page',
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_checked_by" UUID,
ADD COLUMN     "last_viewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "source_label" VARCHAR(300),
ADD COLUMN     "source_ref" VARCHAR(120),
ADD COLUMN     "source_type" "KnowledgeSource" NOT NULL DEFAULT 'manual',
ADD COLUMN     "source_url" VARCHAR(1000),
ADD COLUMN     "status" "KnowledgeStatus" NOT NULL DEFAULT 'current',
ADD COLUMN     "supersedes_id" UUID,
ADD COLUMN     "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "valid_from" DATE,
ADD COLUMN     "valid_to" DATE,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "wiki_page_id" UUID,
    "source_block_id" VARCHAR(40),
    "task_id" UUID,
    "objective_id" UUID,
    "title" VARCHAR(500) NOT NULL,
    "reason" TEXT,
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "evidence" TEXT,
    "source_url" VARCHAR(1000),
    "decided_at" DATE NOT NULL DEFAULT CURRENT_DATE,
    "status" "DecisionStatus" NOT NULL DEFAULT 'active',
    "valid_from" DATE,
    "valid_to" DATE,
    "supersedes_id" UUID,
    "source_type" "KnowledgeSource" NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_people" (
    "decision_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "decision_people_pkey" PRIMARY KEY ("decision_id","user_id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "ai_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_layers" (
    "page_id" UUID NOT NULL,
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "key_points" TEXT,
    "summary" TEXT,
    "insights" TEXT,
    "generated_from" TIMESTAMPTZ(6),
    "generated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_layers_pkey" PRIMARY KEY ("page_id")
);

-- CreateTable
CREATE TABLE "knowledge_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "next_review_at" TIMESTAMPTZ(6) NOT NULL,
    "last_reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decisions_supersedes_id_key" ON "decisions"("supersedes_id");

-- CreateIndex
CREATE INDEX "decisions_workspace_id_deleted_at_decided_at_idx" ON "decisions"("workspace_id", "deleted_at", "decided_at" DESC);

-- CreateIndex
CREATE INDEX "decisions_project_id_idx" ON "decisions"("project_id");

-- CreateIndex
CREATE INDEX "decisions_wiki_page_id_idx" ON "decisions"("wiki_page_id");

-- CreateIndex
CREATE INDEX "decision_people_user_id_idx" ON "decision_people"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_user_id_workspace_id_date_key" ON "journal_entries"("user_id", "workspace_id", "date");

-- CreateIndex
CREATE INDEX "knowledge_reviews_user_id_next_review_at_idx" ON "knowledge_reviews"("user_id", "next_review_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_reviews_user_id_page_id_key" ON "knowledge_reviews"("user_id", "page_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_recurrence_parent_id_key" ON "tasks"("recurrence_parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_pages_supersedes_id_key" ON "wiki_pages"("supersedes_id");

-- CreateIndex
CREATE INDEX "wiki_pages_workspace_id_deleted_at_kind_idx" ON "wiki_pages"("workspace_id", "deleted_at", "kind");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_parent_id_fkey" FOREIGN KEY ("recurrence_parent_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "wiki_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_people" ADD CONSTRAINT "decision_people_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_people" ADD CONSTRAINT "decision_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_layers" ADD CONSTRAINT "knowledge_layers_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_reviews" ADD CONSTRAINT "knowledge_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_reviews" ADD CONSTRAINT "knowledge_reviews_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A decision's project / page / task / objective and its people belong to its workspace.
CREATE OR REPLACE FUNCTION enforce_decision_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'decision project must belong to its workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.wiki_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_pages WHERE id = NEW.wiki_page_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'decision page must belong to its workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'decision task must belong to its workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.objective_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objectives WHERE id = NEW.objective_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'decision objective must belong to its workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM decisions WHERE id = NEW.supersedes_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'superseded decision must belong to the same workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "decisions_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, project_id, wiki_page_id, task_id, objective_id, supersedes_id ON "decisions"
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_tenant();

CREATE OR REPLACE FUNCTION enforce_decision_person_member() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM decisions d JOIN workspace_members m ON m.workspace_id = d.workspace_id WHERE d.id = NEW.decision_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'people involved in a decision must be members of its workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "decision_people_enforce_member"
  BEFORE INSERT OR UPDATE ON "decision_people"
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_person_member();

-- A page can only supersede a page of the same workspace.
CREATE OR REPLACE FUNCTION enforce_page_supersedes_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_pages WHERE id = NEW.supersedes_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'superseded page must belong to the same workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "wiki_pages_enforce_supersedes"
  BEFORE INSERT OR UPDATE OF supersedes_id ON "wiki_pages"
  FOR EACH ROW EXECUTE FUNCTION enforce_page_supersedes_tenant();

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_interval_check" CHECK ("recurrence_interval" IS NULL OR "recurrence_interval" BETWEEN 1 AND 365);
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from");
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from");
