-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ai_about" TEXT,
ADD COLUMN     "ai_instructions" TEXT,
ADD COLUMN     "ai_length" VARCHAR(10) NOT NULL DEFAULT 'balanced',
ADD COLUMN     "ai_tone" VARCHAR(20) NOT NULL DEFAULT 'professional',
ADD COLUMN     "avatar_data" BYTEA,
ADD COLUMN     "avatar_type" VARCHAR(40),
ADD COLUMN     "avatar_updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "google_sub" VARCHAR(64),
ADD COLUMN     "job_title" VARCHAR(120),
ADD COLUMN     "surface_tone" VARCHAR(20) NOT NULL DEFAULT 'neutral',
ADD COLUMN     "theme_mode" VARCHAR(10) NOT NULL DEFAULT 'system',
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");


-- Guard rails for the new profile / preference columns.
ALTER TABLE "users"
  ADD CONSTRAINT "users_theme_mode_check" CHECK ("theme_mode" IN ('light', 'dark', 'system')),
  ADD CONSTRAINT "users_surface_tone_check" CHECK ("surface_tone" IN ('neutral', 'slate', 'ocean', 'mint', 'sand', 'rose', 'amber')),
  ADD CONSTRAINT "users_ai_tone_check" CHECK ("ai_tone" IN ('professional', 'friendly', 'concise', 'coach', 'formal')),
  ADD CONSTRAINT "users_ai_length_check" CHECK ("ai_length" IN ('short', 'balanced', 'detailed')),
  ADD CONSTRAINT "users_ai_about_len" CHECK ("ai_about" IS NULL OR char_length("ai_about") <= 3000),
  ADD CONSTRAINT "users_ai_instructions_len" CHECK ("ai_instructions" IS NULL OR char_length("ai_instructions") <= 3000),
  ADD CONSTRAINT "users_avatar_size" CHECK ("avatar_data" IS NULL OR octet_length("avatar_data") <= 524288),
  -- Every account can sign in somehow: a password or a linked Google account.
  ADD CONSTRAINT "users_has_login" CHECK ("password_hash" IS NOT NULL OR "google_sub" IS NOT NULL);
