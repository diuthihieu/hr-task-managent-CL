-- Per-project capabilities of a member (capped by their workspace role in the app).
CREATE TABLE "project_member_permissions" (
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "project_member_permissions_pkey" PRIMARY KEY ("project_id","user_id")
);

CREATE INDEX "project_member_permissions_user_id_idx" ON "project_member_permissions"("user_id");

ALTER TABLE "project_member_permissions" ADD CONSTRAINT "project_member_permissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_member_permissions" ADD CONSTRAINT "project_member_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
