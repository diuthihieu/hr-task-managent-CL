-- AlterTable
ALTER TABLE "Base" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TableDef" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;
