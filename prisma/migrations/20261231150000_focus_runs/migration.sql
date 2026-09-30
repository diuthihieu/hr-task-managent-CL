-- CreateTable
CREATE TABLE "focus_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "start_kind" VARCHAR(12) NOT NULL DEFAULT 'started',
    "end_kind" VARCHAR(12),
    "seconds" INTEGER,

    CONSTRAINT "focus_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "focus_runs_session_id_started_at_idx" ON "focus_runs"("session_id", "started_at");

-- AddForeignKey
ALTER TABLE "focus_runs" ADD CONSTRAINT "focus_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sessions from before run tracking: one run covering what is known.
INSERT INTO "focus_runs" ("session_id", "started_at", "ended_at", "start_kind", "end_kind", "seconds")
SELECT "id", COALESCE("resumed_at", "started_at"), CASE WHEN "status" = 'running' THEN NULL ELSE "ended_at" END, 'started',
       CASE "status" WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'stopped' WHEN 'paused' THEN 'paused' ELSE NULL END,
       CASE WHEN "status" = 'running' THEN NULL ELSE "elapsed_seconds" END
FROM "focus_sessions";
