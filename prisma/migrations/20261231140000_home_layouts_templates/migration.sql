-- CreateEnum
CREATE TYPE "home_template_visibility" AS ENUM ('private', 'workspace', 'shared');

-- CreateTable
CREATE TABLE "home_layouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "widgets" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "widgets" JSONB NOT NULL,
    "visibility" "home_template_visibility" NOT NULL DEFAULT 'private',
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_template_shares" (
    "template_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_template_shares_pkey" PRIMARY KEY ("template_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_layouts_workspace_id_user_id_key" ON "home_layouts"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "home_templates_workspace_id_visibility_idx" ON "home_templates"("workspace_id", "visibility");

-- CreateIndex
CREATE INDEX "home_templates_owner_id_idx" ON "home_templates"("owner_id");

-- CreateIndex
CREATE INDEX "home_template_shares_user_id_idx" ON "home_template_shares"("user_id");

-- AddForeignKey
ALTER TABLE "home_layouts" ADD CONSTRAINT "home_layouts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_layouts" ADD CONSTRAINT "home_layouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_templates" ADD CONSTRAINT "home_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_templates" ADD CONSTRAINT "home_templates_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_template_shares" ADD CONSTRAINT "home_template_shares_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "home_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_template_shares" ADD CONSTRAINT "home_template_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

