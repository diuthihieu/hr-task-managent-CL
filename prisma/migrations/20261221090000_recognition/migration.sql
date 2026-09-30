-- Recognition: points rules + ledger, delegated managers, per-member point
-- visibility, kudos letters, reward catalog and redemptions.

-- CreateEnum
CREATE TYPE "PointAction" AS ENUM ('task_completed', 'task_on_time', 'task_created', 'comment_posted', 'helped_colleague', 'kudos_received', 'kudos_sent', 'wiki_page_created', 'decision_recorded', 'focus_hour', 'approval_given');

-- CreateEnum
CREATE TYPE "KudosStyle" AS ENUM ('gratitude', 'appreciation', 'teamwork', 'above_beyond', 'mentor');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "recognition_settings" (
    "workspace_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "members_see_points" BOOLEAN NOT NULL DEFAULT true,
    "points_since" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recognition_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "point_rules" (
    "workspace_id" UUID NOT NULL,
    "action" "PointAction" NOT NULL,
    "points" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "point_rules_pkey" PRIMARY KEY ("workspace_id","action")
);

-- CreateTable
CREATE TABLE "point_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "PointAction" NOT NULL,
    "points" INTEGER NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognition_managers" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recognition_managers_pkey" PRIMARY KEY ("workspace_id","user_id")
);

-- CreateTable
CREATE TABLE "recognition_members" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "can_view_others_points" BOOLEAN NOT NULL,

    CONSTRAINT "recognition_members_pkey" PRIMARY KEY ("workspace_id","user_id")
);

-- CreateTable
CREATE TABLE "kudos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "style" "KudosStyle" NOT NULL DEFAULT 'gratitude',
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "task_id" UUID,
    "project_id" UUID,
    "values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "kudos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "image_data" BYTEA,
    "image_mime_type" VARCHAR(40),
    "points_cost" INTEGER NOT NULL,
    "price" DECIMAL(14,2),
    "currency" VARCHAR(8) NOT NULL DEFAULT 'VND',
    "quantity" INTEGER NOT NULL,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'pending',
    "note" VARCHAR(1000),
    "decision_note" VARCHAR(1000),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "point_events_workspace_id_occurred_at_idx" ON "point_events"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "point_events_workspace_id_user_id_idx" ON "point_events"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_events_workspace_id_user_id_action_source_id_key" ON "point_events"("workspace_id", "user_id", "action", "source_id");

-- CreateIndex
CREATE INDEX "kudos_workspace_id_created_at_idx" ON "kudos"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "kudos_to_id_created_at_idx" ON "kudos"("to_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "kudos_from_id_idx" ON "kudos"("from_id");

-- CreateIndex
CREATE INDEX "rewards_workspace_id_deleted_at_sort_order_idx" ON "rewards"("workspace_id", "deleted_at", "sort_order");

-- CreateIndex
CREATE INDEX "reward_redemptions_workspace_id_status_created_at_idx" ON "reward_redemptions"("workspace_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reward_redemptions_user_id_status_idx" ON "reward_redemptions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "recognition_settings" ADD CONSTRAINT "recognition_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_managers" ADD CONSTRAINT "recognition_managers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_managers" ADD CONSTRAINT "recognition_managers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_members" ADD CONSTRAINT "recognition_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_members" ADD CONSTRAINT "recognition_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_points_check" CHECK ("points" BETWEEN -1000 AND 1000);
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_stock_check" CHECK ("quantity" >= 0 AND "approved_count" >= 0 AND "approved_count" <= "quantity");
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_cost_check" CHECK ("points_cost" > 0);
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_points_check" CHECK ("points" > 0);
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_not_self_check" CHECK ("from_id" <> "to_id");

-- Kudos: sender and receiver are members of the workspace; task/project belong to it.
CREATE OR REPLACE FUNCTION enforce_kudos_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.from_id)
     OR NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.to_id) THEN
    RAISE EXCEPTION 'kudos sender and receiver must be members of the workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'kudos task must belong to the workspace' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'kudos project must belong to the workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "kudos_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, from_id, to_id, task_id, project_id ON "kudos"
  FOR EACH ROW EXECUTE FUNCTION enforce_kudos_tenant();

-- A redemption's reward is in the same workspace.
CREATE OR REPLACE FUNCTION enforce_redemption_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rewards WHERE id = NEW.reward_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'redemption reward must belong to the workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "reward_redemptions_enforce_tenant"
  BEFORE INSERT OR UPDATE OF workspace_id, reward_id ON "reward_redemptions"
  FOR EACH ROW EXECUTE FUNCTION enforce_redemption_tenant();
