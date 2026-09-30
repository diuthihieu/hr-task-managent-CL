-- Security hardening (production-readiness review):
-- * users.session_version: bumped on password change/reset/deactivation so older session cookies stop working.
-- * users.email_verified_at: email ownership. Existing accounts are grandfathered as verified (they already
--   use the app); new password sign-ups must verify before accepting an email invitation.
-- * workspaces.ai_enabled: AI must be switched on by a workspace admin. Existing workspaces keep AI on
--   (the owner already chose to use it); new workspaces start with AI off.
-- * activity_logs ip / user_agent for security events, and the log becomes append-only for DELETE too.
-- * rate_limits: counters shared by all server instances.

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "ip" VARCHAR(64),
ADD COLUMN     "user_agent" VARCHAR(300);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "ai_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" VARCHAR(200) NOT NULL,
    "count" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limits_reset_at_idx" ON "rate_limits"("reset_at");


-- Backfill (see header).
UPDATE "users" SET "email_verified_at" = COALESCE("created_at", now()) WHERE "email_verified_at" IS NULL;
UPDATE "workspaces" SET "ai_enabled" = true;

-- Activity log: no DELETE either, except a deliberate retention purge in the same transaction:
--   SET LOCAL app.allow_audit_purge = 'on'; DELETE FROM activity_logs WHERE created_at < ...;
CREATE OR REPLACE FUNCTION forbid_activity_log_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'activity_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "activity_logs_no_delete"
  BEFORE DELETE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_activity_log_delete();
