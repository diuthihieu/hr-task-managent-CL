-- Skill reference files reuse the existing private Attachment storage model.
-- The exclusive-owner check prevents a file from crossing Task/Wiki/Skill scopes.
ALTER TABLE "attachments" ADD COLUMN "agent_skill_id" UUID;
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_one_owner";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_one_owner"
  CHECK (num_nonnulls("task_id", "wiki_page_id", "agent_skill_id") = 1);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_agent_skill_id_fkey"
  FOREIGN KEY ("agent_skill_id") REFERENCES "agent_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "attachments_agent_skill_id_deleted_at_idx" ON "attachments"("agent_skill_id", "deleted_at");

CREATE OR REPLACE FUNCTION enforce_attachment_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'attachment task must belong to the attachment workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.wiki_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_pages WHERE id = NEW.wiki_page_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'attachment wiki page must belong to the attachment workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.agent_skill_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_skills WHERE id = NEW.agent_skill_id AND workspace_id = NEW.workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'attachment Agent Skill must belong to the attachment workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "attachments_enforce_tenant" ON "attachments";
CREATE TRIGGER "attachments_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, task_id, wiki_page_id, agent_skill_id ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION enforce_attachment_tenant();
