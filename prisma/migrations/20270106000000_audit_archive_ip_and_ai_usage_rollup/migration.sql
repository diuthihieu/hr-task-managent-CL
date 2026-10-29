-- BUG-19: archived audit rows keep the security fields and are append-only like
-- activity_logs; AI usage older than the retention is rolled up per month before
-- the raw rows are deleted, so all-time totals survive the clean-up.

-- AlterTable
ALTER TABLE "activity_log_archives" ADD COLUMN "ip" VARCHAR(64),
ADD COLUMN "user_agent" VARCHAR(300);

-- The same append-only guards as activity_logs (functions already pin search_path,
-- see 20270103000000_lock_down_data_api). DELETE is allowed only after
-- SET LOCAL app.allow_audit_purge = 'on'. These stop application bugs and SQL
-- injection; they don't stop someone holding the owner role's credentials.
CREATE TRIGGER activity_log_archives_no_update BEFORE UPDATE ON "activity_log_archives"
  FOR EACH ROW EXECUTE FUNCTION forbid_activity_log_update();
CREATE TRIGGER activity_log_archives_no_delete BEFORE DELETE ON "activity_log_archives"
  FOR EACH ROW EXECUTE FUNCTION forbid_activity_log_delete();

-- CreateTable
CREATE TABLE "ai_usage_monthly" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(400) NOT NULL,
    "month" DATE NOT NULL,
    "workspace_id" UUID,
    "user_id" UUID,
    "feature" VARCHAR(160) NOT NULL,
    "model" VARCHAR(80),
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokens_in" BIGINT NOT NULL DEFAULT 0,
    "tokens_out" BIGINT NOT NULL DEFAULT 0,
    "last_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_usage_monthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_monthly_key_key" ON "ai_usage_monthly"("key");

-- CreateIndex
CREATE INDEX "ai_usage_monthly_workspace_id_month_idx" ON "ai_usage_monthly"("workspace_id", "month");

-- AddForeignKey
ALTER TABLE "ai_usage_monthly" ADD CONSTRAINT "ai_usage_monthly_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_monthly" ADD CONSTRAINT "ai_usage_monthly_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same lock-down as every other table (see 20270103000000_lock_down_data_api).
ALTER TABLE "ai_usage_monthly" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.ai_usage_monthly FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
