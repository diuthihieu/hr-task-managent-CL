-- CreateEnum
CREATE TYPE "AiConversationKind" AS ENUM ('wiki', 'assistant');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'model');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "accent_color" SET DEFAULT 'orange';

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "logo_data" BYTEA,
ADD COLUMN     "logo_mime_type" VARCHAR(40),
ADD COLUMN     "logo_updated_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "project_ai_settings" (
    "project_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT NOT NULL DEFAULT '',
    "greeting" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "project_ai_settings_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "knowledge_docs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "user_id" UUID NOT NULL,
    "kind" "AiConversationKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_docs_project_id_deleted_at_idx" ON "knowledge_docs"("project_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_workspace_id_kind_updated_at_idx" ON "ai_conversations"("user_id", "workspace_id", "kind", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_ai_settings" ADD CONSTRAINT "project_ai_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ai_settings" ADD CONSTRAINT "project_ai_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rebrand: orange is the new default accent. Users still on the old default move with it
-- (they can pick another colour in Preferences).
UPDATE "users" SET "accent_color" = 'orange' WHERE "accent_color" = 'indigo';

-- Logos are small images kept in the database.
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_logo_size" CHECK ("logo_data" IS NULL OR octet_length("logo_data") <= 262144);
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_logo_mime" CHECK ("logo_mime_type" IS NULL OR "logo_mime_type" IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_title_not_blank" CHECK (length(btrim("title")) > 0);

-- Tenant integrity: a knowledge doc / conversation's project lives in its workspace.
CREATE OR REPLACE FUNCTION enforce_project_in_workspace() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'project must belong to the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_docs_enforce_project BEFORE INSERT OR UPDATE OF project_id, workspace_id ON "knowledge_docs"
  FOR EACH ROW EXECUTE FUNCTION enforce_project_in_workspace();
CREATE TRIGGER ai_conversations_enforce_project BEFORE INSERT OR UPDATE OF project_id, workspace_id ON "ai_conversations"
  FOR EACH ROW EXECUTE FUNCTION enforce_project_in_workspace();
