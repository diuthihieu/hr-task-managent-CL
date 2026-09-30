-- Per-user notification settings: which groups pop up in the app / as system notifications, and the ringtone.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_native_off" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "notify_popup_off" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "notify_sound" VARCHAR(20) NOT NULL DEFAULT 'chime',
ADD COLUMN     "notify_volume" SMALLINT NOT NULL DEFAULT 70;

