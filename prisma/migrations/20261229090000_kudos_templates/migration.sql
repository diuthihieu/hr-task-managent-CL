-- Kudos: card template and editable greeting / closing.

-- AlterTable
ALTER TABLE "kudos" ADD COLUMN     "closing" VARCHAR(200),
ADD COLUMN     "greeting" VARCHAR(200),
ADD COLUMN     "template" VARCHAR(30) NOT NULL DEFAULT 'classic';

