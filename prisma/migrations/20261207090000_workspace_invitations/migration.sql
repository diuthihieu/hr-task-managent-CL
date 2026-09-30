-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'declined', 'revoked');

-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "invited_user_id" UUID,
    "role" "workspace_role" NOT NULL DEFAULT 'editor',
    "token" VARCHAR(64) NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "message" VARCHAR(500),
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invite_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "role" "workspace_role" NOT NULL DEFAULT 'contributor',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "use_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workspace_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_token_key" ON "workspace_invitations"("token");

-- CreateIndex
CREATE INDEX "workspace_invitations_workspace_id_status_idx" ON "workspace_invitations"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workspace_invitations_email_status_idx" ON "workspace_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "workspace_invitations_invited_user_id_status_idx" ON "workspace_invitations"("invited_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invite_links_token_key" ON "workspace_invite_links"("token");

-- CreateIndex
CREATE INDEX "workspace_invite_links_workspace_id_revoked_at_idx" ON "workspace_invite_links"("workspace_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invite_links" ADD CONSTRAINT "workspace_invite_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invite_links" ADD CONSTRAINT "workspace_invite_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One pending invitation per workspace and email; one live link per workspace.
CREATE UNIQUE INDEX "workspace_invitations_one_pending" ON "workspace_invitations" ("workspace_id", lower("email")) WHERE "status" = 'pending';
CREATE UNIQUE INDEX "workspace_invite_links_one_live" ON "workspace_invite_links" ("workspace_id") WHERE "revoked_at" IS NULL;
-- Owners are made by owners in settings, never through an invitation or link.
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_not_owner" CHECK ("role" <> 'owner');
ALTER TABLE "workspace_invite_links" ADD CONSTRAINT "workspace_invite_links_role" CHECK ("role" IN ('editor', 'contributor', 'viewer'));
