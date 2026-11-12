-- Skills run on demand with a slash command and their own parameters (Agent Work, phase 2).
ALTER TYPE "agent_origin_type" ADD VALUE 'command';

ALTER TABLE "agent_skills" ADD COLUMN "command" VARCHAR(60);
ALTER TABLE "agent_skills" ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "agent_skills_workspace_id_command_idx" ON "agent_skills"("workspace_id", "command");
