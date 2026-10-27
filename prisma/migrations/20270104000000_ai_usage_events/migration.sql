-- Token counts of every AI (Gemini) call, for the system admin overview. Counts only: no prompt or answer text.
-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "user_id" UUID,
    "feature" VARCHAR(160) NOT NULL,
    "model" VARCHAR(80),
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_events_workspace_id_created_at_idx" ON "ai_usage_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events"("created_at");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Same lock-down as every other table (see 20270103000000_lock_down_data_api): only the app's own role reads it.
ALTER TABLE "ai_usage_events" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.ai_usage_events FROM %I', api_role);
    END IF;
  END LOOP;
END $$;

-- History: AI answers saved before this table existed already carry token counts.
INSERT INTO "ai_usage_events" ("workspace_id", "user_id", "feature", "tokens_in", "tokens_out", "created_at")
SELECT c."workspace_id", c."user_id", 'history:' || c."kind"::text, COALESCE(m."tokens_in", 0), COALESCE(m."tokens_out", 0), m."created_at"
FROM "ai_messages" m
JOIN "ai_conversations" c ON c."id" = m."conversation_id"
WHERE m."role" = 'model' AND (m."tokens_in" IS NOT NULL OR m."tokens_out" IS NOT NULL);
