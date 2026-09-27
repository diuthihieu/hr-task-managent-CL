-- Desktop client release registry (Download page + updater manifest).
-- CreateEnum
CREATE TYPE "release_channel" AS ENUM ('stable', 'beta');

-- CreateTable
CREATE TABLE "desktop_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" VARCHAR(40) NOT NULL,
    "platform" VARCHAR(40) NOT NULL DEFAULT 'windows-x86_64',
    "channel" "release_channel" NOT NULL DEFAULT 'stable',
    "installer_url" TEXT NOT NULL,
    "installer_file_name" VARCHAR(255) NOT NULL,
    "installer_size_bytes" BIGINT,
    "sha256" VARCHAR(64),
    "updater_url" TEXT,
    "updater_signature" TEXT,
    "min_os_version" VARCHAR(120) NOT NULL DEFAULT 'Windows 10 (1803+) / Windows 11, 64-bit',
    "release_notes" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "desktop_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "desktop_releases_platform_channel_is_published_published_at_idx" ON "desktop_releases"("platform", "channel", "is_published", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "desktop_releases_platform_channel_version_key" ON "desktop_releases"("platform", "channel", "version");


-- Integrity rules Prisma can't express.
ALTER TABLE "desktop_releases"
  ADD CONSTRAINT "desktop_releases_version_semver" CHECK ("version" ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'),
  ADD CONSTRAINT "desktop_releases_installer_https" CHECK ("installer_url" ~ '^https://'),
  ADD CONSTRAINT "desktop_releases_updater_https" CHECK ("updater_url" IS NULL OR "updater_url" ~ '^https://'),
  ADD CONSTRAINT "desktop_releases_size_non_negative" CHECK ("installer_size_bytes" IS NULL OR "installer_size_bytes" >= 0),
  ADD CONSTRAINT "desktop_releases_sha256_hex" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');
