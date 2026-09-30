-- Structured decisions: an owner and a review date.

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "review_date" DATE;

-- CreateIndex
CREATE INDEX "decisions_workspace_id_review_date_idx" ON "decisions"("workspace_id", "review_date");

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The owner is a member of the decision's workspace.
CREATE OR REPLACE FUNCTION enforce_decision_owner_member() RETURNS trigger AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_id) THEN
    RAISE EXCEPTION 'decision owner must be a member of its workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "decisions_enforce_owner"
  BEFORE INSERT OR UPDATE OF owner_id, workspace_id ON "decisions"
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_owner_member();
