-- CreateTable
CREATE TABLE "kudos_reactions" (
    "kudos_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kudos_reactions_pkey" PRIMARY KEY ("kudos_id","user_id","emoji")
);

-- AddForeignKey
ALTER TABLE "kudos_reactions" ADD CONSTRAINT "kudos_reactions_kudos_id_fkey" FOREIGN KEY ("kudos_id") REFERENCES "kudos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos_reactions" ADD CONSTRAINT "kudos_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

