-- CreateTable
CREATE TABLE "journal_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journal_notes_user_id_workspace_id_created_at_idx" ON "journal_notes"("user_id", "workspace_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "journal_notes" ADD CONSTRAINT "journal_notes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_notes" ADD CONSTRAINT "journal_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

