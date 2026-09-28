-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "extracted_text" TEXT,
ADD COLUMN     "wiki_comment_id" UUID;

-- CreateTable
CREATE TABLE "wiki_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "wiki_page_id" UUID NOT NULL,
    "author_id" UUID,
    "parent_comment_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "wiki_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_comment_mentions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "wiki_comment_mentions_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateIndex
CREATE INDEX "wiki_comments_wiki_page_id_created_at_idx" ON "wiki_comments"("wiki_page_id", "created_at");

-- CreateIndex
CREATE INDEX "wiki_comment_mentions_user_id_idx" ON "wiki_comment_mentions"("user_id");

-- CreateIndex
CREATE INDEX "attachments_wiki_comment_id_idx" ON "attachments"("wiki_comment_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_wiki_comment_id_fkey" FOREIGN KEY ("wiki_comment_id") REFERENCES "wiki_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "wiki_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_comment_mentions" ADD CONSTRAINT "wiki_comment_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "wiki_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_comment_mentions" ADD CONSTRAINT "wiki_comment_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_body_len" CHECK (char_length("body") BETWEEN 1 AND 10000);

-- A wiki comment belongs to its page's workspace; a reply stays on its parent's page.
CREATE OR REPLACE FUNCTION enforce_wiki_comment_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wiki_pages p WHERE p.id = NEW.wiki_page_id AND p.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'wiki comment page must belong to the comment workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_comments c WHERE c.id = NEW.parent_comment_id AND c.wiki_page_id = NEW.wiki_page_id) THEN
    RAISE EXCEPTION 'wiki comment reply must be on the same page as its parent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wiki_comments_enforce_tenant BEFORE INSERT OR UPDATE OF wiki_page_id, workspace_id, parent_comment_id ON "wiki_comments"
  FOR EACH ROW EXECUTE FUNCTION enforce_wiki_comment_tenant();

-- A file attached to a wiki comment lives on that comment's page.
CREATE OR REPLACE FUNCTION enforce_attachment_wiki_comment() RETURNS trigger AS $$
BEGIN
  IF NEW.wiki_comment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_comments c WHERE c.id = NEW.wiki_comment_id AND c.wiki_page_id = NEW.wiki_page_id) THEN
    RAISE EXCEPTION 'wiki comment attachment must be on the comment page' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER attachments_enforce_wiki_comment BEFORE INSERT OR UPDATE OF wiki_comment_id, wiki_page_id ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION enforce_attachment_wiki_comment();
