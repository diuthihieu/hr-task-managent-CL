-- Teams-style emoji reactions on task comments. The composite primary key
-- makes toggles idempotent per user and emoji; both parents cascade safely.
CREATE TABLE "comment_reactions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("comment_id","user_id","emoji")
);

CREATE INDEX "comment_reactions_user_id_idx" ON "comment_reactions"("user_id");

ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_fkey"
  FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
