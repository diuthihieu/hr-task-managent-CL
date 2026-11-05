-- Web Push sends each notification once: the sender that sets pushed_at first (an atomic
-- UPDATE ... WHERE pushed_at IS NULL) pushes it; concurrent reminder runs that saw the same row skip it.
-- Rows written before this migration are left NULL; they are only pushed right after they are created.
ALTER TABLE "notifications" ADD COLUMN "pushed_at" TIMESTAMPTZ(6);

-- "Your focus today" pinned by the member on Home, per workspace. No foreign key: a pin whose task is
-- done, deleted or no longer theirs is simply ignored (and cleared) when Home reads it.
ALTER TABLE "workspace_members" ADD COLUMN "focus_task_id" UUID;
